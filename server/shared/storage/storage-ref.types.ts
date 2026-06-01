import type { StorageService } from './storage.types';
import type { StorageResult } from './storage.types';

/**
 * Dual-path reference to a stored file (local + optional GCS/public URLs).
 * Used in project metadata for assets that FFmpeg or external APIs consume differently.
 */
export interface StorageRef {
  /** Absolute filesystem path on the creating service */
  localPath?: string;
  /** Relative URL path e.g. /uploads/logos/project/corner.png */
  localUrl?: string;
  /** GCS public URL when uploaded */
  gcsUrl?: string;
  /** Preferred external URL (GCS or backend) */
  publicUrl?: string;
  /** Service that owns the local file */
  service?: StorageService;
}

export interface ResolveStorageRefOptions {
  uploadsDir: string;
  /** Base URL for cross-service HTTP fetch e.g. http://localhost:9001 */
  aiContentServiceUrl?: string;
  backendBaseUrl?: string;
  /** Optional shared/cross-service path to ai-content uploads directory */
  aiContentUploadsDir?: string;
  /** When true, prefer gcsUrl/publicUrl for external APIs (BytePlus) */
  external?: boolean;
}

export interface ResolvedStorageRef {
  /** Local path suitable for FFmpeg -i (may be a temp download) */
  localPath: string;
  /** Whether the file was downloaded to a temp location */
  isTemp: boolean;
  /** External URL for APIs that require HTTP */
  externalUrl?: string;
}

/** Build StorageRef from UnifiedStorageService upload result */
export function storageResultToRef(
  result: StorageResult,
  service: StorageService,
): StorageRef {
  return {
    localPath: result.localPath,
    localUrl: result.localUrl,
    gcsUrl: result.gcsUrl,
    publicUrl: result.publicUrl,
    service,
  };
}

/** Normalize legacy string URL or partial object into StorageRef */
export function normalizeStorageRef(
  value: string | StorageRef | null | undefined,
  service?: StorageService,
): StorageRef | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    if (value.startsWith('/') && !value.startsWith('http')) {
      return { localUrl: value, publicUrl: value, service };
    }
    return { publicUrl: value, gcsUrl: value.includes('storage.googleapis.com') ? value : undefined, service };
  }
  return { ...value, service: value.service ?? service };
}

/** Pick best external URL for BytePlus / vision APIs */
export function getExternalUrl(ref?: StorageRef | string | null): string | undefined {
  const normalized = typeof ref === 'string' ? normalizeStorageRef(ref) : ref;
  if (!normalized) return undefined;
  return normalized.gcsUrl || normalized.publicUrl || normalized.localUrl;
}

/** Pick legacy-compatible single URL field from StorageRef */
export function getPublicUrlFromRef(ref?: StorageRef | string | null): string | undefined {
  return getExternalUrl(ref);
}
