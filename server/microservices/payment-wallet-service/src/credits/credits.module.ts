import { Module } from '@nestjs/common';
import { CreditsController } from './credits.controller';
import { CreditsService } from './credits.service';
import { PricingModule } from '../pricing/pricing.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { DatabaseModule } from '../common/database/database.module';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule, PricingModule, TransactionsModule],
  controllers: [CreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
