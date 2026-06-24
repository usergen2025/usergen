import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StagedAssetsService } from './staged-assets.service';
import { StagedAssetsController } from './staged-assets.controller';
import { StagedAssetCleanupService } from './staged-asset-cleanup.service';
import { DatabaseModule } from '../common/database/database.module';
import { VideoModule } from '../video/video.module';
import { StorageModule } from '../common/storage/storage.module';

@Module({
  imports: [ConfigModule, DatabaseModule, VideoModule, StorageModule],
  controllers: [StagedAssetsController],
  providers: [StagedAssetsService, StagedAssetCleanupService],
  exports: [StagedAssetsService, StagedAssetCleanupService],
})
export class StagedAssetsModule {}
