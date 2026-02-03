import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  IImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ProviderCapabilities,
  ModelInfo,
  ValidationResult,
} from '../interfaces/image-generation.interface';
import { FalProviderError, FalErrorType } from './fal-errors';
import { preWarmUrls, withRetry, isRetryableError } from '@shared/storage';

/**
 * FAL API Response Types
 */
interface FalSubmitResponse {
  request_id: string;
}

interface FalStatusResponse {
  status: string;
  [key: string]: any;
}

interface FalImageFile {
  file_name: string;
  content_type: string;
  url: string;
}

interface FalResultResponse {
  images: FalImageFile[];
  description?: string;
  error?: {
    message: string;
    type?: string;
  };
}

/**
 * FAL Provider Implementation
 * Handles async image generation via FAL API
 * Documentation: https://docs.fal.ai/model-apis/errors
 */
@Injectable()
export class FalProvider implements IImageGenerationProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string = 'https://queue.fal.run';
  private axiosInstance: AxiosInstance;
  private readonly maxPollAttempts: number = 60; // 5 minutes max (60 * 5s)
  private readonly pollIntervalMs: number = 5000; // 5 seconds
  private readonly maxDuration: number = 300000; // 5 minutes in milliseconds

  constructor(private readonly configService: ConfigService) {
    // Try multiple ways to get the API key
    this.apiKey = 
      this.configService.get<string>('FAL_KEY') || 
      process.env.FAL_KEY || 
      '';

    if (!this.apiKey) {
      throw new Error('FAL_KEY is required but not configured. Please set FAL_KEY in .env file.');
    }

    // Trim any whitespace that might have been accidentally added
    this.apiKey = this.apiKey.trim();

    // Debug logging (masked for security)
    const maskedKey = this.apiKey.length > 10 
      ? `${this.apiKey.substring(0, 10)}...${this.apiKey.substring(this.apiKey.length - 4)}`
      : '***';
    console.log(`[FalProvider] Initialized with FAL_KEY: ${maskedKey} (length: ${this.apiKey.length})`);

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60 seconds for initial request
    });

    // Add response interceptor for error handling
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
      // Server responded with error
      const statusCode = error.response.status;
      const headers = error.response.headers;
      const data = error.response.data as any;

      // Enhanced logging for 403 and 405 errors to diagnose issues
      if (statusCode === 403) {
        console.error('[FalProvider] 403 Forbidden Error Details:', {
          status: statusCode,
          url: error.config?.url,
          method: error.config?.method,
          headers: {
            'authorization': error.config?.headers?.['Authorization'] ? 'Key ***' : 'missing',
            'content-type': error.config?.headers?.['Content-Type'],
          },
          responseHeaders: Object.keys(headers),
          responseData: data,
          fullResponse: JSON.stringify(data, null, 2),
        });
      }

      if (statusCode === 405) {
        console.error('[FalProvider] 405 Method Not Allowed Error Details:', {
          status: statusCode,
          url: error.config?.url,
          method: error.config?.method,
          expectedMethod: 'GET',
          responseData: data,
          fullResponse: JSON.stringify(data, null, 2),
          note: 'This usually means the endpoint URL structure is incorrect. Status/result endpoints use base model name, not full path.',
        });
      }

      // Check if it's a FAL error response with detail array
      if (data?.detail && Array.isArray(data.detail)) {
        const retryable = headers['x-fal-retryable'] === 'true';
        const primaryError = data.detail[0];
        const errorType = primaryError?.type || 'unknown_error';
        const context = primaryError?.ctx || {};

        return new FalProviderError(
          errorType,
          statusCode,
          retryable,
          data.detail,
          context
        );
      }

      // Check if it's a FAL error response with detail string (e.g., "User is locked. Reason: Exhausted balance.")
      if (data?.detail && typeof data.detail === 'string') {
        const retryable = headers['x-fal-retryable'] === 'true';
        const errorMessage = data.detail;
        
        // Map common FAL error messages to error types
        let errorType = 'unknown_error';
        if (errorMessage.includes('Exhausted balance') || errorMessage.includes('locked')) {
          errorType = 'insufficient_balance';
        } else if (errorMessage.includes('Invalid') || errorMessage.includes('invalid')) {
          errorType = 'invalid_request';
        } else if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
          errorType = 'authentication_error';
        }

        return new FalProviderError(
          errorType,
          statusCode,
          retryable,
          [{
            loc: ['body'],
            msg: errorMessage,
            type: errorType,
            url: 'https://docs.fal.ai/errors',
          }],
          { originalMessage: errorMessage }
        );
      }

      // Non-FAL error format
      return new FalProviderError(
        'unknown_error',
        statusCode,
        headers['x-fal-retryable'] === 'true',
        [{
          loc: ['body'],
          msg: (data?.message || data?.error || `HTTP ${statusCode} error`) as string,
          type: 'unknown_error',
          url: 'https://docs.fal.ai/errors',
        }]
      );
    } else if (error.request) {
      // Request made but no response
      return new FalProviderError(
        FalErrorType.NETWORK_ERROR,
        0,
        true, // Network errors are usually retryable
        [{
          loc: ['body'],
          msg: 'Network error: No response from FAL API',
          type: FalErrorType.NETWORK_ERROR,
          url: 'https://docs.fal.ai/errors',
        }]
      );
    } else {
      // Request setup error
      return new FalProviderError(
        FalErrorType.UNEXPECTED_ERROR,
        0,
        false,
        [{
          loc: ['body'],
          msg: `FAL API request setup error: ${error.message}`,
          type: FalErrorType.UNEXPECTED_ERROR,
          url: 'https://docs.fal.ai/errors',
        }]
      );
    }
  }

  /**
   * Submit request to FAL API
   */
  private async submitRequest(
    modelPath: string,
    payload: any,
    hasReferenceImages: boolean = false
  ): Promise<FalSubmitResponse> {
    try {
      // Use new endpoint builder
      const url = this.buildEndpointUrl(modelPath, hasReferenceImages);
      
      console.log(`[FalProvider] Submitting request to model: ${modelPath}`);
      console.log(`[FalProvider] Request URL: ${this.baseUrl}${url}`);
      console.log(`[FalProvider] Has reference images: ${hasReferenceImages}`);
      console.log(`[FalProvider] Request payload:`, JSON.stringify(payload, null, 2));
      console.log(`[FalProvider] Authorization header present:`, !!this.axiosInstance.defaults.headers['Authorization']);

      const response = await this.axiosInstance.post<FalSubmitResponse>(
        url,
        payload
      );

      if (!response.data?.request_id) {
        throw new FalProviderError(
          FalErrorType.INVALID_RESPONSE,
          500,
          false,
          [{
            loc: ['body', 'request_id'],
            msg: 'FAL API did not return request_id',
            type: FalErrorType.INVALID_RESPONSE,
            url: 'https://docs.fal.ai/errors',
          }]
        );
      }

      console.log(`[FalProvider] Request submitted. Request ID: ${response.data.request_id}`);
      return response.data;
    } catch (error) {
      if (error instanceof FalProviderError) {
        throw error;
      }
      throw this.handleAxiosError(error as AxiosError);
    }
  }

  /**
   * Extract base model name from full model path
   * Examples:
   * - "imagen4/preview/ultra" -> "imagen4"
   * - "nano-banana" -> "nano-banana"
   * - "reve/text-to-image" -> "reve"
   * - "nano-banana-pro" -> "nano-banana-pro"
   */
  private extractBaseModelName(modelPath: string): string {
    // Take the first part before any '/' separator
    const parts = modelPath.split('/');
    return parts[0];
  }

  /**
   * Determine FAL endpoint suffix based on model and whether reference images are provided
   * @param modelPath - Full model path (e.g., "imagen4/preview/ultra", "nano-banana", "reve/text-to-image")
   * @param hasReferenceImages - Whether reference images are provided
   * @returns Endpoint suffix (e.g., "", "/edit", "/remix")
   */
  private determineEndpointSuffix(modelPath: string, hasReferenceImages: boolean): string {
    const baseModel = this.extractBaseModelName(modelPath);
    
    // imagen4 is text-to-image only - no endpoint suffix
    if (baseModel === 'imagen4') {
      if (hasReferenceImages) {
        throw new FalProviderError(
          FalErrorType.VALIDATION_ERROR,
          422,
          false,
          [{
            loc: ['body', 'referenceImages'],
            msg: 'imagen4 model does not support reference images. Use nano-banana-pro or reve models for image-to-image.',
            type: FalErrorType.VALIDATION_ERROR,
            url: 'https://docs.fal.ai/errors',
          }]
        );
      }
      return ''; // No suffix for imagen4
    }
    
    // nano-banana and nano-banana-pro use /edit endpoint for image-to-image
    if (baseModel === 'nano-banana' || baseModel === 'nano-banana-pro') {
      return hasReferenceImages ? '/edit' : ''; // Can also do text-to-image without /edit
    }
    
    // reve uses /remix endpoint for multi-reference
    if (baseModel === 'reve') {
      return hasReferenceImages ? '/remix' : '/text-to-image'; // Default to text-to-image if no references
    }
    
    // Default: no suffix
    return '';
  }

  /**
   * Build FAL endpoint URL
   * @param modelPath - Full model path
   * @param hasReferenceImages - Whether reference images are provided
   * @returns Full endpoint path
   */
  private buildEndpointUrl(modelPath: string, hasReferenceImages: boolean): string {
    const baseModel = this.extractBaseModelName(modelPath);
    const suffix = this.determineEndpointSuffix(modelPath, hasReferenceImages);
    
    // For models with sub-paths (like imagen4/preview/ultra), use full path
    // For base models (like nano-banana), use base model name
    if (modelPath.includes('/') && baseModel !== 'reve') {
      // imagen4/preview/ultra -> /fal-ai/imagen4/preview/ultra
      return `/fal-ai/${modelPath}${suffix}`;
    } else {
      // nano-banana -> /fal-ai/nano-banana/edit
      // reve -> /fal-ai/reve/remix
      return `/fal-ai/${baseModel}${suffix}`;
    }
  }

  /**
   * Check request status
   */
  private async checkRequestStatus(
    modelPath: string,
    requestId: string
  ): Promise<FalStatusResponse> {
    try {
      // Extract base model name for status endpoint
      // Status endpoint uses base model name, not full path
      const baseModel = this.extractBaseModelName(modelPath);
      const response = await this.axiosInstance.get<FalStatusResponse>(
        `/fal-ai/${baseModel}/requests/${requestId}/status`
      );
      return response.data;
    } catch (error) {
      if (error instanceof FalProviderError) {
        // If status check fails with 404, the request doesn't exist
        if (error.statusCode === 404) {
          throw new FalProviderError(
            FalErrorType.REQUEST_NOT_FOUND,
            404,
            false,
            [{
              loc: ['body', 'request_id'],
              msg: `Request ${requestId} not found`,
              type: FalErrorType.REQUEST_NOT_FOUND,
              url: 'https://docs.fal.ai/errors',
            }]
          );
        }
        throw error;
      }
      throw this.handleAxiosError(error as AxiosError);
    }
  }

  /**
   * Fetch request result
   */
  private async fetchRequestResult(
    modelPath: string,
    requestId: string
  ): Promise<FalResultResponse> {
    try {
      // Extract base model name for result endpoint
      // Result endpoint uses base model name, not full path
      const baseModel = this.extractBaseModelName(modelPath);
      const response = await this.axiosInstance.get<FalResultResponse>(
        `/fal-ai/${baseModel}/requests/${requestId}`
      );
      return response.data;
    } catch (error) {
      if (error instanceof FalProviderError) {
        throw error;
      }
      throw this.handleAxiosError(error as AxiosError);
    }
  }

  /**
   * Poll until request is complete
   */
  private async pollUntilComplete(
    modelPath: string,
    requestId: string,
    onProgress?: (progress: number) => void
  ): Promise<FalResultResponse> {
    let attempts = 0;
    const startTime = Date.now();

    while (attempts < this.maxPollAttempts) {
      // Check if we've exceeded max duration
      if (Date.now() - startTime > this.maxDuration) {
        throw new FalProviderError(
          FalErrorType.GENERATION_TIMEOUT,
          504,
          true,
          [{
            loc: ['body'],
            msg: `Request ${requestId} exceeded maximum duration of 5 minutes`,
            type: FalErrorType.GENERATION_TIMEOUT,
            url: 'https://docs.fal.ai/errors/#generation_timeout',
          }]
        );
      }

      try {
        const statusResponse = await this.checkRequestStatus(modelPath, requestId);
        const status = statusResponse.status?.toLowerCase();

        console.log(
          `[FalProvider] Request ${requestId} status: ${status} (attempt ${attempts + 1}/${this.maxPollAttempts})`
        );

        // Update progress (estimate based on attempts)
        if (onProgress) {
          const progress = Math.min(90, 10 + (attempts / this.maxPollAttempts) * 80);
          onProgress(progress);
        }

        if (status === 'completed' || status === 'succeeded') {
          console.log(`[FalProvider] Request ${requestId} completed successfully`);
          return await this.fetchRequestResult(modelPath, requestId);
        }

        if (status === 'failed' || status === 'error') {
          // Try to fetch result to get error details
          try {
            const result = await this.fetchRequestResult(modelPath, requestId);
            // If result has error information, use it
            if (result.error) {
              throw new FalProviderError(
                'generation_failed',
                500,
                false,
                [{
                  loc: ['body'],
                  msg: result.error.message || 'Generation failed',
                  type: 'generation_failed',
                  url: 'https://docs.fal.ai/errors',
                }]
              );
            }
          } catch (fetchError) {
            // If fetching result fails, use generic error
            if (fetchError instanceof FalProviderError) {
              throw fetchError;
            }
            throw new FalProviderError(
              'generation_failed',
              500,
              false,
              [{
                loc: ['body'],
                msg: `Image generation failed for request ${requestId}`,
                type: 'generation_failed',
                url: 'https://docs.fal.ai/errors',
              }]
            );
          }
        }

        if (status === 'cancelled') {
          throw new FalProviderError(
            'request_cancelled',
            400,
            false,
            [{
              loc: ['body'],
              msg: `Request ${requestId} was cancelled`,
              type: 'request_cancelled',
              url: 'https://docs.fal.ai/errors',
            }]
          );
        }

        // Status is 'queued' or 'running', continue polling
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
        attempts++;

      } catch (error) {
        // If it's a FalProviderError and not retryable, throw immediately
        if (error instanceof FalProviderError && !error.isRetryable()) {
          throw error;
        }

        // For retryable errors or network issues, continue polling
        // But limit retries for status check errors
        if (attempts >= 3 && error instanceof FalProviderError) {
          console.warn(
            `[FalProvider] Status check failed multiple times for ${requestId}, rethrowing error`
          );
          throw error;
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
        attempts++;
      }
    }

    // Max attempts reached
    throw new FalProviderError(
      FalErrorType.GENERATION_TIMEOUT,
      504,
      true,
      [{
        loc: ['body'],
        msg: `Request ${requestId} timed out after ${this.maxPollAttempts} polling attempts`,
        type: FalErrorType.GENERATION_TIMEOUT,
        url: 'https://docs.fal.ai/errors/#generation_timeout',
      }]
    );
  }

  /**
   * Normalize request to FAL format
   */
  private normalizeRequest(request: ImageGenerationRequest): any {
    const modelId = request.modelId;
    const modelPath = modelId.replace('fal-ai/', '');
    const baseModel = this.extractBaseModelName(modelPath);

    // Build base payload
    const payload: any = {
      prompt: request.prompt,
      num_images: request.numImages || 1,
      output_format: request.outputFormat || 'png',
    };

    // Add aspect_ratio if provided
    if (request.aspectRatio) {
      payload.aspect_ratio = request.aspectRatio;
    }

    // Add resolution only for models that support it
    const modelsWithResolution = [
      'imagen4/preview/ultra',
      'nano-banana-pro',
    ];

    if (request.resolution && modelsWithResolution.some(m => modelPath.includes(m))) {
      payload.resolution = request.resolution;
    }

    // Add reference images for image-to-image generation (if supported)
    // Use image_urls array (correct parameter name for FAL)
    if (request.referenceImages && request.referenceImages.length > 0) {
      // Validate imagen4 doesn't support reference images
      if (baseModel === 'imagen4') {
        throw new FalProviderError(
          FalErrorType.VALIDATION_ERROR,
          422,
          false,
          [{
            loc: ['body', 'referenceImages'],
            msg: 'imagen4 model does not support reference images. Use nano-banana-pro or reve models for image-to-image generation.',
            type: FalErrorType.VALIDATION_ERROR,
            url: 'https://docs.fal.ai/errors',
          }]
        );
      }

      // Use image_urls array (correct parameter name for FAL API)
      payload.image_urls = request.referenceImages;
      console.log(`[FalProvider] Using image-to-image with ${request.referenceImages.length} reference image(s) via image_urls`);
    }

    // Merge any additional params (provider-specific)
    if (request.additionalParams) {
      Object.assign(payload, request.additionalParams);
    }

    return payload;
  }

  /**
   * Normalize FAL response to unified format
   */
  private normalizeResponse(
    falResponse: FalResultResponse,
    modelId: string
  ): ImageGenerationResponse {
    // Validate response structure
    if (!falResponse.images || !Array.isArray(falResponse.images) || falResponse.images.length === 0) {
      throw new FalProviderError(
        FalErrorType.INVALID_RESPONSE,
        500,
        false,
        [{
          loc: ['body', 'images'],
          msg: 'FAL API returned invalid response: missing or empty images array',
          type: FalErrorType.INVALID_RESPONSE,
          url: 'https://docs.fal.ai/errors',
        }]
      );
    }

    // Get first image (we only generate 1 image)
    const image = falResponse.images[0];

    if (!image?.url) {
      throw new FalProviderError(
        FalErrorType.INVALID_RESPONSE,
        500,
        false,
        [{
          loc: ['body', 'images', 'url'],
          msg: 'FAL API returned image without URL',
          type: FalErrorType.INVALID_RESPONSE,
          url: 'https://docs.fal.ai/errors',
        }]
      );
    }

    return {
      imageUrl: image.url,
      model: modelId,
      metadata: {
        fileName: image.file_name,
        contentType: image.content_type,
        description: falResponse.description,
      },
      usage: {
        generatedImages: falResponse.images.length,
      },
    };
  }

  /**
   * Main generateImage method
   */
  async generateImage(
    request: ImageGenerationRequest,
    onProgress?: (progress: number) => void
  ): Promise<ImageGenerationResponse> {
    try {
      // Validate request
      const validation = this.validateRequest(request);
      if (!validation.valid) {
        throw new FalProviderError(
          FalErrorType.VALIDATION_ERROR,
          422,
          false,
          [{
            loc: ['body'],
            msg: validation.error || 'Invalid request',
            type: FalErrorType.VALIDATION_ERROR,
            url: 'https://docs.fal.ai/errors',
          }]
        );
      }

      // Normalize request to FAL format
      const falRequest = this.normalizeRequest(request);

      // Extract model path
      const modelPath = request.modelId.replace('fal-ai/', '');
      const hasReferenceImages = !!(request.referenceImages && request.referenceImages.length > 0);

      // Pre-warm reference images before submitting to FAL
      // This ensures GCS/CDN has the files cached and accessible
      if (hasReferenceImages && request.referenceImages) {
        console.log(`[FalProvider] Pre-warming ${request.referenceImages.length} reference image(s)...`);
        onProgress?.(2);
        const warmResult = await preWarmUrls(request.referenceImages, 3);
        if (warmResult.failedUrls.length > 0) {
          console.warn(`[FalProvider] ⚠️ Some URLs failed to pre-warm, proceeding anyway...`);
        }
        // Small delay after pre-warming to ensure propagation
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Submit request with reference image flag and retry logic
      onProgress?.(5);
      const submitResponse = await withRetry(
        async () => this.submitRequest(modelPath, falRequest, hasReferenceImages),
        3,
        (attempt, error) => {
          console.log(`[FalProvider] Submit retry ${attempt}/3 after error: ${error.message}`);
        }
      );
      const requestId = submitResponse.request_id;

      // Poll until complete with retry logic for transient errors
      onProgress?.(10);
      const result = await withRetry(
        async () => this.pollUntilComplete(
          modelPath,
          requestId,
          (progress) => {
            // Map polling progress to 10-90% range
            const mappedProgress = 10 + (progress * 0.8);
            onProgress?.(mappedProgress);
          }
        ),
        2, // Fewer retries for polling since it already has internal retry
        (attempt, error) => {
          console.log(`[FalProvider] Poll retry ${attempt}/2 after error: ${error.message}`);
        }
      );

      // Normalize and return response
      onProgress?.(95);
      return this.normalizeResponse(result, request.modelId);

    } catch (error) {
      // Re-throw FalProviderError as-is
      if (error instanceof FalProviderError) {
        throw error;
      }

      // Wrap unexpected errors
      throw new FalProviderError(
        FalErrorType.UNEXPECTED_ERROR,
        500,
        true,
        [{
          loc: ['body'],
          msg: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
          type: FalErrorType.UNEXPECTED_ERROR,
          url: 'https://docs.fal.ai/errors',
        }]
      );
    }
  }

  /**
   * Validate request before submission
   */
  validateRequest(request: ImageGenerationRequest): ValidationResult {
    if (!request.prompt || request.prompt.trim().length === 0) {
      return { valid: false, error: 'Prompt is required' };
    }

    if (request.prompt.length > 10000) {
      return { valid: false, error: 'Prompt exceeds maximum length of 10000 characters' };
    }

    if (!request.modelId) {
      return { valid: false, error: 'Model ID is required' };
    }

    if (request.numImages && (request.numImages < 1 || request.numImages > 4)) {
      return { valid: false, error: 'num_images must be between 1 and 4' };
    }

    // Validate imagen4 doesn't support reference images
    if (request.referenceImages && request.referenceImages.length > 0) {
      const modelId = request.modelId;
      const modelPath = modelId.replace('fal-ai/', '');
      const baseModel = this.extractBaseModelName(modelPath);
      
      if (baseModel === 'imagen4') {
        return {
          valid: false,
          error: 'imagen4 model does not support reference images. Use nano-banana-pro (model-4) or reve (model-3) for image-to-image generation.'
        };
      }
      
      // Validate reference images are URLs
      for (const refUrl of request.referenceImages) {
        if (!refUrl.startsWith('http://') && !refUrl.startsWith('https://')) {
          return {
            valid: false,
            error: `Invalid reference image URL: ${refUrl}. Must be a valid HTTP/HTTPS URL.`
          };
        }
      }
    }

    // Validate aspect ratio
    const validAspectRatios = [
      '1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '3:2', '2:3', '5:4', '4:5'
    ];
    if (request.aspectRatio && !validAspectRatios.includes(request.aspectRatio)) {
      return {
        valid: false,
        error: `Invalid aspect ratio. Valid values: ${validAspectRatios.join(', ')}`
      };
    }

    // Validate resolution
    const validResolutions = ['1K', '2K', '4K'];
    if (request.resolution && !validResolutions.includes(request.resolution)) {
      return {
        valid: false,
        error: `Invalid resolution. Valid values: ${validResolutions.join(', ')}`
      };
    }

    return { valid: true };
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): ProviderCapabilities {
    return {
      supportsAspectRatio: true,
      supportsResolution: true, // Some models support it
      supportsNumImages: true,
      supportedAspectRatios: [
        '1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '3:2', '2:3', '5:4', '4:5'
      ],
      supportedResolutions: ['1K', '2K', '4K'],
      maxNumImages: 4,
      isAsync: true,
      estimatedTimeSeconds: 30, // Average generation time
    };
  }

  /**
   * Get supported models
   */
  async getSupportedModels(): Promise<ModelInfo[]> {
    // Models are managed by ModelRegistryService
    // This method can be used for dynamic model discovery in the future
    return [];
  }
}

