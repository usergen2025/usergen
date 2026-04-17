import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../common/database/database.module';
import { NotificationsController } from './notifications.controller';
import { UserNotificationService } from './user-notification.service';
import { UserPresenceService } from './user-presence.service';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [NotificationsController],
  providers: [UserNotificationService, UserPresenceService],
  exports: [UserNotificationService, UserPresenceService],
})
export class NotificationsModule {}
