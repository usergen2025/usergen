import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UserNotificationService } from './user-notification.service';

@Module({
  imports: [ConfigModule],
  providers: [UserNotificationService],
  exports: [UserNotificationService],
})
export class NotificationsModule {}
