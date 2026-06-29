import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseOrderPayload } from './order-payload';
import { detectProductChanges } from './product-diff';

export type WebhookEventDto = {
  id: string;
  topic: string;
  shopDomain: string;
  payload: Prisma.JsonValue;
  status: string;
  createdAt: Date;
};

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

  async handleOrderCreated(
    raw: unknown,
    shopDomain: string,
  ): Promise<string | null> {
    const order = parseOrderPayload(raw);

    this.logger.log(
      `orders/create order=#${order.order_number} total=${order.total_price} ${order.currency} shop=${shopDomain}`,
    );

    try {
      const event = await this.prisma.webhookEvent.create({
        data: {
          topic: 'orders/create',
          shopDomain,
          shopifyId: order.id,
          payload: order,
        },
      });
      return event.id;
    } catch (err: unknown) {
      if (isPrismaUniqueConstraintError(err)) {
        this.logger.warn(
          `duplicate orders/create shopifyId=${order.id} — skipped`,
        );
        return null;
      }
      throw err;
    }
  }

  async markProcessed(id: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status: 'processed', processedAt: new Date() },
    });
  }

  async getEvents(topic: string): Promise<WebhookEventDto[]> {
    const results: WebhookEventDto[] = [];

    if (topic === 'all' || topic === 'orders') {
      const events = await this.prisma.webhookEvent.findMany({
        where: { topic: { startsWith: 'orders/' } },
        orderBy: { receivedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          topic: true,
          shopDomain: true,
          payload: true,
          status: true,
          receivedAt: true,
        },
      });
      for (const e of events) {
        results.push({
          id: e.id,
          topic: e.topic,
          shopDomain: e.shopDomain,
          payload: e.payload,
          status: e.status,
          createdAt: e.receivedAt,
        });
      }
    }

    if (topic === 'all' || topic === 'products') {
      const changeLogs = await this.prisma.productChangeLog.findMany({
        orderBy: { changedAt: 'desc' },
        take: 50,
      });

      if (changeLogs.length > 0) {
        const productIds = [...new Set(changeLogs.map((c) => c.shopifyId))];
        const products = await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, shopDomain: true },
        });
        const shopDomainMap = new Map(
          products.map((p) => [p.id, p.shopDomain]),
        );

        for (const c of changeLogs) {
          results.push({
            id: c.id,
            topic: 'products/update',
            shopDomain: shopDomainMap.get(c.shopifyId) ?? 'unknown',
            payload: {
              productTitle: c.productTitle,
              field: c.field,
              oldValue: c.oldValue ?? null,
              newValue: c.newValue,
              productId: c.shopifyId,
            },
            status: 'processed',
            createdAt: c.changedAt,
          });
        }
      }
    }

    return results
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
  }

  async getProductChanges(): Promise<
    {
      id: string;
      productTitle: string;
      fieldChanged: string;
      oldValue: string;
      newValue: string;
      changedAt: Date;
    }[]
  > {
    const rows = await this.prisma.productChangeLog.findMany({
      orderBy: { changedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        productTitle: true,
        field: true,
        oldValue: true,
        newValue: true,
        changedAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      productTitle: r.productTitle,
      fieldChanged: r.field,
      oldValue: r.oldValue ?? '',
      newValue: r.newValue,
      changedAt: r.changedAt,
    }));
  }

  async getFailedJobCount(): Promise<number> {
    return this.prisma.failedJob.count();
  }

  async getFailedJobs(): Promise<
    {
      id: string;
      jobId: string;
      queueName: string;
      jobData: unknown;
      errorMessage: string;
      attemptsMade: number;
      failedAt: Date;
    }[]
  > {
    return this.prisma.failedJob.findMany({
      orderBy: { failedAt: 'desc' },
    });
  }

  async clearFailedJobs(): Promise<{ deleted: number }> {
    const { count } = await this.prisma.failedJob.deleteMany();
    return { deleted: count };
  }

  async handleProductUpdated(
    raw: unknown,
    shopDomain: string,
  ): Promise<string | null> {
    const obj = isJsonObject(raw) ? raw : {};
    const id = obj['id'];
    const shopifyId =
      typeof id === 'string' || typeof id === 'number' ? String(id) : '';
    const title = typeof obj['title'] === 'string' ? obj['title'] : 'unknown';
    const updatedAt =
      typeof obj['updated_at'] === 'string'
        ? obj['updated_at']
        : new Date().toISOString();

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

    // Step 5: write a WebhookEvent so the dashboard can display this update.
    // Idempotency key = productId + updatedAt so Shopify retries of the same
    // delivery are silently skipped, but genuine new updates create a new row.
    try {
      const event = await this.prisma.webhookEvent.create({
        data: {
          topic: 'products/update',
          shopDomain,
          shopifyId: `${shopifyId}-${updatedAt}`,
          payload: raw as Prisma.InputJsonValue,
        },
      });
      return event.id;
    } catch (err: unknown) {
      if (isPrismaUniqueConstraintError(err)) {
        this.logger.warn(
          `duplicate products/update shopifyId=${shopifyId} updatedAt=${updatedAt} — skipped`,
        );
        return null;
      }
      throw err;
    }
  }
}
