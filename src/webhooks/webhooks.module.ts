import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookProcessor } from './webhook.processor';
import { ProductsController } from '../products/products.controller';
import { ShopifyModule } from '../shopify/shopify.module';
import { ShopifySessionTokenGuard } from '../auth/shopify-session-token.guard';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'webhook-processing',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: { count: 100 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
      },
    }),
    ShopifyModule,
    BillingModule,
  ],
  controllers: [WebhooksController, ProductsController],
  providers: [WebhooksService, WebhookProcessor, ShopifySessionTokenGuard],
})
export class WebhooksModule {}
