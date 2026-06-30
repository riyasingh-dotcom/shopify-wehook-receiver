import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookProcessor } from './webhook.processor';
import { ProductsController } from '../products/products.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'webhook-processing',
      defaultJobOptions: {
        removeOnComplete: true, // delete from Redis on success — prevents accumulation
        removeOnFail: { count: 100 }, // keep last 100 failed for debugging
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
      },
    }),
  ],
  controllers: [WebhooksController, ProductsController],
  providers: [WebhooksService, WebhookProcessor],
})
export class WebhooksModule {}
