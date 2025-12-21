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
    // Model 1: FAL imagen4/preview/ultra (DEFAULT)
    this.models.set('model-1', {
      id: 'fal-ai/imagen4/preview/ultra',
      displayName: 'Model 1',
      platform: 'FAL',
      capabilities: {
        supportsAspectRatio: true,
        supportsResolution: true,
        supportsNumImages: true,
        supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        supportedResolutions: ['1K', '2K'],
        maxNumImages: 1,
        isAsync: true,
        estimatedTimeSeconds: 30,
      },
      defaultConfig: {
        aspectRatio: '9:16', // Will be overridden by video style
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

    // Model 5: BytePlus seedream
    this.models.set('model-5', {
      id: 'seedream-4-0-250828',
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
   * Get default model (Model 1 - FAL imagen4)
   */
  getDefaultModel(): ModelInfo {
    const defaultModel = this.models.get('model-1');
    if (!defaultModel) {
      throw new Error('Default model (model-1) not found');
    }
    return defaultModel;
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
   * Get default video model (Model 1 - BytePlus Seedance)
   */
  getDefaultVideoModel(): VideoModelInfo {
    const defaultModel = this.videoModels.get('video-model-1');
    if (!defaultModel) {
      throw new Error('Default video model (video-model-1) not found');
    }
    return defaultModel;
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

