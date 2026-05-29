import { Module, forwardRef } from '@nestjs/common';
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
import { HtmlCaptionLayerProvider } from './providers/html-caption-layer.provider';
import { CaptionPlaywrightHealthService } from './caption-playwright-health.service';
import { DatabaseModule } from '../common/database/database.module';
import { StorageModule } from '../common/storage/storage.module';
import { CompositorModule } from '../compositor/compositor.module';
import { QueueModule } from '../common/queue/queue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectLogModule } from '../common/logging/project-log.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    StorageModule,
    CompositorModule,
    VideoModule,
    NotificationsModule,
    ProjectLogModule,
    forwardRef(() => QueueModule),
  ],
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
    HtmlCaptionLayerProvider,
    CaptionPlaywrightHealthService,
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
    CompositorModule,
    HtmlCaptionLayerProvider,
    CaptionPlaywrightHealthService,
  ],
})
export class RenderingModule {}

