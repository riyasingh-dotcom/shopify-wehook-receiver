import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PlanGuard } from './plan.guard';

@Module({
  imports: [PrismaModule, ShopifyModule],
  providers: [BillingService, PlanGuard],
  controllers: [BillingController],
  exports: [BillingService, PlanGuard],
})
export class BillingModule {}
