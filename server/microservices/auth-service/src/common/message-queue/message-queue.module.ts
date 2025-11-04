import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MessageQueueService } from './message-queue.service';

@Module({
  imports: [ConfigModule],
  providers: [MessageQueueService],
  exports: [MessageQueueService],
})
export class MessageQueueModule {}
