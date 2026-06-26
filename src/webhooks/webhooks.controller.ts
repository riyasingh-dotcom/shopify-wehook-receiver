import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { WebhooksService, type WebhookEventDto } from './webhooks.service';
import type { WebhookJobData } from './webhooks.types';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    @InjectQueue('webhook-processing')
    private readonly queue: Queue<WebhookJobData>,
  ) {}

  @Get('events')
  async getEvents(@Query('topic') topic = 'all'): Promise<WebhookEventDto[]> {
    return this.webhooksService.getEvents(topic);
  }

  @Get('failed-count')
  async getFailedCount(): Promise<{ count: number }> {
    const count = await this.webhooksService.getFailedJobCount();
    return { count };
  }

  @Post('shopify')
  @HttpCode(200)
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

    const payload: unknown = JSON.parse(rawBody.toString('utf8'));
    const obj =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const idVal = obj['id'];
    const shopifyId =
      typeof idVal === 'string' || typeof idVal === 'number'
        ? String(idVal)
        : '';

    const normalizedTopic = typeof topic === 'string' ? topic : 'unknown';
    const normalizedDomain =
      typeof shopDomain === 'string' ? shopDomain : 'unknown';

    await this.queue.add(
      'process',
      {
        topic: normalizedTopic,
        shopDomain: normalizedDomain,
        shopifyId,
        payload,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );

    this.logger.log(
      `queued job topic=${normalizedTopic} shopifyId=${shopifyId}`,
    );
  }
}
