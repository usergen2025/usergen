/**
 * Unified interface for video generation providers
 * This abstraction allows switching between different providers (FAL, BytePlus, etc.)
 */

export interface VideoGenerationRequest {
  prompt: string;
  imageUrl: string; // Public URL of the scene image (main image to animate)
  modelId: string; // e.g., "video-model-1" (BytePlus) or "video-model-2" (FAL)
  aspectRatio?: string; // "16:9", "9:16"
  duration?: number; // Duration in seconds (will be mapped to enum for FAL)
  resolution?: string; // "720p", "1080p"
  generateAudio?: boolean; // For FAL models
  /** Optional reference image (e.g. product image for PRODUCT_ONLY/AVATAR_PRODUCT). BytePlus: added as first image in content array. */
  referenceImageUrl?: string;
  additionalParams?: Record<string, any>; // Provider-specific
}

export interface VideoGenerationResponse {
  videoUrl: string; // Provider URL
  model: string; // Model identifier used
  metadata?: {
    requestId?: string; // For async providers like FAL
    generationTime?: number;
    creditsUsed?: number;
    taskId?: string; // For BytePlus
  };
}

export interface VideoProviderCapabilities {
  supportsAspectRatio: boolean;
  supportsResolution: boolean;
  supportsDuration: boolean;
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  supportedDurations?: string[]; // For FAL: ['4s', '6s', '8s']
  minDuration?: number; // For BytePlus: 2
  maxDuration?: number; // For FAL: 8
  isAsync: boolean; // FAL is async, BytePlus is async (polling)
  estimatedTimeSeconds: number;
}

export interface VideoModelInfo {
  id: string; // e.g., "video-model-1" or "video-model-2"
  displayName: string; // "Model 1", "Model 2", etc.
  platform: 'FAL' | 'BYTEPLUS';
  capabilities: VideoProviderCapabilities;
  defaultConfig: {
    aspectRatio: string;
    resolution?: string;
    duration?: number;
    generateAudio?: boolean;
  };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Main provider interface that all video generation providers must implement
 */
export interface IVideoGenerationProvider {
  /**
   * Generate a video from an image and prompt
   * @param request Unified video generation request
   * @param onProgress Optional progress callback (0-100)
   * @returns Promise resolving to video generation response
   */
  generateVideo(
    request: VideoGenerationRequest,
    onProgress?: (progress: number) => void
  ): Promise<VideoGenerationResponse>;

  /**
   * Get provider capabilities
   */
  getCapabilities(): VideoProviderCapabilities;

  /**
   * Get list of supported models
   */
  getSupportedModels(): Promise<VideoModelInfo[]>;

  /**
   * Validate request before submission
   */
  validateRequest(request: VideoGenerationRequest): ValidationResult;
}

