import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { WalletSyncService } from './wallet-sync.service';
import { DatabaseModule } from '../common/database/database.module';
import { AuthModule } from '../common/auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, WalletSyncService],
})
export class CampaignsModule {}
