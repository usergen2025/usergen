import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QueueManagerService } from './queue-manager.service';
import { AudioGenerationProcessor } from './processors/audio-generation.processor';
import { ImageGenerationProcessor } from './processors/image-generation.processor';
import { VideoGenerationProcessor } from './processors/video-generation.processor';
import { AvatarVideoGenerationProcessor } from './processors/avatar-video-generation.processor';
import { SceneCompositeProcessor } from './processors/scene-composite.processor';
import { StockDownloadProcessor } from './processors/stock-download.processor';
import { PreviewDerivativesProcessor } from './processors/preview-derivatives.processor';
import { DatabaseModule } from '../database/database.module';
import { RenderingModule } from '../../rendering/rendering.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { StorageModule } from '../storage/storage.module';
import { AssetProcessorService } from '../services/asset-processor.service';
import { VideoModule } from '../../video/video.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    VideoModule,
    StorageModule, // Import StorageModule to access PublicUrlService
    forwardRef(() => RenderingModule),
    WebSocketModule, // Import WebSocket module to access gateway
    // Register queues for different task types
    BullModule.registerQueue(
      { name: 'audio-generation' },
      { name: 'image-generation' },
      { name: 'video-generation' },
      { name: 'avatar-video-generation' },
      { name: 'scene-composite' },
      { name: 'stock-download' },
      { name: 'preview-derivatives' },
    ),
  ],
  providers: [
    QueueManagerService,
    AudioGenerationProcessor,
    ImageGenerationProcessor,
    VideoGenerationProcessor,
    AvatarVideoGenerationProcessor,
    SceneCompositeProcessor,
    StockDownloadProcessor,
    PreviewDerivativesProcessor,
    AssetProcessorService,
  ],
  exports: [QueueManagerService],
})
export class QueueModule {}

