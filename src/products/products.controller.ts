import { Controller, Get } from '@nestjs/common';
import { WebhooksService } from '../webhooks/webhooks.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get('changes')
  async getChanges(): Promise<
    {
      id: string;
      productTitle: string;
      fieldChanged: string;
      oldValue: string;
      newValue: string;
      changedAt: Date;
    }[]
  > {
    return this.webhooksService.getProductChanges();
  }
}
