import { Injectable } from '@nestjs/common';
import { IImageGenerationProvider } from './interfaces/image-generation.interface';
import { FalProvider } from './fal/fal.provider';
import { BytePlusProvider } from './byteplus.provider';
import { ModelRegistryService } from './model-registry.service';

/**
 * Provider Factory Service
 * Manages provider instances and routes requests to the correct provider
 */
@Injectable()
export class ProviderFactory {
  private providers: Map<string, IImageGenerationProvider> = new Map();

  constructor(
    private readonly falProvider: FalProvider,
    private readonly bytePlusProvider: BytePlusProvider,
    private readonly modelRegistry: ModelRegistryService,
  ) {
    this.initializeProviders();
  }

  private initializeProviders() {
    this.providers.set('FAL', this.falProvider);
    this.providers.set('BYTEPLUS', this.bytePlusProvider);
  }

  /**
   * Get provider by platform name
   */
  getProvider(platform: 'FAL' | 'BYTEPLUS'): IImageGenerationProvider {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(`Provider not found: ${platform}`);
    }
    return provider;
  }

  /**
   * Get provider for a specific model
   */
  getProviderForModel(modelId: string): IImageGenerationProvider {
    // First check if it's a registry model ID (e.g., "model-1")
    const model = this.modelRegistry.getModel(modelId);
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

