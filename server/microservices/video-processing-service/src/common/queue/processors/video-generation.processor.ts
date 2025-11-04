import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { BytePlusProvider } from '../../../rendering/providers/byteplus.provider';
import { JobStatusGateway } from '../../websocket/job-status.gateway';
import * as path from 'path';
import * as fs from 'fs';

export interface VideoGenerationJobData {
  projectId: string;
  userId: string;
  sceneNumber: number;
  imageUrl: string;
  prompt?: string;
  duration: number;
}

@Processor('video-generation', {
  concurrency: 10, // Process 10 video generation jobs concurrently per worker
})
@Injectable()
export class VideoGenerationProcessor extends WorkerHost {
  private readonly uploadsDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly bytePlusProvider: BytePlusProvider,
    private readonly jobStatusGateway: JobStatusGateway,
  ) {
    super();
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  async process(job: Job<VideoGenerationJobData>): Promise<any> {
    const { projectId, userId, sceneNumber, imageUrl, prompt, duration } = job.data;

    console.log(`[VideoGenerationProcessor] Processing job ${job.id} for scene ${sceneNumber}`);

    try {
      // Get project
      const project = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // Get video prompt from script if available
      let videoPrompt = prompt || 'A cinematic video scene';
      if (project.script) {
        const script = typeof project.script === 'string' 
          ? JSON.parse(project.script) 
          : project.script;
        const scenes = script.scenes || script.scene_plan || [];
        const scene = scenes.find((s: any) => (s.scene_number || s.sceneNumber) === sceneNumber);
        if (scene?.broll_video_prompt) {
          videoPrompt = scene.broll_video_prompt;
        }
      }

      await job.updateProgress(10);

      // Ensure duration matches audio file duration exactly (not exceeding it)
      // Round down to nearest second to ensure video doesn't exceed audio duration
      const videoDuration = Math.floor(duration);
      if (videoDuration <= 0) {
        throw new Error(`Invalid duration for scene ${sceneNumber}: ${duration} seconds`);
      }

      // Determine video dimensions based on video style
      let videoRatio: string = '9:16';
      let videoResolution: string = '1080p';
      
      if (project.style === 'HALF_N_HALF') {
        // For half-n-half, b-roll videos should be 3:4 ratio (1080x1440 for top half)
        videoRatio = '3:4';
        videoResolution = '1080p'; // Results in 1080x1440
      } else if (project.style === 'AVATAR_CUTOUT' || project.style === 'ALTERNATE') {
        // For cutout and alternate, b-roll videos should be 9:16 ratio
        videoRatio = '9:16';
        videoResolution = '1080p'; // Results in 1080x1920
      }

      // BytePlus API requires minimum duration of 2 seconds
      const minDuration = 2;
      const finalDuration = Math.max(videoDuration, minDuration);
      
      if (videoDuration < minDuration) {
        console.warn(`[VideoGenerationProcessor] Scene ${sceneNumber}: Duration ${videoDuration}s is less than minimum ${minDuration}s. Using ${minDuration}s for BytePlus API.`);
      }

      console.log(`[VideoGenerationProcessor] Scene ${sceneNumber}: Style=${project.style}, Ratio=${videoRatio}, Resolution=${videoResolution}, Duration=${finalDuration}s (audio: ${videoDuration}s)`);

      // Create video generation task with style-specific dimensions
      const taskResponse = await this.bytePlusProvider.createVideoGenerationTask({
        model: 'seedance-1-0-pro-250528',
        prompt: videoPrompt,
        image: imageUrl,
        duration: finalDuration, // Use minimum 2 seconds for BytePlus API
        ratio: videoRatio,
        resolution: videoResolution,
        frames_per_second: 24,
      });

      await job.updateProgress(30);

      console.log(`[VideoGenerationProcessor] Created video task ${taskResponse.id} for scene ${sceneNumber}`);

      // Poll until completion
      const completedTask = await this.bytePlusProvider.pollVideoTaskUntilComplete(taskResponse.id);

      await job.updateProgress(80);

      if (!completedTask.content || !completedTask.content.video_url) {
        throw new Error('Video generation completed but no video URL');
      }

      // Download video
      const userDir = path.join(this.uploadsDir, 'videos', userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      const videoFilename = `broll_scene_${sceneNumber}_${projectId}_${Date.now()}.mp4`;
      const videoPath = path.join(userDir, videoFilename);
      await this.bytePlusProvider.downloadVideo(completedTask.content.video_url, videoPath);

      await job.updateProgress(90);

      const localUrl = `/uploads/videos/${userId}/${videoFilename}`;

      // CRITICAL: Re-fetch project data right before updating to avoid race conditions
      // Multiple workers may be updating concurrently, so we need the latest state
      const latestProject = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
      });

      if (!latestProject) {
        throw new Error('Project not found');
      }

      const videoData = {
        sceneNumber,
        jobId: job.id!, // Include jobId for unique identification
        taskId: taskResponse.id,
        videoUrl: completedTask.content.video_url,
        localPath: videoPath,
        localUrl,
        duration: completedTask.duration || duration,
        prompt: videoPrompt,
      };

      // Get latest bRollVideoTasks array from database to avoid race conditions
      const bRollVideoTasks = ((latestProject as any).bRollVideoTasks as any[]) || [];
      const existingIndex = bRollVideoTasks.findIndex((vid: any) => vid.sceneNumber === sceneNumber);

      if (existingIndex >= 0) {
        bRollVideoTasks[existingIndex] = videoData;
      } else {
        bRollVideoTasks.push(videoData);
      }

      // Atomic update with latest data
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          bRollVideoTasks: bRollVideoTasks as any,
        } as any,
      });

      await job.updateProgress(100);

      console.log(`[VideoGenerationProcessor] Completed job ${job.id} for scene ${sceneNumber}`);
      console.log(`[VideoGenerationProcessor] 📤 Sending WebSocket update - Scene: ${sceneNumber}, JobId: ${job.id}, LocalUrl: ${localUrl}, LocalPath: ${videoPath}`);
      
      // Emit WebSocket event for job completion (non-blocking)
      this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'video-generation',
        state: 'completed',
        result: {
          success: true,
          video: videoData,
        },
        progress: 100,
      }).catch(err => {
        console.error(`[VideoGenerationProcessor] Failed to emit WebSocket event for job ${job.id}:`, err);
      });
      
      return {
        success: true,
        video: videoData,
      };
    } catch (error: any) {
      console.error(`[VideoGenerationProcessor] Error processing job ${job.id}:`, error);
      
      // Emit WebSocket event for job failure (non-blocking)
      this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'video-generation',
        state: 'failed',
        error: error.message,
        progress: typeof job.progress === 'number' ? job.progress : 0,
      }).catch(err => {
        console.error(`[VideoGenerationProcessor] Failed to emit WebSocket event for failed job ${job.id}:`, err);
      });
      
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`[VideoGenerationProcessor] Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`[VideoGenerationProcessor] Job ${job.id} failed:`, error.message);
  }
}

