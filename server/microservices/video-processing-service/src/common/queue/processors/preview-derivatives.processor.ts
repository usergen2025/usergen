import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { PublicUrlService } from '../../storage/public-url.service';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface PreviewDerivativesJobData {
  projectId: string;
  userId: string;
  videoUrl?: string;
}

@Processor('preview-derivatives', {
  concurrency: 3,
})
@Injectable()
export class PreviewDerivativesProcessor extends WorkerHost {
  private readonly uploadsDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly publicUrlService: PublicUrlService,
  ) {
    super();
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  async process(job: Job<PreviewDerivativesJobData>): Promise<any> {
    const { projectId, userId, videoUrl } = job.data;
    const project = await this.databaseService.videoProject.findUnique({ where: { id: projectId } });
    if (!project) throw new Error('Project not found');

    const sourceUrl = videoUrl || project.videoUrl;
    if (!sourceUrl) throw new Error('Source video URL missing');

    const inputPath = this.resolveInputPath(sourceUrl);
    const outputDir = path.join(this.uploadsDir, 'previews', userId);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const thumbFilename = `${projectId}_thumb.jpg`;
    const previewFilename = `${projectId}_preview.mp4`;
    const thumbPath = path.join(outputDir, thumbFilename);
    const previewPath = path.join(outputDir, previewFilename);

    // Generate poster frame.
    execSync(`ffmpeg -y -ss 0.5 -i "${inputPath}" -frames:v 1 -q:v 5 "${thumbPath}"`, {
      stdio: 'pipe',
    });

    // Generate lightweight compressed preview.
    execSync(
      `ffmpeg -y -i "${inputPath}" -vf "scale='min(360,iw)':-2:force_original_aspect_ratio=decrease" -c:v libx264 -preset veryfast -crf 32 -movflags +faststart -an "${previewPath}"`,
      { stdio: 'pipe' },
    );

    const thumbUpload = await this.publicUrlService.uploadFromPath(
      thumbPath,
      `videos/${userId}/previews`,
      thumbFilename,
      'image/jpeg',
    );
    const previewUpload = await this.publicUrlService.uploadFromPath(
      previewPath,
      `videos/${userId}/previews`,
      previewFilename,
      'video/mp4',
    );

    const metadata =
      project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
        ? ({ ...(project.metadata as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    metadata.previewVideoUrl = previewUpload.publicUrl;
    metadata.previewGeneratedAt = new Date().toISOString();

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        thumbnailUrl: thumbUpload.publicUrl,
        metadata: metadata as object,
      },
    });

    return {
      success: true,
      thumbnailUrl: thumbUpload.publicUrl,
      previewVideoUrl: previewUpload.publicUrl,
    };
  }

  private resolveInputPath(videoUrl: string): string {
    if (videoUrl.startsWith('/uploads/')) {
      const relative = videoUrl.replace(/^\/uploads\//, '');
      return path.join(this.uploadsDir, relative);
    }
    return videoUrl;
  }
}
