import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssetAnalysisService } from './asset-analysis.service';
import { AssetAnalysisController } from './asset-analysis.controller';
import { AssetAnalysisQueueModule } from './queue/asset-analysis-queue.module';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    AssetAnalysisQueueModule,
  ],
  controllers: [AssetAnalysisController],
  providers: [AssetAnalysisService],
  exports: [AssetAnalysisService, AssetAnalysisQueueModule],
})
export class AssetsModule {}

