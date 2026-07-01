/// <reference types="jest" />

/**
 * Integration tests for plan-gated endpoints:
 *   POST /webhooks/events/:id/reprocess  (@RequiresPlan('basic'))
 *   GET  /webhooks/product-history       (@RequiresPlan('basic'))
 *
 * Prerequisites: same as webhooks-shopify.e2e-spec.ts
 *   - TEST_DATABASE_URL in .env
 *   - Test DB migrated: DATABASE_URL=$TEST_DATABASE_URL pnpm prisma migrate deploy
 *   - docker compose up testdb -d
 *
 * Run:
 *   pnpm test:e2e --testPathPatterns=plan-gating
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import express from 'express';
import { getQueueToken } from '@nestjs/bullmq';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WebhookProcessor } from '../src/webhooks/webhook.processor';
import { ShopifySessionTokenGuard } from '../src/auth/shopify-session-token.guard';

const TEST_SHOP = 'plan-test-shop.myshopify.com';

// Bypass real JWT verification — attaches a fake shopifySession to the request.
const mockSessionGuard = {
  canActivate: (ctx: {
    switchToHttp: () => { getRequest: () => Record<string, unknown> };
  }) => {
    const req = ctx.switchToHttp().getRequest();
    req.shopifySession = { dest: `https://${TEST_SHOP}` };
    return true;
  },
};

describe('Plan-gated endpoints (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const mockQueueAdd = jest.fn();

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL is required.\n' +
          'Add it to .env and run: DATABASE_URL=$TEST_DATABASE_URL pnpm prisma migrate deploy',
      );
    }

    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
    process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY ?? 'test-api-key';
    process.env.SHOPIFY_API_SECRET =
      process.env.SHOPIFY_API_SECRET ?? 'test-api-secret';
    process.env.SHOPIFY_WEBHOOK_SECRET =
      process.env.SHOPIFY_WEBHOOK_SECRET ?? 'test-secret';
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('webhook-processing'))
      .useValue({ add: mockQueueAdd })
      .overrideProvider(WebhookProcessor)
      .useValue({})
      // Bypass Shopify JWT verification so we control the session payload
      .overrideGuard(ShopifySessionTokenGuard)
      .useValue(mockSessionGuard)
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.use('/webhooks/shopify', express.raw({ type: 'application/json' }));
    app.use(express.json());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    mockQueueAdd.mockReset();
    await Promise.all([
      prisma.subscription.deleteMany({ where: { shopDomain: TEST_SHOP } }),
      prisma.webhookEvent.deleteMany(),
      prisma.productChangeLog.deleteMany(),
      prisma.product.deleteMany(),
      prisma.failedJob.deleteMany(),
    ]);
  });

  // ─── POST /webhooks/events/:id/reprocess ──────────────────────────────────

  describe('POST /webhooks/events/:id/reprocess', () => {
    it('returns 403 with plan_required error when merchant is on free plan', async () => {
      // No subscription seeded → treated as free
      const res = await request(app.getHttpServer())
        .post('/webhooks/events/some-event-id/reprocess')
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(403);
      expect(res.body as Record<string, unknown>).toMatchObject({
        error: 'plan_required',
        requiredPlan: 'basic',
        currentPlan: 'free',
        upgradeUrl: '/billing/upgrade',
      });
    });

    it('returns 403 when subscription is pending (not yet active)', async () => {
      await prisma.subscription.create({
        data: {
          shopDomain: TEST_SHOP,
          plan: 'basic',
          status: 'pending',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/webhooks/events/some-event-id/reprocess')
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(403);
      expect(res.body as Record<string, unknown>).toMatchObject({
        error: 'plan_required',
      });
    });

    it('returns 404 when merchant has basic plan but event does not exist', async () => {
      await prisma.subscription.create({
        data: {
          shopDomain: TEST_SHOP,
          plan: 'basic',
          status: 'active',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/webhooks/events/nonexistent-id/reprocess')
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(404);
    });

    it('returns 200 and re-enqueues job when merchant has active basic plan', async () => {
      await prisma.subscription.create({
        data: {
          shopDomain: TEST_SHOP,
          plan: 'basic',
          status: 'active',
        },
      });

      const event = await prisma.webhookEvent.create({
        data: {
          topic: 'orders/create',
          shopDomain: TEST_SHOP,
          shopifyId: 'shopify-order-9001',
          payload: { id: 9001 },
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/webhooks/events/${event.id}/reprocess`)
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(200);
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({
          topic: 'orders/create',
          shopDomain: TEST_SHOP,
        }),
      );
    });

    it('returns 200 when merchant has pro plan (pro >= basic)', async () => {
      await prisma.subscription.create({
        data: {
          shopDomain: TEST_SHOP,
          plan: 'pro',
          status: 'active',
        },
      });

      const event = await prisma.webhookEvent.create({
        data: {
          topic: 'orders/create',
          shopDomain: TEST_SHOP,
          shopifyId: 'shopify-order-9002',
          payload: { id: 9002 },
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/webhooks/events/${event.id}/reprocess`)
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(200);
    });
  });

  // ─── GET /webhooks/product-history ────────────────────────────────────────

  describe('GET /webhooks/product-history', () => {
    it('returns 403 when merchant is on free plan', async () => {
      const res = await request(app.getHttpServer())
        .get('/webhooks/product-history')
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(403);
      expect(res.body as Record<string, unknown>).toMatchObject({
        error: 'plan_required',
        requiredPlan: 'basic',
        currentPlan: 'free',
      });
    });

    it('returns 200 with empty array when merchant has basic plan and no history', async () => {
      await prisma.subscription.create({
        data: {
          shopDomain: TEST_SHOP,
          plan: 'basic',
          status: 'active',
        },
      });

      const res = await request(app.getHttpServer())
        .get('/webhooks/product-history')
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body as unknown[])).toBe(true);
      expect((res.body as unknown[]).length).toBe(0);
    });

    it('returns product change log entries within plan window for basic', async () => {
      await prisma.subscription.create({
        data: {
          shopDomain: TEST_SHOP,
          plan: 'basic',
          status: 'active',
        },
      });

      await prisma.product.create({
        data: { id: 'prod-001', shopDomain: TEST_SHOP, payload: {} },
      });
      await prisma.productChangeLog.create({
        data: {
          shopifyId: 'prod-001',
          productTitle: 'Test Widget',
          field: 'title',
          oldValue: 'Widget',
          newValue: 'Test Widget',
        },
      });

      const res = await request(app.getHttpServer())
        .get('/webhooks/product-history')
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body.length).toBe(1);
      expect(body[0]).toMatchObject({
        productTitle: 'Test Widget',
        fieldChanged: 'title',
        oldValue: 'Widget',
        newValue: 'Test Widget',
      });
    });

    it('returns 200 when merchant has pro plan (uses 365-day window)', async () => {
      await prisma.subscription.create({
        data: {
          shopDomain: TEST_SHOP,
          plan: 'pro',
          status: 'active',
        },
      });

      const res = await request(app.getHttpServer())
        .get('/webhooks/product-history')
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body as unknown[])).toBe(true);
    });
  });
});
