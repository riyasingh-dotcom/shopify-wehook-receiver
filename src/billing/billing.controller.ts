import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { BillingService, type SubscriptionStatus } from './billing.service';

const CallbackQuerySchema = z.object({
  charge_id: z.string().min(1),
  // Shopify includes shop on most redirects but it is not guaranteed — fall
  // back to a DB lookup by chargeId when it is absent.
  shop: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/)
    .optional(),
});

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly config: ConfigService,
  ) {}

  @Get('status')
  async getStatus(@Query('shop') shop: unknown): Promise<SubscriptionStatus> {
    const schema = z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/);
    const parsed = schema.safeParse(shop);
    if (!parsed.success) {
      throw new BadRequestException('Invalid or missing shop domain');
    }
    return await this.billingService.getStatus(parsed.data);
  }

  @Post('test-token')
  async testToken(
    @Body() body: unknown,
  ): Promise<{ ok: boolean; shop?: string; error?: string }> {
    const schema = z.object({
      shopDomain: z.string().min(1),
      accessToken: z.string().min(1),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return await this.billingService.testToken(
      parsed.data.shopDomain,
      parsed.data.accessToken,
    );
  }

  @Post('subscribe')
  async subscribe(@Body() body: unknown): Promise<{ confirmationUrl: string }> {
    const schema = z.object({
      shopDomain: z.string().min(1),
      plan: z.enum(['basic', 'pro']),
      sessionToken: z.string().min(1),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.message);
    }

    const { shopDomain, plan, sessionToken } = parsed.data;
    return this.billingService.createSubscription(
      shopDomain,
      plan,
      sessionToken,
    );
  }

  @Get('callback')
  @Redirect('', 302)
  async callback(
    @Query('charge_id') chargeId: unknown,
    @Query('shop') shop: unknown,
  ): Promise<{ url: string }> {
    this.logger.log(
      `billing/callback received charge_id=${String(chargeId)} shop=${String(shop)}`,
    );

    const parsed = CallbackQuerySchema.safeParse({ charge_id: chargeId, shop });

    if (!parsed.success) {
      this.logger.warn(
        `billing/callback invalid params: ${parsed.error.message}`,
      );
      return { url: this.fallbackRedirectUrl() };
    }

    const { charge_id } = parsed.data;

    // Shopify does not always include shop in the billing callback —
    // resolve it from the DB when missing.
    let shopDomain = parsed.data.shop;
    if (!shopDomain) {
      const resolved =
        await this.billingService.resolveShopByChargeId(charge_id);
      if (!resolved) {
        this.logger.warn(
          `billing/callback: could not resolve shop for chargeId=${charge_id}`,
        );
        return { url: this.fallbackRedirectUrl() };
      }
      shopDomain = resolved;
    }

    try {
      await this.billingService.handleCallback(charge_id, shopDomain);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `billing/callback failed shop=${shopDomain} chargeId=${charge_id}: ${msg}`,
      );
    }

    const apiKey = this.config.getOrThrow<string>('SHOPIFY_API_KEY');
    return { url: `https://${shopDomain}/admin/apps/${apiKey}` };
  }

  private fallbackRedirectUrl(): string {
    const billingReturnUrl = this.config.get<string>('BILLING_RETURN_URL');
    if (billingReturnUrl) {
      try {
        return new URL(billingReturnUrl).origin;
      } catch {
        // fall through
      }
    }
    const host = this.config.get<string>('APP_HOST');
    return host ? `https://${host}` : 'about:blank';
  }
}
