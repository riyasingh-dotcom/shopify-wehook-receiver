import { Test } from '@nestjs/testing';
import { WebhookProcessor } from './webhook.processor';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import type { Job } from 'bullmq';
import type { WebhookJobData } from './webhooks.types';

const mockJob = (
  overrides: Partial<Job<WebhookJobData>> = {},
): Job<WebhookJobData> =>
  ({
    id: 'job-1',
    name: 'default',
    attemptsMade: 1,
    opts: { attempts: 1 },
    data: {
      topic: 'orders/create',
      shopDomain: 'test.myshopify.com',
      shopifyId: 'sid-1',
      payload: {},
    },
    ...overrides,
  }) as Job<WebhookJobData>;

describe('WebhookProcessor.handleFailed', () => {
  let processor: WebhookProcessor;
  let prismaCreate: jest.Mock;

  beforeEach(async () => {
    prismaCreate = jest.fn().mockResolvedValue({});
    const module = await Test.createTestingModule({
      providers: [
        WebhookProcessor,
        { provide: WebhooksService, useValue: {} },
        {
          provide: PrismaService,
          useValue: { failedJob: { create: prismaCreate } },
        },
        { provide: BillingService, useValue: {} },
      ],
    }).compile();
    processor = module.get(WebhookProcessor);
  });

  it('writes FailedJob when attempts are exhausted', async () => {
    const job = mockJob({ attemptsMade: 1, opts: { attempts: 1 } });
    await processor.handleFailed(job, new Error('db exploded'));

    expect(prismaCreate).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        jobId: 'job-1',
        queueName: 'webhook-processing',
        errorMessage: 'db exploded',
        attemptsMade: 1,
      }),
    });
  });

  it('skips FailedJob when retries remain', async () => {
    const job = mockJob({ attemptsMade: 1, opts: { attempts: 3 } });
    await processor.handleFailed(job, new Error('transient'));

    expect(prismaCreate).not.toHaveBeenCalled();
  });

  it('handles undefined job gracefully', async () => {
    await expect(
      processor.handleFailed(undefined, new Error('x')),
    ).resolves.toBeUndefined();
    expect(prismaCreate).not.toHaveBeenCalled();
  });
});
