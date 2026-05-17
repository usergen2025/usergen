/**
 * Google Cloud Storage Service
 * 
 * Handles direct interactions with GCS bucket:
 * - Upload files
 * - Download files
 * - Generate public URLs
 * - Delete files
 */

import { Storage, Bucket, File } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import { GCSConfig } from './storage.types';
import { buildGcsPublicUrl } from './storage.constants';

export class GCSStorageService {
  private storage: Storage | null = null;
  private bucket: Bucket | null = null;
  private readonly config: GCSConfig;
  private initialized: boolean = false;

  constructor(config: GCSConfig) {
    this.config = config;
    
    if (config.enabled) {
      this.initialize();
    }
  }

  /**
   * Initialize GCS client
   */
  private initialize(): void {
    try {
      let storageOptions: any = {};

      if (this.config.projectId) {
        storageOptions.projectId = this.config.projectId;
      }

      // Use credentials from file path
      if (this.config.credentialsPath) {
        storageOptions.keyFilename = this.config.credentialsPath;
      }
      // Or use credentials from base64-encoded JSON
      else if (this.config.credentialsBase64) {
        try {
          const credentialsJson = Buffer.from(this.config.credentialsBase64, 'base64').toString('utf-8');
          storageOptions.credentials = JSON.parse(credentialsJson);
        } catch (parseError: any) {
          console.error('[GCSStorageService] Failed to parse credentials from base64:', parseError.message);
          return;
        }
      }
      // Otherwise, use Application Default Credentials (ADC)
      // This works with GOOGLE_APPLICATION_CREDENTIALS env var

      this.storage = new Storage(storageOptions);
      this.bucket = this.storage.bucket(this.config.bucketName);
      this.initialized = true;

      console.log(`[GCSStorageService] Initialized with bucket: ${this.config.bucketName}`);
    } catch (error: any) {
      console.error('[GCSStorageService] Failed to initialize:', error.message);
      this.initialized = false;
    }
  }

  /**
   * Check if GCS is available
   */
  isAvailable(): boolean {
    return this.config.enabled && this.initialized && this.bucket !== null;
  }

  /**
   * Get the bucket name
   */
  getBucketName(): string {
    return this.config.bucketName;
  }

  /**
   * Upload a file from local path to GCS
   */
  async uploadFromPath(
    localPath: string,
    gcsPath: string,
    contentType: string,
    makePublic: boolean = true,
    metadata?: Record<string, string>
  ): Promise<{ gcsUrl: string; gcsPath: string }> {
    if (!this.isAvailable() || !this.bucket) {
      throw new Error('GCS is not available');
    }

    // Verify file exists
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found: ${localPath}`);
    }

    const file = this.bucket.file(gcsPath);

    try {
      // Upload with options
      await this.bucket.upload(localPath, {
        destination: gcsPath,
        metadata: {
          contentType,
          metadata: metadata || {},
        },
      });

      // Make public if requested (gracefully handle uniform bucket-level access)
      if (makePublic) {
        await this.tryMakePublic(file, gcsPath);
      }

      const gcsUrl = buildGcsPublicUrl(this.config.bucketName, gcsPath);

      console.log(`[GCSStorageService] ✅ Uploaded ${path.basename(localPath)} to ${gcsPath}`);

      return { gcsUrl, gcsPath };
    } catch (error: any) {
      console.error(`[GCSStorageService] Upload failed for ${localPath}:`, error.message);
      throw error;
    }
  }

  /**
   * Upload a buffer to GCS
   */
  async uploadFromBuffer(
    buffer: Buffer,
    gcsPath: string,
    contentType: string,
    makePublic: boolean = true,
    metadata?: Record<string, string>
  ): Promise<{ gcsUrl: string; gcsPath: string }> {
    if (!this.isAvailable() || !this.bucket) {
      throw new Error('GCS is not available');
    }

    const file = this.bucket.file(gcsPath);

    try {
      // Save buffer to GCS
      await file.save(buffer, {
        metadata: {
          contentType,
          metadata: metadata || {},
        },
      });

      // Make public if requested (gracefully handle uniform bucket-level access)
      if (makePublic) {
        await this.tryMakePublic(file, gcsPath);
      }

      const gcsUrl = buildGcsPublicUrl(this.config.bucketName, gcsPath);

      console.log(`[GCSStorageService] ✅ Uploaded buffer (${buffer.length} bytes) to ${gcsPath}`);

      return { gcsUrl, gcsPath };
    } catch (error: any) {
      console.error(`[GCSStorageService] Buffer upload failed for ${gcsPath}:`, error.message);
      throw error;
    }
  }

  /**
   * Try to make a file public, gracefully handling uniform bucket-level access
   * When uniform bucket-level access is enabled, individual object ACLs cannot be set.
   * In that case, the bucket itself should be configured for public access.
   */
  private async tryMakePublic(file: File, gcsPath: string): Promise<void> {
    try {
      await file.makePublic();
    } catch (error: any) {
      // Handle uniform bucket-level access - this is not a failure, just a different access model
      if (error.message?.includes('uniform bucket-level access')) {
        console.log(`[GCSStorageService] ℹ️  Uniform bucket-level access enabled for ${gcsPath} - ensure bucket has public access configured`);
        // File was uploaded successfully, just can't set object-level ACL
        // The bucket should be configured with allUsers:objectViewer for public access
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  }

  /**
   * Download a file from GCS to local path
   */
  async download(gcsPath: string, destinationPath: string): Promise<void> {
    if (!this.isAvailable() || !this.bucket) {
      throw new Error('GCS is not available');
    }

    const file = this.bucket.file(gcsPath);

    try {
      // Ensure destination directory exists
      const destDir = path.dirname(destinationPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      await file.download({ destination: destinationPath });

      console.log(`[GCSStorageService] Downloaded ${gcsPath} to ${destinationPath}`);
    } catch (error: any) {
      console.error(`[GCSStorageService] Download failed for ${gcsPath}:`, error.message);
      throw error;
    }
  }

  /**
   * Check if a file exists in GCS
   */
  async exists(gcsPath: string): Promise<boolean> {
    if (!this.isAvailable() || !this.bucket) {
      return false;
    }

    try {
      const file = this.bucket.file(gcsPath);
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete a file from GCS
   */
  async delete(gcsPath: string): Promise<void> {
    if (!this.isAvailable() || !this.bucket) {
      throw new Error('GCS is not available');
    }

    try {
      const file = this.bucket.file(gcsPath);
      await file.delete();
      console.log(`[GCSStorageService] Deleted ${gcsPath}`);
    } catch (error: any) {
      console.error(`[GCSStorageService] Delete failed for ${gcsPath}:`, error.message);
      throw error;
    }
  }

  /**
   * Get public URL for a GCS path
   */
  getPublicUrl(gcsPath: string): string {
    return buildGcsPublicUrl(this.config.bucketName, gcsPath);
  }

  /**
   * Generate a signed URL for temporary access
   */
  async getSignedUrl(
    gcsPath: string,
    expiresInMinutes: number = 60,
    options?: { responseDisposition?: string },
  ): Promise<string> {
    if (!this.isAvailable() || !this.bucket) {
      throw new Error('GCS is not available');
    }

    const file = this.bucket.file(gcsPath);
    const expires = Date.now() + expiresInMinutes * 60 * 1000;

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires,
      ...(options?.responseDisposition
        ? { responseDisposition: options.responseDisposition }
        : {}),
    });

    return signedUrl;
  }

  /**
   * List files in a GCS path prefix
   */
  async listFiles(prefix: string): Promise<string[]> {
    if (!this.isAvailable() || !this.bucket) {
      throw new Error('GCS is not available');
    }

    try {
      const [files] = await this.bucket.getFiles({ prefix });
      return files.map(file => file.name);
    } catch (error: any) {
      console.error(`[GCSStorageService] List failed for prefix ${prefix}:`, error.message);
      throw error;
    }
  }
}

