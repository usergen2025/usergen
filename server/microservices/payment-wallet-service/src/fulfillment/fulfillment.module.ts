import { Module } from '@nestjs/common';
import { BillingEmailsModule } from '../billing-emails/billing-emails.module';
import { DatabaseModule } from '../common/database/database.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { FulfillmentService } from './fulfillment.service';

@Module({
  imports: [
    DatabaseModule,
    TransactionsModule,
    InvoicesModule,
    PaymentsModule,
    BillingEmailsModule,
  ],
  providers: [FulfillmentService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
