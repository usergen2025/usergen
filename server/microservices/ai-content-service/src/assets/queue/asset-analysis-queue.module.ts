import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AssetAnalysisQueueService } from './asset-analysis-queue.service';
import { AssetAnalysisProcessor } from './processors/asset-analysis.processor';
import { AssetAnalysisService } from '../asset-analysis.service';
import { LogoPreprocessingService } from '../logo-preprocessing.service';
import { LoggerModule } from '../../common/logger/logger.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    StorageModule,
    BullModule.registerQueue({ name: 'asset-analysis' }),
  ],
  providers: [
    AssetAnalysisQueueService,
    AssetAnalysisProcessor,
    AssetAnalysisService,
    LogoPreprocessingService,
  ],
  exports: [AssetAnalysisQueueService],
})
export class AssetAnalysisQueueModule {}



