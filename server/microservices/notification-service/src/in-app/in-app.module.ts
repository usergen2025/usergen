import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database/database.module';
import { InAppNotificationService } from './in-app-notification.service';
import { UserPresenceService } from './user-presence.service';

@Module({
  imports: [DatabaseModule],
  providers: [InAppNotificationService, UserPresenceService],
  exports: [InAppNotificationService, UserPresenceService],
})
export class InAppModule {}
