import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { ShopifySessionPayload } from '../auth/shopify-session-token.guard';
import { PLAN_ORDER, type Plan } from './plans';

export const PLAN_KEY = 'requiredPlan';

export const RequiresPlan = (plan: 'basic' | 'pro'): MethodDecorator =>
  SetMetadata(PLAN_KEY, plan);

type AuthenticatedRequest = Request & {
  shopifySession: ShopifySessionPayload;
  shopifyPlan: Plan;
};

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPlan = this.reflector.getAllAndOverride<Plan>(PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPlan) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const shopDomain = new URL(request.shopifySession.dest).hostname;

    const subscription = await this.prisma.subscription.findUnique({
      where: { shopDomain },
      select: { plan: true, status: true, graceEndsAt: true },
    });

    const isExpiredOrCancelled =
      subscription?.status === 'expired' || subscription?.status === 'cancelled';

    const isInGracePeriod =
      isExpiredOrCancelled &&
      subscription?.graceEndsAt != null &&
      subscription.graceEndsAt > new Date();

    if (isInGracePeriod) {
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('X-Subscription-Warning', 'grace_period');
      response.setHeader(
        'X-Grace-Ends-At',
        subscription!.graceEndsAt!.toISOString(),
      );
      request.shopifyPlan =
        subscription!.plan in PLAN_ORDER
          ? (subscription!.plan as Plan)
          : 'free';
      return true;
    }

    const currentPlan: Plan =
      subscription?.status === 'active' && subscription.plan in PLAN_ORDER
        ? (subscription.plan as Plan)
        : 'free';

    request.shopifyPlan = currentPlan;

    if (PLAN_ORDER[currentPlan] < PLAN_ORDER[requiredPlan]) {
      throw new ForbiddenException({
        error: 'plan_required',
        requiredPlan,
        currentPlan,
        upgradeUrl: '/billing/upgrade',
      });
    }

    return true;
  }
}
