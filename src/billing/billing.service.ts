import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RequestedTokenType,
  Session,
  type Shopify,
} from '@shopify/shopify-api';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { SHOPIFY_INSTANCE } from '../shopify/shopify.module';
import { PLANS, PLAN_ORDER, type Plan, type PlanFeatures } from './plans';

export type SubscribablePlan = Exclude<Plan, 'free'>;

export type CreateSubscriptionResult = {
  confirmationUrl: string;
};

export type CallbackStatus = 'ACTIVE' | 'DECLINED' | 'OTHER';

export type SubscriptionStatus = {
  plan: Plan;
  status: string;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  features: PlanFeatures;
};

const PLAN_CONFIG: Record<SubscribablePlan, { name: string; amount: string }> =
  {
    basic: { name: 'Basic Plan', amount: '9.00' },
    pro: { name: 'Pro Plan', amount: '29.00' },
  };

const SHOPIFY_GID_PREFIX = 'gid://shopify/AppSubscription/';

const APP_SUBSCRIPTION_CREATE_MUTATION = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      test: $test
    ) {
      userErrors {
        field
        message
      }
      appSubscription {
        id
        status
      }
      confirmationUrl
    }
  }
`;

const GET_APP_SUBSCRIPTION_QUERY = `#graphql
  query GetAppSubscription($id: ID!) {
    node(id: $id) {
      ... on AppSubscription {
        id
        status
      }
    }
  }
`;

type AppSubscriptionCreateData = {
  appSubscriptionCreate: {
    userErrors: { field: string[]; message: string }[];
    appSubscription: { id: string; status: string } | null;
    confirmationUrl: string | null;
  };
};

type GetAppSubscriptionData = {
  node: { id: string; status: string } | null;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(SHOPIFY_INSTANCE) private readonly shopify: Shopify,
  ) {}

  async getStatus(shopDomain: string): Promise<SubscriptionStatus> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { shopDomain },
      select: {
        plan: true,
        status: true,
        trialEndsAt: true,
        graceEndsAt: true,
      },
    });

    if (!subscription) {
      return {
        plan: 'free',
        status: 'active',
        trialEndsAt: null,
        graceEndsAt: null,
        features: PLANS.free.features,
      };
    }

    const isActive = subscription.status === 'active';
    const plan: Plan =
      isActive && subscription.plan in PLAN_ORDER
        ? (subscription.plan as Plan)
        : 'free';

    return {
      plan,
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      graceEndsAt: subscription.graceEndsAt,
      features: PLANS[plan].features,
    };
  }

  async createSubscription(
    shopDomain: string,
    plan: SubscribablePlan,
    sessionToken: string,
  ): Promise<CreateSubscriptionResult> {
    const existing = await this.prisma.subscription.findUnique({
      where: { shopDomain },
      select: { status: true },
    });
    if (existing?.status === 'active') {
      throw new ConflictException({
        error: 'active_subscription_exists',
        message: 'This shop already has an active subscription',
      });
    }

    const returnUrl = this.config.getOrThrow<string>('BILLING_RETURN_URL');
    const { name, amount } = PLAN_CONFIG[plan];

    this.logger.log(
      `createSubscription shop=${shopDomain} plan=${plan} — exchanging session token`,
    );

    const { session } = await this.shopify.auth.tokenExchange({
      shop: shopDomain,
      sessionToken,
      requestedTokenType: RequestedTokenType.OnlineAccessToken,
    });

    const client = new this.shopify.clients.Graphql({ session });

    const response = await client.request<AppSubscriptionCreateData>(
      APP_SUBSCRIPTION_CREATE_MUTATION,
      {
        variables: {
          name,
          returnUrl,
          test: true,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: { amount, currencyCode: 'USD' },
                  interval: 'EVERY_30_DAYS',
                },
              },
            },
          ],
        },
      },
    );

    const result = response.data?.appSubscriptionCreate;

    if (!result) {
      throw new InternalServerErrorException(
        'Shopify returned no appSubscriptionCreate payload',
      );
    }

    if (result.userErrors.length > 0) {
      const msg = result.userErrors.map((e) => e.message).join('; ');
      this.logger.error(
        `appSubscriptionCreate userErrors shop=${shopDomain}: ${msg}`,
      );
      throw new InternalServerErrorException(`Shopify billing error: ${msg}`);
    }

    if (!result.appSubscription || !result.confirmationUrl) {
      throw new InternalServerErrorException(
        'Shopify did not return a subscription or confirmation URL',
      );
    }

    const { id: chargeId } = result.appSubscription;
    const { confirmationUrl } = result;

    await this.prisma.subscription.upsert({
      where: { shopDomain },
      create: {
        shopDomain,
        shopifyChargeId: chargeId,
        plan,
        status: 'pending',
        accessToken: session.accessToken ?? '',
      },
      update: {
        shopifyChargeId: chargeId,
        plan,
        status: 'pending',
        accessToken: session.accessToken ?? '',
      },
    });

    this.logger.log(
      `AppSubscription created shop=${shopDomain} plan=${plan} chargeId=${chargeId}`,
    );

    return { confirmationUrl };
  }

  async resolveShopByChargeId(chargeId: string): Promise<string | null> {
    const gid = chargeId.startsWith(SHOPIFY_GID_PREFIX)
      ? chargeId
      : `${SHOPIFY_GID_PREFIX}${chargeId}`;
    const subscription = await this.prisma.subscription.findFirst({
      where: { shopifyChargeId: gid },
      select: { shopDomain: true },
    });
    return subscription?.shopDomain ?? null;
  }

  async handleCallback(
    chargeId: string,
    shopDomain: string,
  ): Promise<CallbackStatus> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { shopDomain },
    });

    if (!subscription || !subscription.accessToken) {
      this.logger.error(
        `handleCallback: no subscription or accessToken found for shop=${shopDomain} chargeId=${chargeId}`,
      );
      return 'OTHER';
    }

    const gid = chargeId.startsWith(SHOPIFY_GID_PREFIX)
      ? chargeId
      : `${SHOPIFY_GID_PREFIX}${chargeId}`;

    const session = new Session({
      id: `offline_${shopDomain}`,
      shop: shopDomain,
      state: '',
      isOnline: false,
      accessToken: subscription.accessToken,
    });

    const client = new this.shopify.clients.Graphql({ session });

    const response = await client.request<GetAppSubscriptionData>(
      GET_APP_SUBSCRIPTION_QUERY,
      { variables: { id: gid } },
    );

    const node = response.data?.node;
    const status = node?.status ?? 'OTHER';

    this.logger.log(
      `handleCallback shop=${shopDomain} chargeId=${chargeId} status=${status}`,
    );

    if (status === 'ACTIVE') {
      await this.prisma.subscription.update({
        where: { shopDomain },
        data: { status: 'active', billingStartsAt: new Date() },
      });
    } else if (status === 'DECLINED') {
      await this.prisma.subscription.update({
        where: { shopDomain },
        data: { status: 'declined' },
      });
    } else {
      this.logger.warn(
        `handleCallback unexpected status=${status} shop=${shopDomain}`,
      );
    }

    return status === 'ACTIVE'
      ? 'ACTIVE'
      : status === 'DECLINED'
        ? 'DECLINED'
        : 'OTHER';
  }

  async handleSubscriptionUpdate(payload: unknown): Promise<void> {
    const schema = z.object({
      app_subscription: z.object({
        admin_graphql_api_id: z.string(),
        status: z.enum([
          'ACTIVE',
          'DECLINED',
          'EXPIRED',
          'FROZEN',
          'CANCELLED',
          'PENDING',
        ]),
      }),
    });

    const parsed = schema.parse(payload);
    const { admin_graphql_api_id: chargeId, status: shopifyStatus } =
      parsed.app_subscription;

    const dbStatus = shopifyStatus.toLowerCase();

    const subscription = await this.prisma.subscription.findUnique({
      where: { shopifyChargeId: chargeId },
    });

    if (!subscription) {
      this.logger.warn(
        `handleSubscriptionUpdate: no subscription found for chargeId=${chargeId}`,
      );
      return;
    }

    const graceEndsAt =
      dbStatus === 'expired' || dbStatus === 'cancelled'
        ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        : dbStatus === 'active'
          ? null
          : undefined;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: dbStatus,
        ...(graceEndsAt !== undefined ? { graceEndsAt } : {}),
      },
    });

    this.logger.log(
      `handleSubscriptionUpdate shop=${subscription.shopDomain} chargeId=${chargeId} status=${dbStatus}`,
    );
  }

  async testToken(
    shopDomain: string,
    accessToken: string,
  ): Promise<{ ok: boolean; shop?: string; error?: string }> {
    const session = new Session({
      id: `offline_${shopDomain}`,
      shop: shopDomain,
      state: '',
      isOnline: false,
      accessToken,
    });

    const client = new this.shopify.clients.Graphql({ session });

    try {
      const response = await client.request<{ shop: { name: string } }>(
        `#graphql query { shop { name } }`,
      );
      return { ok: true, shop: response.data?.shop?.name };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`testToken shop=${shopDomain} error=${msg}`);
      return { ok: false, error: msg };
    }
  }
}
