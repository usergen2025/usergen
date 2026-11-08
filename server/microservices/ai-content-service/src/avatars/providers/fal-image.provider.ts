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

    // For fal-ai/ prefixed IDs, strip the prefix. For google/ and alibaba/ namespaced models, keep as-is.
    const modelPath = request.modelId.startsWith('fal-ai/')
      ? request.modelId.replace('fal-ai/', '')
      : request.modelId;
    const hasReferenceImages = !!(request.referenceImages && request.referenceImages.length > 0);

    const payload: Record<string, unknown> = {
      prompt: request.prompt,
      num_images: 1,
      output_format: 'png',
    };

    if (request.aspectRatio) {
      payload.aspect_ratio = request.aspectRatio;
    }

    if (request.resolution && (modelPath.includes('nano-banana-pro') || modelPath.includes('nano-banana-2'))) {
      payload.resolution = request.resolution;
    }

    // Nano Banana 2.1 supports thinking_level; default to medium for quality edits
    if (modelPath.includes('nano-banana-2.1') && hasReferenceImages) {
      payload.thinking_level = 'medium';
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

  /**
   * Extract {owner}/{app} for queue status/result URLs.
   * e.g. 'google/nano-banana-2.1' → 'google/nano-banana-2.1'
   * e.g. 'nano-banana-2' → 'nano-banana-2' (legacy fal-ai models)
   */
  private extractOwnerApp(modelPath: string): string {
    const parts = modelPath.split('/');
    const ns = parts[0];
    if (ns === 'google' || ns === 'alibaba') {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }

  /**
   * URL prefix for queue submission.
   * google/ and alibaba/ models use their namespace directly.
   * Legacy models use /fal-ai/.
   */
  private getModelUrlPrefix(modelPath: string): string {
    const ns = modelPath.split('/')[0];
    if (ns === 'google' || ns === 'alibaba') {
      return '';
    }
    return '/fal-ai';
  }

  private determineEndpointSuffix(modelPath: string, hasReferenceImages: boolean): string {
    const baseName = modelPath.split('/').pop() || modelPath;
    if (baseName === 'nano-banana' || baseName === 'nano-banana-pro' || baseName === 'nano-banana-2' || baseName === 'nano-banana-2.1') {
      return hasReferenceImages ? '/edit' : '';
    }
    if (baseName === 'reve' || modelPath.startsWith('reve')) {
      return hasReferenceImages ? '/remix' : '/text-to-image';
    }
    return '';
  }

  private buildEndpointUrl(modelPath: string, hasReferenceImages: boolean): string {
    const prefix = this.getModelUrlPrefix(modelPath);
    const suffix = this.determineEndpointSuffix(modelPath, hasReferenceImages);

    // Namespaced models (google/…, alibaba/…) — use the model path directly
    if (prefix === '') {
      return `/${modelPath}${suffix}`;
    }

    // Legacy fal-ai models
    const baseModel = modelPath.split('/')[0];
    if (modelPath.includes('/') && !modelPath.startsWith('reve')) {
      return `${prefix}/${modelPath}${suffix}`;
    }
    return `${prefix}/${baseModel}${suffix}`;
  }

  private async pollUntilComplete(modelPath: string, requestId: string): Promise<FalResultResponse> {
    const prefix = this.getModelUrlPrefix(modelPath);
    const ownerApp = this.extractOwnerApp(modelPath);
    let attempts = 0;

    while (attempts < this.maxPollAttempts) {
      const statusUrl = prefix
        ? `${prefix}/${ownerApp}/requests/${requestId}/status`
        : `/${ownerApp}/requests/${requestId}/status`;
      const statusResponse = await this.axiosInstance.get<FalStatusResponse>(statusUrl);
      const status = statusResponse.data?.status;

      if (status === 'COMPLETED') {
        const resultUrl = prefix
          ? `${prefix}/${ownerApp}/requests/${requestId}`
          : `/${ownerApp}/requests/${requestId}`;
        const resultResponse = await this.axiosInstance.get<FalResultResponse>(resultUrl);
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
