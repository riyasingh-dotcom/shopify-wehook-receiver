import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
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

  @Get('failed-jobs')
  async getFailedJobs() {
    return this.webhooksService.getFailedJobs();
  }

  @Delete('failed-jobs')
  async clearFailedJobs(): Promise<{ deleted: number }> {
    return this.webhooksService.clearFailedJobs();
  }

  @Post('events/:id/reprocess')
  @HttpCode(200)
  async reprocessEvent(@Param('id') id: string): Promise<void> {
    const events = await this.webhooksService.getEvents('all');
    const event = events.find((e) => e.id === id);
    if (!event) throw new NotFoundException(`Event ${id} not found`);

    const p = event.payload;
    const rawId =
      typeof p === 'object' && p !== null && !Array.isArray(p) && 'id' in p
        ? p['id']
        : undefined;
    const shopifyId =
      typeof rawId === 'string' || typeof rawId === 'number'
        ? String(rawId)
        : id;

    await this.queue.add('process', {
      topic: event.topic,
      shopDomain: event.shopDomain,
      shopifyId,
      payload: event.payload,
    });

    this.logger.log(`requeued event id=${id} topic=${event.topic}`);
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

    await this.queue.add('process', {
      topic: normalizedTopic,
      shopDomain: normalizedDomain,
      shopifyId,
      payload,
    });

    this.logger.log(
      `queued job topic=${normalizedTopic} shopifyId=${shopifyId}`,
    );
  }
}
