import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRequest = jest.fn();

jest.mock('@shopify/shopify-api', () => {
  const Session = jest.fn().mockImplementation((params: unknown) => params);
  const Graphql = jest.fn().mockImplementation(() => ({ request: mockRequest }));

  return {
    shopifyApi: jest.fn().mockReturnValue({ clients: { Graphql } }),
    ApiVersion: { January25: '2025-01' },
    Session,
  };
});

const mockUpsert = jest.fn();
const mockUpdate = jest.fn();
const mockFindUnique = jest.fn();

const mockPrismaService = {
  subscription: { upsert: mockUpsert, update: mockUpdate, findUnique: mockFindUnique },
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
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSubscription', () => {
    const shopDomain = 'test-shop.myshopify.com';
    const accessToken = 'shpat_test_token';
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

    it('returns confirmationUrl and upserts a pending subscription for basic plan', async () => {
      mockRequest.mockResolvedValueOnce(makeShopifyResponse());
      mockUpsert.mockResolvedValueOnce({});

      const result = await service.createSubscription(shopDomain, 'basic', accessToken);

      expect(result).toEqual({ confirmationUrl });

      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('appSubscriptionCreate'),
        expect.objectContaining({
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
          accessToken,
        },
        update: {
          shopifyChargeId: 'gid://shopify/AppSubscription/1',
          plan: 'basic',
          status: 'pending',
          accessToken,
        },
      });
    });

    it('uses $29.00 and "Pro Plan" name for pro plan', async () => {
      mockRequest.mockResolvedValueOnce(makeShopifyResponse());
      mockUpsert.mockResolvedValueOnce({});

      await service.createSubscription(shopDomain, 'pro', accessToken);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          variables: expect.objectContaining({
            name: 'Pro Plan',
            lineItems: [
              expect.objectContaining({
                plan: expect.objectContaining({
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
        service.createSubscription(shopDomain, 'basic', accessToken),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when Shopify returns no appSubscription', async () => {
      mockRequest.mockResolvedValueOnce(
        makeShopifyResponse({ appSubscription: null, confirmationUrl: null }),
      );

      await expect(
        service.createSubscription(shopDomain, 'basic', accessToken),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when Shopify returns no data', async () => {
      mockRequest.mockResolvedValueOnce({ data: null });

      await expect(
        service.createSubscription(shopDomain, 'basic', accessToken),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('propagates Prisma errors', async () => {
      mockRequest.mockResolvedValueOnce(makeShopifyResponse());
      mockUpsert.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        service.createSubscription(shopDomain, 'basic', accessToken),
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
});
