import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AssetAnalysisQueueService } from './asset-analysis-queue.service';
import { AssetAnalysisProcessor } from './processors/asset-analysis.processor';
import { AssetAnalysisService } from '../asset-analysis.service';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    BullModule.registerQueue({ name: 'asset-analysis' }),
  ],
  providers: [
    AssetAnalysisQueueService,
    AssetAnalysisProcessor,
    AssetAnalysisService,
  ],
  exports: [AssetAnalysisQueueService],
})
export class AssetAnalysisQueueModule {}



