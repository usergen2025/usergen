import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AlternateAvatarService } from '../../../rendering/alternate-avatar.service';
import { RenderingService } from '../../../rendering/rendering.service';
import { JobStatusGateway } from '../../websocket/job-status.gateway';
import { VideoService } from '../../../video/video.service';
import { UserNotificationService } from '../../../notifications/user-notification.service';
import { resolveAudioPathOnDisk, prepareMp3ForHeyGen } from '../../utils/audio-for-heygen.util';

export interface AvatarVideoGenerationJobData {
  projectId: string;
  userId: string;
  sceneNumber: number;
  authToken?: string;
  sceneJobId?: string; // Legacy composite flow; prefer job.id for subscriptions
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
    private readonly renderingService: RenderingService,
    private readonly jobStatusGateway: JobStatusGateway,
    private readonly videoService: VideoService,
    private readonly userNotificationService: UserNotificationService,
  ) {
    super();
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  private resolveAudioPath(audioFile: any): string | null {
    const logicalPath = this.renderingService.getAudioFilePathPublic(audioFile);
    if (logicalPath) {
      const resolved = resolveAudioPathOnDisk(logicalPath, {
        uploadsDir: this.uploadsDir,
        cwd: process.cwd(),
      });
      if (resolved) return resolved;
    }

    // Legacy fallback when only top-level filePath is set
    if (audioFile.filePath) {
      return resolveAudioPathOnDisk(audioFile.filePath, {
        uploadsDir: this.uploadsDir,
        cwd: process.cwd(),
      });
    }

    return null;
  }

  async process(job: Job<AvatarVideoGenerationJobData>): Promise<any> {
    const { projectId, userId, sceneNumber, authToken } = job.data;
    const emitJobId = job.id!;

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

      const audioPath = this.resolveAudioPath(audioFile);
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

      const { mp3Path: hashAudioPath, cleanup: hashCleanup } = prepareMp3ForHeyGen(audioPath);
      let audioHash: string;
      try {
        audioHash = crypto.createHash('sha256').update(fs.readFileSync(hashAudioPath)).digest('hex');
      } finally {
        hashCleanup?.();
      }

      const cacheEntry = metadata.avatarVideoCache?.[sceneNumber];
      let avatarVideoPath: string;
      let avatarEntry: any;

      if (cacheEntry?.audioHash === audioHash && cacheEntry?.localPath && fs.existsSync(cacheEntry.localPath)) {
        avatarVideoPath = cacheEntry.localPath;
        avatarEntry = {
          sceneNumber,
          jobId: emitJobId,
          localPath: avatarVideoPath,
          localUrl: cacheEntry.localUrl,
          duration: audioFile.duration,
          sceneType: 'avatar',
        };
        await this.databaseService.withProjectLock(projectId, async (tx) => {
          const latest = await tx.videoProject.findUnique({ where: { id: projectId } });
          const avatarVideos = ((latest as any)?.avatarVideos as any[]) || [];
          const existingIdx = avatarVideos.findIndex((v: any) => v.sceneNumber === sceneNumber);
          if (existingIdx >= 0) {
            avatarVideos[existingIdx] = avatarEntry;
          } else {
            avatarVideos.push(avatarEntry);
          }
          await tx.videoProject.update({
            where: { id: projectId },
            data: { avatarVideos: avatarVideos as any } as any,
          });
        });
      } else {
        avatarVideoPath = await this.alternateAvatarService.generateAlternateSceneAvatarVideo(
          projectId,
          userId,
          sceneNumber,
          audioPath,
          authToken,
        );

        const relativePath = path.relative(this.uploadsDir, avatarVideoPath);
        const localUrl = `/uploads/${relativePath.replace(/\\/g, '/')}`;

        avatarEntry = {
          sceneNumber,
          jobId: emitJobId,
          localPath: avatarVideoPath,
          localUrl,
          duration: audioFile.duration,
          sceneType: 'avatar',
        };

        await this.databaseService.withProjectLock(projectId, async (tx) => {
          const latestProj = await tx.videoProject.findUnique({
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
          await tx.videoProject.update({
            where: { id: projectId },
            data: {
              avatarVideos: avVideos as any,
              metadata: { ...meta, avatarVideoCache: cache, failedAvatarScenes: failed } as any,
            } as any,
          });
        });
      }

      await this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: emitJobId,
        queueType: 'avatar-video-generation',
        state: 'completed',
        result: { success: true, video: avatarEntry },
        progress: 100,
      }).catch(() => {});

      this.userNotificationService
        .notifyProcessingEvent({
          userId,
          projectId,
          type: 'AVATAR_PREVIEW_READY',
          operation: 'avatar-video-generation',
          status: 'completed',
          title: 'Avatar scene ready',
          message: `Avatar video is ready for scene ${sceneNumber}.`,
          data: { sceneNumber, jobId: emitJobId, queueType: 'avatar-video-generation' },
        })
        .catch(() => {});

      return { success: true, localPath: avatarVideoPath, video: avatarEntry };
    } catch (error: any) {
      console.error(`[AvatarVideoGenerationProcessor] Error for job ${job.id}:`, error);

      await this.databaseService.withProjectLock(projectId, async (tx) => {
        const meta = ((await tx.videoProject.findUnique({ where: { id: projectId } }))?.metadata as any) || {};
        const failedScenes = meta?.failedAvatarScenes || [];
        if (!failedScenes.includes(sceneNumber)) {
          failedScenes.push(sceneNumber);
          await tx.videoProject.update({
            where: { id: projectId },
            data: { metadata: { ...meta, failedAvatarScenes: failedScenes } as any } as any,
          });
        }
      }).catch(() => {});

      await this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: emitJobId,
        queueType: 'avatar-video-generation',
        state: 'failed',
        error: error.message,
        metadata: { sceneNumber },
      }).catch(() => {});
      this.userNotificationService
        .notifyProcessingEvent({
          userId,
          projectId,
          type: 'PROCESSING_FAILED',
          operation: 'avatar-video-generation',
          status: 'failed',
          title: 'Avatar generation failed',
          message: `Avatar video generation failed for scene ${sceneNumber}.`,
          data: { sceneNumber, jobId: emitJobId, queueType: 'avatar-video-generation', error: error.message },
        })
        .catch(() => {});

      throw error;
    }
  }
}
