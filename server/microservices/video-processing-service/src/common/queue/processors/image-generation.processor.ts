import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { ProviderFactory } from '../../../rendering/providers/provider-factory.service';
import { ModelRegistryService } from '../../../rendering/providers/model-registry.service';
import { ImageGenerationRequest } from '../../../rendering/providers/interfaces/image-generation.interface';
import { FalProviderError } from '../../../rendering/providers/fal/fal-errors';
import { JobStatusGateway } from '../../websocket/job-status.gateway';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

export interface ImageGenerationJobData {
  projectId: string;
  userId: string;
  sceneNumber: number;
  prompt: string;
  modelId?: string; // e.g., "model-1", "model-2", etc.
  aspectRatio?: string; // Override default
  resolution?: string; // Override default
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
    private readonly providerFactory: ProviderFactory,
    private readonly modelRegistry: ModelRegistryService,
    private readonly jobStatusGateway: JobStatusGateway,
  ) {
    super();
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  async process(job: Job<ImageGenerationJobData>): Promise<any> {
    const { projectId, userId, sceneNumber, prompt, modelId, aspectRatio, resolution } = job.data;

    console.log(`[ImageGenerationProcessor] Processing job ${job.id} for scene ${sceneNumber}, model: ${modelId || 'default'}`);

    try {
      // Get project to determine video style
      const project = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // Determine aspect ratio from video style
      let finalAspectRatio: string = '9:16'; // Default
      if (project.style === 'HALF_N_HALF') {
        finalAspectRatio = '3:4';
      } else if (project.style === 'AVATAR_CUTOUT' || project.style === 'ALTERNATE') {
        finalAspectRatio = '9:16';
      }

      // Use provided aspect ratio or default from video style
      const selectedAspectRatio = aspectRatio || finalAspectRatio;

      // Get model configuration (from job or project default or system default)
      const selectedModelId = modelId || (project as any).defaultImageModel || 'model-1';
      const model = this.modelRegistry.getModel(selectedModelId) || this.modelRegistry.getDefaultModel();

      console.log(`[ImageGenerationProcessor] Scene ${sceneNumber}: Style=${project.style}, Model=${model.displayName}, AspectRatio=${selectedAspectRatio}`);

      // Get provider for this model
      const provider = this.providerFactory.getProviderForModel(model.id);

      // Build unified request
      const request: ImageGenerationRequest = {
        prompt,
        modelId: model.id,
        aspectRatio: selectedAspectRatio,
        resolution: resolution || model.defaultConfig.resolution || '2K',
        numImages: model.defaultConfig.numImages || 1,
        outputFormat: (model.defaultConfig.outputFormat as 'png' | 'jpeg' | 'webp') || 'png',
      };

      // Validate request
      const validation = provider.validateRequest(request);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid request');
      }

      // Create user-specific directory for images
      const userDir = path.join(this.uploadsDir, 'images', userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      await job.updateProgress(10);

      // Generate image using unified interface
      let imageResponse;
      try {
        imageResponse = await provider.generateImage(
          request,
          (progress) => {
            // Map provider progress (0-100) to job progress (10-90)
            const mappedProgress = 10 + (progress * 0.8);
            job.updateProgress(mappedProgress);
          }
        );
      } catch (error) {
        // Handle FAL-specific errors
        if (error instanceof FalProviderError) {
          console.error(`[ImageGenerationProcessor] FAL error for job ${job.id}:`, {
            type: error.type,
            statusCode: error.statusCode,
            retryable: error.isRetryable(),
            message: error.getUserMessage(),
          });

          // If retryable and we haven't exceeded max attempts, let BullMQ retry
          if (error.isRetryable() && (job.attemptsMade || 0) < 3) {
            throw error;
          }

          // Non-retryable or max attempts reached - fail the job
          throw new Error(`Image generation failed: ${error.getUserMessage()}`);
        }

        // Re-throw other errors
        throw error;
      }

      await job.updateProgress(90);

      // Download image (works for all providers - they all return URLs)
      const imageUrl = imageResponse.imageUrl;
      const imageFilename = `scene_${sceneNumber}_${projectId}_${Date.now()}.jpg`;
      const imagePath = path.join(userDir, imageFilename);

      await this.downloadImage(imageUrl, imagePath);

      await job.updateProgress(95);

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
        modelId: selectedModelId, // Store which model was used
        model: model.displayName, // Store display name
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

      // Enhanced error reporting for FAL errors
      let errorMessage = error.message;
      let isRetryable = false;
      let errorType = 'unknown';

      if (error instanceof FalProviderError) {
        errorMessage = error.getUserMessage();
        isRetryable = error.isRetryable();
        errorType = error.type;
      }

      // Emit WebSocket event with detailed error info
      this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'image-generation',
        state: 'failed',
        error: errorMessage,
        progress: typeof job.progress === 'number' ? job.progress : 0,
        metadata: {
          retryable: isRetryable,
          errorType,
        },
      }).catch(err => {
        console.error(`[ImageGenerationProcessor] Failed to emit WebSocket event:`, err);
      });

      throw error;
    }
  }

  /**
   * Download image from URL (works for all providers)
   */
  private async downloadImage(imageUrl: string, outputPath: string): Promise<string> {
    try {
      console.log(`[ImageGenerationProcessor] Downloading image from ${imageUrl} to ${outputPath}`);

      const response = await axios.get(imageUrl, {
        responseType: 'stream',
        timeout: 60000,
      });

      const writer = fs.createWriteStream(outputPath);

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`[ImageGenerationProcessor] Image downloaded successfully to ${outputPath}`);
          resolve(outputPath);
        });
        writer.on('error', reject);
      });
    } catch (error: any) {
      console.error(`[ImageGenerationProcessor] Failed to download image:`, error.message);
      throw new Error(`Failed to download image: ${error.message}`);
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

