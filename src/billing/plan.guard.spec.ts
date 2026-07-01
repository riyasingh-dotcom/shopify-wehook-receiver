import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PlanGuard, PLAN_KEY } from './plan.guard';
import { PrismaService } from '../prisma/prisma.service';

const mockPrismaService = {
  subscription: {
    findUnique: jest.fn(),
  },
};

const mockReflector = {
  getAllAndOverride: jest.fn(),
};

function buildContext(shopifySessionDest: string): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        shopifySession: { dest: shopifySessionDest },
      }),
    }),
  } as unknown as ExecutionContext;
}

function buildContextWithResponse(
  shopifySessionDest: string,
  mockSetHeader: jest.Mock,
): ExecutionContext {
  const req = { shopifySession: { dest: shopifySessionDest } };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ setHeader: mockSetHeader }),
    }),
  } as unknown as ExecutionContext;
}

describe('PlanGuard', () => {
  let guard: PlanGuard;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PlanGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    guard = module.get<PlanGuard>(PlanGuard);
    jest.clearAllMocks();
  });

  describe('when no required plan metadata is set', () => {
    it('allows the request', async () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      const ctx = buildContext('https://test-shop.myshopify.com');
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(mockPrismaService.subscription.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('when required plan is "basic"', () => {
    beforeEach(() => {
      mockReflector.getAllAndOverride.mockReturnValue('basic');
    });

    it('allows request when merchant has active basic subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'basic',
        status: 'active',
      });
      const ctx = buildContext('https://shop.myshopify.com');
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('allows request when merchant has active pro subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'pro',
        status: 'active',
      });
      const ctx = buildContext('https://shop.myshopify.com');
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('throws 403 when merchant has no subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);
      const ctx = buildContext('https://shop.myshopify.com');
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('throws 403 with structured body when plan is free', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);
      const ctx = buildContext('https://shop.myshopify.com');
      try {
        await guard.canActivate(ctx);
        fail('Expected ForbiddenException');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const forbidden = err as ForbiddenException;
        expect(forbidden.getResponse()).toMatchObject({
          error: 'plan_required',
          requiredPlan: 'basic',
          currentPlan: 'free',
          upgradeUrl: '/billing/upgrade',
        });
      }
    });

    it('throws 403 when subscription exists but is not active (pending)', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'basic',
        status: 'pending',
      });
      const ctx = buildContext('https://shop.myshopify.com');
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('throws 403 when subscription is expired', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'basic',
        status: 'expired',
      });
      const ctx = buildContext('https://shop.myshopify.com');
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('attaches shopifyPlan to the request when plan meets requirement', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'basic',
        status: 'active',
      });
      const req = { shopifySession: { dest: 'https://shop.myshopify.com' } };
      const ctx = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;

      await guard.canActivate(ctx);
      expect((req as typeof req & { shopifyPlan: string }).shopifyPlan).toBe(
        'basic',
      );
    });
  });

  describe('when required plan is "pro"', () => {
    beforeEach(() => {
      mockReflector.getAllAndOverride.mockReturnValue('pro');
    });

    it('allows request when merchant has active pro subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'pro',
        status: 'active',
      });
      const ctx = buildContext('https://shop.myshopify.com');
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('throws 403 when merchant has active basic subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'basic',
        status: 'active',
      });
      const ctx = buildContext('https://shop.myshopify.com');
      try {
        await guard.canActivate(ctx);
        fail('Expected ForbiddenException');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const forbidden = err as ForbiddenException;
        expect(forbidden.getResponse()).toMatchObject({
          error: 'plan_required',
          requiredPlan: 'pro',
          currentPlan: 'basic',
          upgradeUrl: '/billing/upgrade',
        });
      }
    });
  });

  describe('PLAN_KEY metadata key', () => {
    it('is the expected constant used by @RequiresPlan', () => {
      expect(PLAN_KEY).toBe('requiredPlan');
    });
  });

  describe('grace period', () => {
    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

    beforeEach(() => {
      mockReflector.getAllAndOverride.mockReturnValue('basic');
    });

    it('allows access and sets warning headers when in grace period', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'basic',
        status: 'cancelled',
        graceEndsAt: futureDate,
      });
      const mockSetHeader = jest.fn();
      const ctx = buildContextWithResponse(
        'https://shop.myshopify.com',
        mockSetHeader,
      );

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(mockSetHeader).toHaveBeenCalledWith(
        'X-Subscription-Warning',
        'grace_period',
      );
      expect(mockSetHeader).toHaveBeenCalledWith(
        'X-Grace-Ends-At',
        futureDate.toISOString(),
      );
    });

    it('preserves the original plan during grace period', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'pro',
        status: 'expired',
        graceEndsAt: futureDate,
      });
      const mockSetHeader = jest.fn();
      const req = { shopifySession: { dest: 'https://shop.myshopify.com' } };
      const ctx = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => ({ setHeader: mockSetHeader }),
        }),
      } as unknown as ExecutionContext;

      await guard.canActivate(ctx);

      expect((req as typeof req & { shopifyPlan: string }).shopifyPlan).toBe(
        'pro',
      );
    });

    it('falls through to normal plan check when grace period has expired', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'basic',
        status: 'cancelled',
        graceEndsAt: pastDate,
      });
      const ctx = buildContext('https://shop.myshopify.com');
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('falls through to normal plan check when graceEndsAt is null', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        plan: 'basic',
        status: 'expired',
        graceEndsAt: null,
      });
      const ctx = buildContext('https://shop.myshopify.com');
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });
});
