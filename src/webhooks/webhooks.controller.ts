import {
  Controller,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('shopify')
  async handleShopify(@Req() req: Request): Promise<void> {
    const signature = req.headers['x-shopify-hmac-sha256'];
    const topic = req.headers['x-shopify-topic'];
    const shopDomain = req.headers['x-shopify-shop-domain'];
    const rawBody = req.body as Buffer;

    if (
      typeof signature !== 'string' ||
      !Buffer.isBuffer(rawBody) ||
      !this.webhooksService.verifyShopifyHmac(rawBody, signature)
    ) {
      throw new UnauthorizedException();
    }

    const normalizedTopic = typeof topic === 'string' ? topic : 'unknown';
    const normalizedDomain =
      typeof shopDomain === 'string' ? shopDomain : 'unknown';
    const raw: unknown = JSON.parse(rawBody.toString('utf8'));

    switch (normalizedTopic) {
      case 'orders/create':
        await this.webhooksService.handleOrderCreated(raw, normalizedDomain);
        break;
      case 'products/update':
        await this.webhooksService.handleProductUpdated(raw, normalizedDomain);
        break;
      default:
        this.logger.warn(`Unhandled webhook topic: ${normalizedTopic}`);
    }
  }
}
