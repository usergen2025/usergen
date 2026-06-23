import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { preWarmUrl, withRetry } from '@shared/storage';
import { ProjectLogService } from '../../common/logging/project-log.service';
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

/** Pipeline modes for avatar video generation */
export type HeyGenPipelineMode = 'legacy_av4' | 'v3_image_video' | 'v3_photo_avatar';

/** Engine types for HeyGen v3 API */
export type HeyGenEngineType = 'avatar_v' | 'avatar_iv';

/** Optional context for HeyGen v3 pipelines */
export interface HeyGenV3Context {
  fullScriptText: string;
  /** HeyGen TTS voice id when not using uploaded stitched audio. */
  voiceId: string;
  projectId: string;
  /** HeyGen `uploadAudio` asset id — v3: send as `audio_asset_id` (omit `script` / `voice_id`). */
  audioAssetId?: string;
  /** Cached v3 image asset ID (avoids re-upload per job when set). */
  cachedV3ImageAssetId?: string;
  /** Cached v3 photo avatar ID (for v3_photo_avatar mode). */
  cachedV3AvatarId?: string;
}

/** @deprecated Use HeyGenV3Context */
export type HeyGenAvatarIVV3Context = HeyGenV3Context;

/** Result of unified start — callers must use matching poll (v1 status vs v3 video GET). */
export interface HeyGenVideoUnifiedResult {
  video_id: string;
  useV3Polling: boolean;
  pipeline: HeyGenPipelineMode;
  engine?: HeyGenEngineType;
}

/** @deprecated Use HeyGenVideoUnifiedResult */
export type HeyGenAvatarIVUnifiedStart = Pick<
  HeyGenVideoUnifiedResult,
  'video_id' | 'useV3Polling'
>;

export interface HeyGenVideoTranslationRequest {
  videoUrl: string;
  outputLanguage: string;
  mode?: 'speed' | 'precision';
  translateAudioOnly?: boolean;
  disableMusicTrack?: boolean;
  title?: string;
  inputLanguage?: string;
  speakerNum?: number;
}

export interface HeyGenVideoTranslationStatus {
  id: string;
  status: string;
  videoUrl?: string;
  error?: string;
  captionUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HeyGen Audio Search Types (Background Music & Sound Effects)
// ─────────────────────────────────────────────────────────────────────────────

/** Audio content type for HeyGen audio search */
export type HeyGenAudioType = 'music' | 'sound_effects';

/** Options for HeyGen audio search */
export interface HeyGenAudioSearchOptions {
  /** Audio content type: 'music' (default) or 'sound_effects' */
  type?: HeyGenAudioType;
  /** Maximum number of results (1-50, default 10) */
  limit?: number;
  /** Minimum semantic similarity score (0-1, default 0.7) */
  minScore?: number;
  /** Pagination cursor from previous response */
  token?: string;
}

/** Single audio track from HeyGen audio search */
export interface HeyGenAudioTrack {
  /** Unique identifier for the track */
  id: string;
  /** Display name of the track */
  name: string;
  /** Human-readable description of the track */
  description: string;
  /** Pre-signed download URL (WAV format, time-limited) */
  audio_url: string;
  /** Duration in seconds */
  duration: number;
  /** Semantic similarity score (0-1) */
  score: number;
  /** Audio content type */
  type: HeyGenAudioType;
}

/** Response from HeyGen audio search */
export interface HeyGenAudioSearchResponse {
  /** Array of matching audio tracks */
  tracks: HeyGenAudioTrack[];
  /** Whether more results are available */
  hasMore: boolean;
  /** Cursor for next page (undefined when hasMore is false) */
  nextToken?: string;
}

@Injectable()
export class HeyGenVideoProvider {
  private axiosInstance: AxiosInstance;
  private axiosV3: AxiosInstance;
  private apiKey: string;
  private baseUrl: string = 'https://api.heygen.com/v2';

  constructor(
    private readonly configService: ConfigService,
    private readonly projectLog: ProjectLogService,
  ) {
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

  /** Pipeline mode — see HEYGEN_AVATAR_PIPELINE in env.example */
  getAvatarPipelineMode(): HeyGenPipelineMode {
    const v = (this.configService.get<string>('HEYGEN_AVATAR_PIPELINE') || 'legacy_av4').toLowerCase();
    if (v === 'v3_image_video') return 'v3_image_video';
    if (v === 'v3_photo_avatar') return 'v3_photo_avatar';
    return 'legacy_av4';
  }

  /** Engine type for v3 pipelines — see HEYGEN_AVATAR_ENGINE in env.example */
  getAvatarEngineType(): HeyGenEngineType {
    const v = (this.configService.get<string>('HEYGEN_AVATAR_ENGINE') || 'avatar_iv').toLowerCase();
    return v === 'avatar_v' ? 'avatar_v' : 'avatar_iv';
  }

  /** Whether v3 failures fall back to legacy_av4 (default: true). */
  isFallbackEnabled(): boolean {
    return this.configService.get<string>('HEYGEN_V3_FALLBACK_TO_LEGACY') !== 'false';
  }

  private logV3Failure(projectId: string | undefined, error: unknown): void {
    const err = error as { response?: { data?: unknown }; message?: string };
    const detail =
      err?.response?.data != null
        ? JSON.stringify(err.response.data)
        : err?.message || String(error);
    console.error(`[HeyGen v3] Pipeline failed, falling back to legacy: ${detail}`);
    if (projectId) {
      this.projectLog
        .logProject(projectId, 'WARN', `HeyGen v3 failed, using legacy AV4. ${detail}`, {
          op: 'heygen_video',
        })
        .catch(() => {});
    }
  }

  private async downloadImageBuffer(imageUrl: string): Promise<{ buffer: Buffer; filename: string }> {
    console.log(`[HeyGen v3] Fetching image: ${imageUrl}`);
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
    return { buffer, filename };
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
   * LEGACY: Generate avatar video using v2 POST /video/generate (talking_photo).
   * UNUSED in current flows but preserved for potential future use.
   * DO NOT REMOVE.
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
   * LEGACY: Poll video status using v1 GET /video_status.get.
   * DO NOT REMOVE — required for legacy_av4 polling.
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
   * LEGACY: Generate Avatar IV video using v2 POST /video/av4/generate.
   * DO NOT REMOVE — required for HEYGEN_AVATAR_PIPELINE=legacy_av4 and v3 fallback.
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
   * POST /v3/videos — animate image directly (type=image). Equivalent to create_video_from_image.
   * Supports engine selection for Avatar V / Avatar IV quality.
   */
  async createV3ImageVideo(params: {
    imageAssetId?: string;
    imageUrl?: string;
    title: string;
    resolution?: '4k' | '1080p' | '720p';
    aspectRatio?: '16:9' | '9:16' | '4:5' | '5:4' | '1:1' | 'auto';
    fit?: 'cover' | 'contain';
    motionPrompt?: string;
    expressiveness?: 'high' | 'medium' | 'low';
    audioAssetId?: string;
    audioUrl?: string;
    script?: string;
    voiceId?: string;
    engine?: { type: 'avatar_v' } | { type: 'avatar_iv' };
  }): Promise<string> {
    const imageAssetId = params.imageAssetId?.trim();
    const imageUrl = params.imageUrl?.trim();
    if (!imageAssetId && !imageUrl) {
      throw new Error('HeyGen v3 image video requires imageAssetId or imageUrl');
    }

    const audioAssetId = params.audioAssetId?.trim();
    const audioUrl = params.audioUrl?.trim();
    const useAudio = !!(audioAssetId || audioUrl);

    const body: Record<string, unknown> = {
      type: 'image',
      image: imageAssetId
        ? { type: 'asset_id', asset_id: imageAssetId }
        : { type: 'url', url: imageUrl },
      title: params.title,
      resolution: params.resolution || '1080p',
      aspect_ratio: params.aspectRatio || '9:16',
    };
    if (params.fit) body.fit = params.fit;
    if (params.motionPrompt) body.motion_prompt = params.motionPrompt;
    if (params.engine?.type !== 'avatar_v' && params.expressiveness) {
      body.expressiveness = params.expressiveness;
    }
    if (params.engine) body.engine = params.engine;

    if (useAudio) {
      if (audioAssetId) body.audio_asset_id = audioAssetId;
      else if (audioUrl) body.audio_url = audioUrl;
    } else {
      const script = (params.script || '').trim();
      const voiceId = (params.voiceId || '').trim();
      if (!script || !voiceId) {
        throw new Error('HeyGen v3 TTS mode requires non-empty script and voice_id');
      }
      body.script = script;
      body.voice_id = voiceId;
    }

    return this.postV3VideoJob(body, 'image');
  }

  /**
   * POST /v3/videos — Photo Avatar: either uploaded audio (`audio_asset_id` / `audio_url`, no script/voice_id)
   * or TTS (`script` + `voice_id`). HeyGen treats these as mutually exclusive.
   */
  async createV3AvatarVideo(params: {
    avatarId: string;
    title: string;
    resolution?: '4k' | '1080p' | '720p';
    aspectRatio?: '16:9' | '9:16';
    motionPrompt?: string;
    expressiveness?: 'high' | 'medium' | 'low';
    /** Lip-sync from HeyGen-uploaded stitched audio — omit script and voice_id. */
    audioAssetId?: string;
    audioUrl?: string;
    script?: string;
    voiceId?: string;
    engine?: { type: 'avatar_v' } | { type: 'avatar_iv' };
  }): Promise<string> {
    const audioAssetId = params.audioAssetId?.trim();
    const audioUrl = params.audioUrl?.trim();
    const useAudio = !!(audioAssetId || audioUrl);

    const body: Record<string, unknown> = {
      type: 'avatar',
      avatar_id: params.avatarId,
      title: params.title,
      resolution: params.resolution || '1080p',
      aspect_ratio: params.aspectRatio || '9:16',
    };
    if (params.motionPrompt) body.motion_prompt = params.motionPrompt;
    if (params.engine?.type !== 'avatar_v' && params.expressiveness) {
      body.expressiveness = params.expressiveness;
    }
    if (params.engine) body.engine = params.engine;

    if (useAudio) {
      if (audioAssetId) body.audio_asset_id = audioAssetId;
      else if (audioUrl) body.audio_url = audioUrl;
    } else {
      const script = (params.script || '').trim();
      const voiceId = (params.voiceId || '').trim();
      if (!script || !voiceId) {
        throw new Error('HeyGen v3 TTS mode requires non-empty script and voice_id');
      }
      body.script = script;
      body.voice_id = voiceId;
    }

    return this.postV3VideoJob(body, 'avatar');
  }

  private async postV3VideoJob(body: Record<string, unknown>, kind: 'image' | 'avatar'): Promise<string> {
    try {
      const res = await this.axiosV3.post<any>('/v3/videos', body);
      const d = res.data?.data ?? res.data;
      const videoId = d?.video_id ?? d?.id;
      if (!videoId) {
        console.error(`[HeyGen v3] /v3/videos (${kind}) response:`, JSON.stringify(res.data));
        throw new Error('Failed to get video_id from HeyGen v3 /v3/videos');
      }
      console.log(`[HeyGen v3] Video job created (${kind}): ${videoId}`);
      return String(videoId);
    } catch (err: any) {
      const status = err?.response?.status;
      const errBody = err?.response?.data;
      console.error(
        `[HeyGen v3] POST /v3/videos (${kind}) failed`,
        status != null ? `HTTP ${status}` : '',
        errBody != null ? JSON.stringify(errBody) : err?.message || err,
      );
      throw err;
    }
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

  private buildV3VideoAudioParams(
    request: HeyGenAvatarIVRequest,
    ctx: HeyGenV3Context,
  ): { audioAssetId?: string; audioUrl?: string; script?: string; voiceId?: string } {
    const uploadedAudioId = (request.audio_asset_id || ctx.audioAssetId || '').trim();
    const uploadedAudioUrl = (request.audio_url || '').trim();
    if (uploadedAudioId) return { audioAssetId: uploadedAudioId };
    if (uploadedAudioUrl) return { audioUrl: uploadedAudioUrl };
    return {
      script: (ctx.fullScriptText || ' ').trim() || '.',
      voiceId: ctx.voiceId.trim(),
    };
  }

  /**
   * v3 image pipeline: image_key → v3 asset → POST /v3/videos type=image.
   * Now supports engine selection (avatar_v / avatar_iv).
   */
  private async startV3ImageVideoPipeline(
    request: HeyGenAvatarIVRequest,
    ctx: HeyGenV3Context,
    engine: HeyGenEngineType,
  ): Promise<HeyGenVideoUnifiedResult> {
    let imageAssetId = ctx.cachedV3ImageAssetId?.trim();
    if (!imageAssetId) {
      const imageUrl = this.buildImageUrlFromImageKey(request.image_key);
      const { buffer, filename } = await this.downloadImageBuffer(imageUrl);
      imageAssetId = await this.uploadV3AssetFromBuffer(buffer, filename);
    }

    const audioParams = this.buildV3VideoAudioParams(request, ctx);
    const modeTag = audioParams.audioAssetId
      ? 'v3_audio_asset'
      : audioParams.audioUrl
        ? 'v3_audio_url'
        : 'v3_tts';
    console.log(`[HeyGen v3] image video mode: ${modeTag}, engine=${engine}`);

    const videoId = await this.createV3ImageVideo({
      imageAssetId,
      title: request.video_title || `Video ${ctx.projectId}`,
      resolution: '1080p',
      aspectRatio: request.video_orientation === 'landscape' ? '16:9' : '9:16',
      fit: request.fit || 'cover',
      motionPrompt: request.custom_motion_prompt,
      engine: { type: engine },
      ...(engine !== 'avatar_v' ? { expressiveness: 'medium' as const } : {}),
      ...audioParams,
    });

    return {
      video_id: videoId,
      useV3Polling: true,
      pipeline: 'v3_image_video',
      engine,
    };
  }

  /**
   * v3 Photo Avatar pipeline: image_key → v3 assets → v3 avatars → v3/videos type=avatar.
   */
  private async startV3PhotoAvatarPipeline(
    request: HeyGenAvatarIVRequest,
    ctx: HeyGenV3Context,
    engine: HeyGenEngineType,
  ): Promise<HeyGenVideoUnifiedResult> {
    let avatarId = ctx.cachedV3AvatarId?.trim();
    if (!avatarId) {
      const imageUrl = this.buildImageUrlFromImageKey(request.image_key);
      const { buffer, filename } = await this.downloadImageBuffer(imageUrl);
      const assetId = await this.uploadV3AssetFromBuffer(buffer, filename);
      avatarId = await this.createV3PhotoAvatar(assetId, `Project ${ctx.projectId} ${Date.now()}`);
    }

    const audioParams = this.buildV3VideoAudioParams(request, ctx);
    const modeTag = audioParams.audioAssetId
      ? 'v3_audio_asset'
      : audioParams.audioUrl
        ? 'v3_audio_url'
        : 'v3_tts';
    console.log(`[HeyGen v3] photo avatar video mode: ${modeTag}, engine=${engine}`);

    const videoId = await this.createV3AvatarVideo({
      avatarId,
      title: request.video_title || `Video ${ctx.projectId}`,
      resolution: '1080p',
      aspectRatio: request.video_orientation === 'landscape' ? '16:9' : '9:16',
      motionPrompt: request.custom_motion_prompt,
      engine: { type: engine },
      ...(engine !== 'avatar_v' ? { expressiveness: 'medium' as const } : {}),
      ...audioParams,
    });

    return {
      video_id: videoId,
      useV3Polling: true,
      pipeline: 'v3_photo_avatar',
      engine,
    };
  }

  private canUseV3Pipeline(
    pipeline: HeyGenPipelineMode,
    v3Context: HeyGenV3Context | undefined,
    request: HeyGenAvatarIVRequest,
  ): boolean {
    if (pipeline === 'legacy_av4' || !v3Context) return false;
    const uploadedAudioId = (request.audio_asset_id || v3Context.audioAssetId || '').trim();
    const uploadedAudioUrl = (request.audio_url || '').trim();
    const hasAudioAsset = !!(uploadedAudioId || uploadedAudioUrl);
    const hasScript = !!v3Context.fullScriptText?.trim()?.length;
    const hasTtsVoice = !!v3Context.voiceId?.trim()?.length;
    return hasAudioAsset || (hasScript && hasTtsVoice);
  }

  /**
   * Unified dispatcher: legacy_av4 | v3_image_video | v3_photo_avatar with optional fallback.
   */
  async generateAvatarVideoUnified(
    request: HeyGenAvatarIVRequest,
    v3Context?: HeyGenV3Context,
  ): Promise<HeyGenVideoUnifiedResult> {
    const pipeline = this.getAvatarPipelineMode();
    const engine = this.getAvatarEngineType();
    const fallbackEnabled = this.isFallbackEnabled();

    console.log(
      `[HeyGen] Video generation: pipeline=${pipeline}, engine=${engine}, project=${v3Context?.projectId ?? 'n/a'}`,
    );

    if (pipeline === 'legacy_av4') {
      const legacy = await this.generateAvatarIVVideo(request);
      return { video_id: legacy.video_id, useV3Polling: false, pipeline: 'legacy_av4' };
    }

    if (!this.canUseV3Pipeline(pipeline, v3Context, request)) {
      console.warn(
        `[HeyGen] HEYGEN_AVATAR_PIPELINE=${pipeline} but missing v3Context or audio/TTS inputs; using legacy_av4`,
      );
      const legacy = await this.generateAvatarIVVideo(request);
      return { video_id: legacy.video_id, useV3Polling: false, pipeline: 'legacy_av4' };
    }

    try {
      if (pipeline === 'v3_image_video') {
        return await this.startV3ImageVideoPipeline(request, v3Context!, engine);
      }
      return await this.startV3PhotoAvatarPipeline(request, v3Context!, engine);
    } catch (e) {
      if (fallbackEnabled) {
        this.logV3Failure(v3Context?.projectId, e);
        const legacy = await this.generateAvatarIVVideo(request);
        return { video_id: legacy.video_id, useV3Polling: false, pipeline: 'legacy_av4' };
      }
      throw e;
    }
  }

  /**
   * @deprecated Use generateAvatarVideoUnified
   */
  async generateAvatarIVVideoUnified(
    request: HeyGenAvatarIVRequest,
    v3Context?: HeyGenV3Context,
  ): Promise<HeyGenAvatarIVUnifiedStart> {
    const result = await this.generateAvatarVideoUnified(request, v3Context);
    return { video_id: result.video_id, useV3Polling: result.useV3Polling };
  }

  async pollAvatarVideoUntilCompleteUnified(
    start: HeyGenVideoUnifiedResult | HeyGenAvatarIVUnifiedStart,
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

  private cachedTranslationLanguages: string[] | null = null;
  private cachedTranslationLanguagesAt = 0;
  private readonly translationLanguagesCacheMs = 60 * 60 * 1000;

  /**
   * List supported HeyGen video translation target languages (v3).
   */
  async listVideoTranslationLanguages(forceRefresh = false): Promise<string[]> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedTranslationLanguages &&
      now - this.cachedTranslationLanguagesAt < this.translationLanguagesCacheMs
    ) {
      return this.cachedTranslationLanguages;
    }

    try {
      const response = await this.axiosV3.get('/v3/video-translations/languages');
      const data = response.data?.data ?? response.data;
      const languages: string[] =
        data?.languages ??
        data?.output_languages ??
        (Array.isArray(data) ? data : []);
      if (!Array.isArray(languages) || languages.length === 0) {
        throw new Error('Empty language list from HeyGen');
      }
      this.cachedTranslationLanguages = languages.map(String);
      this.cachedTranslationLanguagesAt = now;
      return this.cachedTranslationLanguages;
    } catch (error: any) {
      console.error('[HeyGen] listVideoTranslationLanguages error:', error.response?.data || error.message);
      if (this.cachedTranslationLanguages?.length) {
        return this.cachedTranslationLanguages;
      }
      throw new Error(
        `Failed to list HeyGen translation languages: ${
          error.response?.data?.error?.message || error.message
        }`,
      );
    }
  }

  /**
   * Create a HeyGen v3 video translation job (single target language).
   */
  async createVideoTranslation(
    request: HeyGenVideoTranslationRequest,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      video: { type: 'url', url: request.videoUrl },
      output_languages: [request.outputLanguage],
      mode: request.mode ?? 'precision',
      translate_audio_only: request.translateAudioOnly ?? false,
      disable_music_track: request.disableMusicTrack ?? true,
      enable_dynamic_duration: true,
    };
    if (request.title) body.title = request.title;
    if (request.inputLanguage) body.input_language = request.inputLanguage;
    if (request.speakerNum != null) body.speaker_num = request.speakerNum;

    try {
      const response = await this.axiosV3.post('/v3/video-translations', body);
      const data = response.data?.data ?? response.data;
      const ids: string[] =
        data?.video_translation_ids ??
        (data?.video_translation_id ? [data.video_translation_id] : []);
      const id = ids[0] || data?.id;
      if (!id) {
        console.error('[HeyGen] createVideoTranslation response:', JSON.stringify(response.data));
        throw new Error('HeyGen did not return video_translation_id');
      }
      console.log(`[HeyGen] Video translation created: ${id} -> ${request.outputLanguage}`);
      return String(id);
    } catch (error: any) {
      console.error('[HeyGen] createVideoTranslation error:', error.response?.data || error.message);
      throw new Error(
        `Failed to create HeyGen video translation: ${
          error.response?.data?.error?.message || error.message
        }`,
      );
    }
  }

  /**
   * Poll HeyGen v3 video translation status.
   */
  async getVideoTranslationStatus(translationId: string): Promise<HeyGenVideoTranslationStatus> {
    try {
      const response = await this.axiosV3.get(`/v3/video-translations/${translationId}`);
      const data = response.data?.data ?? response.data;
      const status = String(data?.status ?? data?.state ?? 'unknown').toLowerCase();
      const videoUrl =
        data?.video_url ??
        data?.url ??
        data?.output?.video_url ??
        data?.translated_video_url;
      const error =
        data?.error?.message ??
        data?.error_message ??
        (typeof data?.error === 'string' ? data.error : undefined);
      return {
        id: translationId,
        status,
        videoUrl: videoUrl ? String(videoUrl) : undefined,
        error: error ? String(error) : undefined,
        captionUrl: data?.caption_url ? String(data.caption_url) : undefined,
      };
    } catch (error: any) {
      console.error('[HeyGen] getVideoTranslationStatus error:', error.response?.data || error.message);
      throw new Error(
        `Failed to get HeyGen translation status: ${
          error.response?.data?.error?.message || error.message
        }`,
      );
    }
  }

  /**
   * Poll until translation completes or fails.
   */
  async pollVideoTranslationUntilComplete(
    translationId: string,
    maxAttempts = 120,
    intervalMs = 5000,
  ): Promise<HeyGenVideoTranslationStatus> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const status = await this.getVideoTranslationStatus(translationId);
      if (['completed', 'success', 'done'].includes(status.status) && status.videoUrl) {
        return status;
      }
      if (['failed', 'error'].includes(status.status)) {
        throw new Error(status.error || `HeyGen translation failed (${status.status})`);
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    throw new Error(`HeyGen translation timed out after ${maxAttempts} attempts`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HeyGen Audio Search (Background Music & Sound Effects)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Search HeyGen's audio catalog using semantic/natural language search.
   * Returns tracks ranked by similarity, each with a pre-signed download URL.
   * 
   * @param query Natural language description (e.g., "upbeat corporate background music")
   * @param options Search options (type, limit, minScore, token for pagination)
   * @returns Array of audio tracks with pre-signed download URLs
   */
  async searchAudioSounds(
    query: string,
    options: HeyGenAudioSearchOptions = {},
  ): Promise<HeyGenAudioSearchResponse> {
    const {
      type = 'music',
      limit = 10,
      minScore = 0.7,
      token,
    } = options;

    try {
      const params: Record<string, string | number> = {
        query,
        type,
        limit,
        min_score: minScore,
      };
      if (token) {
        params.token = token;
      }

      console.log(`[HeyGen] Searching audio catalog: query="${query}", type=${type}, limit=${limit}`);

      const response = await this.axiosV3.get('/v3/audio/sounds', { params });
      const data = response.data?.data ?? response.data;

      const tracks: HeyGenAudioTrack[] = Array.isArray(data) 
        ? data 
        : (data?.data ?? []);

      const result: HeyGenAudioSearchResponse = {
        tracks,
        hasMore: response.data?.has_more ?? false,
        nextToken: response.data?.next_token,
      };

      console.log(`[HeyGen] Audio search returned ${tracks.length} tracks (hasMore=${result.hasMore})`);
      return result;
    } catch (error: any) {
      console.error('[HeyGen] searchAudioSounds error:', error.response?.data || error.message);
      throw new Error(
        `Failed to search HeyGen audio: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  /**
   * Search for background music by description.
   * Convenience wrapper for searchAudioSounds with type='music'.
   */
  async searchBackgroundMusic(
    query: string,
    limit = 10,
    minScore = 0.7,
  ): Promise<HeyGenAudioTrack[]> {
    const result = await this.searchAudioSounds(query, { type: 'music', limit, minScore });
    return result.tracks;
  }

  /**
   * Search for sound effects by description.
   * Convenience wrapper for searchAudioSounds with type='sound_effects'.
   */
  async searchSoundEffects(
    query: string,
    limit = 10,
    minScore = 0.7,
  ): Promise<HeyGenAudioTrack[]> {
    const result = await this.searchAudioSounds(query, { type: 'sound_effects', limit, minScore });
    return result.tracks;
  }

  /**
   * Get a fresh pre-signed URL for a specific audio track by re-searching.
   * HeyGen audio URLs are pre-signed S3 URLs with limited lifetime,
   * so we need to re-search to get a fresh URL at download time.
   * 
   * @param searchQuery The original search query used to find this track
   * @param trackId Optional: specific track ID to match (for verification)
   * @returns Fresh audio track with new pre-signed URL, or null if not found
   */
  async refreshAudioTrackUrl(
    searchQuery: string,
    trackId?: string,
  ): Promise<HeyGenAudioTrack | null> {
    try {
      const result = await this.searchAudioSounds(searchQuery, { type: 'music', limit: 10 });
      
      if (trackId) {
        const matchingTrack = result.tracks.find(t => t.id === trackId);
        if (matchingTrack) {
          console.log(`[HeyGen] Refreshed URL for track ${trackId}`);
          return matchingTrack;
        }
        console.warn(`[HeyGen] Track ${trackId} not found in search results, returning best match`);
      }
      
      return result.tracks[0] || null;
    } catch (error: any) {
      console.error('[HeyGen] refreshAudioTrackUrl error:', error.message);
      return null;
    }
  }

  /**
   * Download audio from HeyGen's pre-signed URL to a local file.
   * 
   * @param audioUrl Pre-signed S3 URL from HeyGen audio search
   * @param destPath Local file path to save the audio
   * @returns True if download succeeded
   */
  async downloadAudioToFile(audioUrl: string, destPath: string): Promise<boolean> {
    try {
      console.log(`[HeyGen] Downloading audio to ${destPath}`);
      
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const response = await axios.get(audioUrl, {
        responseType: 'arraybuffer',
        maxContentLength: 100 * 1024 * 1024, // 100MB max
        timeout: 120000, // 2 minutes
      });

      fs.writeFileSync(destPath, Buffer.from(response.data));
      console.log(`[HeyGen] Audio downloaded successfully (${response.data.length} bytes)`);
      return true;
    } catch (error: any) {
      console.error('[HeyGen] downloadAudioToFile error:', error.message);
      return false;
    }
  }
}
