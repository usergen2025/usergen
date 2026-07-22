import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TransactionsModule } from './transactions/transactions.module';
import { PricingModule } from './pricing/pricing.module';
import { CreditsModule } from './credits/credits.module';
import { DatabaseModule } from './common/database/database.module';
import { LoggerModule } from './common/logger/logger.module';
import { AuthModule } from './common/auth/auth.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { BillingModule } from './billing/billing.module';
import { PaymentsModule } from './payments/payments.module';
import { InvoicesModule } from './invoices/invoices.module';
import { FulfillmentModule } from './fulfillment/fulfillment.module';
import { CheckoutModule } from './checkout/checkout.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PaymentLinksModule } from './payment-links/payment-links.module';
import { RefundsModule } from './refunds/refunds.module';
import { BillingEmailsModule } from './billing-emails/billing-emails.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    DatabaseModule,
    LoggerModule,
    AuthModule,
    IdempotencyModule,
    BillingEmailsModule,
    TransactionsModule,
    PricingModule,
    CreditsModule,
    BillingModule,
    PaymentsModule,
    InvoicesModule,
    FulfillmentModule,
    CheckoutModule,
    WebhooksModule,
    PaymentLinksModule,
    RefundsModule,
  ],
})
export class AppModule {}
