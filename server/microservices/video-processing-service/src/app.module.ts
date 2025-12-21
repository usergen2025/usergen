import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { VideoController } from './video/video.controller';
import { VideoService } from './video/video.service';
import { DatabaseModule } from './common/database/database.module';
import { RenderingModule } from './rendering/rendering.module';
import { QueueModule } from './common/queue/queue.module';
import { QueueManagerService } from './common/queue/queue-manager.service';
import { WebSocketModule } from './common/websocket/websocket.module';
import { StorageModule } from './common/storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        '.env', // Current directory (when running from service root)
        '../.env', // Parent directory
        'microservices/video-processing-service/.env', // From server root
        '../../.env', // From server/microservices root
      ],
    }),
    BullModule.forRoot({
      connection: QueueManagerService.getRedisConnection(),
    }),
    DatabaseModule,
    RenderingModule,
    QueueModule,
    WebSocketModule,
    StorageModule,
  ],
  controllers: [VideoController],
  providers: [VideoService],
})
export class AppModule {}

