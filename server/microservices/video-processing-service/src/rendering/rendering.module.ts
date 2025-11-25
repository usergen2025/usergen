import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RenderingService } from './rendering.service';
import { BytePlusProvider } from './providers/byteplus.provider';
import { FalProvider } from './providers/fal/fal.provider';
import { FalVideoProvider } from './providers/fal/fal-video.provider';
import { ModelRegistryService } from './providers/model-registry.service';
import { ProviderFactory } from './providers/provider-factory.service';
import { VideoProviderFactory } from './providers/video-provider-factory.service';
import { HeyGenVideoProvider } from './providers/heygen-video.provider';
import { VideoCompositorProvider } from './providers/video-compositor.provider';
import { DatabaseModule } from '../common/database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    RenderingService,
    BytePlusProvider,
    FalProvider,
    FalVideoProvider,
    ModelRegistryService,
    ProviderFactory,
    VideoProviderFactory,
    HeyGenVideoProvider,
    VideoCompositorProvider,
  ],
  exports: [
    RenderingService,
    BytePlusProvider,
    FalProvider,
    FalVideoProvider,
    ModelRegistryService,
    ProviderFactory,
    VideoProviderFactory,
    HeyGenVideoProvider,
    VideoCompositorProvider,
  ],
})
export class RenderingModule {}

