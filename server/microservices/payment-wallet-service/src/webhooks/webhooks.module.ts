import { Module } from '@nestjs/common';
import { BillingEmailsModule } from '../billing-emails/billing-emails.module';
import { DatabaseModule } from '../common/database/database.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PaymentsModule } from '../payments/payments.module';
import { RefundsModule } from '../refunds/refunds.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    DatabaseModule,
    PaymentsModule,
    FulfillmentModule,
    RefundsModule,
    BillingEmailsModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
