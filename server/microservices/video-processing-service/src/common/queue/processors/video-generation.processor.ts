import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { BytePlusProvider } from '../../../rendering/providers/byteplus.provider';
import { VideoProviderFactory } from '../../../rendering/providers/video-provider-factory.service';
import { ModelRegistryService } from '../../../rendering/providers/model-registry.service';
import { JobStatusGateway } from '../../websocket/job-status.gateway';
import { FalProviderError } from '../../../rendering/providers/fal/fal-errors';
import { VideoCompositorProvider } from '../../../rendering/providers/video-compositor.provider';
import { HeyGenVideoProvider } from '../../../rendering/providers/heygen-video.provider';
import { PublicUrlService } from '../../storage/public-url.service';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

export interface VideoGenerationJobData {
  projectId: string;
  userId: string;
  sceneNumber: number;
  imageUrl: string;
  prompt?: string;
  duration: number;
  modelId?: string; // Video model selection
  heygenImageKey?: string; // HeyGen image_key for Avatar IV (AVATAR_PRODUCT style)
  videoStyle?: string; // Video style to determine generation method
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
    private readonly videoProviderFactory: VideoProviderFactory,
    private readonly modelRegistry: ModelRegistryService,
    private readonly jobStatusGateway: JobStatusGateway,
    private readonly videoCompositor: VideoCompositorProvider,
    private readonly heygenVideoProvider: HeyGenVideoProvider,
    private readonly publicUrlService: PublicUrlService,
  ) {
    super();
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  async process(job: Job<VideoGenerationJobData>): Promise<any> {
    const { projectId, userId, sceneNumber, imageUrl, prompt, duration, modelId, heygenImageKey, videoStyle } = job.data;

    console.log(`[VideoGenerationProcessor] Processing job ${job.id} for scene ${sceneNumber}, modelId: ${modelId || 'default'}, style: ${videoStyle || 'default'}`);

    try {
      // Get project
      const project = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      const style = videoStyle || project.style;

      // Handle AVATAR_PRODUCT style - use HeyGen Avatar IV
      if (style === 'AVATAR_PRODUCT' && heygenImageKey) {
        return await this.processAvatarProductVideo(
          job,
          project,
          sceneNumber,
          heygenImageKey,
          duration,
          userId,
          projectId
        );
      }

      // Default processing for other styles
      return await this.processDefaultVideo(
        job,
        project,
        sceneNumber,
        imageUrl,
        prompt,
        duration,
        modelId,
        userId,
        projectId
      );
    } catch (error: any) {
      console.error(`[VideoGenerationProcessor] Error processing job ${job.id}:`, error);
      
      // Emit WebSocket event for job failure
      this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'video-generation',
        state: 'failed',
        error: error.message,
        progress: typeof job.progress === 'number' ? job.progress : 0,
      }).catch(err => {
        console.error(`[VideoGenerationProcessor] Failed to emit WebSocket event:`, err);
      });
      
      throw error;
    }
  }

  /**
   * Process AVATAR_PRODUCT style - use HeyGen Avatar IV
   */
  private async processAvatarProductVideo(
    job: Job<VideoGenerationJobData>,
    project: any,
    sceneNumber: number,
    heygenImageKey: string,
    duration: number,
    userId: string,
    projectId: string
  ): Promise<any> {
    console.log(`[VideoGenerationProcessor] Processing AVATAR_PRODUCT style for scene ${sceneNumber} with image_key: ${heygenImageKey}`);

    await job.updateProgress(10);

    // Get audio URL/asset ID for this scene
    const audioFiles = ((project as any).audioFiles as any[]) || [];
    const sceneAudio = audioFiles.find((audio: any) => audio.sceneNumber === sceneNumber);

    if (!sceneAudio) {
      throw new Error(`Audio file not found for scene ${sceneNumber}`);
    }

    // Prefer audio_asset_id over audio_url for HeyGen
    const audioAssetId = sceneAudio.audioAssetId || sceneAudio.heygenAssetId;
    const audioUrl = sceneAudio.audioUrl || sceneAudio.url;

    if (!audioAssetId && !audioUrl) {
      throw new Error(`Audio asset ID or URL not found for scene ${sceneNumber}`);
    }

    await job.updateProgress(20);

    // Generate video using HeyGen Avatar IV
    console.log(`[VideoGenerationProcessor] Generating Avatar IV video with image_key: ${heygenImageKey}, audio: ${audioAssetId || audioUrl}`);
    
    let videoResponse;
    try {
      videoResponse = await this.heygenVideoProvider.generateAvatarIVVideo({
        image_key: heygenImageKey,
        video_title: `Scene ${sceneNumber} - ${projectId}`,
        audio_asset_id: audioAssetId || undefined,
        audio_url: audioUrl || undefined,
        video_orientation: 'portrait', // 9:16 is portrait
        fit: 'cover', // Cover the screen
      });

      await job.updateProgress(40);

      // Poll until video is complete
      console.log(`[VideoGenerationProcessor] Polling video ${videoResponse.video_id} until complete...`);
      const completedVideo = await this.heygenVideoProvider.pollVideoUntilComplete(videoResponse.video_id);

      if (!completedVideo.data.video_url) {
        throw new Error('Avatar IV video generation completed but no video URL');
      }

      await job.updateProgress(80);

      // Download video
      const userDir = path.join(this.uploadsDir, 'videos', userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      const videoFilename = `avatar_product_scene_${sceneNumber}_${projectId}_${Date.now()}.mp4`;
      const videoPath = path.join(userDir, videoFilename);
      await this.downloadVideo(completedVideo.data.video_url, videoPath);

      await job.updateProgress(85);

      const localUrl = `/uploads/videos/${userId}/${videoFilename}`;

      // Upload to GCS if available
      let gcsUrl: string | undefined;
      let publicUrl: string = localUrl;
      try {
        const storageResult = await this.publicUrlService.uploadFromPath(
          videoPath,
          `videos/${userId}`,
          videoFilename,
          'video/mp4'
        );
        gcsUrl = storageResult.gcsUrl;
        publicUrl = storageResult.publicUrl;
        if (gcsUrl) {
          console.log(`[VideoGenerationProcessor] ✅ AVATAR_PRODUCT video uploaded to GCS: ${gcsUrl}`);
        }
      } catch (error: any) {
        console.warn(`[VideoGenerationProcessor] GCS upload failed for AVATAR_PRODUCT video: ${error.message}`);
      }

      await job.updateProgress(90);

      // Update project
      const latestProject = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
      });

      if (!latestProject) {
        throw new Error('Project not found');
      }

      const videoData = {
        sceneNumber,
        jobId: job.id!,
        videoId: videoResponse.video_id,
        videoUrl: completedVideo.data.video_url,
        localPath: videoPath,
        localUrl,
        gcsUrl,
        publicUrl,
        duration: duration,
        heygenImageKey, // Store image_key used
        generationMethod: 'heygen-avatar-iv',
        style: 'AVATAR_PRODUCT',
      };

      const bRollVideoTasks = ((latestProject as any).bRollVideoTasks as any[]) || [];
      const existingIndex = bRollVideoTasks.findIndex((vid: any) => vid.sceneNumber === sceneNumber);

      if (existingIndex >= 0) {
        bRollVideoTasks[existingIndex] = videoData;
      } else {
        bRollVideoTasks.push(videoData);
      }

      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          bRollVideoTasks: bRollVideoTasks as any,
        } as any,
      });

      await job.updateProgress(100);

      console.log(`[VideoGenerationProcessor] Completed AVATAR_PRODUCT job ${job.id} for scene ${sceneNumber}`);
      
      // Emit WebSocket event
      await this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'video-generation',
        state: 'completed',
        result: {
          success: true,
          video: videoData,
        },
        progress: 100,
      });

      return {
        success: true,
        video: videoData,
      };
    } catch (error: any) {
      console.error(`[VideoGenerationProcessor] HeyGen Avatar IV error:`, error);
      throw error;
    }
  }

  /**
   * Process default video style (existing logic)
   */
  private async processDefaultVideo(
    job: Job<VideoGenerationJobData>,
    project: any,
    sceneNumber: number,
    imageUrl: string,
    prompt: string | undefined,
    duration: number,
    modelId: string | undefined,
    userId: string,
    projectId: string
  ): Promise<any> {
    try {
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

    // Get selected model or use default
    const selectedModelId = modelId || 'video-model-1';
    const model = this.modelRegistry.getVideoModel(selectedModelId);
    if (!model) {
      throw new Error(`Video model not found: ${selectedModelId}`);
    }

    // Get provider for the selected model
    const provider = this.videoProviderFactory.getProviderForModel(selectedModelId);
    // Use model capabilities from registry (more reliable than provider.getCapabilities())
    const capabilities = model.capabilities;

    // Map duration based on provider capabilities
    // Note: Audio duration is already rounded up during generation, so we use it as-is
    let finalDuration: number;
    if (capabilities.supportedDurations) {
      // FAL: Map to enum (4s, 6s, 8s)
      // Audio is already rounded up, so we use the rounded value
      const durationValue = duration;
      if (durationValue <= 4) {
        finalDuration = 4;
      } else if (durationValue <= 6) {
        finalDuration = 6;
      } else {
        finalDuration = Math.min(8, Math.ceil(durationValue)); // Cap at 8s
      }
    } else {
      // BytePlus: Ensure minimum duration
      // Audio is already rounded up, so we use Math.ceil to match
      finalDuration = Math.max(Math.ceil(duration), capabilities.minDuration || 2);
    }

    if (finalDuration <= 0) {
      throw new Error(`Invalid duration for scene ${sceneNumber}: ${duration} seconds`);
    }

    // Determine video dimensions based on video style
    let videoRatio: string = '9:16';
    let videoResolution: string = '1080p';
    
    if (project.style === 'HALF_N_HALF') {
      // For half-n-half, b-roll videos should be 1080x960 (top half)
      if (model.platform === 'BYTEPLUS') {
        // Use adaptive for BytePlus/Seedance - will auto-detect from image
        videoRatio = 'adaptive';
      } else if (model.platform === 'FAL') {
        // FAL doesn't support 3:4 or adaptive, use 1:1 then scale to 1080x960
        videoRatio = '1:1';
      } else {
        // Fallback for other platforms
        videoRatio = '3:4';
      }
      videoResolution = '1080p';
    } else if (project.style === 'AVATAR_CUTOUT' || project.style === 'PRODUCT_ONLY') {
      // For cutout and product-only, b-roll videos should be 9:16 ratio
      videoRatio = '9:16';
      videoResolution = '1080p'; // Results in 1080x1920
    } else if (project.style === 'ALTERNATE') {
      // For ALTERNATE: odd scenes = 9:16, even scenes = 3:4
      videoRatio = (sceneNumber % 2 === 1) ? '9:16' : '3:4';
      videoResolution = '1080p';
      
      // For FAL, 3:4 needs special handling
      if (model.platform === 'FAL' && videoRatio === '3:4') {
        videoRatio = '1:1'; // Will be scaled to 1080x960 later
      }
    }

    // Adjust aspect ratio for FAL (only supports 16:9, 9:16, and 1:1)
    if (model.platform === 'FAL') {
      if (videoRatio === '3:4' || videoRatio === 'adaptive') {
        if (project.style === 'HALF_N_HALF') {
          videoRatio = '1:1';
        } else if (project.style === 'ALTERNATE' && sceneNumber % 2 === 0) {
          // Already handled above, but ensure it's 1:1
          videoRatio = '1:1';
        } else if (project.style !== 'HALF_N_HALF') {
          videoRatio = '9:16';
        }
      }
    }

    console.log(`[VideoGenerationProcessor] Scene ${sceneNumber}: Model=${model.displayName} (${model.platform}), Style=${project.style}, Ratio=${videoRatio}, Resolution=${videoResolution}, Duration=${finalDuration}s (audio: ${duration}s)`);

    await job.updateProgress(15);

    // Generate video using unified interface
    let videoResponse;
    try {
      videoResponse = await provider.generateVideo({
        prompt: videoPrompt,
        imageUrl: imageUrl,
        modelId: selectedModelId,
        aspectRatio: videoRatio,
        resolution: videoResolution,
        duration: finalDuration,
        generateAudio: model.defaultConfig.generateAudio,
      }, (progress) => {
        // Map provider progress (0-100) to job progress (15-80)
        const mappedProgress = 15 + (progress * 0.65); // 15% to 80%
        job.updateProgress(mappedProgress);
      });
    } catch (error: any) {
      if (error instanceof FalProviderError) {
        // Handle FAL-specific errors
        const errorMessage = error.getUserMessage();
        console.error(`[VideoGenerationProcessor] FAL error: ${errorMessage}`);
        
        // Emit WebSocket event with error details
        this.jobStatusGateway.notifyJobStatus(userId, {
          jobId: job.id!,
          queueType: 'video-generation',
          state: 'failed',
          error: errorMessage,
          progress: typeof job.progress === 'number' ? job.progress : 0,
          metadata: {
            retryable: error.isRetryable(),
            errorType: error.type,
          },
        }).catch(err => {
          console.error(`[VideoGenerationProcessor] Failed to emit WebSocket event:`, err);
        });
        
        throw error;
      }
      throw error;
    }

    await job.updateProgress(80);

    if (!videoResponse.videoUrl) {
      throw new Error('Video generation completed but no video URL');
    }

    // Download video
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const videoFilename = `broll_scene_${sceneNumber}_${projectId}_${Date.now()}.mp4`;
    let videoPath = path.join(userDir, videoFilename);
    await this.downloadVideo(videoResponse.videoUrl, videoPath);

    // For HALF_N_HALF style, verify and scale video to 1080x960 if needed
    if (project.style === 'HALF_N_HALF') {
      const videoRes = await this.videoCompositor.getVideoResolution(videoPath);
      if (videoRes && (videoRes.width !== 1080 || videoRes.height !== 960)) {
        console.log(`[VideoGenerationProcessor] HALF_N_HALF: Scaling video from ${videoRes.width}x${videoRes.height} to 1080x960`);
        const scaledPath = videoPath.replace('.mp4', '_scaled.mp4');
        await this.videoCompositor.scaleVideoToDimensions(videoPath, scaledPath, 1080, 960);
        // Replace original with scaled version
        fs.unlinkSync(videoPath);
        fs.renameSync(scaledPath, videoPath);
        console.log(`[VideoGenerationProcessor] HALF_N_HALF: Video scaled successfully to 1080x960`);
      } else if (videoRes) {
        console.log(`[VideoGenerationProcessor] HALF_N_HALF: Video already at correct dimensions ${videoRes.width}x${videoRes.height}`);
      }
    }

    // For ALTERNATE style, even scenes need 1080x960 (3:4)
    if (project.style === 'ALTERNATE' && sceneNumber % 2 === 0) {
      const videoRes = await this.videoCompositor.getVideoResolution(videoPath);
      if (videoRes && (videoRes.width !== 1080 || videoRes.height !== 960)) {
        console.log(`[VideoGenerationProcessor] ALTERNATE: Scaling even scene video from ${videoRes.width}x${videoRes.height} to 1080x960`);
        const scaledPath = videoPath.replace('.mp4', '_scaled.mp4');
        await this.videoCompositor.scaleVideoToDimensions(videoPath, scaledPath, 1080, 960);
        // Replace original with scaled version
        fs.unlinkSync(videoPath);
        fs.renameSync(scaledPath, videoPath);
        console.log(`[VideoGenerationProcessor] ALTERNATE: Video scaled successfully to 1080x960`);
      } else if (videoRes) {
        console.log(`[VideoGenerationProcessor] ALTERNATE: Video already at correct dimensions ${videoRes.width}x${videoRes.height}`);
      }
    }

    await job.updateProgress(90);

    const localUrl = `/uploads/videos/${userId}/${videoFilename}`;

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string = localUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        videoPath,
        `videos/${userId}`,
        videoFilename,
        'video/mp4'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
      if (gcsUrl) {
        console.log(`[VideoGenerationProcessor] ✅ Video uploaded to GCS: ${gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[VideoGenerationProcessor] GCS upload failed for ${videoFilename}: ${error.message}`);
    }

    await job.updateProgress(93);

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
      taskId: videoResponse.metadata?.taskId || videoResponse.metadata?.requestId,
      videoUrl: videoResponse.videoUrl,
      localPath: videoPath,
      localUrl,
      gcsUrl,
      publicUrl,
      duration: finalDuration,
      prompt: videoPrompt,
      modelId: selectedModelId, // Store which model was used
      model: model.displayName, // Store display name
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

  /**
   * Download video from URL (works for all providers)
   */
  private async downloadVideo(videoUrl: string, outputPath: string): Promise<string> {
    try {
      console.log(`[VideoGenerationProcessor] Downloading video from ${videoUrl} to ${outputPath}`);

      const response = await axios.get(videoUrl, {
        responseType: 'stream',
        timeout: 300000, // 5 minutes for large files
      });

      const writer = fs.createWriteStream(outputPath);

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`[VideoGenerationProcessor] Video downloaded successfully to ${outputPath}`);
          resolve(outputPath);
        });
        writer.on('error', (err) => {
          writer.destroy();
          reject(err);
        });
        // Handle response stream errors (EPIPE, connection closed, etc.)
        response.data.on('error', (err) => {
          writer.destroy();
          reject(err);
        });
      });
    } catch (error: any) {
      console.error(`[VideoGenerationProcessor] Failed to download video:`, error.message);
      throw new Error(`Failed to download video: ${error.message}`);
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

