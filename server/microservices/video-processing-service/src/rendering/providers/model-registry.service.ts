import { Injectable } from '@nestjs/common';
import { ModelInfo, ProviderCapabilities } from './interfaces/image-generation.interface';
import { VideoModelInfo, VideoProviderCapabilities } from './interfaces/video-generation.interface';

/**
 * Model Registry Service
 * Centralized configuration for all available image generation models
 */
@Injectable()
export class ModelRegistryService {
  private models: Map<string, ModelInfo> = new Map();
  private videoModels: Map<string, VideoModelInfo> = new Map();

  constructor() {
    this.initializeModels();
    this.initializeVideoModels();
  }

  private initializeModels() {
    // Model 1: legacy client id. Imagen4 is unavailable, so this resolves to BytePlus Seedream (same as model-5).
    this.models.set('model-1', {
      id: 'seedream-4-5-251128',
      displayName: 'Model 1',
      platform: 'BYTEPLUS',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsNumImages: false,
        supportedAspectRatios: ['9:16', '3:4', '16:9', '1:1', '4:3'],
        supportedResolutions: ['1K', '2K', '4K'],
        maxNumImages: 1,
        isAsync: false,
        estimatedTimeSeconds: 15,
      },
      defaultConfig: {
        aspectRatio: '9:16',
        resolution: '2K',
        outputFormat: 'png',
        numImages: 1,
      },
    });

    // Model 2: FAL nano-banana
    this.models.set('model-2', {
      id: 'fal-ai/nano-banana',
      displayName: 'Model 2',
      platform: 'FAL',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: false, // This model doesn't support resolution parameter
        supportsNumImages: true,
        supportedAspectRatios: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
        supportedResolutions: [],
        maxNumImages: 1,
        isAsync: true,
        estimatedTimeSeconds: 25,
      },
      defaultConfig: {
        aspectRatio: '9:16',
        outputFormat: 'png',
        numImages: 1,
      },
    });

    // Model 3: FAL reve/text-to-image
    this.models.set('model-3', {
      id: 'fal-ai/reve/text-to-image',
      displayName: 'Model 3',
      platform: 'FAL',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: false,
        supportsNumImages: true,
        supportedAspectRatios: ['16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '1:1'],
        supportedResolutions: [],
        maxNumImages: 1,
        isAsync: true,
        estimatedTimeSeconds: 20,
      },
      defaultConfig: {
        aspectRatio: '9:16',
        outputFormat: 'png',
        numImages: 1,
      },
    });

    // Model 4: FAL nano-banana-pro
    this.models.set('model-4', {
      id: 'fal-ai/nano-banana-pro',
      displayName: 'Model 4',
      platform: 'FAL',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsNumImages: true,
        supportedAspectRatios: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
        supportedResolutions: ['1K', '2K', '4K'],
        maxNumImages: 1,
        isAsync: true,
        estimatedTimeSeconds: 35,
      },
      defaultConfig: {
        aspectRatio: '9:16',
        resolution: '1K',
        outputFormat: 'png',
        numImages: 1,
      },
    });

    // Model 5: BytePlus Seedream (multi-reference image-to-image; use for default styles when assets exist)
    this.models.set('model-5', {
      id: 'seedream-4-5-251128',
      displayName: 'Model 5',
      platform: 'BYTEPLUS',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsNumImages: false,
        supportedAspectRatios: ['9:16', '3:4', '16:9', '1:1', '4:3'],
        supportedResolutions: ['1K', '2K', '4K'],
        maxNumImages: 1,
        isAsync: false,
        estimatedTimeSeconds: 15,
      },
      defaultConfig: {
        aspectRatio: '9:16',
        resolution: '2K',
        outputFormat: 'png',
        numImages: 1,
      },
    });

    // Model 6: Google Nano Banana 2.1 (DEFAULT — text-to-image and image-to-image/edit)
    this.models.set('model-6', {
      id: 'google/nano-banana-2.1',
      displayName: 'Model 6',
      platform: 'FAL',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsNumImages: true,
        supportedAspectRatios: ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8'],
        supportedResolutions: ['0.5K', '1K', '2K', '4K'],
        maxNumImages: 4,
        isAsync: true,
        estimatedTimeSeconds: 20,
      },
      defaultConfig: {
        aspectRatio: '9:16',
        resolution: '1K',
        outputFormat: 'png',
        numImages: 1,
      },
    });
  }

  /**
   * Get model by ID
   */
  getModel(modelId: string): ModelInfo | undefined {
    return this.models.get(modelId);
  }

  /**
   * Get all models
   */
  getAllModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  /**
   * Get all models with their keys (for API responses)
   * Returns array of [key, ModelInfo] pairs
   */
  getAllModelsWithKeys(): Array<[string, ModelInfo]> {
    return Array.from(this.models.entries());
  }

  /**
   * Get default model (Model 6 - Google Nano Banana 2.1)
   */
  getDefaultModel(): ModelInfo {
    const defaultModel = this.models.get('model-6');
    if (!defaultModel) {
      throw new Error('Default model (model-6) not found');
    }
    return defaultModel;
  }

  /**
   * Get default model key string
   */
  getDefaultModelKey(): string {
    return 'model-6';
  }

  /**
   * Get default model for a specific video style
   * @param videoStyle - Video style (PRODUCT_ONLY, AVATAR_PRODUCT, etc.)
   * @returns ModelInfo for the default model
   */
  getDefaultModelForStyle(videoStyle?: string): ModelInfo {
    // All styles now default to model-6 (Nano Banana 2.1) which supports both T2I and I2I/edit
    const model = this.models.get('model-6');
    if (!model) {
      throw new Error('Default model (model-6) not found');
    }
    return model;
  }

  /**
   * Get models by platform
   */
  getModelsByPlatform(platform: 'FAL' | 'BYTEPLUS'): ModelInfo[] {
    return Array.from(this.models.values()).filter(m => m.platform === platform);
  }

  /**
   * Check if model exists
   */
  hasModel(modelId: string): boolean {
    return this.models.has(modelId);
  }

  /**
   * Initialize video models
   */
  private initializeVideoModels() {
    // Video Model 1: BytePlus Seedance Pro (DEFAULT)
    this.videoModels.set('video-model-1', {
      id: 'seedance-1-0-pro-250528',
      displayName: 'Model 1',
      platform: 'BYTEPLUS',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsDuration: true,
        supportedAspectRatios: ['9:16', '3:4', '16:9', '1:1', '4:3'],
        supportedResolutions: ['720p', '1080p'],
        minDuration: 2,
        isAsync: true,
        estimatedTimeSeconds: 60,
      },
      defaultConfig: {
        aspectRatio: '9:16',
        resolution: '1080p',
        duration: 2,
      },
    });

    // Video Model 2: FAL veo3.1/image-to-video
    this.videoModels.set('video-model-2', {
      id: 'fal-ai/veo3.1/image-to-video',
      displayName: 'Model 2',
      platform: 'FAL',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsDuration: true,
        supportedAspectRatios: ['16:9', '9:16'],
        supportedResolutions: ['720p', '1080p'],
        supportedDurations: ['4s', '6s', '8s'],
        minDuration: 4,
        maxDuration: 8,
        isAsync: true,
        estimatedTimeSeconds: 120,
      },
      defaultConfig: {
        aspectRatio: '16:9',
        resolution: '720p',
        duration: 8,
        generateAudio: true,
      },
    });

    // Video Model 3: Alibaba Wan 3.0 Standard (DEFAULT)
    this.videoModels.set('video-model-3', {
      id: 'alibaba/wan-3.0/image-to-video',
      displayName: 'Model 3',
      platform: 'FAL',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsDuration: true,
        supportedAspectRatios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'],
        supportedResolutions: ['480p', '720p', '1080p'],
        minDuration: 2,
        maxDuration: 30,
        isAsync: true,
        estimatedTimeSeconds: 90,
      },
      defaultConfig: {
        aspectRatio: '9:16',
        resolution: '1080p',
        duration: 5,
        generateAudio: false,
      },
    });

    // Video Model 4: Alibaba Wan 3.0 Prime
    this.videoModels.set('video-model-4', {
      id: 'alibaba/wan-3.0-prime/image-to-video',
      displayName: 'Model 4',
      platform: 'FAL',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsDuration: true,
        supportedAspectRatios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'],
        supportedResolutions: ['480p', '720p', '1080p'],
        minDuration: 2,
        maxDuration: 30,
        isAsync: true,
        estimatedTimeSeconds: 120,
      },
      defaultConfig: {
        aspectRatio: '9:16',
        resolution: '1080p',
        duration: 5,
        generateAudio: false,
      },
    });
  }

  /**
   * Get video model by ID
   */
  getVideoModel(modelId: string): VideoModelInfo | undefined {
    return this.videoModels.get(modelId);
  }

  /**
   * Get all video models
   */
  getAllVideoModels(): VideoModelInfo[] {
    return Array.from(this.videoModels.values());
  }

  /**
   * Get all video models with their keys (for API responses)
   * Returns array of [key, VideoModelInfo] pairs
   */
  getAllVideoModelsWithKeys(): Array<[string, VideoModelInfo]> {
    return Array.from(this.videoModels.entries());
  }

  /**
   * Get default video model (Model 3 - Wan 3.0 Standard)
   */
  getDefaultVideoModel(): VideoModelInfo {
    const defaultModel = this.videoModels.get('video-model-3');
    if (!defaultModel) {
      throw new Error('Default video model (video-model-3) not found');
    }
    return defaultModel;
  }

  /**
   * Get default video model key string
   */
  getDefaultVideoModelKey(): string {
    return 'video-model-3';
  }

  /**
   * Get video models by platform
   */
  getVideoModelsByPlatform(platform: 'FAL' | 'BYTEPLUS'): VideoModelInfo[] {
    return Array.from(this.videoModels.values()).filter(m => m.platform === platform);
  }

  /**
   * Check if video model exists
   */
  hasVideoModel(modelId: string): boolean {
    return this.videoModels.has(modelId);
  }
}

