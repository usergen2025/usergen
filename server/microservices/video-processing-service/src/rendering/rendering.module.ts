import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RenderingService } from './rendering.service';
import { BytePlusProvider } from './providers/byteplus.provider';
import { HeyGenVideoProvider } from './providers/heygen-video.provider';
import { VideoCompositorProvider } from './providers/video-compositor.provider';
import { DatabaseModule } from '../common/database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    RenderingService,
    BytePlusProvider,
    HeyGenVideoProvider,
    VideoCompositorProvider,
  ],
  exports: [RenderingService, BytePlusProvider, HeyGenVideoProvider, VideoCompositorProvider],
})
export class RenderingModule {}

