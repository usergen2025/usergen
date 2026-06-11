import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { preWarmUrls } from '@shared/storage';

export interface FalImageGenerationRequest {
  prompt: string;
  modelId: string;
  aspectRatio?: string;
  resolution?: string;
  referenceImages?: string[];
}

export interface FalImageGenerationResponse {
  imageUrl: string;
}

interface FalSubmitResponse {
  request_id: string;
}

interface FalStatusResponse {
  status: string;
}

interface FalImageFile {
  url: string;
}

interface FalResultResponse {
  images: FalImageFile[];
}

/**
 * Lightweight FAL image provider for avatar preview generation (multi-reference image-to-image).
 */
@Injectable()
export class FalImageProvider {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://queue.fal.run';
  private readonly axiosInstance: AxiosInstance;
  private readonly maxPollAttempts = 60;
  private readonly pollIntervalMs = 5000;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = (
      this.configService.get<string>('FAL_KEY') ||
      this.configService.get<string>('FAL_API_KEY') ||
      process.env.FAL_KEY ||
      process.env.FAL_API_KEY ||
      ''
    ).trim();

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }

  async generateImage(request: FalImageGenerationRequest): Promise<FalImageGenerationResponse> {
    if (!this.apiKey) {
      throw new Error('FAL_KEY (or FAL_API_KEY) is required for avatar preview generation with FAL.');
    }

    const modelPath = request.modelId.replace('fal-ai/', '');
    const hasReferenceImages = !!(request.referenceImages && request.referenceImages.length > 0);

    const payload: Record<string, unknown> = {
      prompt: request.prompt,
      num_images: 1,
      output_format: 'png',
    };

    if (request.aspectRatio) {
      payload.aspect_ratio = request.aspectRatio;
    }

    if (request.resolution && modelPath.includes('nano-banana-pro')) {
      payload.resolution = request.resolution;
    }

    if (hasReferenceImages && request.referenceImages) {
      payload.image_urls = request.referenceImages;
      await preWarmUrls(request.referenceImages, 3);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const endpoint = this.buildEndpointUrl(modelPath, hasReferenceImages);
    const submitResponse = await this.axiosInstance.post<FalSubmitResponse>(endpoint, payload);
    const requestId = submitResponse.data?.request_id;
    if (!requestId) {
      throw new Error('FAL API did not return request_id');
    }

    const result = await this.pollUntilComplete(modelPath, requestId);
    const imageUrl = result.images?.[0]?.url;
    if (!imageUrl) {
      throw new Error('FAL API returned no image URL');
    }

    return { imageUrl };
  }

  private extractBaseModelName(modelPath: string): string {
    return modelPath.split('/')[0];
  }

  private determineEndpointSuffix(modelPath: string, hasReferenceImages: boolean): string {
    const baseModel = this.extractBaseModelName(modelPath);
    if (baseModel === 'nano-banana' || baseModel === 'nano-banana-pro') {
      return hasReferenceImages ? '/edit' : '';
    }
    if (baseModel === 'reve') {
      return hasReferenceImages ? '/remix' : '/text-to-image';
    }
    return '';
  }

  private buildEndpointUrl(modelPath: string, hasReferenceImages: boolean): string {
    const baseModel = this.extractBaseModelName(modelPath);
    const suffix = this.determineEndpointSuffix(modelPath, hasReferenceImages);
    if (modelPath.includes('/') && baseModel !== 'reve') {
      return `/fal-ai/${modelPath}${suffix}`;
    }
    return `/fal-ai/${baseModel}${suffix}`;
  }

  private async pollUntilComplete(modelPath: string, requestId: string): Promise<FalResultResponse> {
    const baseModel = this.extractBaseModelName(modelPath);
    let attempts = 0;

    while (attempts < this.maxPollAttempts) {
      const statusResponse = await this.axiosInstance.get<FalStatusResponse>(
        `/fal-ai/${baseModel}/requests/${requestId}/status`,
      );
      const status = statusResponse.data?.status;

      if (status === 'COMPLETED') {
        const resultResponse = await this.axiosInstance.get<FalResultResponse>(
          `/fal-ai/${baseModel}/requests/${requestId}`,
        );
        return resultResponse.data;
      }

      if (status === 'FAILED') {
        throw new Error(`FAL image generation failed for request ${requestId}`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      attempts++;
    }

    throw new Error(`FAL image generation timed out for request ${requestId}`);
  }
}
