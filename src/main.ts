import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import express from 'express';

async function bootstrap(): Promise<void> {
  // bodyParser: false — we register raw() ourselves for the webhook route
  // so HMAC verification has access to the unmodified bytes Shopify signed.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use('/webhooks/shopify', express.raw({ type: 'application/json' }));
  app.use(express.json());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
