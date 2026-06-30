import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiVersion, shopifyApi, type Shopify } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

export const SHOPIFY_INSTANCE = Symbol('SHOPIFY_INSTANCE');

@Module({
  providers: [
    {
      provide: SHOPIFY_INSTANCE,
      useFactory: (config: ConfigService): Shopify =>
        shopifyApi({
          apiKey: config.getOrThrow<string>('SHOPIFY_API_KEY'),
          apiSecretKey: config.getOrThrow<string>('SHOPIFY_API_SECRET'),
          scopes: ['read_orders', 'read_products'],
          hostName: config.get<string>('APP_HOST') ?? 'localhost',
          apiVersion: ApiVersion.January25,
          isEmbeddedApp: true,
        }),
      inject: [ConfigService],
    },
  ],
  exports: [SHOPIFY_INSTANCE],
})
export class ShopifyModule {}
