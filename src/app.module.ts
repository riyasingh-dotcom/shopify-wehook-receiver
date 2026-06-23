import { Module } from '@nestjs/common';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    WebhooksModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
