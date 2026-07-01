import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import type { WebhookJobData } from './webhooks.types';

@Processor('webhook-processing')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  async handleFailed(
    job: Job<WebhookJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;

    const isPermanent = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!isPermanent) return;

    const { topic, shopDomain } = job.data;

    this.logger.error(
      `PERMANENT FAILURE jobId=${job.id} jobName=${job.name} topic=${topic} ` +
        `shop=${shopDomain} attempts=${job.attemptsMade} error=${error.message}`,
    );

    await this.prisma.failedJob.create({
      data: {
        jobId: String(job.id),
        queueName: 'webhook-processing',
        jobData: job.data as unknown as Prisma.InputJsonValue,
        errorMessage: error.message,
        attemptsMade: job.attemptsMade,
      },
    });
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { topic, shopDomain, shopifyId, payload } = job.data;
    this.logger.log(`job=${job.id} topic=${topic} shopifyId=${shopifyId}`);

    let eventId: string | null = null;

    try {
      switch (topic) {
        case 'orders/create':
          eventId = await this.webhooksService.handleOrderCreated(
            payload,
            shopDomain,
          );
          break;
        case 'products/update':
          eventId = await this.webhooksService.handleProductUpdated(
            payload,
            shopDomain,
          );
          break;
        case 'app_subscriptions/update':
          await this.billingService.handleSubscriptionUpdate(payload);
          break;
        default:
          this.logger.warn(`job=${job.id} unhandled topic=${topic}`);
      }

      if (eventId !== null) {
        await this.webhooksService.markProcessed(eventId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `job=${job.id} topic=${topic} shopifyId=${shopifyId} FAILED: ${message}`,
      );
      throw err;
    }
  }
}
