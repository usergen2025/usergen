import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { FreepikProvider } from './providers/freepik.provider';

@Module({
  imports: [ConfigModule],
  controllers: [StockController],
  providers: [StockService, FreepikProvider],
  exports: [StockService],
})
export class StockModule {}
