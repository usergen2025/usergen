import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

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
export class BytePlusProvider {
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
   * Generate image using BytePlus Seedream 4.0
   */
  async generateImage(request: BytePlusImageGenerationRequest): Promise<BytePlusImageGenerationResponse> {
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
    intervalMs: number = 5000
  ): Promise<BytePlusVideoTaskStatus> {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const taskStatus = await this.getVideoTaskStatus(taskId);
      
      console.log(`[BytePlus] Task ${taskId} status: ${taskStatus.status} (attempt ${attempts + 1}/${maxAttempts})`);
      
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
}

