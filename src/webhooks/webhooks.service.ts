import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseOrderPayload } from './order-payload';
import { detectProductChanges } from './product-diff';

function isJsonObject(
  val: unknown,
): val is { [key: string]: Prisma.InputJsonValue | null | undefined } {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'P2002'
  );
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
      .digest();
    const received = Buffer.from(signature, 'base64');
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  }

  async handleOrderCreated(raw: unknown, shopDomain: string): Promise<void> {
    const order = parseOrderPayload(raw);

    this.logger.log(
      `orders/create order=#${order.order_number} total=${order.total_price} ${order.currency} shop=${shopDomain}`,
    );

    try {
      await this.prisma.webhookEvent.create({
        data: {
          topic: 'orders/create',
          shopDomain,
          shopifyId: String(order.id),
          payload: order,
        },
      });
    } catch (err: unknown) {
      if (isPrismaUniqueConstraintError(err)) {
        this.logger.warn(`duplicate orders/create id=${order.id} — skipped`);
        return;
      }
      throw err;
    }
  }

  async handleProductUpdated(raw: unknown, shopDomain: string): Promise<void> {
    const obj = isJsonObject(raw) ? raw : {};
    const id = obj['id'];
    const shopifyId =
      typeof id === 'string' || typeof id === 'number' ? String(id) : '';
    const title = typeof obj['title'] === 'string' ? obj['title'] : 'unknown';

    this.logger.log(
      `products/update id=${shopifyId} title="${title}" shop=${shopDomain}`,
    );

    // Step 1: read previous snapshot BEFORE overwriting
    const existing = await this.prisma.product.findUnique({
      where: { id: shopifyId },
    });

    // Step 2: diff previous snapshot vs incoming payload
    const changes = detectProductChanges(existing?.payload ?? null, raw);

    if (changes.length > 0) {
      this.logger.log(
        `products/update id=${shopifyId} detected ${changes.length} change(s): ${JSON.stringify(changes)}`,
      );
    }

    // Step 3 + 4: overwrite snapshot and write audit log atomically
    const changeLogOps = changes.map((change) =>
      this.prisma.productChangeLog.create({
        data: {
          shopifyId,
          productTitle: title,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
        },
      }),
    );

    await this.prisma.$transaction([
      this.prisma.product.upsert({
        where: { id: shopifyId },
        create: {
          id: shopifyId,
          shopDomain,
          payload: raw as Prisma.InputJsonValue,
        },
        update: {
          payload: raw as Prisma.InputJsonValue,
          shopDomain,
        },
      }),
      ...changeLogOps,
    ]);
  }
}
