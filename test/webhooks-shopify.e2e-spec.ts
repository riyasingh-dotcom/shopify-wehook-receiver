/// <reference types="jest" />

/**
 * Integration test for POST /webhooks/shopify.
 *
 * Prerequisites
 * ─────────────
 * 1. Spin up a local test database (port 5433 keeps it separate from dev):
 *
 *      # docker-compose.override.yml
 *      services:
 *        testdb:
 *          image: postgres:15-alpine
 *          environment:
 *            POSTGRES_DB: webhooks_test
 *            POSTGRES_USER: postgres
 *            POSTGRES_PASSWORD: postgres
 *          ports:
 *            - "5433:5432"
 *
 * 2. Add to .env:
 *      TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/webhooks_test
 *
 * 3. Run the schema migration against the test DB once:
 *      DATABASE_URL=$TEST_DATABASE_URL pnpm prisma migrate deploy
 *
 * 4. Run:
 *      pnpm test:e2e --testPathPatterns=webhooks-shopify
 *
 * Redis
 * ─────
 * No Redis required. The 'webhook-processing' Queue is overridden with a
 * jest spy. WebhookProcessor is overridden with a plain value so
 * BullExplorer sees no @Processor metadata and creates no Worker — no
 * IORedis connection is ever attempted.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import express from 'express';
import * as crypto from 'crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WebhookProcessor } from '../src/webhooks/webhook.processor';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-hmac-secret-32-bytes-minimum!';

/**
 * Replicates WebhooksService.verifyShopifyHmac so tests can produce
 * signatures the real app accepts.
 */
function computeHmac(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

// ─── suite ────────────────────────────────────────────────────────────────────

describe('POST /webhooks/shopify (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const mockQueueAdd = jest.fn();

  beforeAll(async () => {
    // TEST_DATABASE_URL is loaded from .env by setupFiles: ['dotenv/config']
    // in jest-e2e.json before this block runs.
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL is required.\n' +
          'Add it to .env and run the migration:\n' +
          '  DATABASE_URL=$TEST_DATABASE_URL pnpm prisma migrate deploy',
      );
    }

    // Set env vars BEFORE AppModule compiles — ConfigService and PrismaClient
    // read these at module-init time.
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    // DIRECT_URL is only used by Prisma migrations, but declared in the schema,
    // so prevent a missing-env-var error at startup.
    process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
    process.env.SHOPIFY_WEBHOOK_SECRET = TEST_SECRET;
    // ShopifyModule calls getOrThrow() on these; use real values from .env if
    // present, otherwise fall back to stubs so the module boots without real
    // Shopify credentials.  Use || (not ??) to also replace empty strings.
    process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test-api-key';
    process.env.SHOPIFY_API_SECRET =
      process.env.SHOPIFY_API_SECRET || 'test-api-secret';
    // Ensure forRootAsync takes the REDIS_URL branch, so Upstash credentials
    // are never required.
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Replace the real BullMQ Queue with a spy so tests assert on
      // queue.add() calls without needing a live Redis connection.
      .overrideProvider(getQueueToken('webhook-processing'))
      .useValue({ add: mockQueueAdd })
      // Override WebhookProcessor with a plain value (no @Processor metadata).
      // BullExplorer.registerWorkers checks wrapper.metatype (null for useValue)
      // and falls back to wrapper.instance.constructor (Object), which has no
      // @Processor metadata → no BullMQ Worker is created → no Redis needed.
      .overrideProvider(WebhookProcessor)
      .useValue({})
      .compile();

    // Mirror main.ts exactly:
    //   1. Disable NestJS body parser.
    //   2. Mount express.raw() on the webhook route so HMAC verification
    //      receives unmodified bytes (Buffer), not a parsed JSON object.
    //   3. Mount express.json() for all other routes.
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
    // No FK constraints across these tables — parallel deletes are safe.
    await Promise.all([
      prisma.webhookEvent.deleteMany(),
      prisma.productChangeLog.deleteMany(),
      prisma.product.deleteMany(),
      prisma.failedJob.deleteMany(),
    ]);
  });

  // ─── 1. Valid HMAC + valid payload → 200 ──────────────────────────────────

  describe('valid HMAC + valid order payload', () => {
    it('returns 200 and enqueues a job with the parsed data', async () => {
      const payload = JSON.stringify({
        id: 5001,
        order_number: 1234,
        total_price: '99.00',
        currency: 'USD',
        email: 'customer@example.com',
        line_items: [],
      });
      const signature = computeHmac(TEST_SECRET, payload);

      const { status } = await request(app.getHttpServer())
        .post('/webhooks/shopify')
        .set('Content-Type', 'application/json')
        .set('x-shopify-hmac-sha256', signature)
        .set('x-shopify-topic', 'orders/create')
        .set('x-shopify-shop-domain', 'test-shop.myshopify.com')
        .send(payload);

      expect(status).toBe(200);
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
      expect(mockQueueAdd).toHaveBeenCalledWith('process', {
        topic: 'orders/create',
        shopDomain: 'test-shop.myshopify.com',
        shopifyId: '5001', // numeric id coerced to string by the controller
        payload: {
          id: 5001,
          order_number: 1234,
          total_price: '99.00',
          currency: 'USD',
          email: 'customer@example.com',
          line_items: [],
        },
      });
    });

    it('returns 200 for a products/update topic', async () => {
      const payload = JSON.stringify({
        id: 'gid://shopify/Product/99',
        title: 'Blue Widget',
        status: 'active',
        updated_at: '2024-01-15T10:00:00Z',
        variants: [],
      });
      const signature = computeHmac(TEST_SECRET, payload);

      const { status } = await request(app.getHttpServer())
        .post('/webhooks/shopify')
        .set('Content-Type', 'application/json')
        .set('x-shopify-hmac-sha256', signature)
        .set('x-shopify-topic', 'products/update')
        .set('x-shopify-shop-domain', 'test-shop.myshopify.com')
        .send(payload);

      expect(status).toBe(200);
      expect(mockQueueAdd).toHaveBeenCalledWith('process', {
        topic: 'products/update',
        shopDomain: 'test-shop.myshopify.com',
        shopifyId: 'gid://shopify/Product/99',
        payload: {
          id: 'gid://shopify/Product/99',
          title: 'Blue Widget',
          status: 'active',
          updated_at: '2024-01-15T10:00:00Z',
          variants: [],
        },
      });
    });
  });

  // ─── 2. Invalid HMAC → 401 ────────────────────────────────────────────────

  describe('invalid HMAC', () => {
    it('returns 401 for an incorrect signature', async () => {
      const payload = JSON.stringify({ id: 9999 });

      const { status } = await request(app.getHttpServer())
        .post('/webhooks/shopify')
        .set('Content-Type', 'application/json')
        .set('x-shopify-hmac-sha256', 'bm90LWEtdmFsaWQtc2lnbmF0dXJl') // base64 garbage
        .set('x-shopify-topic', 'orders/create')
        .set('x-shopify-shop-domain', 'test-shop.myshopify.com')
        .send(payload);

      expect(status).toBe(401);
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it('returns 401 when the HMAC header is absent', async () => {
      const payload = JSON.stringify({ id: 9999 });

      const { status } = await request(app.getHttpServer())
        .post('/webhooks/shopify')
        .set('Content-Type', 'application/json')
        .set('x-shopify-topic', 'orders/create')
        .set('x-shopify-shop-domain', 'test-shop.myshopify.com')
        .send(payload);

      expect(status).toBe(401);
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it('returns 401 when signature is computed with the wrong secret', async () => {
      const payload = JSON.stringify({ id: 9999 });
      // Valid HMAC format, wrong key — timing-safe comparison will reject it.
      const signature = computeHmac('wrong-secret-entirely', payload);

      const { status } = await request(app.getHttpServer())
        .post('/webhooks/shopify')
        .set('Content-Type', 'application/json')
        .set('x-shopify-hmac-sha256', signature)
        .set('x-shopify-topic', 'orders/create')
        .set('x-shopify-shop-domain', 'test-shop.myshopify.com')
        .send(payload);

      expect(status).toBe(401);
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  // ─── 3. Valid HMAC + missing required fields → 200 ────────────────────────

  describe('valid HMAC + missing required fields', () => {
    it('returns 200 and enqueues with shopifyId="" when payload has no id', async () => {
      // The controller does not validate payload structure — it accepts anything
      // with a valid HMAC and hands it off to the queue. Validation and error
      // handling live in WebhookProcessor, which runs asynchronously.
      const payload = JSON.stringify({});
      const signature = computeHmac(TEST_SECRET, payload);

      const { status } = await request(app.getHttpServer())
        .post('/webhooks/shopify')
        .set('Content-Type', 'application/json')
        .set('x-shopify-hmac-sha256', signature)
        .set('x-shopify-topic', 'orders/create')
        .set('x-shopify-shop-domain', 'test-shop.myshopify.com')
        .send(payload);

      expect(status).toBe(200);
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
      expect(mockQueueAdd).toHaveBeenCalledWith('process', {
        topic: 'orders/create',
        shopDomain: 'test-shop.myshopify.com',
        shopifyId: '', // controller falls back to '' when "id" is absent
        payload: {},
      });
    });

    it('returns 200 and uses "unknown" when topic and shop-domain headers are absent', async () => {
      // Missing x-shopify-topic / x-shopify-shop-domain → controller falls
      // back to the string "unknown" for both fields, then enqueues.
      const payload = JSON.stringify({ id: 7777 });
      const signature = computeHmac(TEST_SECRET, payload);

      const { status } = await request(app.getHttpServer())
        .post('/webhooks/shopify')
        .set('Content-Type', 'application/json')
        .set('x-shopify-hmac-sha256', signature)
        .send(payload);

      expect(status).toBe(200);
      expect(mockQueueAdd).toHaveBeenCalledWith('process', {
        topic: 'unknown',
        shopDomain: 'unknown',
        shopifyId: '7777',
        payload: { id: 7777 },
      });
    });
  });
});
