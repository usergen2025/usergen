import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VideoCompositorProvider } from '../rendering/providers/video-compositor.provider';

/**
 * FFmpeg compositor utilities without RenderingModule / QueueModule dependencies.
 * Used by PreviewModule to avoid circular imports.
 */
@Module({
  imports: [ConfigModule],
  providers: [VideoCompositorProvider],
  exports: [VideoCompositorProvider],
})
export class CompositorModule {}
