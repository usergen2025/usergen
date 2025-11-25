/**
 * Unified interface for image generation providers
 * This abstraction allows switching between different providers (FAL, BytePlus, etc.)
 */

export interface ImageGenerationRequest {
  prompt: string;
  modelId: string; // e.g., "fal-ai/imagen4/preview/ultra" or "seedream-4-0-250828"
  aspectRatio?: string; // "9:16", "3:4", "1:1", etc.
  resolution?: string; // "1K", "2K", "4K" (if supported)
  numImages?: number; // Default: 1
  outputFormat?: 'png' | 'jpeg' | 'webp'; // Default: 'png'
  additionalParams?: Record<string, any>; // Provider-specific
}

export interface ImageGenerationResponse {
  imageUrl: string; // Always a URL (we'll download it)
  model: string; // Model identifier used
  metadata?: {
    requestId?: string; // For async providers like FAL
    generationTime?: number;
    creditsUsed?: number;
    fileName?: string;
    contentType?: string;
    description?: string;
  };
  usage?: {
    generatedImages: number;
    tokens?: number;
  };
}

export interface ProviderCapabilities {
  supportsAspectRatio: boolean;
  supportsResolution: boolean;
  supportsNumImages: boolean;
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  maxNumImages: number;
  isAsync: boolean; // FAL is async, BytePlus is sync
  estimatedTimeSeconds: number;
}

export interface ModelInfo {
  id: string; // e.g., "fal-ai/imagen4/preview/ultra" or "model-1"
  displayName: string; // "Model 1", "Model 2", etc.
  platform: 'FAL' | 'BYTEPLUS';
  capabilities: ProviderCapabilities;
  defaultConfig: {
    aspectRatio: string;
    resolution?: string;
    outputFormat: string;
    numImages: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Main provider interface that all image generation providers must implement
 */
export interface IImageGenerationProvider {
  /**
   * Generate an image from a text prompt
   * @param request Unified image generation request
   * @param onProgress Optional progress callback (0-100)
   * @returns Promise resolving to image generation response
   */
  generateImage(
    request: ImageGenerationRequest,
    onProgress?: (progress: number) => void
  ): Promise<ImageGenerationResponse>;

  /**
   * Get provider capabilities
   */
  getCapabilities(): ProviderCapabilities;

  /**
   * Get list of supported models
   */
  getSupportedModels(): Promise<ModelInfo[]>;

  /**
   * Validate request before submission
   */
  validateRequest(request: ImageGenerationRequest): ValidationResult;
}

