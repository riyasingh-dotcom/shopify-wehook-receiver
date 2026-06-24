import { Module } from '@nestjs/common';
import { WebhooksModule } from './webhooks/webhooks.module';
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
        const restUrl = config.getOrThrow<string>('UPSTASH_REDIS_REST_URL');
        const host = new URL(restUrl).hostname;
        const password = config.getOrThrow<string>('UPSTASH_REDIS_REST_TOKEN');
        return {
          connection: { host, port: 6379, password, tls: {} },
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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
