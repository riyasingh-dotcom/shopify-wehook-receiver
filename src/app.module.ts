import { Module } from '@nestjs/common';
import { WebhooksModule } from './webhooks/webhooks.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';

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
            blockTimeout: 60_000,     // blocking wait: 60s (1440 BLMOVE cmds/day)
            skipVersionCheck: true,   // skip compat check commands on startup
          },
        };
      },
      inject: [ConfigService],
    }),
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    PrismaModule,
    WebhooksModule,
    DashboardModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
