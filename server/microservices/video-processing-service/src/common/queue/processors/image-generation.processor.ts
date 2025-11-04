import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { BytePlusProvider } from '../../../rendering/providers/byteplus.provider';
import { JobStatusGateway } from '../../websocket/job-status.gateway';
import * as path from 'path';
import * as fs from 'fs';

export interface ImageGenerationJobData {
  projectId: string;
  userId: string;
  sceneNumber: number;
  prompt: string;
}

@Processor('image-generation', {
  concurrency: 10, // Process 10 image generation jobs concurrently per worker
})
@Injectable()
export class ImageGenerationProcessor extends WorkerHost {
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

  async process(job: Job<ImageGenerationJobData>): Promise<any> {
    const { projectId, userId, sceneNumber, prompt } = job.data;

    console.log(`[ImageGenerationProcessor] Processing job ${job.id} for scene ${sceneNumber}`);

    try {
      // Get project to determine video style
      const project = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // Determine image dimensions based on video style
      let imageSize: string = '1080x1920'; // Default 9:16
      
      if (project.style === 'HALF_N_HALF') {
        // For half-n-half, images should be 3:4 ratio (1080x1440)
        imageSize = '1080x1440';
      } else if (project.style === 'AVATAR_CUTOUT' || project.style === 'ALTERNATE') {
        // For cutout and alternate, images should be 9:16 ratio (1080x1920)
        imageSize = '1080x1920';
      }

      console.log(`[ImageGenerationProcessor] Scene ${sceneNumber}: Style=${project.style}, Image size=${imageSize}`);

      // Create user-specific directory for images
      const userDir = path.join(this.uploadsDir, 'images', userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      await job.updateProgress(10);

      // Generate image using BytePlus with style-specific dimensions
      const imageResponse = await this.bytePlusProvider.generateImage({
        model: 'seedream-4-0-250828',
        prompt,
        size: imageSize,
        response_format: 'url',
        sequential_image_generation: 'disabled',
        watermark: false,
      });

      await job.updateProgress(50);

      if (!imageResponse.data || !imageResponse.data[0] || !imageResponse.data[0].url) {
        throw new Error('No image URL in response');
      }

      const imageUrl = imageResponse.data[0].url;
      const imageFilename = `scene_${sceneNumber}_${projectId}_${Date.now()}.jpg`;
      const imagePath = path.join(userDir, imageFilename);

      // Download image
      await this.bytePlusProvider.downloadImage(imageUrl, imagePath);

      await job.updateProgress(80);

      const localUrl = `/uploads/images/${userId}/${imageFilename}`;

      // CRITICAL: Re-fetch project data right before updating to avoid race conditions
      // Multiple workers may be updating concurrently, so we need the latest state
      const latestProject = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
      });

      if (!latestProject) {
        throw new Error('Project not found');
      }

      const imageData = {
        sceneNumber,
        jobId: job.id!, // Include jobId for unique identification
        imageUrl,
        localPath: imagePath,
        localUrl,
        prompt,
      };

      // Get latest bRollImages array from database to avoid race conditions
      const bRollImages = ((latestProject as any).bRollImages as any[]) || [];
      const existingIndex = bRollImages.findIndex((img: any) => img.sceneNumber === sceneNumber);

      if (existingIndex >= 0) {
        bRollImages[existingIndex] = imageData;
      } else {
        bRollImages.push(imageData);
      }

      // Atomic update with latest data
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          bRollImages: bRollImages as any,
        } as any,
      });

      await job.updateProgress(100);

      console.log(`[ImageGenerationProcessor] Completed job ${job.id} for scene ${sceneNumber}`);
      console.log(`[ImageGenerationProcessor] 📤 Sending WebSocket update - Scene: ${sceneNumber}, JobId: ${job.id}, LocalUrl: ${localUrl}, LocalPath: ${imagePath}`);
      
      // Emit WebSocket event for job completion (non-blocking)
      this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'image-generation',
        state: 'completed',
        result: {
          success: true,
          image: imageData,
        },
        progress: 100,
      }).catch(err => {
        console.error(`[ImageGenerationProcessor] Failed to emit WebSocket event for job ${job.id}:`, err);
      });
      
      return {
        success: true,
        image: imageData,
      };
    } catch (error: any) {
      console.error(`[ImageGenerationProcessor] Error processing job ${job.id}:`, error);
      
      // Emit WebSocket event for job failure (non-blocking)
      this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'image-generation',
        state: 'failed',
        error: error.message,
        progress: typeof job.progress === 'number' ? job.progress : 0,
      }).catch(err => {
        console.error(`[ImageGenerationProcessor] Failed to emit WebSocket event for failed job ${job.id}:`, err);
      });
      
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`[ImageGenerationProcessor] Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`[ImageGenerationProcessor] Job ${job.id} failed:`, error.message);
  }
}

