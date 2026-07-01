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

describe('WebhookProcessor.process', () => {
  let processor: WebhookProcessor;
  let handleOrderCreated: jest.Mock;
  let handleProductUpdated: jest.Mock;
  let markProcessed: jest.Mock;
  let handleSubscriptionUpdate: jest.Mock;
  let subscriptionUpdateMany: jest.Mock;

  beforeEach(async () => {
    handleOrderCreated = jest.fn().mockResolvedValue('event-1');
    handleProductUpdated = jest.fn().mockResolvedValue('event-2');
    markProcessed = jest.fn().mockResolvedValue(undefined);
    handleSubscriptionUpdate = jest.fn().mockResolvedValue(undefined);
    subscriptionUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

    const module = await Test.createTestingModule({
      providers: [
        WebhookProcessor,
        {
          provide: WebhooksService,
          useValue: { handleOrderCreated, handleProductUpdated, markProcessed },
        },
        {
          provide: PrismaService,
          useValue: {
            failedJob: { create: jest.fn() },
            subscription: { updateMany: subscriptionUpdateMany },
          },
        },
        { provide: BillingService, useValue: { handleSubscriptionUpdate } },
      ],
    }).compile();

    processor = module.get(WebhookProcessor);
  });

  it('handles orders/create and increments eventsProcessedThisMonth', async () => {
    const job = mockJob({
      data: {
        topic: 'orders/create',
        shopDomain: 'test.myshopify.com',
        shopifyId: 'sid-1',
        payload: {},
      },
    });

    await processor.process(job);

    expect(handleOrderCreated).toHaveBeenCalledWith({}, 'test.myshopify.com');
    expect(markProcessed).toHaveBeenCalledWith('event-1');
    expect(subscriptionUpdateMany).toHaveBeenCalledWith({
      where: { shopDomain: 'test.myshopify.com' },
      data: { eventsProcessedThisMonth: { increment: 1 } },
    });
  });

  it('handles products/update and increments eventsProcessedThisMonth', async () => {
    const job = mockJob({
      data: {
        topic: 'products/update',
        shopDomain: 'test.myshopify.com',
        shopifyId: 'sid-2',
        payload: {},
      },
    });

    await processor.process(job);

    expect(handleProductUpdated).toHaveBeenCalledWith({}, 'test.myshopify.com');
    expect(markProcessed).toHaveBeenCalledWith('event-2');
    expect(subscriptionUpdateMany).toHaveBeenCalledWith({
      where: { shopDomain: 'test.myshopify.com' },
      data: { eventsProcessedThisMonth: { increment: 1 } },
    });
  });

  it('handles app_subscriptions/update without incrementing events', async () => {
    const job = mockJob({
      data: {
        topic: 'app_subscriptions/update',
        shopDomain: 'test.myshopify.com',
        shopifyId: 'sid-3',
        payload: {},
      },
    });

    await processor.process(job);

    expect(handleSubscriptionUpdate).toHaveBeenCalledWith({});
    expect(markProcessed).not.toHaveBeenCalled();
    expect(subscriptionUpdateMany).not.toHaveBeenCalled();
  });

  it('rethrows errors so BullMQ can retry', async () => {
    handleOrderCreated.mockRejectedValueOnce(new Error('db down'));
    const job = mockJob();

    await expect(processor.process(job)).rejects.toThrow('db down');
    expect(subscriptionUpdateMany).not.toHaveBeenCalled();
  });
});
