import {
  CanActivate,
  ExecutionContext,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  shopifyApi,
  ApiVersion,
  type Shopify,
  type JwtPayload,
} from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import type { Request } from 'express';

export type ShopifySessionPayload = JwtPayload & {
  iss: string;   // https://<shop>.myshopify.com/admin
  dest: string;  // https://<shop>.myshopify.com
  aud: string;   // your API key
  sub: string;   // user ID
  sid: string;   // session ID
};

/**
 * Verifies the Shopify session token (JWT) sent from the embedded frontend
 * using the official @shopify/shopify-api package.
 *
 * Apply with @UseGuards(ShopifySessionTokenGuard) on any route the frontend calls.
 * The decoded payload is attached to request.shopifySession for downstream use.
 *
 * Returns 401 if the token is missing, malformed, expired, or has an invalid signature.
 */
@Injectable()
export class ShopifySessionTokenGuard implements CanActivate, OnModuleInit {
  private shopify!: Shopify;

  constructor(private readonly config: ConfigService) {}

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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const token = authHeader.slice(7);

    try {
      const payload = await this.shopify.session.decodeSessionToken(token);

      (request as Request & { shopifySession: ShopifySessionPayload }).shopifySession =
        payload as ShopifySessionPayload;

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session token');
    }
  }
}
