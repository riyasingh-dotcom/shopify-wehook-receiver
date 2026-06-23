import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseOrderPayload } from './order-payload';

// Type predicate: narrows unknown to a JSON object whose values are InputJsonValue-compatible
function isJsonObject(
  val: unknown,
): val is { [key: string]: Prisma.InputJsonValue | null | undefined } {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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

  async handleShopifyWebhook(
    topic: string,
    shopDomain: string,
    rawBody: Buffer,
  ): Promise<void> {
    const raw: unknown = JSON.parse(rawBody.toString('utf8'));
    const obj = isJsonObject(raw) ? raw : {};
    const id = obj['id'];
    const shopifyId =
      typeof id === 'string' || typeof id === 'number' ? String(id) : '';

    this.logger.log(
      `topic=${topic} payload=${JSON.stringify(raw).slice(0, 100)}`,
    );

    const payload: Prisma.InputJsonValue =
      topic === 'orders/create'
        ? parseOrderPayload(raw)
        : (raw as Prisma.InputJsonValue);

    try {
      await this.prisma.webhookEvent.create({
        data: {
          topic,
          shopDomain,
          shopifyId,
          payload,
        },
      });
    } catch (err: unknown) {
      if (isPrismaUniqueConstraintError(err)) {
        this.logger.warn(`duplicate shopifyId=${shopifyId} — skipped`);
        return;
      }
      throw err;
    }
  }
}

function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'P2002'
  );
}
