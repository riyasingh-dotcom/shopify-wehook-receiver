import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookProcessor } from './webhook.processor';
import { ProductsController } from '../products/products.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'webhook-processing' })],
  controllers: [WebhooksController, ProductsController],
  providers: [WebhooksService, WebhookProcessor],
})
export class WebhooksModule {}
