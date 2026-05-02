import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CampaignsController } from './campaigns.controller';
import { CampaignMediaController } from './campaign-media.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignMediaService } from './campaign-media.service';
import { WalletSyncService } from './wallet-sync.service';
import { CampaignEventsGateway } from './campaign-events.gateway';
import { CampaignNotificationService } from './campaign-notification.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { DatabaseModule } from '../common/database/database.module';
import { AuthModule } from '../common/auth/auth.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ScheduleModule.forRoot(),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [CampaignsController, CampaignMediaController],
  providers: [
    CampaignsService,
    CampaignMediaService,
    WalletSyncService,
    CampaignEventsGateway,
    CampaignNotificationService,
    CampaignSchedulerService,
  ],
  exports: [CampaignEventsGateway, CampaignNotificationService],
})
export class CampaignsModule {}
