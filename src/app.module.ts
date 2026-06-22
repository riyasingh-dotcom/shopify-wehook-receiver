import { Module } from '@nestjs/common';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), WebhooksModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
