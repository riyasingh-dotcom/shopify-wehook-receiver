import { Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
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

    await this.webhooksService.handleShopifyWebhook(
      typeof topic === 'string' ? topic : 'unknown',
      typeof shopDomain === 'string' ? shopDomain : 'unknown',
      rawBody,
    );
  }
}
