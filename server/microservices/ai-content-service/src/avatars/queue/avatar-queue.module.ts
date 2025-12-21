import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AvatarQueueService } from './avatar-queue.service';
import { AvatarImageProcessingProcessor } from './processors/avatar-image-processing.processor';
import { AvatarsModule } from '../avatars.module';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    LoggerModule,
    forwardRef(() => AvatarsModule), // Import to access services
    BullModule.registerQueue(
      { name: 'avatar-image-processing' },
      { name: 'avatar-generation' },
    ),
  ],
  providers: [
    AvatarQueueService,
    AvatarImageProcessingProcessor,
  ],
  exports: [AvatarQueueService],
})
export class AvatarQueueModule {}

