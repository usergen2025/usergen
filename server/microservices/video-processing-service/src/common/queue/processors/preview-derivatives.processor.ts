import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { PreviewVideoService } from '../../../preview/preview-video.service';

export interface PreviewDerivativesJobData {
  projectId: string;
  userId: string;
  videoUrl?: string;
  forceRegenerate?: boolean;
}

@Processor('preview-derivatives', {
  concurrency: 3,
})
@Injectable()
export class PreviewDerivativesProcessor extends WorkerHost {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly previewVideoService: PreviewVideoService,
  ) {
    super();
  }

  async process(job: Job<PreviewDerivativesJobData>): Promise<any> {
    const { projectId, userId, videoUrl, forceRegenerate } = job.data;
    const project = await this.databaseService.videoProject.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new Error('Project not found');

    const sourceVideoUrl = videoUrl || project.videoUrl;
    if (!sourceVideoUrl) throw new Error('Source video URL missing');

    const metadata =
      project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
        ? ({ ...(project.metadata as Record<string, unknown>) } as Record<string, unknown>)
        : {};

    if (
      this.previewVideoService.shouldSkipRegeneration(metadata, sourceVideoUrl, forceRegenerate)
    ) {
      console.log(`[PreviewDerivatives] Skipping project ${projectId} — preview up to date`);
      return { success: true, skipped: true };
    }

    try {
      const audioFiles = this.parseAudioFiles(project.audioFiles);

      const result = await this.previewVideoService.buildWatermarkedPreview({
        projectId,
        userId,
        sourceVideoUrl,
        audioFiles,
      });

      delete metadata.previewGenerationError;
      metadata.previewVideoUrl = result.previewPublicUrl;
      metadata.previewGeneratedAt = new Date().toISOString();
      metadata.previewSourceHash = result.previewSourceHash;
      metadata.previewFormatVersion = result.previewFormatVersion;

      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          thumbnailUrl: result.thumbnailPublicUrl,
          metadata: metadata as object,
        },
      });

      return {
        success: true,
        thumbnailUrl: result.thumbnailPublicUrl,
        previewVideoUrl: result.previewPublicUrl,
      };
    } catch (error: any) {
      console.error(
        `[PreviewDerivatives] Failed for project ${projectId}:`,
        error?.message || error,
      );
      metadata.previewGenerationError = error?.message || String(error);
      metadata.previewGenerationFailedAt = new Date().toISOString();
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: { metadata: metadata as object },
      });
      throw error;
    }
  }

  private parseAudioFiles(
    raw: unknown,
  ): Array<{ sceneNumber?: number; duration?: number }> | undefined {
    if (!raw) return undefined;
    const arr = Array.isArray(raw) ? raw : typeof raw === 'object' ? Object.values(raw as object) : [];
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    return arr.map((item: any) => ({
      sceneNumber: item?.sceneNumber ?? item?.scene_number,
      duration: item?.duration,
    }));
  }
}
