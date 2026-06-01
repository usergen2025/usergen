import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssetAnalysisService } from './asset-analysis.service';
import { LogoPreprocessingService } from './logo-preprocessing.service';
import { AssetAnalysisController } from './asset-analysis.controller';
import { AssetAnalysisQueueModule } from './queue/asset-analysis-queue.module';
import { LoggerModule } from '../common/logger/logger.module';
import { StorageModule } from '../common/storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    StorageModule,
    AssetAnalysisQueueModule,
  ],
  controllers: [AssetAnalysisController],
  providers: [AssetAnalysisService, LogoPreprocessingService],
  exports: [AssetAnalysisService, LogoPreprocessingService, AssetAnalysisQueueModule],
})
export class AssetsModule {}

