/**
 * Storage Types for GCS and Local Storage Integration
 */

/**
 * Service identifiers for bucket path segregation
 */
export type StorageService = 'ai-content' | 'video-processing' | 'voice-audio' | 'media';

/**
 * Result of a storage upload operation
 */
export interface StorageResult {
  /** Full local file system path */
  localPath: string;
  /** Local URL path (e.g., /uploads/images/user123/file.jpg) */
  localUrl: string;
  /** GCS public URL (if upload succeeded) */
  gcsUrl?: string;
  /** GCS object path within bucket (e.g., ai-content/avatars/user123/avatar123/original.jpg) */
  gcsPath?: string;
  /** Final public URL to use (GCS if available, else backend URL + localUrl) */
  publicUrl: string;
  /** Whether the file was successfully uploaded to GCS */
  gcsUploaded: boolean;
}

/**
 * Options for uploading a file
 */
export interface UploadOptions {
  /** Service identifier for bucket path prefix */
  service: StorageService;
  /** Sub-path within service folder (e.g., "avatars/user123/avatar456") */
  subPath: string;
  /** Filename for the uploaded file */
  filename: string;
  /** MIME content type of the file */
  contentType: string;
  /** Whether to make the file publicly accessible (default: true) */
  makePublic?: boolean;
  /** Custom metadata to attach to the file */
  metadata?: Record<string, string>;
}

/**
 * Options for uploading from a local file path
 */
export interface UploadFromPathOptions extends UploadOptions {
  /** Full local file system path to the file */
  localPath: string;
}

/**
 * Options for uploading from a buffer
 */
export interface UploadFromBufferOptions extends UploadOptions {
  /** File content as buffer */
  buffer: Buffer;
  /** Directory to save the local file */
  localDir: string;
}

/**
 * Options for downloading a file from GCS
 */
export interface DownloadOptions {
  /** GCS object path */
  gcsPath: string;
  /** Local destination path */
  destinationPath: string;
}

/**
 * GCS Configuration options
 */
export interface GCSConfig {
  /** Whether GCS is enabled */
  enabled: boolean;
  /** GCS bucket name */
  bucketName: string;
  /** GCS project ID */
  projectId?: string;
  /** Path to service account credentials file */
  credentialsPath?: string;
  /** Base64-encoded service account credentials JSON */
  credentialsBase64?: string;
}

/**
 * Result of getting a public URL for an existing file
 */
export interface PublicUrlResult {
  /** The public URL to use */
  publicUrl: string;
  /** GCS URL if file was uploaded to GCS */
  gcsUrl?: string;
  /** Whether the URL is from GCS */
  isGcs: boolean;
}

/**
 * File info for URL resolution
 */
export interface FileInfo {
  /** Full local file system path */
  localPath: string;
  /** Local URL path */
  localUrl: string;
  /** Optional existing GCS URL */
  gcsUrl?: string;
}

