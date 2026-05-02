/**
 * Storage Constants for GCS Bucket Structure
 * 
 * Bucket structure:
 * usergen-bucket/
 * ├── ai-content/
 * │   ├── avatars/{userId}/{avatarId}/
 * │   └── product-images/{userId}/
 * ├── video-processing/
 * │   ├── images/{userId}/
 * │   ├── videos/{userId}/
 * │   └── composites/{userId}/{projectId}/
 * ├── voice-audio/
 * │   ├── audio/{userId}/
 * │   └── cloned/{userId}/
 * └── temp/
 *     └── {service-name}/
 */

import { StorageService } from './storage.types';

/**
 * Service path prefixes in the GCS bucket
 */
export const SERVICE_PREFIXES: Record<StorageService, string> = {
  'ai-content': 'ai-content',
  'video-processing': 'video-processing',
  'voice-audio': 'voice-audio',
  'media': 'media',
  'campaign': 'campaign',
};

/**
 * Common sub-paths used within services
 */
export const STORAGE_PATHS = {
  // ai-content-service paths
  AI_CONTENT: {
    AVATARS: 'avatars',
    PRODUCT_IMAGES: 'product-images',
    SCRIPTS: 'scripts',
  },
  // video-processing-service paths
  VIDEO_PROCESSING: {
    IMAGES: 'images',
    VIDEOS: 'videos',
    COMPOSITES: 'composites',
    BROLL: 'broll',
  },
  // voice-audio-service paths
  VOICE_AUDIO: {
    AUDIO: 'audio',
    CLONED: 'cloned',
    TTS: 'tts',
  },
  // Temporary files
  TEMP: 'temp',
} as const;

/**
 * Default content types for common file extensions
 */
export const CONTENT_TYPES: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  // Videos
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm-audio': 'audio/webm',
  // Documents
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

/**
 * Get content type from file extension
 */
export function getContentType(filename: string): string {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

/**
 * Build GCS object path from service and sub-path
 */
export function buildGcsPath(service: StorageService, subPath: string, filename: string): string {
  const prefix = SERVICE_PREFIXES[service];
  // Normalize path separators and remove leading/trailing slashes
  const normalizedSubPath = subPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const normalizedFilename = filename.replace(/^\/+/, '');
  
  if (normalizedSubPath) {
    return `${prefix}/${normalizedSubPath}/${normalizedFilename}`;
  }
  return `${prefix}/${normalizedFilename}`;
}

/**
 * Build local URL from local path
 * Extracts the /uploads/... portion from a full path
 */
export function buildLocalUrl(localPath: string): string {
  // Match /uploads/... pattern in the path
  const match = localPath.match(/\/uploads\/.+$/);
  if (match) {
    return match[0];
  }
  // Fallback: use basename with /uploads prefix
  const filename = localPath.split(/[/\\]/).pop() || '';
  return `/uploads/${filename}`;
}

/**
 * GCS URL format
 */
export function buildGcsPublicUrl(bucketName: string, objectPath: string): string {
  return `https://storage.googleapis.com/${bucketName}/${objectPath}`;
}




