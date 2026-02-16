import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseService } from '../../database/database.service';
import { VideoCompositorProvider } from '../../../rendering/providers/video-compositor.provider';
import { PublicUrlService } from '../../storage/public-url.service';
import { JobStatusGateway } from '../../websocket/job-status.gateway';

export interface SceneCompositeJobData {
  projectId: string;
  userId: string;
  sceneNumber: number;
  sceneJobId?: string; // Emit WebSocket with this jobId for client subscription
}

@Processor('scene-composite', {
  concurrency: 5,
})
@Injectable()
export class SceneCompositeProcessor extends WorkerHost {
  private readonly uploadsDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly videoCompositor: VideoCompositorProvider,
    private readonly publicUrlService: PublicUrlService,
    private readonly jobStatusGateway: JobStatusGateway,
  ) {
    super();
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  private resolveAudioPath(audioFile: any): string | null {
    const originalPath = audioFile.filePath;
    if (!originalPath) return null;

    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');

    if (path.isAbsolute(originalPath) && fs.existsSync(originalPath)) {
      return originalPath;
    }
    const relPath = originalPath.startsWith('/') ? originalPath.slice(1) : originalPath;
    const candidates = [
      path.join(voiceServiceDir, relPath),
      path.join(serverRoot, relPath),
      path.join(process.cwd(), relPath),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  async process(job: Job<SceneCompositeJobData>): Promise<any> {
    const { projectId, userId, sceneNumber, sceneJobId } = job.data;
    const emitJobId = sceneJobId || job.id!;

    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId },
    });
    if (!project) {
      throw new Error('Project not found');
    }

    const bRollVideoTasks = ((project as any).bRollVideoTasks as any[]) || [];
    const avatarVideos = ((project as any).avatarVideos as any[]) || [];
    const metadata = ((project as any).metadata as any) || {};
    const avatarVideoCache = metadata.avatarVideoCache || {};

    const brollEntry = bRollVideoTasks.find((v: any) => v.sceneNumber === sceneNumber);
    if (!brollEntry || (!brollEntry.localPath && !brollEntry.localUrl)) {
      throw new Error(`B-roll video not found for scene ${sceneNumber}`);
    }

    let brollPath: string;
    if (brollEntry.localPath && fs.existsSync(brollEntry.localPath)) {
      brollPath = brollEntry.localPath;
    } else if (brollEntry.localUrl) {
      const userDir = path.join(this.uploadsDir, 'videos', userId);
      const urlPath = (brollEntry.localUrl as string).replace(/^\/uploads\/videos\/[^/]+\//, '');
      brollPath = path.join(userDir, urlPath);
      if (!fs.existsSync(brollPath)) {
        throw new Error(`B-roll file not found at ${brollPath}`);
      }
    } else {
      throw new Error(`B-roll video path missing for scene ${sceneNumber}`);
    }

    let avatarPath: string | null = null;
    const avatarEntry = avatarVideos.find((v: any) => v.sceneNumber === sceneNumber);
    const cacheEntry = avatarVideoCache[sceneNumber];

    if (avatarEntry?.localPath && fs.existsSync(avatarEntry.localPath)) {
      avatarPath = avatarEntry.localPath;
    } else if (cacheEntry?.localPath && fs.existsSync(cacheEntry.localPath)) {
      avatarPath = cacheEntry.localPath;
    } else if (avatarEntry?.localUrl || cacheEntry?.localUrl) {
      const url = avatarEntry?.localUrl || cacheEntry.localUrl;
      const rel = (url as string).replace(/^\/uploads\//, '').replace(/\//g, path.sep);
      const fullPath = path.join(this.uploadsDir, rel);
      if (fs.existsSync(fullPath)) avatarPath = fullPath;
    }

    if (!avatarPath || !fs.existsSync(avatarPath)) {
      throw new Error(`Avatar video not found for scene ${sceneNumber}`);
    }

    const audioFiles = (project.audioFiles as any[]) || [];
    const audioFile = audioFiles.find((af: any) => af.sceneNumber === sceneNumber);
    if (!audioFile) {
      throw new Error(`Audio file not found for scene ${sceneNumber}`);
    }

    const audioPath = this.resolveAudioPath(audioFile);
    if (!audioPath || !fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found for scene ${sceneNumber}`);
    }

    // Emit progress (compositing)
    await this.jobStatusGateway.notifyJobStatus(userId, {
      jobId: emitJobId,
      queueType: 'scene-composite',
      state: 'progress',
      metadata: { stage: 'compositing', sceneNumber },
      progress: 90,
    }).catch(() => {});

    const userDir = path.join(this.uploadsDir, 'videos', userId);
    const compositePath = path.join(userDir, `half_n_half_scene_${sceneNumber}_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.compositeHalfAndHalf(brollPath, avatarPath, compositePath, 1080, 1920);

    const completePath = path.join(userDir, `complete_scene_${sceneNumber}_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.addAudioToVideo(compositePath, audioPath, completePath);

    if (fs.existsSync(compositePath)) {
      try {
        fs.unlinkSync(compositePath);
      } catch (_) {}
    }

    const filename = path.basename(completePath);
    const localUrl = `/uploads/videos/${userId}/${filename}`;

    let publicUrl = localUrl;
    try {
      const result = await this.publicUrlService.uploadFromPath(
        completePath,
        `videos/${userId}`,
        filename,
        'video/mp4'
      );
      if (result.publicUrl) publicUrl = result.publicUrl;
    } catch (e: any) {
      console.warn(`[SceneCompositeProcessor] GCS upload failed: ${e.message}`);
    }

    const videoData = {
      sceneNumber,
      jobId: emitJobId,
      localPath: completePath,
      localUrl,
      publicUrl,
      isComposite: true,
      duration: audioFile.duration,
    };

    const latestProject = await this.databaseService.videoProject.findUnique({
      where: { id: projectId },
    });
    if (!latestProject) throw new Error('Project not found');

    const latestBroll = ((latestProject as any).bRollVideoTasks as any[]) || [];
    const idx = latestBroll.findIndex((v: any) => v.sceneNumber === sceneNumber);
    if (idx >= 0) {
      latestBroll[idx] = videoData;
    } else {
      latestBroll.push(videoData);
    }

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: { bRollVideoTasks: latestBroll as any } as any,
    });

    await this.jobStatusGateway.notifyJobStatus(userId, {
      jobId: emitJobId,
      queueType: 'scene-composite',
      state: 'completed',
      result: { success: true, video: videoData },
      progress: 100,
    }).catch(() => {});

    return { success: true, video: videoData };
  }
}
