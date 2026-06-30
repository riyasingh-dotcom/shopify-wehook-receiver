import { Module } from '@nestjs/common';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { BullModule } from '@nestjs/bullmq';
import { BillingModule } from './billing/billing.module';
import { ShopifyModule } from './shopify/shopify.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl) {
          const url = new URL(redisUrl);
          return {
            connection: {
              host: url.hostname,
              port: parseInt(url.port || '6379', 10),
              ...(url.password
                ? { password: decodeURIComponent(url.password) }
                : {}),
              ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
            },
          };
        }
        // Upstash fallback for production — high stalledInterval to limit request usage
        const restUrl = config.getOrThrow<string>('UPSTASH_REDIS_REST_URL');
        const host = new URL(restUrl).hostname;
        const password = config.getOrThrow<string>('UPSTASH_REDIS_REST_TOKEN');
        return {
          connection: {
            host,
            port: 6379,
            password,
            tls: {},
            // don't queue commands while disconnected — fail fast instead
            enableOfflineQueue: false,
          },
          defaultWorkerOptions: {
            stalledInterval: 600_000, // stalled check: every 10 min (144×/day)
            blockTimeout: 300_000, // blocking wait: 5 min (288 BLMOVE cmds/day)
            skipVersionCheck: true, // skip compat check commands on startup
            metrics: { maxDataPoints: 0 }, // disable metrics — each job would write to Redis
          },
        };
      },
      inject: [ConfigService],
    }),
    PrismaModule,
    ShopifyModule,
    WebhooksModule,
    BillingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
