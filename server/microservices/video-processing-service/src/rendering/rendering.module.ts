import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VideoModule } from '../video/video.module';
import { RenderingService } from './rendering.service';
import { AlternateAvatarService } from './alternate-avatar.service';
import { BytePlusProvider } from './providers/byteplus.provider';
import { FalProvider } from './providers/fal/fal.provider';
import { FalVideoProvider } from './providers/fal/fal-video.provider';
import { ModelRegistryService } from './providers/model-registry.service';
import { ProviderFactory } from './providers/provider-factory.service';
import { VideoProviderFactory } from './providers/video-provider-factory.service';
import { HeyGenVideoProvider } from './providers/heygen-video.provider';
import { VideoCompositorProvider } from './providers/video-compositor.provider';
import { DatabaseModule } from '../common/database/database.module';
import { StorageModule } from '../common/storage/storage.module';

@Module({
  imports: [ConfigModule, DatabaseModule, StorageModule, VideoModule],
  providers: [
    RenderingService,
    AlternateAvatarService,
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
    AlternateAvatarService,
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

