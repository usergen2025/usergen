import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MediaController } from './media/media.controller';
import { StockModule } from './stock/stock.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/media-management-service/.env',
        '.env',
      ],
    }),
    StockModule,
  ],
  controllers: [MediaController],
  providers: [],
})
export class AppModule {}

