import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { BillingEmailsModule } from '../billing-emails/billing-emails.module';
import { DatabaseModule } from '../common/database/database.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminOrdersService } from './admin-orders.service';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentLinksService } from './payment-links.service';

@Module({
  imports: [DatabaseModule, BillingModule, PaymentsModule, BillingEmailsModule],
  controllers: [AdminPaymentsController],
  providers: [PaymentLinksService, AdminOrdersService],
  exports: [PaymentLinksService, AdminOrdersService],
})
export class PaymentLinksModule {}
