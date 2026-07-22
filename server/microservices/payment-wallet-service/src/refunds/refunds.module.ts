import { Module } from '@nestjs/common';
import { BillingEmailsModule } from '../billing-emails/billing-emails.module';
import { DatabaseModule } from '../common/database/database.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ReconciliationService } from './reconciliation.service';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [
    DatabaseModule,
    PaymentsModule,
    TransactionsModule,
    BillingEmailsModule,
    InvoicesModule,
  ],
  controllers: [RefundsController],
  providers: [RefundsService, ReconciliationService],
  exports: [RefundsService, ReconciliationService],
})
export class RefundsModule {}
