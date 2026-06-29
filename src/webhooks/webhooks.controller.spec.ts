import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: {
    verifyShopifyHmac: jest.Mock;
    handleOrderCreated: jest.Mock;
    handleProductUpdated: jest.Mock;
    getFailedJobCount: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      verifyShopifyHmac: jest.fn(),
      handleOrderCreated: jest.fn(),
      handleProductUpdated: jest.fn(),
      getFailedJobCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: WebhooksService, useValue: service },
        {
          provide: getQueueToken('webhook-processing'),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getFailedCount', () => {
    it('returns count from service', async () => {
      service.getFailedJobCount.mockResolvedValue(5);
      const result = await controller.getFailedCount();
      expect(result).toEqual({ count: 5 });
      expect(service.getFailedJobCount).toHaveBeenCalledTimes(1);
    });

    it('returns zero count when no failed jobs', async () => {
      service.getFailedJobCount.mockResolvedValue(0);
      const result = await controller.getFailedCount();
      expect(result).toEqual({ count: 0 });
    });
  });
});
