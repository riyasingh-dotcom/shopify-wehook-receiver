import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaMock = {
  failedJob: { count: jest.Mock };
  webhookEvent: { create: jest.Mock };
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
      failedJob: { count: jest.fn() },
      webhookEvent: { create: jest.fn() },
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
});
