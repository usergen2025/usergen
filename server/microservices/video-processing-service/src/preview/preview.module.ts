import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PreviewVideoService } from './preview-video.service';
import { StorageModule } from '../common/storage/storage.module';
import { CompositorModule } from '../compositor/compositor.module';

@Module({
  imports: [ConfigModule, StorageModule, CompositorModule],
  providers: [PreviewVideoService],
  exports: [PreviewVideoService],
})
export class PreviewModule {}
