import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { preWarmUrl, withRetry } from '@shared/storage';
import * as fs from 'fs';
import * as path from 'path';

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

export interface HeyGenAvatarIVRequest {
  image_key: string;
  video_title: string;
  script?: string;
  voice_id?: string;
  audio_url?: string;
  audio_asset_id?: string;
  video_orientation?: 'portrait' | 'landscape';
  fit?: 'cover' | 'contain';
  custom_motion_prompt?: string;
  enhance_custom_motion_prompt?: boolean;
}

export interface HeyGenAvatarIVResponse {
  video_id: string;
}

/** Optional context for HeyGen v3 Photo Avatar pipeline (POST /v3/assets → /v3/avatars → /v3/videos). */
export interface HeyGenAvatarIVV3Context {
  fullScriptText: string;
  voiceId: string;
  projectId: string;
}

/** Result of unified start — callers must use matching poll (v1 status vs v3 video GET). */
export interface HeyGenAvatarIVUnifiedStart {
  video_id: string;
  useV3Polling: boolean;
}

@Injectable()
export class HeyGenVideoProvider {
  private axiosInstance: AxiosInstance;
  private axiosV3: AxiosInstance;
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

    this.axiosV3 = axios.create({
      baseURL: 'https://api.heygen.com',
      headers: {
        'x-api-key': this.apiKey,
        accept: 'application/json',
      },
      timeout: 120000,
    });

    // Add error interceptors to handle EPIPE and socket errors
    this.setupErrorHandlers();
  }

  /** `legacy_av4` (default) or `v3_photo_avatar` — see HEYGEN_AVATAR_PIPELINE in env.example */
  getAvatarPipelineMode(): 'legacy_av4' | 'v3_photo_avatar' {
    const v = (this.configService.get<string>('HEYGEN_AVATAR_PIPELINE') || 'legacy_av4').toLowerCase();
    return v === 'v3_photo_avatar' ? 'v3_photo_avatar' : 'legacy_av4';
  }

  /**
   * Setup error handlers for axios instance to prevent EPIPE errors from crashing the process
   */
  private setupErrorHandlers(): void {
    // Request interceptor
    this.axiosInstance.interceptors.request.use(
      (config) => config,
      (error) => {
        console.error(`[HeyGenVideoProvider] Request error: ${error.message}`);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        // Handle EPIPE and socket errors gracefully
        if (error.code === 'EPIPE' || error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') {
          console.warn(`[HeyGenVideoProvider] Connection error (${error.code}): ${error.message}`);
          // Return a more descriptive error instead of crashing
          return Promise.reject(new Error(`HeyGen API connection failed: ${error.message}`));
        }
        console.error(`[HeyGenVideoProvider] Response error: ${error.message}`);
        return Promise.reject(error);
      }
    );
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

      // Pre-warm audio URL if provided (helps HeyGen download the file faster)
      if (request.audio_url && !request.audio_asset_id) {
        console.log(`[HeyGen] Pre-warming audio URL...`);
        const warmed = await preWarmUrl(request.audio_url, 3);
        if (!warmed) {
          console.warn(`[HeyGen] ⚠️ Audio URL pre-warming failed, proceeding anyway...`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
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
      console.error(`[HeyGen] Failed to download video:`, error.message);
      throw new Error(`Failed to download video: ${error.message}`);
    }
  }

  /**
   * Generate Avatar IV video (Premium mode)
   * Uses /v2/video/av4/generate endpoint
   * Reference: https://docs.heygen.com/reference/create-avatar-iv-video
   */
  async generateAvatarIVVideo(request: HeyGenAvatarIVRequest): Promise<HeyGenAvatarIVResponse> {
    try {
      console.log(`[HeyGen] Generating Avatar IV video with image_key: ${request.image_key}`);
      
      // Validate required fields
      if (!request.image_key) {
        throw new Error('image_key is required for Avatar IV generation');
      }
      
      if (!request.audio_url && !request.audio_asset_id && (!request.script || !request.voice_id)) {
        throw new Error('Either audio_url/audio_asset_id or script+voice_id must be provided');
      }

      // Pre-warm audio URL if provided (helps HeyGen download the file faster)
      if (request.audio_url && !request.audio_asset_id) {
        console.log(`[HeyGen] Pre-warming audio URL for Avatar IV...`);
        const warmed = await preWarmUrl(request.audio_url, 3);
        if (!warmed) {
          console.warn(`[HeyGen] ⚠️ Audio URL pre-warming failed, proceeding anyway...`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const payload: any = {
        image_key: request.image_key,
        video_title: request.video_title,
        video_orientation: request.video_orientation || 'portrait',
      };

      // Add audio source (prefer audio_asset_id over audio_url)
      if (request.audio_asset_id) {
        payload.audio_asset_id = request.audio_asset_id;
      } else if (request.audio_url) {
        payload.audio_url = request.audio_url;
      } else if (request.script && request.voice_id) {
        payload.script = request.script;
        payload.voice_id = request.voice_id;
      }

      // Add optional parameters
      if (request.fit) {
        payload.fit = request.fit;
      }
      if (request.custom_motion_prompt) {
        payload.custom_motion_prompt = request.custom_motion_prompt;
      }
      if (request.enhance_custom_motion_prompt !== undefined) {
        payload.enhance_custom_motion_prompt = request.enhance_custom_motion_prompt;
      }

      console.log(`[HeyGen] Avatar IV payload:`, JSON.stringify(payload, null, 2));

      const response = await this.axiosInstance.post<any>(
        '/video/av4/generate',
        payload
      );

      // Handle response format: { error: null, data: { video_id: '...' } }
      const responseData = response.data;
      let videoId: string;
      
      if (responseData.error !== null && responseData.error !== undefined) {
        throw new Error(`HeyGen Avatar IV API error: ${JSON.stringify(responseData.error)}`);
      }
      
      if (responseData.data?.video_id) {
        videoId = responseData.data.video_id;
      } else {
        console.error('[HeyGen] Avatar IV response:', JSON.stringify(responseData, null, 2));
        throw new Error('Failed to get video_id from HeyGen Avatar IV API response');
      }

      console.log(`[HeyGen] Avatar IV video generation started. Video ID: ${videoId}`);
      return { video_id: videoId };
    } catch (error: any) {
      console.error('[HeyGen] Avatar IV video generation error:', error.response?.data || error.message);
      throw new Error(`Failed to generate Avatar IV video: ${error.response?.data?.msg || error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Public URL for an uploaded HeyGen image asset (image_key from v1 upload).
   * Used to fetch bytes before POST /v3/assets when using the v3 Photo Avatar pipeline.
   */
  buildImageUrlFromImageKey(imageKey: string): string {
    const key = (imageKey || '').trim();
    if (key.startsWith('http')) return key;
    const normalized = key.replace(/^\/+/, '');
    return `https://resource2.heygen.ai/${normalized}`;
  }

  /**
   * POST /v3/assets — multipart file upload; returns asset id for POST /v3/avatars.
   */
  async uploadV3AssetFromBuffer(buffer: Buffer, filename: string): Promise<string> {
    const form = new FormData();
    form.append('file', buffer, { filename });
    const res = await this.axiosV3.post<any>('/v3/assets', form, {
      headers: form.getHeaders(),
    });
    const d = res.data?.data ?? res.data;
    const assetId = d?.id ?? d?.asset_id ?? d?.assetId;
    if (!assetId) {
      console.error('[HeyGen v3] /v3/assets response:', JSON.stringify(res.data));
      throw new Error('Failed to get asset id from HeyGen v3 /v3/assets');
    }
    console.log(`[HeyGen v3] Asset uploaded: ${assetId}`);
    return String(assetId);
  }

  /**
   * POST /v3/avatars — create Photo Avatar from asset_id; returns avatar id for POST /v3/videos.
   */
  async createV3PhotoAvatar(assetId: string, name: string): Promise<string> {
    const body = {
      type: 'photo',
      name: name.slice(0, 200),
      file: { type: 'asset_id', asset_id: assetId },
    };
    const res = await this.axiosV3.post<any>('/v3/avatars', body);
    const d = res.data?.data ?? res.data;
    const avatarId =
      d?.avatar_item?.id ?? d?.avatar_item_id ?? d?.id ?? d?.avatar_id;
    if (!avatarId) {
      console.error('[HeyGen v3] /v3/avatars response:', JSON.stringify(res.data));
      throw new Error('Failed to get avatar id from HeyGen v3 /v3/avatars');
    }
    console.log(`[HeyGen v3] Photo avatar created: ${avatarId}`);
    return String(avatarId);
  }

  /**
   * POST /v3/videos — Photo Avatar talking-head video (script + voice).
   */
  async createV3AvatarVideo(params: {
    avatarId: string;
    script: string;
    voiceId: string;
    title: string;
    resolution?: '4k' | '1080p' | '720p';
    aspectRatio?: '16:9' | '9:16';
    motionPrompt?: string;
    expressiveness?: 'high' | 'medium' | 'low';
  }): Promise<string> {
    const body: Record<string, unknown> = {
      type: 'avatar',
      avatar_id: params.avatarId,
      script: params.script,
      voice_id: params.voiceId,
      title: params.title,
      resolution: params.resolution || '1080p',
      aspect_ratio: params.aspectRatio || '9:16',
    };
    if (params.motionPrompt) body.motion_prompt = params.motionPrompt;
    if (params.expressiveness) body.expressiveness = params.expressiveness;

    const res = await this.axiosV3.post<any>('/v3/videos', body);
    const d = res.data?.data ?? res.data;
    const videoId = d?.video_id ?? d?.id;
    if (!videoId) {
      console.error('[HeyGen v3] /v3/videos response:', JSON.stringify(res.data));
      throw new Error('Failed to get video_id from HeyGen v3 /v3/videos');
    }
    console.log(`[HeyGen v3] Video job created: ${videoId}`);
    return String(videoId);
  }

  /**
   * GET /v3/videos/{id} — map to legacy HeyGenVideoStatus shape for downstream code.
   */
  async getV3VideoStatus(videoId: string): Promise<HeyGenVideoStatus> {
    const res = await this.axiosV3.get<any>(`/v3/videos/${encodeURIComponent(videoId)}`);
    const d = res.data?.data ?? res.data;
    const status = (d?.status || 'pending').toLowerCase();
    const mapped: 'processing' | 'completed' | 'failed' | 'pending' | 'waiting' =
      status === 'completed'
        ? 'completed'
        : status === 'failed'
          ? 'failed'
          : status === 'processing'
            ? 'processing'
            : 'pending';

    return {
      code: 100,
      data: {
        id: d?.id ?? videoId,
        status: mapped,
        video_url: d?.video_url,
        thumbnail_url: d?.thumbnail_url,
        duration: d?.duration,
        created_at: d?.created_at,
        callback_id: null,
        error:
          mapped === 'failed'
            ? {
                code: 0,
                message: d?.failure_message || d?.error?.message || 'Video generation failed',
                detail: '',
              }
            : null,
      },
    };
  }

  async pollV3VideoUntilComplete(
    videoId: string,
    maxAttempts: number = 120,
    intervalMs: number = 5000,
  ): Promise<HeyGenVideoStatus> {
    let attempts = 0;
    while (attempts < maxAttempts) {
      const status = await this.getV3VideoStatus(videoId);
      console.log(`[HeyGen v3] Video ${videoId} status: ${status.data.status} (${attempts + 1}/${maxAttempts})`);
      if (status.data.status === 'completed') return status;
      if (status.data.status === 'failed') {
        const msg = status.data.error?.message || 'Unknown error';
        throw new Error(`HeyGen v3 video failed: ${msg}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
      attempts++;
    }
    throw new Error(`HeyGen v3 video ${videoId} timed out after ${maxAttempts} attempts`);
  }

  /**
   * v3 Photo Avatar pipeline: fetch image by image_key → v3 assets → v3 avatars → v3 videos.
   * Requires non-empty script + voiceId (project voice).
   */
  async startAvatarIVV3PhotoAvatarPipeline(
    request: HeyGenAvatarIVRequest,
    ctx: HeyGenAvatarIVV3Context,
  ): Promise<HeyGenAvatarIVUnifiedStart> {
    const imageUrl = this.buildImageUrlFromImageKey(request.image_key);
    console.log(`[HeyGen v3] Fetching image for Photo Avatar pipeline: ${imageUrl}`);
    const imgRes = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      validateStatus: (s) => s < 500,
    });
    if (imgRes.status >= 400) {
      throw new Error(`Failed to download image for v3 pipeline: HTTP ${imgRes.status}`);
    }
    const buffer = Buffer.from(imgRes.data);
    const isPng = buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50;
    const filename = isPng ? 'portrait.png' : 'portrait.jpg';

    const assetId = await this.uploadV3AssetFromBuffer(buffer, filename);
    const avatarId = await this.createV3PhotoAvatar(
      assetId,
      `Project ${ctx.projectId} ${Date.now()}`,
    );
    const script = (ctx.fullScriptText || ' ').trim() || '.';
    const videoId = await this.createV3AvatarVideo({
      avatarId,
      script,
      voiceId: ctx.voiceId,
      title: request.video_title || `Video ${ctx.projectId}`,
      resolution: '1080p',
      aspectRatio: request.video_orientation === 'landscape' ? '16:9' : '9:16',
      motionPrompt: request.custom_motion_prompt,
      expressiveness: 'medium',
    });
    return { video_id: videoId, useV3Polling: true };
  }

  /**
   * Chooses v3 Photo Avatar pipeline or legacy POST /video/av4/generate based on HEYGEN_AVATAR_PIPELINE and context.
   */
  async generateAvatarIVVideoUnified(
    request: HeyGenAvatarIVRequest,
    v3Context?: HeyGenAvatarIVV3Context,
  ): Promise<HeyGenAvatarIVUnifiedStart> {
    const mode = this.getAvatarPipelineMode();
    const canV3 =
      mode === 'v3_photo_avatar' &&
      v3Context &&
      v3Context.fullScriptText?.trim()?.length > 0 &&
      v3Context.voiceId?.trim()?.length > 0;

    if (!canV3) {
      if (mode === 'v3_photo_avatar') {
        console.warn(
          '[HeyGen] HEYGEN_AVATAR_PIPELINE=v3_photo_avatar but missing script/voiceId; using legacy_av4',
        );
      }
      const legacy = await this.generateAvatarIVVideo(request);
      return { video_id: legacy.video_id, useV3Polling: false };
    }

    try {
      return await this.startAvatarIVV3PhotoAvatarPipeline(request, v3Context);
    } catch (e: any) {
      console.error('[HeyGen v3] Pipeline failed, falling back to legacy Avatar IV:', e?.message || e);
      const legacy = await this.generateAvatarIVVideo(request);
      return { video_id: legacy.video_id, useV3Polling: false };
    }
  }

  async pollAvatarVideoUntilCompleteUnified(
    start: HeyGenAvatarIVUnifiedStart,
    maxAttempts?: number,
    intervalMs?: number,
  ): Promise<HeyGenVideoStatus> {
    if (start.useV3Polling) {
      return this.pollV3VideoUntilComplete(start.video_id, maxAttempts, intervalMs);
    }
    return this.pollVideoUntilComplete(start.video_id, maxAttempts, intervalMs);
  }

  /**
   * Upload an image file to HeyGen and return its image_key.
   * This is used for Avatar IV (image_key-based) flows such as AVATAR_PRODUCT.
   * The caller is responsible for caching the returned key in project data.
   */
  async uploadImageAndGetKey(imagePath: string, filename?: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('HEYGEN_API_KEY is not configured');
    }

    const resolvedPath = path.isAbsolute(imagePath)
      ? imagePath
      : path.join(process.cwd(), imagePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Image file not found at path: ${resolvedPath}`);
    }

    try {
      console.log(`[HeyGen] Uploading image to HeyGen asset API from ${resolvedPath}`);

      // Read file into buffer
      const buffer = fs.readFileSync(resolvedPath);

      // Detect actual image format from magic bytes (not just extension)
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      // JPEG signature: FF D8 FF
      let contentType: 'image/jpeg' | 'image/png';
      if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        // PNG file
        contentType = 'image/png';
        console.log(`[HeyGen] Detected PNG format (magic bytes)`);
      } else if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        // JPEG file
        contentType = 'image/jpeg';
        console.log(`[HeyGen] Detected JPEG format (magic bytes)`);
      } else {
        // Fallback to extension-based detection
        const ext = path.extname(resolvedPath).toLowerCase();
        contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
        console.log(`[HeyGen] Using extension-based detection: ${contentType}`);
      }

      // Mirror the working avatar upload flow: send raw binary buffer with appropriate Content-Type
      const uploadAxios = axios.create({
        baseURL: 'https://upload.heygen.com/v1',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': contentType,
        },
        timeout: 60000,
      });

      const response = await uploadAxios.post<any>('/asset', buffer);

      // Handle different response formats (code-wrapped or direct)
      const responseData = response.data;
      const data = responseData.code !== undefined ? responseData.data : (responseData as any);

      const imageKey = data?.image_key || data?.id;

      if (!imageKey) {
        console.error('[HeyGen] Image upload response:', JSON.stringify(responseData, null, 2));
        throw new Error('Failed to get image_key from HeyGen upload response');
      }

      console.log(`[HeyGen] ✅ Image uploaded to HeyGen. image_key=${imageKey}`);
      return imageKey;
    } catch (error: any) {
      console.error('[HeyGen] Image upload error:', error.response?.data || error.message);
      throw new Error(
        `Failed to upload image to HeyGen: ${
          error.response?.data?.msg || error.response?.data?.message || error.message
        }`,
      );
    }
  }
}
