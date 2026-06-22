import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly config: ConfigService) {}

  verifyShopifyHmac(rawBody: Buffer, signature: string): boolean {
    const secret = this.config.getOrThrow<string>('SHOPIFY_WEBHOOK_SECRET');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest(); // raw Buffer, not hex/base64
    const received = Buffer.from(signature, 'base64');
    // Lengths must match before timingSafeEqual — mismatched lengths throw
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  }

  handleShopifyWebhook(topic: string, rawBody: Buffer): void {
    const payload = JSON.parse(rawBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    const preview = JSON.stringify(payload).slice(0, 100);
    this.logger.log(`topic=${topic} payload=${preview}`);
  }
}
