import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsController } from './analytics/analytics.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/analytics-service/.env',
        '.env',
      ],
    }),
  ],
  controllers: [AnalyticsController],
  providers: [],
})
export class AppModule {}

