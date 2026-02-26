import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AlternateAvatarService } from '../../../rendering/alternate-avatar.service';
import { QueueManagerService } from '../queue-manager.service';
import { JobStatusGateway } from '../../websocket/job-status.gateway';
import { VideoService } from '../../../video/video.service';

export interface AvatarVideoGenerationJobData {
  projectId: string;
  userId: string;
  sceneNumber: number;
  authToken?: string;
  sceneJobId?: string; // For client subscription - emit with this jobId
}

@Processor('avatar-video-generation', {
  concurrency: 5,
})
@Injectable()
export class AvatarVideoGenerationProcessor extends WorkerHost {
  private readonly uploadsDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly alternateAvatarService: AlternateAvatarService,
    private readonly queueManager: QueueManagerService,
    private readonly jobStatusGateway: JobStatusGateway,
    private readonly videoService: VideoService,
  ) {
    super();
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  private resolveAudioPath(audioFile: any, userId: string): string | null {
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

  async process(job: Job<AvatarVideoGenerationJobData>): Promise<any> {
    const { projectId, userId, sceneNumber, authToken, sceneJobId } = job.data;
    const emitJobId = sceneJobId || job.id!;

    try {
      const project = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });
      if (!project || !project.avatarId) {
        throw new Error('Project or avatar ID not found');
      }

      const audioFiles = (project.audioFiles as any[]) || [];
      const audioFile = audioFiles.find((af: any) => af.sceneNumber === sceneNumber);
      if (!audioFile) {
        throw new Error(`Missing audio file for scene ${sceneNumber}`);
      }

      const audioPath = this.resolveAudioPath(audioFile, userId);
      if (!audioPath || !fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found for scene ${sceneNumber}`);
      }

      let metadata = ((project as any).metadata as any) || {};
      if (!metadata.generatedAvatarImageKey) {
        await this.videoService.ensureProjectAvatarImage(projectId, userId, authToken);
        const refreshed = await this.databaseService.videoProject.findFirst({
          where: { id: projectId },
        });
        metadata = ((refreshed as any)?.metadata as any) || {};
        if (!metadata.generatedAvatarImageKey) {
          throw new Error(
            'Avatar image for this project has not been generated yet. The script may be missing avatar_image_prompt — regenerate the script with an avatar style, or avatar image generation failed. Complete the b-roll images step and try again.',
          );
        }
      }

      // Avatar cache check (Phase 9): skip generation if valid cache exists
      const audioBuffer = fs.readFileSync(audioPath);
      const audioHash = crypto.createHash('sha256').update(audioBuffer).digest('hex');
      const cacheEntry = metadata.avatarVideoCache?.[sceneNumber];
      let avatarVideoPath: string;
      if (cacheEntry?.audioHash === audioHash && cacheEntry?.localPath && fs.existsSync(cacheEntry.localPath)) {
        avatarVideoPath = cacheEntry.localPath;
        const avatarVideos = ((project as any).avatarVideos as any[]) || [];
        const existingIdx = avatarVideos.findIndex((v: any) => v.sceneNumber === sceneNumber);
        const avatarEntry = {
          sceneNumber,
          localPath: avatarVideoPath,
          localUrl: cacheEntry.localUrl || `/uploads/videos/${userId}/avatars/${projectId}/alternate/${((project.avatarMode as string) || 'PREMIUM').toLowerCase()}/avatar_scene_${sceneNumber}_${projectId}.mp4`,
          duration: audioFile.duration,
        };
        if (existingIdx >= 0) {
          avatarVideos[existingIdx] = avatarEntry;
        } else {
          avatarVideos.push(avatarEntry);
        }
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: { avatarVideos: avatarVideos as any } as any,
        });
      } else {
        avatarVideoPath = await this.alternateAvatarService.generateAlternateSceneAvatarVideo(
          projectId,
          userId,
          sceneNumber,
          audioPath,
          authToken
        );

        const relativePath = path.relative(this.uploadsDir, avatarVideoPath);
        const localUrl = `/uploads/${relativePath.replace(/\\/g, '/')}`;

        const avatarEntry = {
          sceneNumber,
          localPath: avatarVideoPath,
          localUrl,
          duration: audioFile.duration,
        };

        const latestProj = await this.databaseService.videoProject.findUnique({
          where: { id: projectId },
        });
        if (!latestProj) throw new Error('Project not found');

        const avVideos = ((latestProj as any).avatarVideos as any[]) || [];
        const idx = avVideos.findIndex((v: any) => v.sceneNumber === sceneNumber);
        if (idx >= 0) avVideos[idx] = avatarEntry;
        else avVideos.push(avatarEntry);

        const meta = ((latestProj as any).metadata as any) || {};
        const cache = meta.avatarVideoCache || {};
        cache[sceneNumber] = {
          localPath: avatarVideoPath,
          localUrl,
          audioHash,
          generatedAt: new Date().toISOString(),
        };

        const failed = (meta.failedAvatarScenes || []).filter((s: number) => s !== sceneNumber);
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: {
            avatarVideos: avVideos as any,
            metadata: { ...meta, avatarVideoCache: cache, failedAvatarScenes: failed } as any,
          } as any,
        });
      }

      // Emit progress (Phase 8)
      await this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: emitJobId,
        queueType: 'scene-composite',
        state: 'progress',
        metadata: { stage: 'avatar_complete', sceneNumber },
        progress: 66,
      }).catch(() => {});

      const latestProject = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
      });
      const bRollVideoTasks = latestProject ? ((latestProject as any).bRollVideoTasks as any[]) || [] : [];
      const hasBroll = bRollVideoTasks.some((v: any) => v.sceneNumber === sceneNumber);

      if (hasBroll) {
        await this.queueManager.addSceneCompositeJob({
          projectId,
          userId,
          sceneNumber,
          sceneJobId: emitJobId,
        });
      }

      return { success: true, localPath: avatarVideoPath };
    } catch (error: any) {
      console.error(`[AvatarVideoGenerationProcessor] Error for job ${job.id}:`, error);

      const meta = (await this.databaseService.videoProject.findFirst({ where: { id: projectId } }))?.metadata as any;
      const failedScenes = meta?.failedAvatarScenes || [];
      if (!failedScenes.includes(sceneNumber)) {
        failedScenes.push(sceneNumber);
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: { metadata: { ...meta, failedAvatarScenes: failedScenes } as any } as any,
        }).catch(() => {});
      }

      await this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: emitJobId,
        queueType: 'scene-composite',
        state: 'failed',
        error: error.message,
        metadata: { sceneNumber },
      }).catch(() => {});

      throw error;
    }
  }
}
