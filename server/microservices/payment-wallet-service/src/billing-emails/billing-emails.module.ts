import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database/database.module';
import { BillingEmailService } from './billing-email.service';

@Module({
  imports: [DatabaseModule],
  providers: [BillingEmailService],
  exports: [BillingEmailService],
})
export class BillingEmailsModule {}
