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
 * FAL Video Provider Implementation
 * Handles async video generation via FAL API (veo3.1/image-to-video)
 * Documentation: https://docs.fal.ai/model-apis/errors
 */
@Injectable()
export class FalVideoProvider implements IVideoGenerationProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string = 'https://queue.fal.run';
  private axiosInstance: AxiosInstance;
  private readonly maxPollAttempts: number = 120; // 10 minutes max (120 * 5s) - videos take longer
  private readonly pollIntervalMs: number = 5000; // 5 seconds
  private readonly maxDuration: number = 600000; // 10 minutes in milliseconds
  private readonly modelPath: string = 'veo3.1/image-to-video'; // Note: 'fal-ai/' prefix is added in URL construction

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
   * Extract base model name from model path
   * veo3.1/image-to-video -> veo3.1
   */
  private extractBaseModelName(modelPath: string): string {
    const parts = modelPath.split('/');
    return parts[0];
  }

  /**
   * Map duration to FAL enum values
   * Round up to nearest supported value, cap at 8s
   */
  private mapDurationToFalEnum(duration: number): '4s' | '6s' | '8s' {
    if (duration <= 4) return '4s';
    if (duration <= 6) return '6s';
    return '8s'; // Cap at 8s (max supported)
  }

  /**
   * Submit video generation request
   */
  private async submitRequest(payload: any): Promise<FalVideoSubmitResponse> {
    try {
      const url = `/fal-ai/${this.modelPath}`;
      console.log(`[FalVideoProvider] Submitting request to model: ${this.modelPath}`);
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
  private async checkRequestStatus(requestId: string): Promise<FalVideoStatusResponse> {
    try {
      const baseModel = this.extractBaseModelName(this.modelPath);
      const response = await this.axiosInstance.get<FalVideoStatusResponse>(
        `/fal-ai/${baseModel}/requests/${requestId}/status`
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
  private async fetchRequestResult(requestId: string): Promise<FalVideoResultResponse> {
    try {
      const baseModel = this.extractBaseModelName(this.modelPath);
      const response = await this.axiosInstance.get<FalVideoResultResponse>(
        `/fal-ai/${baseModel}/requests/${requestId}`
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
    requestId: string,
    onProgress?: (progress: number) => void
  ): Promise<FalVideoResultResponse> {
    const startTime = Date.now();
    let attempt = 0;

    while (attempt < this.maxPollAttempts) {
      // Check timeout
      if (Date.now() - startTime > this.maxDuration) {
        throw new FalProviderError(
          FalErrorType.GENERATION_TIMEOUT,
          504,
          false,
          [{ loc: ['body'], msg: 'Video generation exceeded maximum duration', type: FalErrorType.GENERATION_TIMEOUT, url: 'https://docs.fal.ai/errors' }]
        );
      }

      const statusResponse = await this.checkRequestStatus(requestId);
      const status = statusResponse.status?.toLowerCase();

      console.log(`[FalVideoProvider] Poll attempt ${attempt + 1}/${this.maxPollAttempts}, Status: ${status}`);

      if (status === 'completed') {
        // Fetch result
        const result = await this.fetchRequestResult(requestId);
        if (onProgress) onProgress(100);
        return result;
      }

      if (status === 'failed' || status === 'error') {
        const result = await this.fetchRequestResult(requestId);
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

      // Update progress (estimate based on attempts)
      if (onProgress) {
        const estimatedProgress = Math.min(90, (attempt / this.maxPollAttempts) * 90);
        onProgress(estimatedProgress);
      }

      // Wait before next poll
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
    // Validate request
    const validation = this.validateRequest(request);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Map duration to FAL enum
    const duration = request.duration ? this.mapDurationToFalEnum(request.duration) : '8s';
    
    // Map aspect ratio (FAL supports 16:9 and 9:16)
    const aspectRatio = request.aspectRatio || '16:9';
    if (aspectRatio !== '16:9' && aspectRatio !== '9:16') {
      console.warn(`[FalVideoProvider] Aspect ratio ${aspectRatio} not supported, using 16:9`);
    }
    const falAspectRatio = (aspectRatio === '9:16') ? '9:16' : '16:9';

    // Build payload
    const payload: any = {
      prompt: request.prompt,
      image_url: request.imageUrl,
      aspect_ratio: falAspectRatio,
      duration: duration,
      generate_audio: request.generateAudio !== undefined ? request.generateAudio : true,
    };

    // Add resolution if provided
    if (request.resolution) {
      payload.resolution = request.resolution; // '720p' or '1080p'
    }

    // Add additional params
    if (request.additionalParams) {
      Object.assign(payload, request.additionalParams);
    }

    console.log(`[FalVideoProvider] Generating video with payload:`, JSON.stringify(payload, null, 2));

    if (onProgress) onProgress(5);

    // Submit request
    const submitResponse = await this.submitRequest(payload);
    const requestId = submitResponse.request_id;

    console.log(`[FalVideoProvider] Request submitted, request_id: ${requestId}`);

    if (onProgress) onProgress(10);

    // Poll until completion
    const result = await this.pollUntilComplete(requestId, onProgress);

    if (!result.video || !result.video.url) {
      throw new Error('Video generation completed but no video URL');
    }

    console.log(`[FalVideoProvider] Video generated successfully: ${result.video.url}`);

    return {
      videoUrl: result.video.url,
      model: `fal-ai/${this.modelPath}`, // Return full model ID to match model registry
      metadata: {
        requestId,
        generationTime: Date.now(),
      },
    };
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): VideoProviderCapabilities {
    return {
      supportsAspectRatio: true,
      supportsResolution: true,
      supportsDuration: true,
      supportedAspectRatios: ['16:9', '9:16'],
      supportedResolutions: ['720p', '1080p'],
      supportedDurations: ['4s', '6s', '8s'],
      minDuration: 4,
      maxDuration: 8,
      isAsync: true,
      estimatedTimeSeconds: 120, // Videos take longer than images
    };
  }

  /**
   * Get supported models
   */
  async getSupportedModels(): Promise<VideoModelInfo[]> {
    // Models are managed by ModelRegistryService
    return [];
  }

  /**
   * Validate request
   */
  validateRequest(request: VideoGenerationRequest): ValidationResult {
    if (!request.prompt || request.prompt.trim().length === 0) {
      return { valid: false, error: 'Prompt is required' };
    }

    if (!request.imageUrl || request.imageUrl.trim().length === 0) {
      return { valid: false, error: 'Image URL is required' };
    }

    if (request.duration && (request.duration < 4 || request.duration > 8)) {
      return { valid: false, error: 'Duration must be between 4 and 8 seconds for FAL veo3.1' };
    }

    return { valid: true };
  }
}

