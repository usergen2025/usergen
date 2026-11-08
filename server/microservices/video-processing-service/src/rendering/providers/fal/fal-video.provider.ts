import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  IVideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoProviderCapabilities,
  VideoModelInfo,
  ValidationResult,
} from '../interfaces/video-generation.interface';
import { FalProviderError, FalErrorType } from './fal-errors';
import { preWarmUrl, withRetry } from '@shared/storage';

/**
 * FAL Video API Response Types
 */
interface FalVideoSubmitResponse {
  request_id: string;
}

interface FalVideoStatusResponse {
  status: string;
  [key: string]: any;
}

interface FalVideoFile {
  file_name: string;
  content_type: string;
  url: string;
}

interface FalVideoResultResponse {
  video: FalVideoFile;
  error?: {
    message: string;
    type?: string;
  };
}

/**
 * Model family configuration for payload/URL differences across fal video endpoints.
 */
interface FalVideoModelAdapter {
  imageKey: string;           // payload key for the source image
  durationFormat: 'enum' | 'integer'; // Veo uses '4s'/'6s'/'8s'; Wan uses integer
  audioKey: string;           // 'generate_audio' (Veo) or 'audio' (Wan)
  audioDefault: boolean;      // default value for the audio toggle
  urlPrefix: string;          // '/fal-ai' or '' for namespaced
  minDuration: number;
  maxDuration: number;
}

const MODEL_ADAPTERS: Record<string, FalVideoModelAdapter> = {
  veo: {
    imageKey: 'image_url',
    durationFormat: 'enum',
    audioKey: 'generate_audio',
    audioDefault: true,
    urlPrefix: '/fal-ai',
    minDuration: 4,
    maxDuration: 8,
  },
  wan: {
    imageKey: 'start_image_url',
    durationFormat: 'integer',
    audioKey: 'audio',
    audioDefault: false,
    urlPrefix: '',
    minDuration: 2,
    maxDuration: 30,
  },
};

function getAdapterForModel(modelPath: string): FalVideoModelAdapter {
  if (modelPath.startsWith('alibaba/')) return MODEL_ADAPTERS.wan;
  return MODEL_ADAPTERS.veo;
}

/**
 * FAL Video Provider Implementation
 * Handles async video generation via FAL API.
 * Supports multiple model families (Veo, Wan 3.0) through adapter pattern.
 */
@Injectable()
export class FalVideoProvider implements IVideoGenerationProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string = 'https://queue.fal.run';
  private axiosInstance: AxiosInstance;
  private readonly maxPollAttempts: number = 120;
  private readonly pollIntervalMs: number = 5000;
  private readonly maxDuration: number = 600000;
  private readonly defaultModelPath: string = 'veo3.1/image-to-video';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = 
      this.configService.get<string>('FAL_KEY') || 
      process.env.FAL_KEY || 
      '';

    if (!this.apiKey) {
      throw new Error('FAL_KEY is required but not configured. Please set FAL_KEY in .env file.');
    }

    this.apiKey = this.apiKey.trim();

    const maskedKey = this.apiKey.length > 10 
      ? `${this.apiKey.substring(0, 10)}...${this.apiKey.substring(this.apiKey.length - 4)}`
      : '***';
    console.log(`[FalVideoProvider] Initialized with FAL_KEY: ${maskedKey} (length: ${this.apiKey.length})`);

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });

    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        throw this.handleAxiosError(error);
      }
    );
  }

  /**
   * Handle Axios errors and convert to FalProviderError
   */
  private handleAxiosError(error: AxiosError): FalProviderError {
    if (error.response) {
      const statusCode = error.response.status;
      const data = error.response.data as any;

      if (statusCode === 403 || statusCode === 405) {
        console.error(`[FalVideoProvider] ${statusCode} Error Details:`, {
          status: statusCode,
          url: error.config?.url,
          method: error.config?.method,
          headers: {
            'authorization': error.config?.headers?.['Authorization'] ? 'Key ***' : 'missing',
            'content-type': error.config?.headers?.['Content-Type'],
          },
          responseData: data,
        });
      }

      // Handle string detail for balance exhaustion
      if (data?.detail && typeof data.detail === 'string') {
        if (data.detail.includes('Exhausted balance')) {
          return new FalProviderError(
            FalErrorType.INSUFFICIENT_BALANCE,
            statusCode,
            false,
            [{ loc: ['body'], msg: data.detail, type: FalErrorType.INSUFFICIENT_BALANCE, url: 'https://docs.fal.ai/errors' }]
          );
        }
      }

      // Handle structured error response
      if (data?.detail && Array.isArray(data.detail)) {
        const errors = data.detail.map((err: any) => ({
          loc: err.loc || ['body'],
          msg: err.msg || 'Unknown error',
          type: err.type || 'unknown_error',
          url: err.url || 'https://docs.fal.ai/errors',
        }));

        const primaryError = errors[0];
        const errorType = primaryError.type as FalErrorType;

        return new FalProviderError(
          errorType,
          statusCode,
          statusCode >= 500 || statusCode === 429, // Retryable for server errors and rate limits
          errors
        );
      }

      // Fallback for unstructured errors
      return new FalProviderError(
        FalErrorType.INTERNAL_SERVER_ERROR,
        statusCode,
        statusCode >= 500,
        [{ loc: ['body'], msg: data?.message || data?.error || 'Unknown error', type: FalErrorType.INTERNAL_SERVER_ERROR, url: 'https://docs.fal.ai/errors' }]
      );
    }

    // Network or timeout error
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return new FalProviderError(
        FalErrorType.GENERATION_TIMEOUT,
        504,
        true,
        [{ loc: ['body'], msg: 'Request timeout', type: FalErrorType.GENERATION_TIMEOUT, url: 'https://docs.fal.ai/errors' }]
      );
    }

    return new FalProviderError(
      FalErrorType.INTERNAL_SERVER_ERROR,
      500,
      true,
      [{ loc: ['body'], msg: error.message || 'Network error', type: FalErrorType.INTERNAL_SERVER_ERROR, url: 'https://docs.fal.ai/errors' }]
    );
  }

  /**
   * Resolve the model path from a registry id like "alibaba/wan-3.0/image-to-video"
   * or raw fal path like "veo3.1/image-to-video". Strips the "fal-ai/" prefix if present.
   */
  private resolveModelPath(modelId?: string): string {
    if (!modelId) return this.defaultModelPath;
    return modelId.replace(/^fal-ai\//, '');
  }

  /**
   * Extract base model name for queue status/result URLs.
   * Namespaced models keep full path; legacy uses first segment.
   */
  private extractBaseModelName(modelPath: string): string {
    const ns = modelPath.split('/')[0];
    if (ns === 'alibaba' || ns === 'google') return modelPath;
    return ns;
  }

  /**
   * Map duration to Veo FAL enum values.
   */
  private mapDurationToFalEnum(duration: number): '4s' | '6s' | '8s' {
    if (duration <= 4) return '4s';
    if (duration <= 6) return '6s';
    return '8s';
  }

  /**
   * Clamp duration for Wan (integer 2–30).
   */
  private clampWanDuration(duration: number): number {
    return Math.min(30, Math.max(2, Math.ceil(duration)));
  }

  /**
   * Submit video generation request
   */
  private async submitRequest(modelPath: string, payload: any): Promise<FalVideoSubmitResponse> {
    try {
      const adapter = getAdapterForModel(modelPath);
      const url = adapter.urlPrefix ? `${adapter.urlPrefix}/${modelPath}` : `/${modelPath}`;
      console.log(`[FalVideoProvider] Submitting request to model: ${modelPath}`);
      console.log(`[FalVideoProvider] Request URL: ${this.baseUrl}${url}`);
      console.log(`[FalVideoProvider] Request payload:`, JSON.stringify(payload, null, 2));

      const response = await this.axiosInstance.post<FalVideoSubmitResponse>(url, payload);
      return response.data;
    } catch (error: any) {
      if (error instanceof FalProviderError) {
        throw error;
      }
      throw this.handleAxiosError(error as AxiosError);
    }
  }

  /**
   * Check request status
   */
  private async checkRequestStatus(modelPath: string, requestId: string): Promise<FalVideoStatusResponse> {
    try {
      const adapter = getAdapterForModel(modelPath);
      const baseModel = this.extractBaseModelName(modelPath);
      const prefix = adapter.urlPrefix || '';
      const response = await this.axiosInstance.get<FalVideoStatusResponse>(
        `${prefix}/${baseModel}/requests/${requestId}/status`
      );
      return response.data;
    } catch (error: any) {
      if (error instanceof FalProviderError) {
        throw error;
      }
      throw this.handleAxiosError(error as AxiosError);
    }
  }

  /**
   * Fetch request result
   */
  private async fetchRequestResult(modelPath: string, requestId: string): Promise<FalVideoResultResponse> {
    try {
      const adapter = getAdapterForModel(modelPath);
      const baseModel = this.extractBaseModelName(modelPath);
      const prefix = adapter.urlPrefix || '';
      const response = await this.axiosInstance.get<FalVideoResultResponse>(
        `${prefix}/${baseModel}/requests/${requestId}`
      );
      return response.data;
    } catch (error: any) {
      if (error instanceof FalProviderError) {
        throw error;
      }
      throw this.handleAxiosError(error as AxiosError);
    }
  }

  /**
   * Poll for completion
   */
  private async pollUntilComplete(
    modelPath: string,
    requestId: string,
    onProgress?: (progress: number) => void
  ): Promise<FalVideoResultResponse> {
    const startTime = Date.now();
    let attempt = 0;

    while (attempt < this.maxPollAttempts) {
      if (Date.now() - startTime > this.maxDuration) {
        throw new FalProviderError(
          FalErrorType.GENERATION_TIMEOUT,
          504,
          false,
          [{ loc: ['body'], msg: 'Video generation exceeded maximum duration', type: FalErrorType.GENERATION_TIMEOUT, url: 'https://docs.fal.ai/errors' }]
        );
      }

      const statusResponse = await this.checkRequestStatus(modelPath, requestId);
      const status = statusResponse.status?.toLowerCase();

      console.log(`[FalVideoProvider] Poll attempt ${attempt + 1}/${this.maxPollAttempts}, Status: ${status}`);

      if (status === 'completed') {
        const result = await this.fetchRequestResult(modelPath, requestId);
        if (onProgress) onProgress(100);
        return result;
      }

      if (status === 'failed' || status === 'error') {
        const result = await this.fetchRequestResult(modelPath, requestId);
        if (result.error) {
          throw new FalProviderError(
            FalErrorType.INTERNAL_SERVER_ERROR,
            500,
            false,
            [{ loc: ['body'], msg: result.error.message || 'Video generation failed', type: result.error.type || FalErrorType.INTERNAL_SERVER_ERROR, url: 'https://docs.fal.ai/errors' }]
          );
        }
        throw new Error('Video generation failed');
      }

      if (onProgress) {
        const estimatedProgress = Math.min(90, (attempt / this.maxPollAttempts) * 90);
        onProgress(estimatedProgress);
      }

      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      attempt++;
    }

    throw new FalProviderError(
      FalErrorType.GENERATION_TIMEOUT,
      504,
      false,
      [{ loc: ['body'], msg: 'Video generation exceeded maximum polling attempts', type: FalErrorType.GENERATION_TIMEOUT, url: 'https://docs.fal.ai/errors' }]
    );
  }

  /**
   * Generate video using unified interface
   */
  async generateVideo(
    request: VideoGenerationRequest,
    onProgress?: (progress: number) => void
  ): Promise<VideoGenerationResponse> {
    const modelPath = this.resolveModelPath(request.modelId);
    const adapter = getAdapterForModel(modelPath);

    // Validate request
    const validation = this.validateRequest(request);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Build duration based on adapter format
    let durationValue: string | number;
    if (adapter.durationFormat === 'enum') {
      durationValue = request.duration ? this.mapDurationToFalEnum(request.duration) : '8s';
    } else {
      durationValue = request.duration ? this.clampWanDuration(request.duration) : 5;
    }

    // Map aspect ratio
    const aspectRatio = request.aspectRatio || '9:16';
    const supportedRatios = adapter === MODEL_ADAPTERS.wan
      ? ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']
      : ['16:9', '9:16'];
    const falAspectRatio = supportedRatios.includes(aspectRatio) ? aspectRatio : '9:16';

    // Build payload using adapter keys
    const audioValue = request.generateAudio !== undefined ? request.generateAudio : adapter.audioDefault;
    const payload: any = {
      prompt: request.prompt,
      [adapter.imageKey]: request.imageUrl,
      aspect_ratio: falAspectRatio,
      duration: durationValue,
      [adapter.audioKey]: audioValue,
    };

    // Add resolution if provided
    if (request.resolution) {
      payload.resolution = request.resolution;
    }

    // Wan-specific: disable prompt expansion to save latency when we supply a specific scene prompt
    if (adapter === MODEL_ADAPTERS.wan) {
      payload.enable_prompt_expansion = false;
    }

    // Add additional params
    if (request.additionalParams) {
      Object.assign(payload, request.additionalParams);
    }

    console.log(`[FalVideoProvider] Generating video (model: ${modelPath}) with payload:`, JSON.stringify(payload, null, 2));

    // Pre-warm the source image URL
    if (request.imageUrl) {
      console.log(`[FalVideoProvider] Pre-warming source image URL...`);
      if (onProgress) onProgress(2);
      const warmed = await preWarmUrl(request.imageUrl, 3);
      if (!warmed) {
        console.warn(`[FalVideoProvider] ⚠️ Image URL pre-warming failed, proceeding anyway...`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (onProgress) onProgress(5);

    // Submit request with retry logic
    const submitResponse = await withRetry(
      async () => this.submitRequest(modelPath, payload),
      3,
      (attempt, error) => {
        console.log(`[FalVideoProvider] Submit retry ${attempt}/3 after error: ${error.message}`);
      }
    );
    const requestId = submitResponse.request_id;

    console.log(`[FalVideoProvider] Request submitted, request_id: ${requestId}`);

    if (onProgress) onProgress(10);

    // Poll until completion
    const result = await withRetry(
      async () => this.pollUntilComplete(modelPath, requestId, onProgress),
      2,
      (attempt, error) => {
        console.log(`[FalVideoProvider] Poll retry ${attempt}/2 after error: ${error.message}`);
      }
    );

    if (!result.video || !result.video.url) {
      throw new Error('Video generation completed but no video URL');
    }

    console.log(`[FalVideoProvider] Video generated successfully: ${result.video.url}`);

    return {
      videoUrl: result.video.url,
      model: modelPath,
      metadata: {
        requestId,
        generationTime: Date.now(),
      },
    };
  }

  /**
   * Get provider capabilities (returns Wan defaults since that's now primary)
   */
  getCapabilities(): VideoProviderCapabilities {
    return {
      supportsAspectRatio: true,
      supportsResolution: true,
      supportsDuration: true,
      supportedAspectRatios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'],
      supportedResolutions: ['480p', '720p', '1080p'],
      minDuration: 2,
      maxDuration: 30,
      isAsync: true,
      estimatedTimeSeconds: 90,
    };
  }

  /**
   * Get supported models
   */
  async getSupportedModels(): Promise<VideoModelInfo[]> {
    return [];
  }

  /**
   * Validate request (model-aware duration limits)
   */
  validateRequest(request: VideoGenerationRequest): ValidationResult {
    if (!request.prompt || request.prompt.trim().length === 0) {
      return { valid: false, error: 'Prompt is required' };
    }

    if (!request.imageUrl || request.imageUrl.trim().length === 0) {
      return { valid: false, error: 'Image URL is required' };
    }

    const modelPath = this.resolveModelPath(request.modelId);
    const adapter = getAdapterForModel(modelPath);

    if (request.duration && (request.duration < adapter.minDuration || request.duration > adapter.maxDuration)) {
      return { valid: false, error: `Duration must be between ${adapter.minDuration} and ${adapter.maxDuration} seconds for ${modelPath}` };
    }

    return { valid: true };
  }
}

