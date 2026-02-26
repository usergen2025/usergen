import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VideoService } from './video.service';
import { DatabaseModule } from '../common/database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
