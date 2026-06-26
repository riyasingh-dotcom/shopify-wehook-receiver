import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { WebhooksService } from '../webhooks/webhooks.service';

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: { getProductChanges: jest.Mock };

  beforeEach(async () => {
    service = { getProductChanges: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: WebhooksService, useValue: service }],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getChanges', () => {
    it('returns product changes from the service', async () => {
      const changes = [
        {
          id: 'clx1',
          productTitle: 'Snowboard',
          fieldChanged: 'title',
          oldValue: 'Board',
          newValue: 'Snowboard',
          changedAt: new Date('2026-06-01T00:00:00Z'),
        },
      ];
      service.getProductChanges.mockResolvedValue(changes);

      const result = await controller.getChanges();

      expect(result).toBe(changes);
      expect(service.getProductChanges).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array when there are no changes', async () => {
      service.getProductChanges.mockResolvedValue([]);

      const result = await controller.getChanges();

      expect(result).toEqual([]);
    });
  });
});
