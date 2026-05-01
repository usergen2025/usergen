import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CampaignsModule } from './campaigns/campaigns.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['microservices/campaign-service/.env', '.env'],
    }),
    CampaignsModule,
  ],
})
export class AppModule {}
