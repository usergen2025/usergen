import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FreepikProvider } from './providers/freepik.provider';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

export interface StockSearchResult {
  id: string;
  type: 'image' | 'video';
  source: 'freepik';
  title: string;
  thumbnailUrl: string;
  previewUrl: string;
  aspectRatio: string;
  premium: boolean;
  duration?: string;
  quality?: string;
}

export interface StockSearchRequest {
  term: string;
  type: 'image' | 'video';
  page?: number;
  limit?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
}

export interface StockSearchResponse {
  results: StockSearchResult[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface StockDownloadResult {
  localPath: string;
  gcsUrl?: string;
  filename: string;
}

@Injectable()
export class StockService {
  constructor(
    private readonly configService: ConfigService,
    private readonly freepikProvider: FreepikProvider,
  ) {}

  /**
   * Search for stock media (images or videos)
   */
  async searchStock(request: StockSearchRequest): Promise<StockSearchResponse> {
    if (!this.freepikProvider.isConfigured()) {
      throw new Error('Freepik API is not configured');
    }

    if (request.type === 'image') {
      return this.searchImages(request);
    } else {
      return this.searchVideos(request);
    }
  }

  private async searchImages(request: StockSearchRequest): Promise<StockSearchResponse> {
    // Map aspect ratio to orientation filter
    const orientationFilter: { portrait?: 0 | 1; landscape?: 0 | 1; square?: 0 | 1 } = {};
    if (request.aspectRatio === '9:16') {
      orientationFilter.portrait = 1;
    } else if (request.aspectRatio === '16:9') {
      orientationFilter.landscape = 1;
    } else if (request.aspectRatio === '1:1') {
      orientationFilter.square = 1;
    }

    const response = await this.freepikProvider.searchResources({
      term: request.term,
      page: request.page || 1,
      limit: request.limit || 20,
      filters: {
        orientation: Object.keys(orientationFilter).length > 0 ? orientationFilter : undefined,
        content_type: { photo: 1 },
      },
    });

    const results: StockSearchResult[] = response.data.map(resource => ({
      id: `freepik-image-${resource.id}`,
      type: 'image' as const,
      source: 'freepik' as const,
      title: resource.title,
      thumbnailUrl: resource.image.source.url,
      previewUrl: resource.image.source.url,
      aspectRatio: this.mapOrientation(resource.image.orientation),
      premium: resource.licenses.some(l => l.type === 'premium'),
    }));

    // Freepik pagination metadata can be missing or differ between endpoints.
    // Guard against undefined meta.pagination and fall back to sensible defaults.
    const paginationMeta = (response as any)?.meta?.pagination;

    const total =
      typeof paginationMeta?.total === 'number'
        ? paginationMeta.total
        : results.length;
    const page =
      typeof paginationMeta?.current_page === 'number'
        ? paginationMeta.current_page
        : request.page || 1;
    const limit =
      typeof paginationMeta?.per_page === 'number'
        ? paginationMeta.per_page
        : request.limit || 20;
    const totalPages =
      typeof paginationMeta?.total_pages === 'number' && paginationMeta.total_pages > 0
        ? paginationMeta.total_pages
        : Math.max(1, Math.ceil(total / limit));

    return {
      results,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  private async searchVideos(request: StockSearchRequest): Promise<StockSearchResponse> {
    // Map aspect ratio to filter
    const aspectRatioFilter: ('9:16' | '16:9' | '1:1')[] = [];
    if (request.aspectRatio) {
      aspectRatioFilter.push(request.aspectRatio);
    }

    const response = await this.freepikProvider.searchVideos({
      term: request.term,
      page: request.page || 1,
      filters: {
        aspect_ratio: aspectRatioFilter.length > 0 ? aspectRatioFilter : undefined,
      },
    });

    const results: StockSearchResult[] = response.data.map(video => ({
      id: `freepik-video-${video.id}`,
      type: 'video' as const,
      source: 'freepik' as const,
      title: video.name,
      thumbnailUrl: video.thumbnails[0]?.url || '',
      previewUrl: video.previews[0]?.url || video.thumbnails[0]?.url || '',
      aspectRatio: video['aspect-ratio'],
      premium: video.premium,
      duration: video.duration,
      quality: video.quality,
    }));

    return {
      results,
      pagination: {
        total: response.meta.pagination.total,
        page: response.meta.pagination.current_page,
        limit: response.meta.pagination.per_page,
        totalPages: response.meta.pagination.total_pages,
      },
    };
  }

  /**
   * Download stock item and optionally upload to GCS
   */
  async downloadStockItem(
    stockId: string,
    type: 'image' | 'video',
    projectId?: string,
  ): Promise<StockDownloadResult> {
    // Parse the stock ID to get the Freepik ID
    const freepikId = parseInt(stockId.replace(`freepik-${type}-`, ''), 10);
    
    if (isNaN(freepikId)) {
      throw new Error(`Invalid stock ID format: ${stockId}`);
    }

    let downloadResponse;
    if (type === 'image') {
      downloadResponse = await this.freepikProvider.downloadResource(freepikId, 'large');
    } else {
      downloadResponse = await this.freepikProvider.downloadVideo(freepikId);
    }

    const downloadUrl = downloadResponse.data.url;
    const filename = downloadResponse.data.filename;

    // Download the file
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
    });

    // Save to local storage
    const uploadDir = path.join(process.cwd(), 'uploads', 'stock', projectId || 'general');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const localPath = path.join(uploadDir, filename);
    fs.writeFileSync(localPath, response.data);

    console.log(`[StockService] Downloaded stock ${type} to: ${localPath}`);

    return {
      localPath,
      filename,
    };
  }

  private mapOrientation(orientation: 'horizontal' | 'vertical' | 'square'): string {
    switch (orientation) {
      case 'vertical':
        return '9:16';
      case 'horizontal':
        return '16:9';
      case 'square':
        return '1:1';
      default:
        return '16:9';
    }
  }
}
