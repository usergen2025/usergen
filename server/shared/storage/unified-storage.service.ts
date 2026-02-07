/**
 * Unified Storage Service
 * 
 * Provides a unified interface for file storage that:
 * 1. Saves files locally first (always)
 * 2. Uploads to GCS for public URL (if enabled)
 * 3. Falls back to local/backend URLs if GCS fails
 * 
 * This ensures files are always available locally as fallback.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GCSStorageService } from './gcs-storage.service';
import {
  StorageResult,
  UploadFromBufferOptions,
  UploadFromPathOptions,
  StorageService,
  GCSConfig,
  PublicUrlResult,
  FileInfo,
} from './storage.types';
import { buildGcsPath, getContentType } from './storage.constants';

export interface UnifiedStorageConfig {
  /** GCS configuration */
  gcs: GCSConfig;
  /** Backend base URL for local file URLs (e.g., http://localhost:9001) */
  backendBaseUrl: string;
  /** Base uploads directory (e.g., /path/to/uploads) */
  uploadsBaseDir: string;
  /** Service identifier */
  service: StorageService;
}

export class UnifiedStorageService {
  private readonly gcsService: GCSStorageService;
  private readonly config: UnifiedStorageConfig;

  constructor(config: UnifiedStorageConfig) {
    this.config = config;
    this.gcsService = new GCSStorageService(config.gcs);
  }

  /**
   * Check if GCS is available and enabled
   */
  isGcsAvailable(): boolean {
    return this.gcsService.isAvailable();
  }

  /**
   * Upload a file from a buffer, saving locally first then to GCS
   */
  async uploadFromBuffer(options: UploadFromBufferOptions): Promise<StorageResult> {
    const { buffer, localDir, filename, contentType, subPath, makePublic = true, metadata } = options;

    // Ensure local directory exists
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    // Save locally first
    const localPath = path.join(localDir, filename);
    fs.writeFileSync(localPath, buffer);

    // Build local URL
    const localUrl = this.buildLocalUrl(localPath);

    // Default result (local only)
    let result: StorageResult = {
      localPath,
      localUrl,
      publicUrl: this.buildBackendUrl(localUrl),
      gcsUploaded: false,
    };

    // Try to upload to GCS
    if (this.isGcsAvailable()) {
      try {
        const gcsPath = buildGcsPath(this.config.service, subPath, filename);
        const gcsResult = await this.gcsService.uploadFromBuffer(
          buffer,
          gcsPath,
          contentType,
          makePublic,
          metadata
        );

        result = {
          ...result,
          gcsUrl: gcsResult.gcsUrl,
          gcsPath: gcsResult.gcsPath,
          publicUrl: gcsResult.gcsUrl, // GCS URL takes priority
          gcsUploaded: true,
        };

        console.log(`[UnifiedStorage] File uploaded to GCS: ${gcsResult.gcsUrl}`);
      } catch (error: any) {
        console.warn(`[UnifiedStorage] GCS upload failed, using local fallback: ${error.message}`);
        // Keep local-only result
      }
    }

    return result;
  }

  /**
   * Upload a file from local path to GCS (file already exists locally)
   */
  async uploadFromPath(options: UploadFromPathOptions): Promise<StorageResult> {
    const { localPath, filename, contentType, subPath, makePublic = true, metadata } = options;

    // Verify file exists
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found: ${localPath}`);
    }

    // Build local URL
    const localUrl = this.buildLocalUrl(localPath);

    // Default result (local only)
    let result: StorageResult = {
      localPath,
      localUrl,
      publicUrl: this.buildBackendUrl(localUrl),
      gcsUploaded: false,
    };

    // Try to upload to GCS
    if (this.isGcsAvailable()) {
      try {
        const gcsPath = buildGcsPath(this.config.service, subPath, filename);
        const gcsResult = await this.gcsService.uploadFromPath(
          localPath,
          gcsPath,
          contentType,
          makePublic,
          metadata
        );

        result = {
          ...result,
          gcsUrl: gcsResult.gcsUrl,
          gcsPath: gcsResult.gcsPath,
          publicUrl: gcsResult.gcsUrl, // GCS URL takes priority
          gcsUploaded: true,
        };

        console.log(`[UnifiedStorage] File uploaded to GCS: ${gcsResult.gcsUrl}`);
      } catch (error: any) {
        console.warn(`[UnifiedStorage] GCS upload failed, using local fallback: ${error.message}`);
        // Keep local-only result
      }
    }

    return result;
  }

  /**
   * Get public URL for an existing file
   * - First tries GCS if available and file exists
   * - Falls back to uploading to GCS if local file exists
   * - Falls back to backend URL if GCS unavailable
   */
  async getPublicUrl(fileInfo: FileInfo): Promise<PublicUrlResult> {
    const { localPath, localUrl, gcsUrl } = fileInfo;

    // If we already have a GCS URL, return it
    if (gcsUrl) {
      return {
        publicUrl: gcsUrl,
        gcsUrl,
        isGcs: true,
      };
    }

    // Verify local file exists
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found: ${localPath}`);
    }

    // Try to upload to GCS if available
    if (this.isGcsAvailable()) {
      try {
        // Extract sub-path from local URL (e.g., /uploads/images/user123/file.jpg -> images/user123)
        const subPath = this.extractSubPath(localUrl);
        const filename = path.basename(localPath);
        const contentType = getContentType(filename);

        const gcsPath = buildGcsPath(this.config.service, subPath, filename);
        const gcsResult = await this.gcsService.uploadFromPath(
          localPath,
          gcsPath,
          contentType,
          true // makePublic
        );

        return {
          publicUrl: gcsResult.gcsUrl,
          gcsUrl: gcsResult.gcsUrl,
          isGcs: true,
        };
      } catch (error: any) {
        console.warn(`[UnifiedStorage] GCS upload failed for public URL: ${error.message}`);
      }
    }

    // Fallback to backend URL
    return {
      publicUrl: this.buildBackendUrl(localUrl),
      isGcs: false,
    };
  }

  /**
   * Download a file from GCS to local path
   */
  async downloadFromGcs(gcsPath: string, localDestination: string): Promise<void> {
    if (!this.isGcsAvailable()) {
      throw new Error('GCS is not available');
    }

    await this.gcsService.download(gcsPath, localDestination);
  }

  /**
   * Check if a file exists in GCS
   */
  async existsInGcs(gcsPath: string): Promise<boolean> {
    if (!this.isGcsAvailable()) {
      return false;
    }

    return this.gcsService.exists(gcsPath);
  }

  /**
   * Delete a file from GCS (keeps local copy)
   */
  async deleteFromGcs(gcsPath: string): Promise<void> {
    if (!this.isGcsAvailable()) {
      throw new Error('GCS is not available');
    }

    await this.gcsService.delete(gcsPath);
  }

  /**
   * Get a signed URL for temporary access
   */
  async getSignedUrl(gcsPath: string, expiresInMinutes: number = 60): Promise<string> {
    if (!this.isGcsAvailable()) {
      throw new Error('GCS is not available');
    }

    return this.gcsService.getSignedUrl(gcsPath, expiresInMinutes);
  }

  /**
   * Build local URL from full path
   */
  private buildLocalUrl(fullPath: string): string {
    // Extract the /uploads/... portion
    const uploadsIndex = fullPath.indexOf('/uploads/');
    if (uploadsIndex !== -1) {
      return fullPath.substring(uploadsIndex);
    }

    // Windows path compatibility
    const windowsUploadsIndex = fullPath.indexOf('\\uploads\\');
    if (windowsUploadsIndex !== -1) {
      return fullPath.substring(windowsUploadsIndex).replace(/\\/g, '/');
    }

    // Fallback: use relative to uploads base dir
    const relativePath = path.relative(this.config.uploadsBaseDir, fullPath);
    return `/uploads/${relativePath.replace(/\\/g, '/')}`;
  }

  /**
   * Build backend URL from local URL
   */
  private buildBackendUrl(localUrl: string): string {
    return `${this.config.backendBaseUrl}${localUrl}`;
  }

  /**
   * Extract sub-path from local URL
   * E.g., /uploads/images/user123/file.jpg -> images/user123
   */
  private extractSubPath(localUrl: string): string {
    // Remove /uploads/ prefix and filename
    const withoutPrefix = localUrl.replace(/^\/uploads\//, '');
    const parts = withoutPrefix.split('/');
    // Remove filename (last part)
    parts.pop();
    return parts.join('/');
  }

  /**
   * Get the underlying GCS service for advanced operations
   */
  getGcsService(): GCSStorageService {
    return this.gcsService;
  }

  /**
   * Get bucket name
   */
  getBucketName(): string {
    return this.config.gcs.bucketName;
  }
}

/**
 * Factory function to create UnifiedStorageService from environment variables
 */
export function createUnifiedStorageFromEnv(
  service: StorageService,
  backendBaseUrl: string,
  uploadsBaseDir: string,
  env: NodeJS.ProcessEnv = process.env
): UnifiedStorageService {
  const gcsConfig: GCSConfig = {
    enabled: env.GCS_ENABLED === 'true',
    bucketName: env.GCS_BUCKET_NAME || '',
    projectId: env.GCS_PROJECT_ID,
    credentialsPath: env.GOOGLE_APPLICATION_CREDENTIALS,
    credentialsBase64: env.GCS_CREDENTIALS_JSON_BASE64,
  };

  // Validate GCS config if enabled
  if (gcsConfig.enabled && !gcsConfig.bucketName) {
    console.warn('[UnifiedStorage] GCS is enabled but GCS_BUCKET_NAME is not set. GCS will be disabled.');
    gcsConfig.enabled = false;
  }

  return new UnifiedStorageService({
    gcs: gcsConfig,
    backendBaseUrl,
    uploadsBaseDir,
    service,
  });
}


