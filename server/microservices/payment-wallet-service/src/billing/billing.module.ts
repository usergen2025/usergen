import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database/database.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AdminBillingController } from './admin-billing.controller';
import { DiscountApplier } from './appliers/discount.applier';
import { TaxApplier } from './appliers/tax.applier';
import { BillingController } from './billing.controller';
import { BillingSettingsService } from './billing-settings.service';
import { CreditPackagesService } from './credit-packages.service';
import { PricingEngine } from './pricing.engine';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [BillingController, AdminBillingController],
  providers: [
    PricingEngine,
    BillingSettingsService,
    CreditPackagesService,
    DiscountApplier,
    TaxApplier,
  ],
  exports: [
    PricingEngine,
    BillingSettingsService,
    CreditPackagesService,
    DiscountApplier,
    TaxApplier,
  ],
})
export class BillingModule {}
