import { Injectable } from '@nestjs/common';
import { IVideoGenerationProvider } from './interfaces/video-generation.interface';
import { FalVideoProvider } from './fal/fal-video.provider';
import { BytePlusProvider } from './byteplus.provider';
import { ModelRegistryService } from './model-registry.service';

/**
 * Video Provider Factory Service
 * Manages provider instances and routes requests to the correct provider
 */
@Injectable()
export class VideoProviderFactory {
  private providers: Map<string, IVideoGenerationProvider> = new Map();

  constructor(
    private readonly falVideoProvider: FalVideoProvider,
    private readonly bytePlusProvider: BytePlusProvider,
    private readonly modelRegistry: ModelRegistryService,
  ) {
    this.initializeProviders();
  }

  private initializeProviders() {
    this.providers.set('FAL', this.falVideoProvider);
    this.providers.set('BYTEPLUS', this.bytePlusProvider);
  }

  /**
   * Get provider by platform name
   */
  getProvider(platform: 'FAL' | 'BYTEPLUS'): IVideoGenerationProvider {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(`Video provider not found: ${platform}`);
    }
    return provider;
  }

  /**
   * Get provider for a specific model
   */
  getProviderForModel(modelId: string): IVideoGenerationProvider {
    // First check if it's a registry model ID (e.g., "video-model-1")
    const model = this.modelRegistry.getVideoModel(modelId);
    if (model) {
      return this.getProvider(model.platform);
    }

    // Otherwise, try to determine platform from model ID
    if (modelId.startsWith('fal-ai/')) {
      return this.getProvider('FAL');
    }

    // Default to BytePlus for other models
    return this.getProvider('BYTEPLUS');
  }

  /**
   * Get all available platforms
   */
  getAvailablePlatforms(): string[] {
    return Array.from(this.providers.keys());
  }
}

