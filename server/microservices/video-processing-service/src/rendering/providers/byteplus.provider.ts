import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  IImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ProviderCapabilities,
  ModelInfo,
  ValidationResult,
} from './interfaces/image-generation.interface';
import {
  IVideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoProviderCapabilities,
  VideoModelInfo,
} from './interfaces/video-generation.interface';

export interface BytePlusImageGenerationRequest {
  model: string;
  prompt: string;
  image?: string | string[]; // Base64 or URL for image-to-image
  size?: string; // "1K" | "2K" | "4K" or "WxH" like "1440x2560"
  response_format?: 'url' | 'b64_json';
  sequential_image_generation?: 'auto' | 'disabled';
  watermark?: boolean;
}

export interface BytePlusImageGenerationResponse {
  model: string;
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    size?: string;
    error?: {
      code: string;
      message: string;
    };
  }>;
  usage: {
    generated_images: number;
    output_tokens: number;
    total_tokens: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface BytePlusVideoGenerationRequest {
  model: string;
  prompt?: string; // Text prompt for video generation
  image?: string; // Image URL or Base64 for image-to-video
  duration?: number; // Duration in seconds
  ratio?: string; // "9:16", "16:9", "adaptive", etc.
  resolution?: string; // "720p", "1080p"
  frames?: number;
  frames_per_second?: number;
  seed?: number;
  // New format: content array for Seedance
  content?: Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
    };
  }>;
}

export interface BytePlusVideoGenerationResponse {
  id: string;
  model: string;
  status: string;
  created_at: number;
}

export interface BytePlusVideoTaskStatus {
  id: string;
  model: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  content?: {
    video_url: string;
    last_frame_url?: string;
  };
  seed?: number;
  resolution?: string;
  ratio?: string;
  duration?: number;
  frames?: number;
  framespersecond?: number;
  usage?: {
    completion_tokens: number;
    total_tokens: number;
  };
  created_at: number;
  updated_at: number;
  error?: {
    code: string;
    message: string;
  };
}

@Injectable()
export class BytePlusProvider implements IImageGenerationProvider, IVideoGenerationProvider {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('BYTEPLUS_API_KEY') || '';
    this.baseUrl = this.configService.get<string>('BYTEPLUS_BASE_URL') || 'https://ark.ap-southeast.bytepluses.com/api/v3';
    
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60 seconds
    });
  }

  /**
   * Generate image using unified interface
   * Implements IImageGenerationProvider
   */
  async generateImage(
    request: ImageGenerationRequest,
    onProgress?: (progress: number) => void
  ): Promise<ImageGenerationResponse> {
    try {
      // Validate request
      const validation = this.validateRequest(request);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid request');
      }

      // Convert unified request to BytePlus format
      const bytePlusRequest = this.normalizeRequest(request);

      onProgress?.(10);

      // Call BytePlus API
      const response = await this.axiosInstance.post<BytePlusImageGenerationResponse>(
        '/images/generations',
        bytePlusRequest
      );

      onProgress?.(80);

      if (response.data.error) {
        throw new Error(`BytePlus image generation failed: ${response.data.error.message}`);
      }

      if (!response.data.data || !response.data.data[0] || !response.data.data[0].url) {
        throw new Error('BytePlus API did not return image URL');
      }

      onProgress?.(95);

      // Convert BytePlus response to unified format
      return this.normalizeResponse(response.data, request.modelId);
    } catch (error: any) {
      console.error('[BytePlus] Image generation error:', error.response?.data || error.message);
      throw new Error(`Failed to generate image: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Normalize unified request to BytePlus format
   */
  private normalizeRequest(request: ImageGenerationRequest): BytePlusImageGenerationRequest {
    // Convert aspect ratio to size format
    // BytePlus uses "WxH" format like "1080x1920" or "1K", "2K", "4K"
    let size: string | undefined;
    
    if (request.resolution) {
      // If resolution is specified, use it directly
      size = request.resolution;
    } else if (request.aspectRatio) {
      // Map aspect ratio to dimensions
      const sizeMap: Record<string, string> = {
        '9:16': '1080x1920',
        '3:4': '1080x1440',
        '16:9': '1920x1080',
        '1:1': '1080x1080',
        '4:3': '1440x1080',
      };
      size = sizeMap[request.aspectRatio] || '1080x1920';
    } else {
      size = '1080x1920'; // Default
    }

    return {
      model: request.modelId || 'seedream-4-0-250828',
      prompt: request.prompt,
      size,
      response_format: (request.outputFormat === 'jpeg' ? 'url' : 'url') as 'url', // BytePlus always returns URL
      sequential_image_generation: 'disabled',
      watermark: false,
    };
  }

  /**
   * Normalize BytePlus response to unified format
   */
  private normalizeResponse(
    bytePlusResponse: BytePlusImageGenerationResponse,
    modelId: string
  ): ImageGenerationResponse {
    const imageData = bytePlusResponse.data[0];
    
    if (!imageData?.url) {
      throw new Error('BytePlus API returned image without URL');
    }

    return {
      imageUrl: imageData.url,
      model: modelId,
      metadata: {
        generationTime: Date.now() - (bytePlusResponse.created * 1000),
      },
      usage: {
        generatedImages: bytePlusResponse.usage?.generated_images || 1,
        tokens: bytePlusResponse.usage?.total_tokens,
      },
    };
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use generateImage with ImageGenerationRequest instead
   */
  async generateImageLegacy(request: BytePlusImageGenerationRequest): Promise<BytePlusImageGenerationResponse> {
    try {
      console.log(`[BytePlus] Generating image with model: ${request.model}`);
      
      const response = await this.axiosInstance.post<BytePlusImageGenerationResponse>(
        '/images/generations',
        {
          model: request.model || 'seedream-4-0-250828',
          prompt: request.prompt,
          ...(request.image && { image: request.image }),
          ...(request.size && { size: request.size }),
          response_format: request.response_format || 'url',
          sequential_image_generation: request.sequential_image_generation || 'disabled',
          watermark: request.watermark !== undefined ? request.watermark : true,
        }
      );

      if (response.data.error) {
        throw new Error(`BytePlus image generation failed: ${response.data.error.message}`);
      }

      console.log(`[BytePlus] Image generated successfully. Generated images: ${response.data.usage?.generated_images || 0}`);
      return response.data;
    } catch (error: any) {
      console.error('[BytePlus] Image generation error:', error.response?.data || error.message);
      throw new Error(`Failed to generate image: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Validate request (for images)
   */
  validateRequest(request: ImageGenerationRequest): ValidationResult;
  /**
   * Validate request (for videos)
   */
  validateRequest(request: VideoGenerationRequest): ValidationResult;
  /**
   * Validate request implementation (handles both image and video)
   */
  validateRequest(request: ImageGenerationRequest | VideoGenerationRequest): ValidationResult {
    // Type guard: check if it's a video request by looking for imageUrl
    if ('imageUrl' in request) {
      // Video request
      return this.validateVideoRequest(request as VideoGenerationRequest);
    } else {
      // Image request
      const imgRequest = request as ImageGenerationRequest;
      if (!imgRequest.prompt || imgRequest.prompt.trim().length === 0) {
        return { valid: false, error: 'Prompt is required' };
      }

      if (imgRequest.prompt.length > 10000) {
        return { valid: false, error: 'Prompt exceeds maximum length of 10000 characters' };
      }

      if (!imgRequest.modelId) {
        return { valid: false, error: 'Model ID is required' };
      }

      return { valid: true };
    }
  }

  /**
   * Get provider capabilities (for images)
   * When called as IImageGenerationProvider, returns ProviderCapabilities
   */
  getCapabilities(): ProviderCapabilities;
  /**
   * Get provider capabilities (for videos)
   * When called as IVideoGenerationProvider, returns VideoProviderCapabilities
   */
  getCapabilities(): VideoProviderCapabilities;
  /**
   * Get provider capabilities implementation
   * Note: TypeScript method overloading with different return types has limitations.
   * The video processor uses model.capabilities from registry instead of this method.
   * This method returns image capabilities for IImageGenerationProvider compatibility.
   */
  getCapabilities(): ProviderCapabilities | VideoProviderCapabilities {
    // Return image capabilities (for IImageGenerationProvider)
    // For video capabilities, use getVideoCapabilities() or model.capabilities from registry
    return {
      supportsAspectRatio: true,
      supportsResolution: true,
      supportsNumImages: false, // BytePlus generates 1 image at a time
      supportedAspectRatios: ['9:16', '3:4', '16:9', '1:1', '4:3'],
      supportedResolutions: ['1K', '2K', '4K'],
      maxNumImages: 1,
      isAsync: false, // BytePlus is synchronous
      estimatedTimeSeconds: 15, // Average generation time
    };
  }

  /**
   * Get supported models (for images)
   * When called as IImageGenerationProvider, returns ModelInfo[]
   */
  async getSupportedModels(): Promise<ModelInfo[]>;
  /**
   * Get supported models (for videos)
   * When called as IVideoGenerationProvider, returns VideoModelInfo[]
   */
  async getSupportedModels(): Promise<VideoModelInfo[]>;
  /**
   * Get supported models implementation
   * Returns image models by default (for IImageGenerationProvider)
   * When called through IVideoGenerationProvider, the factory will handle type casting
   */
  async getSupportedModels(): Promise<ModelInfo[] | VideoModelInfo[]> {
    // Models are managed by ModelRegistryService
    // Return empty array (models are managed by registry)
    // When used as IVideoGenerationProvider, the factory/processor will cast appropriately
    return [];
  }

  /**
   * Create video generation task using BytePlus Seedance
   * Uses the new content array format for Seedance Pro
   */
  async createVideoGenerationTask(request: BytePlusVideoGenerationRequest): Promise<BytePlusVideoGenerationResponse> {
    try {
      console.log(`[BytePlus] Creating video generation task with model: ${request.model}`);
      
      // Build content array for Seedance format
      const content: Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> = [];
      
      // Add text prompt if provided
      if (request.prompt) {
        // Include duration and ratio in the prompt (Seedance format)
        let promptText = request.prompt;
        if (request.ratio && request.ratio !== 'adaptive') {
          promptText += ` --ratio ${request.ratio}`;
        } else if (request.ratio === 'adaptive') {
          promptText += ` --ratio adaptive`;
        }
        if (request.duration) {
          promptText += ` --dur ${request.duration}`;
        }
        
        content.push({
          type: 'text',
          text: promptText,
        });
      }
      
      // Add image if provided (for image-to-video)
      if (request.image) {
        // Seedance expects a publicly accessible URL, not Base64
        // If image is Base64 (starts with data:), we need to handle it differently
        let imageUrl = request.image;
        
        if (imageUrl.startsWith('data:image/')) {
          // Base64 image - Seedance might not support this directly
          // For now, log warning and skip image
          console.warn('[BytePlus] Base64 images not supported in Seedance content format. Use a publicly accessible URL.');
          // Skip image if it's Base64
        } else {
          // Use URL directly (should be publicly accessible)
          content.push({
            type: 'image_url',
            image_url: {
              url: imageUrl,
            },
          });
        }
      }
      
      // Build payload with content array format (Seedance requires content array)
      const payload: any = {
        model: request.model || 'seedance-1-0-pro-250528',
        content: content.length > 0 ? content : undefined,
      };

      // If content array was provided directly, use it (overrides built content)
      if (request.content && request.content.length > 0) {
        payload.content = request.content;
      }

      // Ensure content array is present and not empty
      if (!payload.content || payload.content.length === 0) {
        throw new Error('Content array is required for Seedance video generation. Provide either prompt or image.');
      }

      console.log(`[BytePlus] Video generation payload:`, JSON.stringify(payload, null, 2));
      console.log(`[BytePlus] Content array length: ${payload.content?.length || 0}`);
      console.log(`[BytePlus] Content items:`, payload.content?.map((c: any) => ({ type: c.type, hasText: !!c.text, hasImage: !!c.image_url })));

      const response = await this.axiosInstance.post<BytePlusVideoGenerationResponse>(
        '/contents/generations/tasks',
        payload
      );

      console.log(`[BytePlus] Video generation task created. Task ID: ${response.data.id}, Status: ${response.data.status}`);
      return response.data;
    } catch (error: any) {
      console.error('[BytePlus] Video generation task creation error:', error.response?.data || error.message);
      throw new Error(`Failed to create video generation task: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Query video generation task status
   */
  async getVideoTaskStatus(taskId: string): Promise<BytePlusVideoTaskStatus> {
    try {
      const response = await this.axiosInstance.get<BytePlusVideoTaskStatus>(
        `/contents/generations/tasks/${taskId}`
      );

      return response.data;
    } catch (error: any) {
      console.error(`[BytePlus] Failed to get task status for ${taskId}:`, error.response?.data || error.message);
      throw new Error(`Failed to get video task status: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Poll video generation task until completion
   */
  async pollVideoTaskUntilComplete(
    taskId: string,
    maxAttempts: number = 60,
    intervalMs: number = 5000,
    onProgress?: (progress: number) => void
  ): Promise<BytePlusVideoTaskStatus> {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const taskStatus = await this.getVideoTaskStatus(taskId);
      
      console.log(`[BytePlus] Task ${taskId} status: ${taskStatus.status} (attempt ${attempts + 1}/${maxAttempts})`);
      
      // Update progress (estimate based on attempts)
      if (onProgress) {
        const estimatedProgress = Math.min(85, 30 + (attempts / maxAttempts) * 55);
        onProgress(estimatedProgress);
      }
      
      if (taskStatus.status === 'succeeded') {
        console.log(`[BytePlus] Task ${taskId} completed successfully`);
        return taskStatus;
      }
      
      if (taskStatus.status === 'failed') {
        throw new Error(`Video generation task failed: ${taskStatus.error?.message || 'Unknown error'}`);
      }
      
      if (taskStatus.status === 'cancelled') {
        throw new Error('Video generation task was cancelled');
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      attempts++;
    }
    
    throw new Error(`Video generation task timed out after ${maxAttempts} attempts`);
  }

  /**
   * Download video from URL and save locally
   */
  async downloadVideo(videoUrl: string, outputPath: string): Promise<string> {
    try {
      console.log(`[BytePlus] Downloading video from ${videoUrl} to ${outputPath}`);
      
      const response = await axios.get(videoUrl, {
        responseType: 'stream',
        timeout: 300000, // 5 minutes for large files
      });

      const fs = require('fs');
      const writer = fs.createWriteStream(outputPath);

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`[BytePlus] Video downloaded successfully to ${outputPath}`);
          resolve(outputPath);
        });
        writer.on('error', reject);
      });
    } catch (error: any) {
      console.error(`[BytePlus] Failed to download video:`, error.message);
      throw new Error(`Failed to download video: ${error.message}`);
    }
  }

  /**
   * Download image from URL and save locally
   */
  async downloadImage(imageUrl: string, outputPath: string): Promise<string> {
    try {
      console.log(`[BytePlus] Downloading image from ${imageUrl} to ${outputPath}`);
      
      const response = await axios.get(imageUrl, {
        responseType: 'stream',
        timeout: 60000,
      });

      const fs = require('fs');
      const writer = fs.createWriteStream(outputPath);

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`[BytePlus] Image downloaded successfully to ${outputPath}`);
          resolve(outputPath);
        });
        writer.on('error', reject);
      });
    } catch (error: any) {
      console.error(`[BytePlus] Failed to download image:`, error.message);
      throw new Error(`Failed to download image: ${error.message}`);
    }
  }

  /**
   * Generate video using unified interface
   * Implements IVideoGenerationProvider
   */
  async generateVideo(
    request: VideoGenerationRequest,
    onProgress?: (progress: number) => void
  ): Promise<VideoGenerationResponse> {
    try {
      // Validate request
      const validation = this.validateVideoRequest(request);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid request');
      }

      // Map duration - ensure minimum 2 seconds
      const duration = request.duration ? Math.max(Math.floor(request.duration), 2) : 2;

      // Map aspect ratio
      const ratio = request.aspectRatio || '9:16';

      // Map resolution
      const resolution = request.resolution || '1080p';

      onProgress?.(10);

      // Create video generation task
      const taskResponse = await this.createVideoGenerationTask({
        model: 'seedance-1-0-pro-250528',
        prompt: request.prompt,
        image: request.imageUrl,
        duration,
        ratio,
        resolution,
        frames_per_second: 24,
      });

      onProgress?.(30);

      // Poll until completion
      const completedTask = await this.pollVideoTaskUntilComplete(
        taskResponse.id,
        120, // Max 10 minutes (120 * 5s)
        5000,
        onProgress
      );

      onProgress?.(90);

      if (!completedTask.content || !completedTask.content.video_url) {
        throw new Error('Video generation completed but no video URL');
      }

      onProgress?.(100);

      return {
        videoUrl: completedTask.content.video_url,
        model: 'seedance-1-0-pro-250528',
        metadata: {
          taskId: taskResponse.id,
          generationTime: Date.now() - (completedTask.created_at * 1000),
        },
      };
    } catch (error: any) {
      console.error('[BytePlus] Video generation error:', error.response?.data || error.message);
      throw new Error(`Failed to generate video: ${error.response?.data?.error?.message || error.message}`);
    }
  }


  /**
   * Get video provider capabilities
   */
  getVideoCapabilities(): VideoProviderCapabilities {
    return {
      supportsAspectRatio: true,
      supportsResolution: true,
      supportsDuration: true,
      supportedAspectRatios: ['9:16', '3:4', '16:9', '1:1', '4:3'],
      supportedResolutions: ['720p', '1080p'],
      minDuration: 2,
      isAsync: true, // BytePlus uses async polling
      estimatedTimeSeconds: 60, // Average generation time
    };
  }

  /**
   * Get supported video models
   */
  async getSupportedVideoModels(): Promise<VideoModelInfo[]> {
    // Models are managed by ModelRegistryService
    return [];
  }

  /**
   * Validate video request
   */
  validateVideoRequest(request: VideoGenerationRequest): ValidationResult {
    if (!request.prompt || request.prompt.trim().length === 0) {
      return { valid: false, error: 'Prompt is required' };
    }

    if (!request.imageUrl || request.imageUrl.trim().length === 0) {
      return { valid: false, error: 'Image URL is required' };
    }

    if (request.duration && request.duration < 2) {
      return { valid: false, error: 'Duration must be at least 2 seconds for BytePlus' };
    }

    return { valid: true };
  }
}

