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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env.local', '../../.env', '.env.local', '.env'],
    }),
    BullModule.forRoot({
      connection: QueueManagerService.getRedisConnection(),
    }),
    DatabaseModule,
    RenderingModule,
    QueueModule,
    WebSocketModule,
  ],
  controllers: [VideoController],
  providers: [VideoService],
})
export class AppModule {}

