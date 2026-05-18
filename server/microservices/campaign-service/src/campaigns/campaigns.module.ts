import { Module, forwardRef } from '@nestjs/common';
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
import { LeaderboardService } from './leaderboard.service';
import { CampaignFinalizationService } from './campaign-finalization.service';
import { DatabaseModule } from '../common/database/database.module';
import { AuthModule } from '../common/auth/auth.module';
import { ScraperModule } from '../scraper/scraper.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    forwardRef(() => ScraperModule),
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
    LeaderboardService,
    CampaignFinalizationService,
  ],
  exports: [
    CampaignsService,
    CampaignEventsGateway,
    CampaignNotificationService,
    LeaderboardService,
  ],
})
export class CampaignsModule {}
