import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface FreepikSearchParams {
  term: string;
  page?: number;
  limit?: number;
  order?: 'relevance' | 'recent';
  filters?: {
    orientation?: {
      landscape?: 0 | 1;
      portrait?: 0 | 1;
      square?: 0 | 1;
      panoramic?: 0 | 1;
    };
    content_type?: {
      photo?: 0 | 1;
      vector?: 0 | 1;
      psd?: 0 | 1;
    };
    license?: {
      freemium?: 0 | 1;
      premium?: 0 | 1;
    };
    'ai-generated'?: {
      excluded?: 0 | 1;
      only?: 0 | 1;
    };
  };
}

export interface FreepikVideoSearchParams {
  term: string;
  page?: number;
  order?: 'relevance' | 'recent' | 'random';
  filters?: {
    aspect_ratio?: ('1:1' | '4:3' | '9:16' | '16:9' | '256:135')[];
    category?: 'footage' | 'motion_graphics';
    duration?: { from?: number; to?: number };
    orientation?: ('horizontal' | 'vertical' | 'square' | 'panoramic')[];
    license?: { free?: boolean; premium?: boolean };
    resolution?: { '720p'?: boolean; '1080p'?: boolean; '2k'?: boolean; '4k'?: boolean };
    'ai-generated'?: { excluded?: boolean; only?: boolean };
  };
}

export interface FreepikResource {
  id: number;
  title: string;
  url: string;
  image: {
    orientation: 'horizontal' | 'vertical' | 'square';
    source: { size: string; key: string; url: string };
    type: 'photo' | 'vector' | 'psd';
  };
  author: { id: number; name: string; avatar: string };
  licenses: { type: 'freemium' | 'premium'; url: string }[];
}

export interface FreepikVideo {
  id: number;
  url: string;
  name: string;
  'aspect-ratio': '16:9' | '9:16' | '1:1' | '4:3';
  quality: '720p' | '1080p' | '2k' | '4k';
  premium: boolean;
  duration: string;
  thumbnails: { width: number; height: number; url: string; 'aspect-ratio': string }[];
  previews: { width: number; height: number; url: string; 'aspect-ratio': string }[];
}

export interface FreepikSearchResponse {
  data: FreepikResource[];
  meta: {
    pagination: {
      total: number;
      count: number;
      per_page: number;
      current_page: number;
      total_pages: number;
    };
  };
}

export interface FreepikVideoSearchResponse {
  data: FreepikVideo[];
  meta: {
    pagination: {
      total: number;
      count: number;
      per_page: number;
      current_page: number;
      total_pages: number;
    };
  };
}

export interface FreepikDownloadResponse {
  data: {
    filename: string;
    url: string;
  };
}

@Injectable()
export class FreepikProvider {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FREEPIK_API_KEY') || '';
    this.baseUrl = this.configService.get<string>('FREEPIK_API_BASE_URL') || 'https://api.freepik.com';

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'x-freepik-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Search for images/photos on Freepik
   */
  async searchResources(params: FreepikSearchParams): Promise<FreepikSearchResponse> {
    try {
      const queryParams: Record<string, any> = {
        term: params.term,
        page: params.page || 1,
        limit: params.limit || 20,
        order: params.order || 'relevance',
      };

      // Add filters
      if (params.filters) {
        if (params.filters.orientation) {
          Object.entries(params.filters.orientation).forEach(([key, value]) => {
            queryParams[`filters[orientation][${key}]`] = value;
          });
        }
        if (params.filters.content_type) {
          Object.entries(params.filters.content_type).forEach(([key, value]) => {
            queryParams[`filters[content_type][${key}]`] = value;
          });
        }
        if (params.filters.license) {
          Object.entries(params.filters.license).forEach(([key, value]) => {
            queryParams[`filters[license][${key}]`] = value;
          });
        }
      }

      // Default to photos only
      if (!params.filters?.content_type) {
        queryParams['filters[content_type][photo]'] = 1;
      }

      console.log(`[FreepikProvider] Searching resources with term: ${params.term}`);

      const response = await this.axiosInstance.get<FreepikSearchResponse>('/v1/resources', {
        params: queryParams,
      });

      console.log(`[FreepikProvider] Found ${response.data.data.length} resources`);

      return response.data;
    } catch (error: any) {
      console.error('[FreepikProvider] Search resources error:', error.response?.data || error.message);
      throw new Error(`Failed to search Freepik resources: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Search for videos on Freepik
   */
  async searchVideos(params: FreepikVideoSearchParams): Promise<FreepikVideoSearchResponse> {
    try {
      const queryParams: Record<string, any> = {
        term: params.term,
        page: params.page || 1,
        order: params.order || 'relevance',
      };

      // Add filters
      if (params.filters) {
        if (params.filters.aspect_ratio && params.filters.aspect_ratio.length > 0) {
          params.filters.aspect_ratio.forEach((ratio, index) => {
            queryParams[`filters[aspect_ratio][${index}]`] = ratio;
          });
        }
        if (params.filters.orientation && params.filters.orientation.length > 0) {
          params.filters.orientation.forEach((orient, index) => {
            queryParams[`filters[orientation][${index}]`] = orient;
          });
        }
        if (params.filters.category) {
          queryParams['filters[category]'] = params.filters.category;
        }
        if (params.filters.duration) {
          if (params.filters.duration.from) {
            queryParams['filters[duration][from]'] = params.filters.duration.from;
          }
          if (params.filters.duration.to) {
            queryParams['filters[duration][to]'] = params.filters.duration.to;
          }
        }
      }

      console.log(`[FreepikProvider] Searching videos with term: ${params.term}`);

      const response = await this.axiosInstance.get<FreepikVideoSearchResponse>('/v1/videos', {
        params: queryParams,
      });

      console.log(`[FreepikProvider] Found ${response.data.data.length} videos`);

      return response.data;
    } catch (error: any) {
      console.error('[FreepikProvider] Search videos error:', error.response?.data || error.message);
      throw new Error(`Failed to search Freepik videos: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get resource detail by ID
   */
  async getResourceDetail(resourceId: number): Promise<FreepikResource> {
    try {
      const response = await this.axiosInstance.get<{ data: FreepikResource }>(`/v1/resources/${resourceId}`);
      return response.data.data;
    } catch (error: any) {
      console.error('[FreepikProvider] Get resource detail error:', error.response?.data || error.message);
      throw new Error(`Failed to get resource detail: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get video detail by ID
   */
  async getVideoDetail(videoId: number): Promise<FreepikVideo> {
    try {
      const response = await this.axiosInstance.get<{ data: FreepikVideo }>(`/v1/videos/${videoId}`);
      return response.data.data;
    } catch (error: any) {
      console.error('[FreepikProvider] Get video detail error:', error.response?.data || error.message);
      throw new Error(`Failed to get video detail: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Download resource (image) by ID
   */
  async downloadResource(resourceId: number, imageSize?: 'small' | 'medium' | 'large' | 'original'): Promise<FreepikDownloadResponse> {
    try {
      const params: Record<string, any> = {};
      if (imageSize) {
        params.image_size = imageSize;
      }

      const response = await this.axiosInstance.get<FreepikDownloadResponse>(`/v1/resources/${resourceId}/download`, {
        params,
      });

      console.log(`[FreepikProvider] Downloaded resource ${resourceId}: ${response.data.data.filename}`);

      return response.data;
    } catch (error: any) {
      console.error('[FreepikProvider] Download resource error:', error.response?.data || error.message);
      throw new Error(`Failed to download resource: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Download video by ID
   */
  async downloadVideo(videoId: number): Promise<FreepikDownloadResponse> {
    try {
      const response = await this.axiosInstance.get<FreepikDownloadResponse>(`/v1/videos/${videoId}/download`);

      console.log(`[FreepikProvider] Downloaded video ${videoId}: ${response.data.data.filename}`);

      return response.data;
    } catch (error: any) {
      console.error('[FreepikProvider] Download video error:', error.response?.data || error.message);
      throw new Error(`Failed to download video: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }
}
