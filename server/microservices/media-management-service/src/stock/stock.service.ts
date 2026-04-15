import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FreepikProvider } from './providers/freepik.provider';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import {
  UnifiedStorageService,
  UnifiedStorageConfig,
  GCSConfig,
  getContentType,
} from '@shared/storage';
import { processStockVideo, cleanupProcessedFiles } from './utils/video-processor.util';

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
  durationSeconds?: number; // Parsed duration in seconds
  quality?: string;
}

export interface StockSearchRequest {
  term: string;
  type: 'image' | 'video';
  page?: number;
  limit?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  // Duration filtering for videos (in seconds)
  minDuration?: number;
  maxDuration?: number;
  targetDuration?: number; // Preferred exact match duration
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
  localUrl: string;
  gcsUrl?: string;
  publicUrl: string;
  filename: string;
  // Video processing info
  originalDuration?: number;
  finalDuration?: number;
  originalSizeMB?: number;
  finalSizeMB?: number;
  trimmed?: boolean;
  compressed?: boolean;
}

@Injectable()
export class StockService {
  private readonly unifiedStorage: UnifiedStorageService;

  constructor(
    private readonly configService: ConfigService,
    private readonly freepikProvider: FreepikProvider,
  ) {
    // Initialize unified storage for GCS uploads
    const gcsConfig: GCSConfig = {
      enabled: this.configService.get<string>('GCS_ENABLED') === 'true',
      bucketName: this.configService.get<string>('GCS_BUCKET_NAME') || '',
      projectId: this.configService.get<string>('GCS_PROJECT_ID'),
      credentialsPath: this.configService.get<string>('GOOGLE_APPLICATION_CREDENTIALS'),
      credentialsBase64: this.configService.get<string>('GCS_CREDENTIALS_JSON_BASE64'),
    };

    const storageConfig: UnifiedStorageConfig = {
      gcs: gcsConfig,
      backendBaseUrl: this.configService.get<string>('BACKEND_BASE_URL') || 'http://localhost:9009',
      uploadsBaseDir: path.join(process.cwd(), 'uploads'),
      service: 'media',
    };

    this.unifiedStorage = new UnifiedStorageService(storageConfig);
  }

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
      // If targetDuration is specified, use smart multi-pass search
      if (request.targetDuration) {
        return this.searchVideosWithDurationMatching(request);
      }
      return this.searchVideos(request);
    }
  }

  /**
   * Smart multi-pass video search with duration matching
   * Pass 1: Exact match (targetDuration - 1 to targetDuration + 2)
   * Pass 2: Slightly longer (targetDuration to targetDuration + 5)
   * Pass 3: Broader range (targetDuration to targetDuration + 15)
   * Pass 4: Fallback (no duration filter)
   */
  private async searchVideosWithDurationMatching(request: StockSearchRequest): Promise<StockSearchResponse> {
    const targetDuration = request.targetDuration!;
    
    // Define search passes with progressively broader duration ranges
    const searchPasses = [
      { name: 'exact', from: Math.max(1, targetDuration - 1), to: targetDuration + 2 },
      { name: 'slightly-longer', from: targetDuration, to: targetDuration + 5 },
      { name: 'broader', from: targetDuration, to: targetDuration + 15 },
      { name: 'fallback', from: undefined, to: undefined },
    ];

    for (const pass of searchPasses) {
      console.log(`[StockService] Duration search pass "${pass.name}": from=${pass.from}, to=${pass.to}`);
      
      const searchRequest: StockSearchRequest = {
        ...request,
        minDuration: pass.from,
        maxDuration: pass.to,
      };

      try {
        const response = await this.searchVideos(searchRequest);
        
        if (response.results.length > 0) {
          // Sort results by duration proximity to target
          const sortedResults = response.results.sort((a, b) => {
            const aDiff = Math.abs((a.durationSeconds || 0) - targetDuration);
            const bDiff = Math.abs((b.durationSeconds || 0) - targetDuration);
            return aDiff - bDiff;
          });

          console.log(`[StockService] Found ${sortedResults.length} videos in pass "${pass.name}". Best match: ${sortedResults[0].durationSeconds}s (target: ${targetDuration}s)`);

          return {
            results: sortedResults,
            pagination: response.pagination,
          };
        }
        
        console.log(`[StockService] No results in pass "${pass.name}", trying next pass...`);
      } catch (error: any) {
        console.warn(`[StockService] Error in pass "${pass.name}": ${error.message}`);
      }
    }

    // If all passes fail, return empty result
    console.log(`[StockService] All search passes failed for term "${request.term}"`);
    return {
      results: [],
      pagination: {
        total: 0,
        page: 1,
        limit: request.limit || 20,
        totalPages: 0,
      },
    };
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

    // Build duration filter if specified
    const durationFilter: { from?: number; to?: number } | undefined = 
      (request.minDuration || request.maxDuration) 
        ? {
            from: request.minDuration,
            to: request.maxDuration,
          }
        : undefined;

    console.log(`[StockService] Searching videos with term: "${request.term}", duration filter:`, durationFilter);

    const response = await this.freepikProvider.searchVideos({
      term: request.term,
      page: request.page || 1,
      filters: {
        aspect_ratio: aspectRatioFilter.length > 0 ? aspectRatioFilter : undefined,
        duration: durationFilter,
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
      durationSeconds: this.parseDurationToSeconds(video.duration),
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
   * Parse Freepik duration string (HH:MM:SS or MM:SS) to seconds
   */
  private parseDurationToSeconds(duration: string): number {
    if (!duration) return 0;
    
    const parts = duration.split(':').map(Number);
    if (parts.length === 3) {
      // HH:MM:SS format
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      // MM:SS format
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }

  /**
   * Download stock item and upload to GCS
   * For videos, optionally trim to target duration and compress if too large
   */
  async downloadStockItem(
    stockId: string,
    type: 'image' | 'video',
    projectId?: string,
    targetDuration?: number,
    maxSizeMB: number = 100,
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
    const originalFilename = downloadResponse.data.filename;

    // Download the file from Freepik
    console.log(`[StockService] Downloading stock ${type} from Freepik: ${originalFilename}`);
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
    });

    // Save to local storage
    const uploadDir = path.join(process.cwd(), 'uploads', 'stock', projectId || 'general');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const originalLocalPath = path.join(uploadDir, originalFilename);
    fs.writeFileSync(originalLocalPath, response.data);

    console.log(`[StockService] Downloaded stock ${type} to local: ${originalLocalPath}`);

    // For videos, process (trim and compress) if needed
    let finalLocalPath = originalLocalPath;
    let finalFilename = originalFilename;
    let processingResult: {
      originalDuration?: number;
      finalDuration?: number;
      originalSizeMB?: number;
      finalSizeMB?: number;
      trimmed?: boolean;
      compressed?: boolean;
    } = {};

    if (type === 'video' && targetDuration && targetDuration > 0) {
      console.log(`[StockService] Processing video: target duration ${targetDuration}s, max size ${maxSizeMB} MB`);
      
      try {
        const result = await processStockVideo(originalLocalPath, targetDuration, maxSizeMB);
        
        processingResult = {
          originalDuration: result.originalDuration,
          finalDuration: result.finalDuration,
          originalSizeMB: result.originalSize,
          finalSizeMB: result.finalSize,
          trimmed: result.trimmed,
          compressed: result.compressed,
        };

        if (result.outputPath !== originalLocalPath) {
          finalLocalPath = result.outputPath;
          finalFilename = path.basename(result.outputPath);
          
          // Clean up original file if different from processed
          try {
            fs.unlinkSync(originalLocalPath);
            console.log(`[StockService] Cleaned up original file: ${originalLocalPath}`);
          } catch (cleanupError) {
            console.warn(`[StockService] Could not clean up original file: ${originalLocalPath}`);
          }
        }

        console.log(`[StockService] Video processing complete: ${processingResult.originalDuration?.toFixed(2)}s -> ${processingResult.finalDuration?.toFixed(2)}s, ${processingResult.originalSizeMB?.toFixed(2)} MB -> ${processingResult.finalSizeMB?.toFixed(2)} MB`);
      } catch (processError: any) {
        console.warn(`[StockService] Video processing failed, using original: ${processError.message}`);
      }
    }

    // Upload to GCS for persistent storage
    let gcsUrl: string | undefined;
    let publicUrl: string;
    const localUrl = `/uploads/stock/${projectId || 'general'}/${finalFilename}`;

    try {
      const subPath = `stock/${projectId || 'general'}`;
      const contentType = getContentType(finalFilename);
      
      const uploadResult = await this.unifiedStorage.uploadFromPath({
        localPath: finalLocalPath,
        filename: finalFilename,
        contentType,
        subPath,
        service: 'media',
        makePublic: true,
      });
      
      gcsUrl = uploadResult.gcsUrl;
      publicUrl = uploadResult.publicUrl || gcsUrl || localUrl;
      
      console.log(`[StockService] Uploaded stock ${type} to GCS: ${gcsUrl}`);
    } catch (error: any) {
      console.warn(`[StockService] GCS upload failed, using local fallback: ${error.message}`);
      publicUrl = localUrl;
    }

    return {
      localPath: finalLocalPath,
      localUrl,
      gcsUrl,
      publicUrl,
      filename: finalFilename,
      ...processingResult,
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
