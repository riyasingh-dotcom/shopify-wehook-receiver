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
import { BillingService, type Plan } from './billing.service';

const CallbackQuerySchema = z.object({
  charge_id: z.string().min(1),
  shop: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/, 'Invalid shop domain'),
});

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly config: ConfigService,
  ) {}

  @Post('subscribe')
  async subscribe(
    @Body() body: unknown,
  ): Promise<{ confirmationUrl: string }> {
    const schema = z.object({
      shopDomain: z.string().min(1),
      plan: z.enum(['basic', 'pro']),
      accessToken: z.string().min(1),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.message);
    }

    const { shopDomain, plan, accessToken } = parsed.data;
    return this.billingService.createSubscription(
      shopDomain,
      plan as Plan,
      accessToken,
    );
  }

  @Get('callback')
  @Redirect('', 302)
  async callback(
    @Query('charge_id') chargeId: unknown,
    @Query('shop') shop: unknown,
  ): Promise<{ url: string }> {
    const parsed = CallbackQuerySchema.safeParse({ charge_id: chargeId, shop });

    if (!parsed.success) {
      this.logger.warn(
        `billing/callback received invalid query params: ${parsed.error.message}`,
      );
      return { url: this.fallbackRedirectUrl() };
    }

    const { charge_id, shop: shopDomain } = parsed.data;

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
    const host = this.config.get<string>('APP_HOST') ?? 'localhost';
    return `https://${host}`;
  }
}
