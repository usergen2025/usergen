import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TransactionsModule } from './transactions/transactions.module';
import { PricingModule } from './pricing/pricing.module';
import { CreditsModule } from './credits/credits.module';
import { DatabaseModule } from './common/database/database.module';
import { LoggerModule } from './common/logger/logger.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    DatabaseModule,
    LoggerModule,
    TransactionsModule,
    PricingModule,
    CreditsModule,
  ],
})
export class AppModule {}
