import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';

/**
 * Service to get public URLs for local files
 * - Local environment: Uploads files to FAL storage and returns FAL public URL
 * - Dev/Prod environments: Returns backend URL + localUrl path (files are already publicly accessible)
 */
@Injectable()
export class PublicUrlService {
  private readonly nodeEnv: string;
  private readonly backendBaseUrl: string;
  private readonly falApiKey: string;
  private readonly falStorageUrl: string;
  private readonly axiosInstance: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.nodeEnv = this.configService.get<string>('NODE_ENV') || 'local';
    
    // Get backend base URL - for local, use localhost with service port
    const servicePort = this.configService.get<number>('SERVICE_PORT', 9004);
    this.backendBaseUrl = this.configService.get<string>('BACKEND_BASE_URL') || 
      `http://localhost:${servicePort}`;
    
    this.falApiKey = this.configService.get<string>('FAL_KEY') || '';
    
    // FAL storage endpoint - can be overridden via env variable
    // Default: https://fal.run/storage/upload (may need adjustment based on actual FAL API)
    this.falStorageUrl = this.configService.get<string>('FAL_STORAGE_URL') || 
      'https://fal.run/storage/upload';
    
    if (!this.falApiKey && this.nodeEnv === 'local') {
      console.warn('[PublicUrlService] FAL_KEY not configured. FAL storage uploads will fail in local environment.');
    }

    // Create axios instance for FAL storage uploads
    this.axiosInstance = axios.create({
      timeout: 120000, // 2 minutes for file uploads
    });
  }

  /**
   * Get public URL for a local file
   * @param localPath - Full path to the local file (e.g., /path/to/uploads/images/user123/file.jpg)
   * @param localUrl - Relative URL path (e.g., /uploads/images/user123/file.jpg)
   * @returns Public URL that can be used by external services (BytePlus, etc.)
   */
  async getPublicUrl(localPath: string, localUrl: string): Promise<string> {
    // Validate file exists
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found at path: ${localPath}`);
    }

    if (this.nodeEnv === 'local') {
      // Local environment: Upload to FAL storage for public access
      console.log(`[PublicUrlService] Local environment detected. Uploading file to FAL storage: ${localPath}`);
      return await this.uploadToFalStorage(localPath);
    } else {
      // Dev/Prod environment: Use backend URL (files are already publicly accessible)
      const publicUrl = `${this.backendBaseUrl}${localUrl}`;
      console.log(`[PublicUrlService] Dev/Prod environment. Using backend URL: ${publicUrl}`);
      return publicUrl;
    }
  }

  /**
   * Upload file to FAL storage and get public URL
   * @param filePath - Full path to the file to upload
   * @returns Public URL from FAL storage
   */
  private async uploadToFalStorage(filePath: string): Promise<string> {
    if (!this.falApiKey) {
      throw new Error('FAL_KEY is required for file uploads in local environment. Please set FAL_KEY in .env file.');
    }

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Get file stats for logging
      const stats = fs.statSync(filePath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`[PublicUrlService] Uploading file to FAL storage: ${path.basename(filePath)} (${fileSizeMB} MB)`);

      // Create form data
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));

      // Upload to FAL storage
      const response = await this.axiosInstance.post(this.falStorageUrl, form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Key ${this.falApiKey.trim()}`,
        },
      });

      // Extract URL from response
      // FAL storage API returns different formats, handle both
      let publicUrl: string;
      if (typeof response.data === 'string') {
        // If response is a string URL
        publicUrl = response.data;
      } else if (response.data?.url) {
        // If response is an object with url property
        publicUrl = response.data.url;
      } else if (response.data?.data?.url) {
        // If response is nested
        publicUrl = response.data.data.url;
      } else {
        // Fallback: try to extract from response
        console.warn('[PublicUrlService] Unexpected FAL storage response format:', response.data);
        throw new Error('Failed to extract URL from FAL storage response');
      }

      console.log(`[PublicUrlService] ✅ File uploaded successfully. Public URL: ${publicUrl}`);
      return publicUrl;
    } catch (error: any) {
      console.error('[PublicUrlService] Failed to upload file to FAL storage:', error.message);
      
      if (error.response) {
        console.error('[PublicUrlService] FAL API Error Response:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
        });
      }

      throw new Error(`Failed to upload file to FAL storage: ${error.message}`);
    }
  }

  /**
   * Check if a URL is already public (starts with http/https)
   * Useful for skipping upload if URL is already public
   */
  isPublicUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
  }
}

