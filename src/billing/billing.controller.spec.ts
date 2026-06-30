import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

const mockHandleCallback = jest.fn();

const mockBillingService = {
  handleCallback: mockHandleCallback,
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

    it('redirects to fallback URL when shop is missing', async () => {
      const result = await controller.callback(chargeId, undefined);

      expect(result).toEqual({ url: 'https://app.example.com' });
      expect(mockHandleCallback).not.toHaveBeenCalled();
    });
  });
});
