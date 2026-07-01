import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { SHOPIFY_INSTANCE } from '../shopify/shopify.module';
import { BillingService } from './billing.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRequest = jest.fn();
const mockTokenExchange = jest.fn();

// Mock Session constructor — the real one requires a live Shopify context.
// Also expose RequestedTokenType so the service can reference the enum values.
jest.mock('@shopify/shopify-api', () => ({
  Session: jest.fn().mockImplementation((params: unknown) => params),
  RequestedTokenType: {
    OnlineAccessToken:
      'urn:shopify:params:oauth:token-type:online-access-token',
    OfflineAccessToken:
      'urn:shopify:params:oauth:token-type:offline-access-token',
  },
}));

const mockUpsert = jest.fn();
const mockUpdate = jest.fn();
const mockFindUnique = jest.fn();

const mockPrismaService = {
  subscription: {
    upsert: mockUpsert,
    update: mockUpdate,
    findUnique: mockFindUnique,
  },
} as unknown as PrismaService;

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    const values: Record<string, string> = {
      SHOPIFY_API_KEY: 'test-api-key',
      SHOPIFY_API_SECRET: 'test-api-secret',
      BILLING_RETURN_URL: 'https://app.example.com/billing/callback',
    };
    const val = values[key];
    if (!val) throw new Error(`Config key not found: ${key}`);
    return val;
  }),
  get: jest.fn((key: string) => {
    if (key === 'APP_HOST') return 'localhost';
    return undefined;
  }),
} as unknown as ConfigService;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: SHOPIFY_INSTANCE,
          useValue: {
            clients: {
              Graphql: jest
                .fn()
                .mockImplementation(() => ({ request: mockRequest })),
            },
            auth: {
              tokenExchange: mockTokenExchange,
            },
          },
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStatus', () => {
    const shopDomain = 'test-shop.myshopify.com';

    it('returns free plan defaults when no subscription exists', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const result = await service.getStatus(shopDomain);

      expect(result.plan).toBe('free');
      expect(result.status).toBe('active');
      expect(result.eventsProcessedThisMonth).toBe(0);
    });

    it('returns plan, status, and eventsProcessedThisMonth for an active subscription', async () => {
      mockFindUnique.mockResolvedValueOnce({
        plan: 'basic',
        status: 'active',
        trialEndsAt: null,
        graceEndsAt: null,
        eventsProcessedThisMonth: 3200,
      });

      const result = await service.getStatus(shopDomain);

      expect(result.plan).toBe('basic');
      expect(result.status).toBe('active');
      expect(result.eventsProcessedThisMonth).toBe(3200);
      expect(result.features.webhookEventsLimit).toBe(5000);
    });

    it('falls back to free plan when subscription is not active', async () => {
      mockFindUnique.mockResolvedValueOnce({
        plan: 'basic',
        status: 'expired',
        trialEndsAt: null,
        graceEndsAt: null,
        eventsProcessedThisMonth: 100,
      });

      const result = await service.getStatus(shopDomain);

      expect(result.plan).toBe('free');
      expect(result.eventsProcessedThisMonth).toBe(100);
    });
  });

  describe('createSubscription', () => {
    const shopDomain = 'test-shop.myshopify.com';
    const sessionToken = 'eyJhbGciOiJIUzI1NiJ9.test_session_token';
    const onlineAccessToken = 'online_access_token_from_exchange';
    const confirmationUrl =
      'https://admin.shopify.com/store/test-shop/charges/confirm_recurring_application_charge?charge_id=gid://shopify/AppSubscription/1';

    const makeShopifyResponse = (
      overrides: Partial<{
        userErrors: { field: string[]; message: string }[];
        appSubscription: { id: string; status: string } | null;
        confirmationUrl: string | null;
      }> = {},
    ) => ({
      data: {
        appSubscriptionCreate: {
          userErrors: [],
          appSubscription: {
            id: 'gid://shopify/AppSubscription/1',
            status: 'PENDING',
          },
          confirmationUrl,
          ...overrides,
        },
      },
    });

    beforeEach(() => {
      mockTokenExchange.mockResolvedValue({
        session: { accessToken: onlineAccessToken },
      });
    });

    it('returns confirmationUrl and upserts a pending subscription for basic plan', async () => {
      mockRequest.mockResolvedValueOnce(makeShopifyResponse());
      mockUpsert.mockResolvedValueOnce({});

      const result = await service.createSubscription(
        shopDomain,
        'basic',
        sessionToken,
      );

      expect(result).toEqual({ confirmationUrl });

      expect(mockTokenExchange).toHaveBeenCalledWith({
        shop: shopDomain,
        sessionToken,
        requestedTokenType:
          'urn:shopify:params:oauth:token-type:online-access-token',
      });

      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('appSubscriptionCreate'),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          variables: expect.objectContaining({
            name: 'Basic Plan',
            test: true,
            lineItems: [
              {
                plan: {
                  appRecurringPricingDetails: {
                    price: { amount: '9.00', currencyCode: 'USD' },
                    interval: 'EVERY_30_DAYS',
                  },
                },
              },
            ],
          }),
        }),
      );

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { shopDomain },
        create: {
          shopDomain,
          shopifyChargeId: 'gid://shopify/AppSubscription/1',
          plan: 'basic',
          status: 'pending',
          accessToken: onlineAccessToken,
        },
        update: {
          shopifyChargeId: 'gid://shopify/AppSubscription/1',
          plan: 'basic',
          status: 'pending',
          accessToken: onlineAccessToken,
        },
      });
    });

    it('uses $29.00 and "Pro Plan" name for pro plan', async () => {
      mockRequest.mockResolvedValueOnce(makeShopifyResponse());
      mockUpsert.mockResolvedValueOnce({});

      await service.createSubscription(shopDomain, 'pro', sessionToken);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          variables: expect.objectContaining({
            name: 'Pro Plan',
            lineItems: [
              expect.objectContaining({
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                plan: expect.objectContaining({
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                  appRecurringPricingDetails: expect.objectContaining({
                    price: { amount: '29.00', currencyCode: 'USD' },
                  }),
                }),
              }),
            ],
          }),
        }),
      );
    });

    it('throws InternalServerErrorException when Shopify returns userErrors', async () => {
      mockRequest.mockResolvedValueOnce(
        makeShopifyResponse({
          userErrors: [{ field: ['plan'], message: 'Charge already exists' }],
          appSubscription: null,
          confirmationUrl: null,
        }),
      );

      await expect(
        service.createSubscription(shopDomain, 'basic', sessionToken),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when Shopify returns no appSubscription', async () => {
      mockRequest.mockResolvedValueOnce(
        makeShopifyResponse({ appSubscription: null, confirmationUrl: null }),
      );

      await expect(
        service.createSubscription(shopDomain, 'basic', sessionToken),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when Shopify returns no data', async () => {
      mockRequest.mockResolvedValueOnce({ data: null });

      await expect(
        service.createSubscription(shopDomain, 'basic', sessionToken),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('propagates Prisma errors', async () => {
      mockRequest.mockResolvedValueOnce(makeShopifyResponse());
      mockUpsert.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        service.createSubscription(shopDomain, 'basic', sessionToken),
      ).rejects.toThrow('DB error');
    });
  });

  describe('handleCallback', () => {
    const shopDomain = 'test-shop.myshopify.com';
    const numericChargeId = '12345';
    const gidChargeId = 'gid://shopify/AppSubscription/12345';
    const storedToken = 'shpat_stored_token';

    const makeNodeResponse = (status: string) => ({
      data: { node: { id: gidChargeId, status } },
    });

    beforeEach(() => {
      mockFindUnique.mockResolvedValue({
        id: 'sub-1',
        shopDomain,
        accessToken: storedToken,
        plan: 'basic',
        status: 'pending',
      });
    });

    it('updates status to active and sets billingStartsAt when Shopify returns ACTIVE', async () => {
      mockRequest.mockResolvedValueOnce(makeNodeResponse('ACTIVE'));
      mockUpdate.mockResolvedValueOnce({});

      const result = await service.handleCallback(numericChargeId, shopDomain);

      expect(result).toBe('ACTIVE');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('GetAppSubscription'),
        expect.objectContaining({
          variables: { id: gidChargeId },
        }),
      );
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { shopDomain },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: { status: 'active', billingStartsAt: expect.any(Date) },
      });
    });

    it('accepts a full GID as charge_id without double-prefixing', async () => {
      mockRequest.mockResolvedValueOnce(makeNodeResponse('ACTIVE'));
      mockUpdate.mockResolvedValueOnce({});

      await service.handleCallback(gidChargeId, shopDomain);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ variables: { id: gidChargeId } }),
      );
    });

    it('updates status to declined when Shopify returns DECLINED', async () => {
      mockRequest.mockResolvedValueOnce(makeNodeResponse('DECLINED'));
      mockUpdate.mockResolvedValueOnce({});

      const result = await service.handleCallback(numericChargeId, shopDomain);

      expect(result).toBe('DECLINED');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { shopDomain },
        data: { status: 'declined' },
      });
    });

    it('returns OTHER and does not update DB for unknown status', async () => {
      mockRequest.mockResolvedValueOnce(makeNodeResponse('EXPIRED'));

      const result = await service.handleCallback(numericChargeId, shopDomain);

      expect(result).toBe('OTHER');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('returns OTHER without calling Shopify when subscription is not found', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const result = await service.handleCallback(numericChargeId, shopDomain);

      expect(result).toBe('OTHER');
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('returns OTHER without calling Shopify when accessToken is null', async () => {
      mockFindUnique.mockResolvedValueOnce({ shopDomain, accessToken: null });

      const result = await service.handleCallback(numericChargeId, shopDomain);

      expect(result).toBe('OTHER');
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe('handleSubscriptionUpdate', () => {
    const chargeId = 'gid://shopify/AppSubscription/42';
    const shopDomain = 'test-shop.myshopify.com';

    const makePayload = (status: string) => ({
      app_subscription: {
        admin_graphql_api_id: chargeId,
        status,
      },
    });

    const existingSub = {
      id: 'sub-1',
      shopDomain,
      shopifyChargeId: chargeId,
      status: 'active',
    };

    it('updates status to cancelled and sets graceEndsAt ~3 days out', async () => {
      mockFindUnique.mockResolvedValueOnce(existingSub);
      mockUpdate.mockResolvedValueOnce({});

      const before = Date.now();
      await service.handleSubscriptionUpdate(makePayload('CANCELLED'));
      const after = Date.now();

      const [[callArg]] = mockUpdate.mock.calls as [
        [
          {
            where: { id: string };
            data: { status: string; graceEndsAt: Date };
          },
        ],
      ];
      expect(callArg.where).toEqual({ id: existingSub.id });
      expect(callArg.data.status).toBe('cancelled');
      expect(callArg.data.graceEndsAt).toBeInstanceOf(Date);
      const graceMs = callArg.data.graceEndsAt.getTime();
      expect(graceMs).toBeGreaterThanOrEqual(
        before + 3 * 24 * 60 * 60 * 1000 - 100,
      );
      expect(graceMs).toBeLessThanOrEqual(
        after + 3 * 24 * 60 * 60 * 1000 + 100,
      );
    });

    it('updates status to expired and sets graceEndsAt ~3 days out', async () => {
      mockFindUnique.mockResolvedValueOnce(existingSub);
      mockUpdate.mockResolvedValueOnce({});

      await service.handleSubscriptionUpdate(makePayload('EXPIRED'));

      const [[callArg]] = mockUpdate.mock.calls as [
        [{ data: { status: string; graceEndsAt: Date } }],
      ];
      expect(callArg.data.status).toBe('expired');
      expect(callArg.data.graceEndsAt).toBeInstanceOf(Date);
    });

    it('clears graceEndsAt when status becomes ACTIVE', async () => {
      mockFindUnique.mockResolvedValueOnce({
        ...existingSub,
        status: 'expired',
      });
      mockUpdate.mockResolvedValueOnce({});

      await service.handleSubscriptionUpdate(makePayload('ACTIVE'));

      const [[callArg]] = mockUpdate.mock.calls as [
        [{ data: { status: string; graceEndsAt: null } }],
      ];
      expect(callArg.data.status).toBe('active');
      expect(callArg.data.graceEndsAt).toBeNull();
    });

    it('does not set graceEndsAt for FROZEN status', async () => {
      mockFindUnique.mockResolvedValueOnce(existingSub);
      mockUpdate.mockResolvedValueOnce({});

      await service.handleSubscriptionUpdate(makePayload('FROZEN'));

      const [[callArg]] = mockUpdate.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      expect(callArg.data.status).toBe('frozen');
      expect(callArg.data).not.toHaveProperty('graceEndsAt');
    });

    it('does nothing when no subscription matches the chargeId', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      await service.handleSubscriptionUpdate(makePayload('CANCELLED'));

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('throws a ZodError when payload is invalid', async () => {
      await expect(
        service.handleSubscriptionUpdate({
          app_subscription: { status: 'CANCELLED' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('createUsageCharge', () => {
    const shopDomain = 'test-shop.myshopify.com';
    const lineItemId = 'gid://shopify/AppSubscriptionLineItem/456';

    const activeSubscription = {
      id: 'sub-1',
      shopDomain,
      plan: 'basic',
      status: 'active',
      accessToken: 'shpat_token',
      shopifyChargeId: 'gid://shopify/AppSubscription/123',
    };

    const makeLineItemsResponse = () => ({
      data: { node: { lineItems: [{ id: lineItemId }] } },
    });

    const makeUsageResponse = (
      overrides: Partial<{
        userErrors: { field: string[]; message: string }[];
        appUsageRecord: { id: string; createdAt: string } | null;
      }> = {},
    ) => ({
      data: {
        appUsageRecordCreate: {
          userErrors: [],
          appUsageRecord: {
            id: 'gid://shopify/AppUsageRecord/789',
            createdAt: '2026-07-01T00:00:00Z',
          },
          ...overrides,
        },
      },
    });

    it('returns null when no subscription found', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const result = await service.createUsageCharge(shopDomain, 6000);

      expect(result).toBeNull();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('returns null when subscription is not active', async () => {
      mockFindUnique.mockResolvedValueOnce({
        ...activeSubscription,
        status: 'expired',
      });

      const result = await service.createUsageCharge(shopDomain, 6000);

      expect(result).toBeNull();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('returns null without calling Shopify when overage is 0', async () => {
      mockFindUnique.mockResolvedValueOnce(activeSubscription);

      // 5000 events = at limit, no overage
      const result = await service.createUsageCharge(shopDomain, 5000);

      expect(result).toBeNull();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('calls Shopify and returns charge record when overage > 0', async () => {
      mockFindUnique.mockResolvedValueOnce(activeSubscription);
      mockRequest
        .mockResolvedValueOnce(makeLineItemsResponse())
        .mockResolvedValueOnce(makeUsageResponse());

      const result = await service.createUsageCharge(shopDomain, 6000);

      expect(mockRequest).toHaveBeenCalledTimes(2);
      expect(mockRequest).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('appUsageRecordCreate'),
        expect.objectContaining({
          variables: {
            subscriptionLineItemId: lineItemId,
            price: { amount: '1.00', currencyCode: 'USD' },
            description: 'Webhook events overage: 6000 events',
          },
        }),
      );
      expect(result).toEqual({
        id: 'gid://shopify/AppUsageRecord/789',
        createdAt: '2026-07-01T00:00:00Z',
      });
    });

    it('caps the charge at $5.00 when sent to Shopify', async () => {
      mockFindUnique.mockResolvedValueOnce(activeSubscription);
      mockRequest
        .mockResolvedValueOnce(makeLineItemsResponse())
        .mockResolvedValueOnce(makeUsageResponse());

      await service.createUsageCharge(shopDomain, 15000);

      expect(mockRequest).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          variables: expect.objectContaining({
            price: { amount: '5.00', currencyCode: 'USD' },
          }),
        }),
      );
    });

    it('throws InternalServerErrorException when Shopify returns userErrors', async () => {
      mockFindUnique.mockResolvedValueOnce(activeSubscription);
      mockRequest
        .mockResolvedValueOnce(makeLineItemsResponse())
        .mockResolvedValueOnce(
          makeUsageResponse({
            userErrors: [{ field: ['price'], message: 'Amount exceeds cap' }],
            appUsageRecord: null,
          }),
        );

      await expect(service.createUsageCharge(shopDomain, 6000)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('returns null when subscription has no accessToken', async () => {
      mockFindUnique.mockResolvedValueOnce({
        ...activeSubscription,
        accessToken: null,
      });

      const result = await service.createUsageCharge(shopDomain, 6000);

      expect(result).toBeNull();
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe('calculateOverageCharge', () => {
    it('returns 0 for free plan regardless of events', () => {
      expect(service.calculateOverageCharge('free', 99999)).toBe(0);
    });

    it('returns 0 for basic plan when events are within limit', () => {
      expect(service.calculateOverageCharge('basic', 5000)).toBe(0);
    });

    it('returns correct charge for basic plan with 1000 events over limit', () => {
      // 1000 events × $0.001 = $1.00
      expect(service.calculateOverageCharge('basic', 6000)).toBe(1.0);
    });

    it('caps overage at $5.00 for basic plan regardless of volume', () => {
      // 10,000 events over limit × $0.001 = $10 but cap is $5.00
      expect(service.calculateOverageCharge('basic', 15000)).toBe(5.0);
    });

    it('returns 0 for pro plan regardless of events', () => {
      expect(service.calculateOverageCharge('pro', 99999)).toBe(0);
    });
  });
});
