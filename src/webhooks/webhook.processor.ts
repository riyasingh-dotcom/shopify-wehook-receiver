import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WebhooksService } from './webhooks.service';
import type { WebhookJobData } from './webhooks.types';

@Processor('webhook-processing')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly webhooksService: WebhooksService) {
    super();
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
          await this.webhooksService.handleProductUpdated(payload, shopDomain);
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
