import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  UnifiedStorageService,
  StorageResult,
  GCSConfig,
  getContentType,
} from '@shared/storage';

/**
 * Service to get public URLs for local files
 * 
 * Priority order:
 * 1. GCS (Google Cloud Storage) - Primary, if enabled
 * 2. Backend URL - Fallback for dev/prod when files are publicly accessible
 * 3. Local path - Emergency fallback for internal service use
 */
@Injectable()
export class PublicUrlService {
  private readonly nodeEnv: string;
  private readonly backendBaseUrl: string;
  private readonly unifiedStorage: UnifiedStorageService;
  private readonly uploadsBaseDir: string;

  constructor(private readonly configService: ConfigService) {
    this.nodeEnv = this.configService.get<string>('NODE_ENV') || 'local';
    
    // Get backend base URL - for local, use localhost with service port
    const servicePort = this.configService.get<number>('SERVICE_PORT', 9004);
    this.backendBaseUrl = this.configService.get<string>('BACKEND_BASE_URL') || 
      `http://localhost:${servicePort}`;
    
    // Setup uploads directory
    this.uploadsBaseDir = this.configService.get<string>('UPLOADS_DIR') || 
      path.join(process.cwd(), 'uploads');

    // Initialize GCS configuration
    const gcsConfig: GCSConfig = {
      enabled: this.configService.get<string>('GCS_ENABLED') === 'true',
      bucketName: this.configService.get<string>('GCS_BUCKET_NAME') || '',
      projectId: this.configService.get<string>('GCS_PROJECT_ID'),
      credentialsPath: this.configService.get<string>('GOOGLE_APPLICATION_CREDENTIALS'),
      credentialsBase64: this.configService.get<string>('GCS_CREDENTIALS_JSON_BASE64'),
    };

    // Validate GCS config if enabled
    if (gcsConfig.enabled && !gcsConfig.bucketName) {
      console.warn('[PublicUrlService] GCS is enabled but GCS_BUCKET_NAME is not set. GCS will be disabled.');
      gcsConfig.enabled = false;
    }

    // Initialize unified storage service
    this.unifiedStorage = new UnifiedStorageService({
      gcs: gcsConfig,
      backendBaseUrl: this.backendBaseUrl,
      uploadsBaseDir: this.uploadsBaseDir,
      service: 'video-processing',
    });

    // Log initialization status
    if (this.unifiedStorage.isGcsAvailable()) {
      console.log(`[PublicUrlService] ✅ GCS storage initialized for video-processing-service (bucket: ${gcsConfig.bucketName})`);
    } else {
      console.log(`[PublicUrlService] Using local/backend URL fallback (GCS not available)`);
    }
  }

  /**
   * Get public URL for a local file
   * @param localPath - Full path to the local file (e.g., /path/to/uploads/images/user123/file.jpg)
   * @param localUrl - Relative URL path (e.g., /uploads/images/user123/file.jpg)
   * @returns Public URL that can be used by external services (BytePlus, FAL, HeyGen, etc.)
   */
  async getPublicUrl(localPath: string, localUrl: string): Promise<string> {
    // Validate file exists
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found at path: ${localPath}`);
    }

    try {
      const result = await this.unifiedStorage.getPublicUrl({
        localPath,
        localUrl,
      });

      if (result.isGcs) {
        console.log(`[PublicUrlService] ✅ Using GCS URL: ${result.publicUrl}`);
      } else {
        console.log(`[PublicUrlService] Using backend URL fallback: ${result.publicUrl}`);
      }

      return result.publicUrl;
    } catch (error: any) {
      console.error(`[PublicUrlService] Failed to get public URL: ${error.message}`);
      // Final fallback to backend URL
      const fallbackUrl = `${this.backendBaseUrl}${localUrl}`;
      console.log(`[PublicUrlService] Using emergency fallback URL: ${fallbackUrl}`);
      return fallbackUrl;
    }
  }

  /**
   * Upload a file from buffer and get storage result with both local and GCS URLs
   * @param buffer - File content as buffer
   * @param subPath - Sub-path within service folder (e.g., "images/user123")
   * @param filename - Filename for the uploaded file
   * @param contentType - MIME content type (auto-detected if not provided)
   * @returns StorageResult with local and GCS URLs
   */
  async uploadFromBuffer(
    buffer: Buffer,
    subPath: string,
    filename: string,
    contentType?: string
  ): Promise<StorageResult> {
    // Determine local directory
    const localDir = path.join(this.uploadsBaseDir, subPath);
    
    // Auto-detect content type if not provided
    const mimeType = contentType || getContentType(filename);

    const result = await this.unifiedStorage.uploadFromBuffer({
      buffer,
      localDir,
      filename,
      contentType: mimeType,
      service: 'video-processing',
      subPath,
      makePublic: true,
    });

    if (result.gcsUploaded) {
      console.log(`[PublicUrlService] ✅ File uploaded to GCS: ${result.gcsUrl}`);
    } else {
      console.log(`[PublicUrlService] File saved locally: ${result.localPath}`);
    }

    return result;
  }

  /**
   * Upload an existing local file to GCS and get storage result
   * @param localPath - Full path to the local file
   * @param subPath - Sub-path within service folder
   * @param filename - Filename (defaults to basename of localPath)
   * @param contentType - MIME content type (auto-detected if not provided)
   * @returns StorageResult with local and GCS URLs
   */
  async uploadFromPath(
    localPath: string,
    subPath: string,
    filename?: string,
    contentType?: string
  ): Promise<StorageResult> {
    const finalFilename = filename || path.basename(localPath);
    const mimeType = contentType || getContentType(finalFilename);

    const result = await this.unifiedStorage.uploadFromPath({
      localPath,
      filename: finalFilename,
      contentType: mimeType,
      service: 'video-processing',
      subPath,
      makePublic: true,
    });

    if (result.gcsUploaded) {
      console.log(`[PublicUrlService] ✅ File uploaded to GCS: ${result.gcsUrl}`);
    } else {
      console.log(`[PublicUrlService] Using local path: ${result.localPath}`);
    }

    return result;
  }

  /**
   * Check if a URL is already public (starts with http/https)
   * Useful for skipping upload if URL is already public
   */
  isPublicUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
  }

  /**
   * Check if GCS storage is available
   */
  isGcsAvailable(): boolean {
    return this.unifiedStorage.isGcsAvailable();
  }

  /**
   * Get the unified storage service for advanced operations
   */
  getUnifiedStorage(): UnifiedStorageService {
    return this.unifiedStorage;
  }

  /**
   * Signed GCS URL for browser download (attachment disposition).
   */
  async getSignedDownloadUrl(
    gcsPath: string,
    filename: string,
    expiresInMinutes: number = 15,
  ): Promise<string> {
    const safeName = filename.replace(/"/g, '');
    const responseDisposition = `attachment; filename="${safeName}"`;
    return this.unifiedStorage.getSignedUrl(gcsPath, expiresInMinutes, {
      responseDisposition,
    });
  }
}
