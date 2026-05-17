import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VideoService } from './video.service';
import { DatabaseModule } from '../common/database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../common/storage/storage.module';

@Module({
  imports: [ConfigModule, DatabaseModule, NotificationsModule, StorageModule],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
