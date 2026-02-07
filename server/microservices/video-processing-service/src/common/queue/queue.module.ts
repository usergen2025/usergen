import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QueueManagerService } from './queue-manager.service';
import { AudioGenerationProcessor } from './processors/audio-generation.processor';
import { ImageGenerationProcessor } from './processors/image-generation.processor';
import { VideoGenerationProcessor } from './processors/video-generation.processor';
import { DatabaseModule } from '../database/database.module';
import { RenderingModule } from '../../rendering/rendering.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    StorageModule, // Import StorageModule to access PublicUrlService
    forwardRef(() => RenderingModule),
    WebSocketModule, // Import WebSocket module to access gateway
    // Register queues for different task types
    BullModule.registerQueue(
      { name: 'audio-generation' },
      { name: 'image-generation' },
      { name: 'video-generation' },
    ),
  ],
  providers: [
    QueueManagerService,
    AudioGenerationProcessor,
    ImageGenerationProcessor,
    VideoGenerationProcessor,
  ],
  exports: [QueueManagerService],
})
export class QueueModule {}

