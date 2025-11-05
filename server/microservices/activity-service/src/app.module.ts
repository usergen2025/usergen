import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './common/database/database.module';
import { MessageQueueModule } from './common/message-queue/message-queue.module';
import { LoggerModule } from './common/logger/logger.module';
import { ActivitiesModule } from './activities/activities.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/activity-service/.env',
        '.env',
      ],
    }),
    DatabaseModule,
    MessageQueueModule,
    LoggerModule,
    ActivitiesModule,
  ],
})
export class AppModule {}


