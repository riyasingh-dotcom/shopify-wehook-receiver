import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: { failedJob: { count: jest.Mock } };

  beforeEach(async () => {
    prisma = { failedJob: { count: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFailedJobCount', () => {
    it('returns the count from prisma', async () => {
      prisma.failedJob.count.mockResolvedValue(3);
      const result = await service.getFailedJobCount();
      expect(result).toBe(3);
      expect(prisma.failedJob.count).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when there are no failed jobs', async () => {
      prisma.failedJob.count.mockResolvedValue(0);
      const result = await service.getFailedJobCount();
      expect(result).toBe(0);
    });
  });
});
