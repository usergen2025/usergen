import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AvatarsController } from './avatars.controller';
import { AvatarsService } from './avatars.service';
import { HeyGenProvider } from './providers/heygen.provider';
import { BytePlusImageProvider } from './providers/byteplus-image.provider';
import { FalImageProvider } from './providers/fal-image.provider';
import { ImageProcessorService } from './services/image-processor.service';
import { DatabaseModule } from '../common/database/database.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AvatarQueueModule } from './queue/avatar-queue.module';
import { StorageModule } from '../common/storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    LoggerModule,
    StorageModule,
    forwardRef(() => AvatarQueueModule),
  ],
  controllers: [AvatarsController],
  providers: [
    AvatarsService,
    HeyGenProvider,
    BytePlusImageProvider,
    FalImageProvider,
    ImageProcessorService,
  ],
  exports: [
    AvatarsService,
    HeyGenProvider,
    BytePlusImageProvider,
    FalImageProvider,
    ImageProcessorService,
  ],
})
export class AvatarsModule {}

