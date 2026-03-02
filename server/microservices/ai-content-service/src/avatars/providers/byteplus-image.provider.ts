import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface BytePlusImageToImageRequest {
  model: string;
  prompt: string;
  image: string; // Base64 encoded image
  size: string; // "1080x1920" or "1080x960"
  response_format?: 'url' | 'b64_json';
  sequential_image_generation?: 'auto' | 'disabled';
  watermark?: boolean;
}

export interface BytePlusImageToImageResponse {
  model: string;
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    size?: string;
    error?: {
      code: string;
      message: string;
    };
  }>;
  usage: {
    generated_images: number;
    output_tokens: number;
    total_tokens: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

@Injectable()
export class BytePlusImageProvider {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;
  private readonly model = 'seedream-4-5-251128'; // Seedream 4.5 model

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('BYTEPLUS_API_KEY') || '';
    this.baseUrl = this.configService.get<string>('BYTEPLUS_BASE_URL') || 'https://ark.ap-southeast.bytepluses.com/api/v3';
    
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 300000, // 5 minutes for image generation
    });
  }

  /**
   * Generate image variant using image-to-image generation
   * @param imageBase64 Base64 encoded reference image
   * @param prompt Prompt for image generation
   * @param dimensions Target dimensions (e.g., "1080x1920" or "1080x960")
   * @returns Generated image URL or Base64
   */
  async generateImageVariant(
    imageBase64: string,
    prompt: string,
    dimensions: string
  ): Promise<{ imageUrl: string; imageBase64?: string }> {
    try {
      // Ensure Base64 format is correct
      const base64Image = imageBase64.startsWith('data:image/')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;

      const request: BytePlusImageToImageRequest = {
        model: this.model,
        prompt: prompt,
        image: base64Image,
        size: dimensions,
        response_format: 'url', // Get URL, we'll download and upload to HeyGen
        watermark: false,
        sequential_image_generation: 'disabled', // Single image
      };

      console.log(`[BytePlusImageProvider] Generating image variant: ${dimensions}`);
      
      const response = await this.axiosInstance.post<BytePlusImageToImageResponse>(
        '/images/generations',
        request
      );

      if (response.data.error) {
        throw new Error(`BytePlus image generation failed: ${response.data.error.message}`);
      }

      if (!response.data.data || !response.data.data[0]) {
        throw new Error('BytePlus API did not return image data');
      }

      const imageData = response.data.data[0];
      
      if (imageData.error) {
        throw new Error(`Image generation error: ${imageData.error.message}`);
      }

      if (!imageData.url) {
        throw new Error('BytePlus API did not return image URL');
      }

      console.log(`[BytePlusImageProvider] Image variant generated successfully: ${imageData.url}`);
      
      return {
        imageUrl: imageData.url,
      };
    } catch (error: any) {
      console.error('[BytePlusImageProvider] Image generation error:', error.response?.data || error.message);
      throw new Error(`Failed to generate image variant: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Generate multiple image variants in parallel
   */
  async generateImageVariants(
    imageBase64: string,
    variants: Array<{ prompt: string; dimensions: string }>
  ): Promise<Array<{ imageUrl: string; dimensions: string }>> {
    const promises = variants.map(variant =>
      this.generateImageVariant(imageBase64, variant.prompt, variant.dimensions)
        .then(result => ({ ...result, dimensions: variant.dimensions }))
        .catch(error => {
          console.error(`[BytePlusImageProvider] Failed to generate ${variant.dimensions}:`, error);
          throw error;
        })
    );

    return Promise.all(promises);
  }
}






