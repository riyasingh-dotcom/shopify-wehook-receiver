/// <reference types="jest" />

/**
 * Integration tests for billing endpoints:
 *   POST /billing/subscribe
 *   GET  /billing/status
 *
 * Prerequisites: same as other e2e specs
 *   - TEST_DATABASE_URL in .env
 *   - docker compose up testdb -d
 *   - DATABASE_URL=$TEST_DATABASE_URL pnpm prisma migrate deploy
 *
 * Run:
 *   pnpm test:e2e --testPathPatterns=billing
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
import { SHOPIFY_INSTANCE } from '../src/shopify/shopify.module';

const TEST_SHOP = 'billing-test-shop.myshopify.com';
const FAKE_CONFIRMATION_URL =
  'https://billing.shopify.com/confirm/test-charge-abc123';

// Fake Shopify session returned by tokenExchange mock
const fakeSession = {
  shop: TEST_SHOP,
  accessToken: 'fake-access-token',
  id: `offline_${TEST_SHOP}`,
  state: '',
  isOnline: false,
};

// Shared mock refs — reset in beforeEach so tests don't bleed into each other
const mockGraphqlRequest = jest.fn();
const mockTokenExchange = jest.fn();

const mockShopify = {
  auth: { tokenExchange: mockTokenExchange },
  clients: {
    Graphql: jest.fn().mockImplementation(() => ({
      request: mockGraphqlRequest,
    })),
  },
};

describe('Billing endpoints (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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
    process.env.BILLING_RETURN_URL =
      'https://example.railway.app/billing/callback';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('webhook-processing'))
      .useValue({ add: jest.fn() })
      .overrideProvider(WebhookProcessor)
      .useValue({})
      .overrideProvider(SHOPIFY_INSTANCE)
      .useValue(mockShopify)
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
    jest.clearAllMocks();
    await prisma.subscription.deleteMany({ where: { shopDomain: TEST_SHOP } });
  });

  // ─── POST /billing/subscribe ──────────────────────────────────────────────

  describe('POST /billing/subscribe', () => {
    it('returns 201 with confirmationUrl when plan is valid and Shopify API succeeds', async () => {
      mockTokenExchange.mockResolvedValue({ session: fakeSession });
      mockGraphqlRequest.mockResolvedValue({
        data: {
          appSubscriptionCreate: {
            userErrors: [],
            appSubscription: {
              id: 'gid://shopify/AppSubscription/12345',
              status: 'PENDING',
            },
            confirmationUrl: FAKE_CONFIRMATION_URL,
          },
        },
      });

      const res = await request(app.getHttpServer())
        .post('/billing/subscribe')
        .send({
          shopDomain: TEST_SHOP,
          plan: 'basic',
          sessionToken: 'fake-session-token',
        });

      expect(res.status).toBe(201);
      expect(res.body as Record<string, unknown>).toMatchObject({
        confirmationUrl: FAKE_CONFIRMATION_URL,
      });
      expect(mockTokenExchange).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when sessionToken is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/subscribe')
        .send({ shopDomain: TEST_SHOP, plan: 'basic' });

      expect(res.status).toBe(400);
      expect(mockTokenExchange).not.toHaveBeenCalled();
    });

    it('returns 400 when plan is not basic or pro', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/subscribe')
        .send({
          shopDomain: TEST_SHOP,
          plan: 'premium',
          sessionToken: 'fake-token',
        });

      expect(res.status).toBe(400);
      expect(mockTokenExchange).not.toHaveBeenCalled();
    });

    it('returns 409 when merchant already has an active subscription', async () => {
      await prisma.subscription.create({
        data: { shopDomain: TEST_SHOP, plan: 'basic', status: 'active' },
      });

      const res = await request(app.getHttpServer())
        .post('/billing/subscribe')
        .send({
          shopDomain: TEST_SHOP,
          plan: 'pro',
          sessionToken: 'fake-token',
        });

      expect(res.status).toBe(409);
      expect(res.body as Record<string, unknown>).toMatchObject({
        error: 'active_subscription_exists',
      });
      expect(mockTokenExchange).not.toHaveBeenCalled();
    });
  });

  // ─── GET /billing/status ──────────────────────────────────────────────────

  describe('GET /billing/status', () => {
    it('returns free plan when no subscription exists in DB', async () => {
      const res = await request(app.getHttpServer()).get(
        `/billing/status?shop=${TEST_SHOP}`,
      );

      expect(res.status).toBe(200);
      expect(res.body as Record<string, unknown>).toMatchObject({
        plan: 'free',
        status: 'active',
        trialEndsAt: null,
        features: {
          webhookEventsLimit: 100,
          productChangesHistory: 7,
          reprocessFailedJobs: false,
        },
      });
    });

    it('returns basic plan with correct features when active basic subscription exists', async () => {
      await prisma.subscription.create({
        data: { shopDomain: TEST_SHOP, plan: 'basic', status: 'active' },
      });

      const res = await request(app.getHttpServer()).get(
        `/billing/status?shop=${TEST_SHOP}`,
      );

      expect(res.status).toBe(200);
      expect(res.body as Record<string, unknown>).toMatchObject({
        plan: 'basic',
        status: 'active',
        features: {
          webhookEventsLimit: 5000,
          productChangesHistory: 30,
          reprocessFailedJobs: true,
        },
      });
    });

    it('falls back to free plan when subscription status is not active', async () => {
      await prisma.subscription.create({
        data: { shopDomain: TEST_SHOP, plan: 'basic', status: 'expired' },
      });

      const res = await request(app.getHttpServer()).get(
        `/billing/status?shop=${TEST_SHOP}`,
      );

      expect(res.status).toBe(200);
      expect(res.body as Record<string, unknown>).toMatchObject({
        plan: 'free',
        status: 'expired',
        features: {
          webhookEventsLimit: 100,
          reprocessFailedJobs: false,
        },
      });
    });

    it('returns 400 when shop query param is missing', async () => {
      const res = await request(app.getHttpServer()).get('/billing/status');

      expect(res.status).toBe(400);
    });
  });
});
