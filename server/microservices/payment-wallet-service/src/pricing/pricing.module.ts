import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { DatabaseModule } from '../common/database/database.module';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
