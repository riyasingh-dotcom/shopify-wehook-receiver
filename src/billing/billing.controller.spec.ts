import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

const mockHandleCallback = jest.fn();
const mockResolveShopByChargeId = jest.fn();
const mockGetStatus = jest.fn();
const mockCreateSubscription = jest.fn();

const mockBillingService = {
  handleCallback: mockHandleCallback,
  resolveShopByChargeId: mockResolveShopByChargeId,
  getStatus: mockGetStatus,
  createSubscription: mockCreateSubscription,
} as unknown as BillingService;

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    if (key === 'SHOPIFY_API_KEY') return 'test-api-key';
    throw new Error(`Config key not found: ${key}`);
  }),
  get: jest.fn((key: string) => {
    if (key === 'APP_HOST') return 'app.example.com';
    return undefined;
  }),
} as unknown as ConfigService;

describe('BillingController', () => {
  let controller: BillingController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: mockBillingService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<BillingController>(BillingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /billing/status', () => {
    const shop = 'my-store.myshopify.com';

    it('returns subscription status for a valid shop domain', async () => {
      const fakeStatus = {
        plan: 'basic',
        status: 'active',
        trialEndsAt: null,
        graceEndsAt: null,
        eventsProcessedThisMonth: 1200,
        features: {
          webhookEventsLimit: 5000,
          productChangesHistory: 30,
          reprocessFailedJobs: true,
        },
      };
      mockGetStatus.mockResolvedValueOnce(fakeStatus);

      const result = await controller.getStatus(shop);

      expect(result).toEqual(fakeStatus);
      expect(mockGetStatus).toHaveBeenCalledWith(shop);
    });

    it('throws BadRequestException for an invalid shop domain', async () => {
      await expect(controller.getStatus('not-a-valid-domain')).rejects.toThrow(
        'Invalid or missing shop domain',
      );
      expect(mockGetStatus).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when shop param is missing', async () => {
      await expect(controller.getStatus(undefined)).rejects.toThrow(
        'Invalid or missing shop domain',
      );
    });
  });

  describe('POST /billing/subscribe', () => {
    const validBody = {
      shopDomain: 'my-store.myshopify.com',
      plan: 'basic',
      sessionToken: 'eyJhbGciOiJIUzI1NiJ9.test',
    };

    it('returns confirmationUrl for a valid subscribe request', async () => {
      mockCreateSubscription.mockResolvedValueOnce({
        confirmationUrl: 'https://admin.shopify.com/charges/confirm',
      });

      const result = await controller.subscribe(validBody);

      expect(result).toEqual({
        confirmationUrl: 'https://admin.shopify.com/charges/confirm',
      });
      expect(mockCreateSubscription).toHaveBeenCalledWith(
        validBody.shopDomain,
        validBody.plan,
        validBody.sessionToken,
      );
    });

    it('throws BadRequestException when plan is invalid', async () => {
      await expect(
        controller.subscribe({ ...validBody, plan: 'enterprise' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreateSubscription).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when body is missing required fields', async () => {
      await expect(
        controller.subscribe({ shopDomain: 'my-store.myshopify.com' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreateSubscription).not.toHaveBeenCalled();
    });
  });

  describe('GET /billing/callback', () => {
    const shop = 'my-store.myshopify.com';
    const chargeId = 'gid://shopify/AppSubscription/1';

    it('redirects to Shopify admin app URL after successful ACTIVE callback', async () => {
      mockHandleCallback.mockResolvedValueOnce('ACTIVE');

      const result = await controller.callback(chargeId, shop);

      expect(result).toEqual({
        url: `https://${shop}/admin/apps/test-api-key`,
      });
      expect(mockHandleCallback).toHaveBeenCalledWith(chargeId, shop);
    });

    it('redirects to Shopify admin app URL after DECLINED callback', async () => {
      mockHandleCallback.mockResolvedValueOnce('DECLINED');

      const result = await controller.callback(chargeId, shop);

      expect(result).toEqual({
        url: `https://${shop}/admin/apps/test-api-key`,
      });
    });

    it('still redirects to app URL when handleCallback throws', async () => {
      mockHandleCallback.mockRejectedValueOnce(new Error('Shopify API error'));

      const result = await controller.callback(chargeId, shop);

      expect(result).toEqual({
        url: `https://${shop}/admin/apps/test-api-key`,
      });
    });

    it('redirects to fallback URL when charge_id is missing', async () => {
      const result = await controller.callback(undefined, shop);

      expect(result).toEqual({ url: 'https://app.example.com' });
      expect(mockHandleCallback).not.toHaveBeenCalled();
    });

    it('redirects to fallback URL when shop domain is invalid', async () => {
      const result = await controller.callback(chargeId, 'not-a-valid-domain');

      expect(result).toEqual({ url: 'https://app.example.com' });
      expect(mockHandleCallback).not.toHaveBeenCalled();
    });

    it('redirects to fallback URL when shop is missing and DB lookup finds nothing', async () => {
      mockResolveShopByChargeId.mockResolvedValueOnce(null);

      const result = await controller.callback(chargeId, undefined);

      expect(result).toEqual({ url: 'https://app.example.com' });
      expect(mockResolveShopByChargeId).toHaveBeenCalledWith(chargeId);
      expect(mockHandleCallback).not.toHaveBeenCalled();
    });

    it('resolves shop from DB and proceeds when Shopify omits shop param', async () => {
      mockResolveShopByChargeId.mockResolvedValueOnce(shop);
      mockHandleCallback.mockResolvedValueOnce('ACTIVE');

      const result = await controller.callback(chargeId, undefined);

      expect(result).toEqual({
        url: `https://${shop}/admin/apps/test-api-key`,
      });
      expect(mockResolveShopByChargeId).toHaveBeenCalledWith(chargeId);
      expect(mockHandleCallback).toHaveBeenCalledWith(chargeId, shop);
    });
  });
});
