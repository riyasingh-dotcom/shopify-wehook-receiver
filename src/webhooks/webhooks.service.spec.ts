import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaMock = {
  failedJob: { count: jest.Mock; findMany: jest.Mock; deleteMany: jest.Mock };
  webhookEvent: { create: jest.Mock; update: jest.Mock; findMany: jest.Mock };
  product: { findUnique: jest.Mock; upsert: jest.Mock; findMany: jest.Mock };
  productChangeLog: { create: jest.Mock; findMany: jest.Mock };
  $transaction: jest.Mock;
};

type ConfigMock = { getOrThrow: jest.Mock };

// Minimal valid payload that satisfies OrderPayloadSchema
const VALID_ORDER = {
  id: 987654321,
  order_number: 1001,
  total_price: '99.99',
  currency: 'USD',
  financial_status: 'paid',
  created_at: '2024-01-15T10:00:00Z',
  line_items: [{ id: 1, title: 'Widget', quantity: 1, price: '99.99' }],
};

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: PrismaMock;
  let config: ConfigMock;

  beforeEach(async () => {
    prisma = {
      failedJob: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      webhookEvent: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      productChangeLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    config = { getOrThrow: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFailedJobCount', () => {
    it('returns the count from prisma', async () => {
      prisma.failedJob.count.mockResolvedValue(3);
      const result = await service.getFailedJobCount();
      expect(result).toBe(3);
      expect(prisma.failedJob.count).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when there are no failed jobs', async () => {
      prisma.failedJob.count.mockResolvedValue(0);
      const result = await service.getFailedJobCount();
      expect(result).toBe(0);
    });
  });

  describe('handleOrderCreated', () => {
    it('returns the new event id and persists the record when the order is new', async () => {
      prisma.webhookEvent.create.mockResolvedValue({ id: 'event-uuid-1' });

      const result = await service.handleOrderCreated(
        VALID_ORDER,
        'test.myshopify.com',
      );

      expect(result).toBe('event-uuid-1');
      expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
        data: {
          topic: 'orders/create',
          shopDomain: 'test.myshopify.com',
          shopifyId: '987654321', // bigIntId transform coerces number → string
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          payload: expect.objectContaining({
            id: '987654321',
            order_number: 1001,
          }),
        },
      });
    });

    it('returns null when the shopifyId already exists (P2002 idempotency)', async () => {
      // Shopify delivers at-least-once; duplicate detected via optimistic insert + catch
      const p2002 = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });
      prisma.webhookEvent.create.mockRejectedValue(p2002);

      const result = await service.handleOrderCreated(
        VALID_ORDER,
        'test.myshopify.com',
      );

      expect(result).toBeNull();
    });

    it('still calls prisma.create for duplicate events (optimistic-insert pattern)', async () => {
      // The service does NOT do a pre-flight findUnique — it inserts and catches P2002.
      // This test locks in that contract so a future "add findUnique" refactor is visible.
      const p2002 = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });
      prisma.webhookEvent.create.mockRejectedValue(p2002);

      await service.handleOrderCreated(VALID_ORDER, 'test.myshopify.com');

      expect(prisma.webhookEvent.create).toHaveBeenCalledTimes(1);
    });

    it('throws with a descriptive message when the payload fails Zod validation', async () => {
      const invalidPayload = { id: 123 }; // missing order_number, total_price, etc.

      await expect(
        service.handleOrderCreated(invalidPayload, 'test.myshopify.com'),
      ).rejects.toThrow('Invalid orders/create payload');
    });

    it('does not call prisma.create when Zod validation fails', async () => {
      const invalidPayload = { id: 123 };

      await expect(
        service.handleOrderCreated(invalidPayload, 'test.myshopify.com'),
      ).rejects.toThrow();

      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('rethrows unexpected database errors (non-P2002)', async () => {
      const dbError = new Error('Connection timeout');
      prisma.webhookEvent.create.mockRejectedValue(dbError);

      await expect(
        service.handleOrderCreated(VALID_ORDER, 'test.myshopify.com'),
      ).rejects.toThrow('Connection timeout');
    });
  });

  describe('verifyShopifyHmac', () => {
    const SECRET = 'test-webhook-secret';
    const RAW_BODY = Buffer.from('{"id":1,"name":"test"}');

    // Computes the correct base64 HMAC the same way the service does.
    // Used in tests so no magic strings appear in assertions.
    function sign(body: Buffer, secret: string): string {
      return crypto.createHmac('sha256', secret).update(body).digest('base64');
    }

    it('returns true for a valid HMAC', () => {
      config.getOrThrow.mockReturnValue(SECRET);
      const signature = sign(RAW_BODY, SECRET);

      expect(service.verifyShopifyHmac(RAW_BODY, signature)).toBe(true);
    });

    it('returns false for a wrong signature (correct length, wrong content)', () => {
      // Sign with a different secret so the result is still 32 bytes —
      // this exercises timingSafeEqual returning false, not the length guard.
      config.getOrThrow.mockReturnValue(SECRET);
      const wrongSignature = sign(RAW_BODY, 'a-different-secret');

      expect(service.verifyShopifyHmac(RAW_BODY, wrongSignature)).toBe(false);
    });

    it('returns false for an empty signature', () => {
      // Buffer.from('', 'base64') is 0 bytes; HMAC-SHA256 is always 32 bytes →
      // the length guard short-circuits before timingSafeEqual is reached.
      config.getOrThrow.mockReturnValue(SECRET);

      expect(service.verifyShopifyHmac(RAW_BODY, '')).toBe(false);
    });

    it('returns false when the secret used to verify differs from the signing secret', () => {
      config.getOrThrow.mockReturnValue('wrong-secret');
      const signature = sign(RAW_BODY, SECRET); // signed with correct secret

      expect(service.verifyShopifyHmac(RAW_BODY, signature)).toBe(false);
    });
  });

  describe('markProcessed', () => {
    it('updates the event status to processed with a timestamp', async () => {
      await service.markProcessed('event-1');

      expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: { status: 'processed', processedAt: expect.any(Date) },
      });
    });
  });

  describe('getFailedJobs', () => {
    it('returns failed jobs ordered by failedAt desc', async () => {
      const jobs = [{ id: 'j1', failedAt: new Date() }];
      prisma.failedJob.findMany.mockResolvedValue(jobs);

      const result = await service.getFailedJobs();

      expect(result).toBe(jobs);
      expect(prisma.failedJob.findMany).toHaveBeenCalledWith({
        orderBy: { failedAt: 'desc' },
      });
    });
  });

  describe('clearFailedJobs', () => {
    it('deletes all failed jobs and returns the count', async () => {
      prisma.failedJob.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.clearFailedJobs();

      expect(result).toEqual({ deleted: 5 });
      expect(prisma.failedJob.deleteMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProductHistory', () => {
    it('queries change logs since the given number of days ago', async () => {
      const rows = [
        {
          id: 'cl-1',
          productTitle: 'Shirt',
          field: 'price',
          oldValue: '10.00',
          newValue: '12.00',
          changedAt: new Date(),
        },
      ];
      prisma.productChangeLog.findMany.mockResolvedValue(rows);

      const result = await service.getProductHistory(7);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'cl-1',
        productTitle: 'Shirt',
        fieldChanged: 'price',
        oldValue: '10.00',
        newValue: '12.00',
      });

      const [[callArg]] = prisma.productChangeLog.findMany.mock.calls as [
        [{ where: { changedAt: { gte: Date } } }],
      ];
      const since = callArg.where.changedAt.gte;
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      expect(since.getTime()).toBeGreaterThanOrEqual(sevenDaysAgo - 1000);
      expect(since.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('replaces null oldValue with empty string', async () => {
      prisma.productChangeLog.findMany.mockResolvedValue([
        {
          id: 'cl-2',
          productTitle: 'Hat',
          field: 'title',
          oldValue: null,
          newValue: 'New Hat',
          changedAt: new Date(),
        },
      ]);

      const result = await service.getProductHistory(30);

      expect(result[0].oldValue).toBe('');
    });
  });

  describe('getEvents', () => {
    const orderEvent = {
      id: 'ev-1',
      topic: 'orders/create',
      shopDomain: 'shop.myshopify.com',
      payload: { order_number: 1 },
      status: 'processed',
      receivedAt: new Date('2024-01-15T10:00:00Z'),
    };

    const changeLog = {
      id: 'cl-1',
      shopifyId: 'prod-1',
      productTitle: 'Widget',
      field: 'price',
      oldValue: '9.99',
      newValue: '12.99',
      changedAt: new Date('2024-01-15T09:00:00Z'),
    };

    it('returns order events when topic is "orders"', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([orderEvent]);

      const result = await service.getEvents('orders');

      expect(result).toHaveLength(1);
      expect(result[0].topic).toBe('orders/create');
      expect(prisma.productChangeLog.findMany).not.toHaveBeenCalled();
    });

    it('returns product change events when topic is "products"', async () => {
      prisma.productChangeLog.findMany.mockResolvedValue([changeLog]);
      prisma.product.findMany.mockResolvedValue([
        { id: 'prod-1', shopDomain: 'shop.myshopify.com' },
      ]);

      const result = await service.getEvents('products');

      expect(result).toHaveLength(1);
      expect(result[0].topic).toBe('products/update');
      expect(result[0].shopDomain).toBe('shop.myshopify.com');
      expect(prisma.webhookEvent.findMany).not.toHaveBeenCalled();
    });

    it('returns both orders and product changes when topic is "all"', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([orderEvent]);
      prisma.productChangeLog.findMany.mockResolvedValue([changeLog]);
      prisma.product.findMany.mockResolvedValue([
        { id: 'prod-1', shopDomain: 'shop.myshopify.com' },
      ]);

      const result = await service.getEvents('all');

      expect(result).toHaveLength(2);
      // sorted newest first — order event is 2024-01-15T10:00, change is T09:00
      expect(result[0].topic).toBe('orders/create');
      expect(result[1].topic).toBe('products/update');
    });

    it('falls back to "unknown" shopDomain when product is not in the lookup map', async () => {
      prisma.productChangeLog.findMany.mockResolvedValue([changeLog]);
      prisma.product.findMany.mockResolvedValue([]); // no matching product

      const result = await service.getEvents('products');

      expect(result[0].shopDomain).toBe('unknown');
    });

    it('skips the product lookup when there are no change logs', async () => {
      prisma.productChangeLog.findMany.mockResolvedValue([]);

      await service.getEvents('all');

      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });
  });

  describe('handleProductUpdated', () => {
    const PRODUCT_PAYLOAD = {
      id: 42,
      title: 'Blue Shirt',
      status: 'active',
      updated_at: '2024-01-15T10:00:00Z',
      variants: [{ id: 1, price: '19.99' }],
    };

    it('upserts product snapshot and creates a webhook event for a new product', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({ id: 'ev-new' });

      const result = await service.handleProductUpdated(
        PRODUCT_PAYLOAD,
        'shop.myshopify.com',
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.product.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: '42' } }),
      );
      expect(result).toBe('ev-new');
    });

    it('creates change log entries when tracked fields differ from snapshot', async () => {
      const oldPayload = { ...PRODUCT_PAYLOAD, title: 'Red Shirt' };
      prisma.product.findUnique.mockResolvedValue({
        id: '42',
        shopDomain: 'shop.myshopify.com',
        payload: oldPayload,
        updatedAt: new Date(),
      });
      prisma.webhookEvent.create.mockResolvedValue({ id: 'ev-2' });

      await service.handleProductUpdated(PRODUCT_PAYLOAD, 'shop.myshopify.com');

      // productChangeLog.create called for the title change
      expect(prisma.productChangeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            field: 'title',
            newValue: 'Blue Shirt',
          }),
        }),
      );
    });

    it('returns null for a duplicate products/update (P2002)', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      const p2002 = Object.assign(new Error('Unique constraint'), {
        code: 'P2002',
      });
      prisma.webhookEvent.create.mockRejectedValue(p2002);

      const result = await service.handleProductUpdated(
        PRODUCT_PAYLOAD,
        'shop.myshopify.com',
      );

      expect(result).toBeNull();
    });

    it('rethrows non-P2002 errors from webhookEvent.create', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockRejectedValue(new Error('DB down'));

      await expect(
        service.handleProductUpdated(PRODUCT_PAYLOAD, 'shop.myshopify.com'),
      ).rejects.toThrow('DB down');
    });

    it('handles non-object raw payload without throwing', async () => {
      prisma.webhookEvent.create.mockResolvedValue({ id: 'ev-3' });

      const result = await service.handleProductUpdated(
        null,
        'shop.myshopify.com',
      );

      expect(result).toBe('ev-3');
    });
  });
});
