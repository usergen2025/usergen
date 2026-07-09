import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CampaignsModule } from './campaigns/campaigns.module';
import { SsembleModule } from './ssemble/ssemble.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['microservices/campaign-service/.env', '.env'],
    }),
    CampaignsModule,
    SsembleModule,
  ],
})
export class AppModule {}
