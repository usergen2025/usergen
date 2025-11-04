import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface HeyGenVideoGenerationRequest {
  avatar_id?: string; // Deprecated - use talking_photo_id instead
  talking_photo_id?: string; // Motion avatar ID (talking_photo_id)
  audio_url?: string;
  audio_asset_id?: string;
  dimension: {
    width: number;
    height: number;
  };
  caption?: boolean;
  title?: string;
  callback_id?: string;
}

export interface HeyGenVideoGenerationResponse {
  video_id: string;
}

export interface HeyGenVideoStatus {
  code: number;
  data: {
    id: string;
    status: 'processing' | 'completed' | 'failed' | 'pending' | 'waiting';
    video_url?: string;
    video_url_caption?: string;
    thumbnail_url?: string;
    gif_url?: string;
    caption_url?: string;
    duration?: number;
    created_at?: number;
    callback_id?: string | null;
    error?: {
      code: number;
      message: string;
      detail?: string;
    } | null;
  };
  message?: string;
}

@Injectable()
export class HeyGenVideoProvider {
  private axiosInstance: AxiosInstance;
  private apiKey: string;
  private baseUrl: string = 'https://api.heygen.com/v2';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('HEYGEN_API_KEY') || '';
    
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'x-api-key': this.apiKey,
        'accept': 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }

  /**
   * Generate avatar video with audio
   */
  async generateAvatarVideo(request: HeyGenVideoGenerationRequest): Promise<HeyGenVideoGenerationResponse> {
    try {
      const avatarId = request.talking_photo_id || request.avatar_id;
      console.log(`[HeyGen] Generating avatar video for talking_photo_id: ${avatarId}`);
      
      if (!request.audio_url && !request.audio_asset_id) {
        throw new Error('Either audio_url or audio_asset_id must be provided');
      }

      if (!avatarId) {
        throw new Error('Either talking_photo_id or avatar_id must be provided');
      }

      const payload = {
        dimension: request.dimension,
        video_inputs: [
          {
            character: {
              type: request.talking_photo_id ? 'talking_photo' : 'avatar',
              ...(request.talking_photo_id && { talking_photo_id: request.talking_photo_id }),
              ...(request.avatar_id && !request.talking_photo_id && { avatar_id: request.avatar_id }),
            },
            voice: {
              type: 'audio',
              ...(request.audio_url && { audio_url: request.audio_url }),
              ...(request.audio_asset_id && { audio_asset_id: request.audio_asset_id }),
            },
          },
        ],
        ...(request.caption !== undefined && { caption: request.caption }),
        ...(request.title && { title: request.title }),
        ...(request.callback_id && { callback_id: request.callback_id }),
      };

      const response = await this.axiosInstance.post<any>(
        '/video/generate',
        payload
      );

      // Handle HeyGen API response format: { error: null, data: { video_id: '...' } }
      // or wrapped format: { code: 100, data: { video_id: '...' } }
      // or direct format: { video_id: '...' }
      const responseData = response.data;
      let videoId: string;
      
      // Check for error in response
      if (responseData.error !== null && responseData.error !== undefined) {
        throw new Error(`HeyGen API error: ${JSON.stringify(responseData.error)}`);
      }
      
      // Check for code-based format
      if (responseData.code !== undefined) {
        // HeyGen API wrapped format: { code: 100, data: { video_id: '...' } }
        if (responseData.code !== 100) {
          throw new Error(`HeyGen API error: ${responseData.message || responseData.msg || 'Unknown error'}`);
        }
        videoId = responseData.data?.video_id;
      } else if (responseData.data?.video_id) {
        // Format: { error: null, data: { video_id: '...' } }
        videoId = responseData.data.video_id;
      } else if (responseData.video_id) {
        // Direct format: { video_id: '...' }
        videoId = responseData.video_id;
      } else {
        console.error('[HeyGen] Video generation response:', JSON.stringify(responseData, null, 2));
        throw new Error('Failed to get video_id from HeyGen API response');
      }

      console.log(`[HeyGen] Video generation started. Video ID: ${videoId}`);
      return { video_id: videoId };
    } catch (error: any) {
      console.error('[HeyGen] Video generation error:', error.response?.data || error.message);
      throw new Error(`Failed to generate avatar video: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * Get video status using /v1/video_status.get endpoint
   * Reference: https://docs.heygen.com/reference/video-status
   * Note: Status endpoint is at v1, but axios instance uses v2 base URL
   * So we need to use the full URL for this endpoint
   */
  async getVideoStatus(videoId: string): Promise<HeyGenVideoStatus> {
    try {
      // Status endpoint is at /v1/video_status.get, not /v2
      // Use full URL since axios instance has baseURL set to v2
      const response = await axios.get<HeyGenVideoStatus>(
        `https://api.heygen.com/v1/video_status.get`,
        {
          params: {
            video_id: videoId,
          },
          headers: {
            'x-api-key': this.apiKey,
            'accept': 'application/json',
          },
          timeout: 60000,
        }
      );

      // Handle response format: { code: 100, data: { ... }, message: "Success" }
      if (response.data.code !== undefined && response.data.code !== 100) {
        throw new Error(`HeyGen API error: ${response.data.message || 'Unknown error'}`);
      }

      return response.data;
    } catch (error: any) {
      console.error(`[HeyGen] Failed to get video status for ${videoId}:`, error.response?.data || error.message);
      throw new Error(`Failed to get video status: ${error.response?.data?.message || error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * Poll video generation until completion
   */
  async pollVideoUntilComplete(
    videoId: string,
    maxAttempts: number = 60,
    intervalMs: number = 5000
  ): Promise<HeyGenVideoStatus> {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const status = await this.getVideoStatus(videoId);
      
      console.log(`[HeyGen] Video ${videoId} status: ${status.data.status} (attempt ${attempts + 1}/${maxAttempts})`);
      
      if (status.data.status === 'completed') {
        console.log(`[HeyGen] Video ${videoId} completed successfully`);
        return status;
      }
      
      if (status.data.status === 'failed') {
        const errorMsg = status.data.error?.message || status.data.error?.detail || status.message || 'Unknown error';
        throw new Error(`Video generation failed: ${errorMsg}`);
      }
      
      // Continue polling for 'processing', 'pending', 'waiting' statuses
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      attempts++;
    }
    
    throw new Error(`Video generation timed out after ${maxAttempts} attempts`);
  }

  /**
   * Upload audio file to HeyGen and get asset ID
   * Uses the same upload endpoint as image upload: https://upload.heygen.com/v1/asset
   */
  async uploadAudio(audioBuffer: Buffer, filename: string): Promise<string> {
    try {
      console.log(`[HeyGen] Uploading audio file: ${filename}`);
      
      // Create a separate axios instance for upload endpoint (different from API endpoint)
      const uploadAxios = axios.create({
        baseURL: 'https://upload.heygen.com/v1',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'audio/mpeg', // MP3 files use audio/mpeg
        },
        timeout: 60000, // 60 seconds for file uploads
      });

      const response = await uploadAxios.post<any>(
        '/asset',
        audioBuffer // Send buffer directly as binary data
      );

      // Handle different response formats (similar to image upload)
      const data = response.data.code !== undefined ? response.data.data : (response.data as any);
      
      const assetId = data?.id || response.data?.id;
      if (!assetId) {
        console.error('[HeyGen] Upload response:', JSON.stringify(response.data));
        throw new Error('Failed to get asset ID from upload response');
      }

      console.log(`[HeyGen] Audio uploaded successfully. Asset ID: ${assetId}`);
      return assetId;
    } catch (error: any) {
      console.error('[HeyGen] Audio upload error:', error.response?.data || error.message);
      throw new Error(`Failed to upload audio: ${error.response?.data?.msg || error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Retrieve avatar details from HeyGen API
   * Tries photo avatar endpoint first (for motion IDs / talking_photo IDs), then regular avatar endpoint
   * References:
   * - https://docs.heygen.com/reference/photo-avatar-details
   * - https://docs.heygen.com/reference/retrieve-avatar-details
   */
  async getAvatarDetails(avatarId: string): Promise<any> {
    try {
      console.log(`[HeyGen] Retrieving avatar details for: ${avatarId}`);
      
      // First, try photo avatar endpoint (for motion IDs / talking_photo IDs)
      try {
        const photoResponse = await this.axiosInstance.get<any>(
          `/photo_avatar/${avatarId}`
        );

        // Handle photo avatar response format
        if (photoResponse.data?.error && photoResponse.data.error !== null && typeof photoResponse.data.error === 'object') {
          throw new Error(photoResponse.data.error.message || 'Failed to get photo avatar details');
        }

        if (photoResponse.data?.code !== undefined && photoResponse.data?.code !== 100) {
          throw new Error(photoResponse.data.msg || 'Failed to get photo avatar details');
        }

        // Extract data from different possible locations
        const data = photoResponse.data.data || photoResponse.data;
        console.log(`[HeyGen] Photo avatar details retrieved successfully for ${avatarId}`);
        return data;
      } catch (photoError: any) {
        // If photo avatar endpoint fails with 404, try regular avatar endpoint
        if (photoError.response?.status === 404 || photoError.message?.includes('not found')) {
          console.log(`[HeyGen] Photo avatar not found, trying regular avatar endpoint for: ${avatarId}`);
          
          try {
            const response = await this.axiosInstance.get<any>(
              `/avatar/${avatarId}/details`
            );

            if (response.data?.error) {
              throw new Error(response.data.error);
            }

            if (response.data?.data) {
              console.log(`[HeyGen] Regular avatar details retrieved successfully for ${avatarId}`);
              return response.data.data;
            }

            throw new Error('Invalid response format from HeyGen API');
          } catch (regularError: any) {
            console.error(`[HeyGen] Both photo and regular avatar endpoints failed for ${avatarId}`);
            throw new Error(`Avatar ${avatarId} not found as photo or regular avatar in HeyGen: ${regularError.message}`);
          }
        } else {
          // Other error from photo avatar endpoint
          throw photoError;
        }
      }
    } catch (error: any) {
      console.error(`[HeyGen] Failed to retrieve avatar details for ${avatarId}:`, error.response?.data || error.message);
      throw new Error(`Failed to retrieve avatar details: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * Download video from HeyGen URL and save locally
   */
  async downloadVideo(videoUrl: string, outputPath: string): Promise<string> {
    try {
      console.log(`[HeyGen] Downloading video from ${videoUrl} to ${outputPath}`);
      
      const response = await axios.get(videoUrl, {
        responseType: 'stream',
        timeout: 300000, // 5 minutes
      });

      const fs = require('fs');
      const writer = fs.createWriteStream(outputPath);

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`[HeyGen] Video downloaded successfully to ${outputPath}`);
          resolve(outputPath);
        });
        writer.on('error', reject);
      });
    } catch (error: any) {
      console.error(`[HeyGen] Failed to download video:`, error.message);
      throw new Error(`Failed to download video: ${error.message}`);
    }
  }
}

