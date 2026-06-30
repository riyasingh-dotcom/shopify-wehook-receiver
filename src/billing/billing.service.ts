import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiVersion,
  Session,
  shopifyApi,
  type Shopify,
} from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { PrismaService } from '../prisma/prisma.service';

export type Plan = 'basic' | 'pro';

export type CreateSubscriptionResult = {
  confirmationUrl: string;
};

export type CallbackStatus = 'ACTIVE' | 'DECLINED' | 'OTHER';

const PLAN_CONFIG: Record<Plan, { name: string; amount: string }> = {
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
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);
  private shopify!: Shopify;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.shopify = shopifyApi({
      apiKey: this.config.getOrThrow<string>('SHOPIFY_API_KEY'),
      apiSecretKey: this.config.getOrThrow<string>('SHOPIFY_API_SECRET'),
      scopes: ['read_orders', 'read_products'],
      hostName: this.config.get<string>('APP_HOST') ?? 'localhost',
      apiVersion: ApiVersion.January25,
      isEmbeddedApp: true,
    });
  }

  async createSubscription(
    shopDomain: string,
    plan: Plan,
    accessToken: string,
  ): Promise<CreateSubscriptionResult> {
    const returnUrl = this.config.getOrThrow<string>('BILLING_RETURN_URL');
    const { name, amount } = PLAN_CONFIG[plan];

    const session = new Session({
      id: `offline_${shopDomain}`,
      shop: shopDomain,
      state: '',
      isOnline: false,
      accessToken,
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
        accessToken,
      },
      update: {
        shopifyChargeId: chargeId,
        plan,
        status: 'pending',
        accessToken,
      },
    });

    this.logger.log(
      `AppSubscription created shop=${shopDomain} plan=${plan} chargeId=${chargeId}`,
    );

    return { confirmationUrl };
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
}
