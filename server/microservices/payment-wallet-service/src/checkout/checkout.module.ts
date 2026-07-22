import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { BillingEmailsModule } from '../billing-emails/billing-emails.module';
import { DatabaseModule } from '../common/database/database.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PaymentsModule } from '../payments/payments.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [
    DatabaseModule,
    BillingModule,
    PaymentsModule,
    FulfillmentModule,
    BillingEmailsModule,
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
