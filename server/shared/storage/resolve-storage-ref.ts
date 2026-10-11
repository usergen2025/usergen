import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  StorageRef,
  ResolveStorageRefOptions,
  ResolvedStorageRef,
  normalizeStorageRef,
  getExternalUrl,
} from './storage-ref.types';
import { getStoragePriority } from './storage-priority';
import type { StorageService } from './storage.types';

function uploadsPathFromLocalUrl(localUrl: string, uploadsDir: string): string {
  const relative = localUrl.replace(/^\/uploads\/?/, '');
  return path.join(uploadsDir, relative);
}

async function downloadToPath(url: string, dest: string): Promise<string> {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = `${dest}.partial-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
  return dest;
}

async function downloadToTemp(url: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-ref-'));
  const ext = path.extname(new URL(url, 'http://local').pathname) || '.bin';
  const dest = path.join(dir, `file${ext}`);
  return downloadToPath(url, dest);
}

function cachePathForUrl(uploadsDir: string, url: string): string {
  const ext = path.extname(new URL(url, 'http://local').pathname) || '.bin';
  const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
  return path.join(uploadsDir, '.gcs-cache', `${hash}${ext}`);
}

function tryLocalDisk(
  ref: StorageRef,
  options: ResolveStorageRefOptions,
): ResolvedStorageRef | null {
  const { uploadsDir, aiContentUploadsDir, extraLocalRoots } = options;

  if (ref.localPath && fs.existsSync(ref.localPath)) {
    return {
      localPath: ref.localPath,
      isTemp: false,
      externalUrl: getExternalUrl(ref),
    };
  }

  if (ref.localUrl) {
    const candidates: string[] = [uploadsPathFromLocalUrl(ref.localUrl, uploadsDir)];
    if (aiContentUploadsDir && (ref.service === 'ai-content' || !ref.service)) {
      candidates.push(uploadsPathFromLocalUrl(ref.localUrl, aiContentUploadsDir));
    }
    if (extraLocalRoots?.length) {
      for (const root of extraLocalRoots) {
        candidates.push(uploadsPathFromLocalUrl(ref.localUrl, root));
        const stripped = ref.localUrl.replace(/^\/uploads\/?/, '');
        candidates.push(path.join(root, stripped));
        candidates.push(path.join(root, 'uploads', stripped));
      }
    }
    for (const localPath of candidates) {
      if (fs.existsSync(localPath)) {
        return { localPath, isTemp: false, externalUrl: getExternalUrl(ref) };
      }
    }
  }

  return null;
}

function collectRemoteUrls(
  ref: StorageRef,
  options: ResolveStorageRefOptions,
): string[] {
  const { aiContentServiceUrl, backendBaseUrl } = options;
  const fetchUrls: string[] = [];

  if (ref.gcsUrl?.startsWith('http')) fetchUrls.push(ref.gcsUrl);
  if (ref.publicUrl?.startsWith('http') && !fetchUrls.includes(ref.publicUrl)) {
    fetchUrls.push(ref.publicUrl);
  }
  if (ref.localUrl) {
    if (aiContentServiceUrl) {
      fetchUrls.push(`${aiContentServiceUrl.replace(/\/$/, '')}${ref.localUrl}`);
    }
    if (backendBaseUrl) {
      fetchUrls.push(`${backendBaseUrl.replace(/\/$/, '')}${ref.localUrl}`);
    }
  }

  return fetchUrls;
}

async function tryRemoteFetch(
  ref: StorageRef,
  options: ResolveStorageRefOptions,
  preferStableCache: boolean,
): Promise<ResolvedStorageRef | null> {
  const urls = collectRemoteUrls(ref, options);
  for (const url of urls) {
    if (!url?.startsWith('http')) continue;
    try {
      if (preferStableCache) {
        const cached = cachePathForUrl(options.uploadsDir, url);
        if (fs.existsSync(cached) && fs.statSync(cached).size > 0) {
          return {
            localPath: cached,
            isTemp: false,
            externalUrl: getExternalUrl(ref) || url,
          };
        }
        await downloadToPath(url, cached);
        return {
          localPath: cached,
          isTemp: false,
          externalUrl: getExternalUrl(ref) || url,
        };
      }
      const tempPath = await downloadToTemp(url);
      return {
        localPath: tempPath,
        isTemp: true,
        externalUrl: getExternalUrl(ref) || url,
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Resolve StorageRef to a local filesystem path for FFmpeg / Sharp internal use.
 * Order depends on STORAGE_PRIORITY / options.priority:
 * - local (default): disk first, then HTTP/GCS
 * - gcs: remote/GCS first (stable cache), then disk
 */
export async function resolveStorageRefToLocalPath(
  input: StorageRef | string | null | undefined,
  options: ResolveStorageRefOptions,
): Promise<ResolvedStorageRef | null> {
  const ref = normalizeStorageRef(input);
  if (!ref) return null;

  const priority = options.priority ?? getStoragePriority();

  if (priority === 'gcs') {
    const remote = await tryRemoteFetch(ref, options, true);
    if (remote) return remote;
    return tryLocalDisk(ref, options);
  }

  const local = tryLocalDisk(ref, options);
  if (local) return local;
  return tryRemoteFetch(ref, options, false);
}

/**
 * Resolve for external APIs — returns HTTP URL without downloading.
 * When priority is gcs, prefer gcsUrl/publicUrl over local backend URLs.
 */
export function resolveStorageRefExternalUrl(
  input: StorageRef | string | null | undefined,
  options?: Pick<ResolveStorageRefOptions, 'aiContentServiceUrl' | 'backendBaseUrl' | 'priority'>,
): string | undefined {
  const ref = normalizeStorageRef(input);
  if (!ref) return typeof input === 'string' && input.startsWith('http') ? input : undefined;

  const priority = options?.priority ?? getStoragePriority();

  if (priority === 'gcs') {
    if (ref.gcsUrl?.startsWith('http')) return ref.gcsUrl;
    if (ref.publicUrl?.startsWith('http')) return ref.publicUrl;
  }

  const external = getExternalUrl(ref);
  if (external?.startsWith('http')) return external;

  if (ref.localUrl && options?.aiContentServiceUrl) {
    return `${options.aiContentServiceUrl.replace(/\/$/, '')}${ref.localUrl}`;
  }
  if (ref.localUrl && options?.backendBaseUrl) {
    return `${options.backendBaseUrl.replace(/\/$/, '')}${ref.localUrl}`;
  }

  return external;
}

/** Map legacy logoBrand png url fields to StorageRef */
export function legacyPngUrlToRef(
  pngUrl?: string,
  service?: StorageRef['service'],
): StorageRef | undefined {
  if (!pngUrl) return undefined;
  return normalizeStorageRef(pngUrl, service);
}

/** Normalize ad-hoc audio / b-roll / avatar JSON records into StorageRef */
export function legacyMediaRecordToRef(
  record: Record<string, any> | null | undefined,
  service?: StorageService,
): StorageRef | undefined {
  if (!record || typeof record !== 'object') return undefined;

  const nestedOriginal =
    record.original && typeof record.original === 'object' ? record.original : undefined;

  let localPath: string | undefined;
  if (typeof record.localPath === 'string' && record.localPath) {
    localPath = record.localPath;
  } else if (typeof record.filePath === 'string' && path.isAbsolute(record.filePath)) {
    localPath = record.filePath;
  } else if (
    nestedOriginal &&
    typeof nestedOriginal.filePath === 'string' &&
    path.isAbsolute(nestedOriginal.filePath)
  ) {
    localPath = nestedOriginal.filePath;
  }

  let localUrl: string | undefined;
  if (typeof record.localUrl === 'string' && record.localUrl) {
    localUrl = record.localUrl;
  } else if (typeof record.filePath === 'string' && record.filePath.startsWith('/uploads')) {
    localUrl = record.filePath;
  } else if (nestedOriginal && typeof nestedOriginal.localUrl === 'string') {
    localUrl = nestedOriginal.localUrl;
  }

  const gcsUrl =
    (typeof record.gcsUrl === 'string' && record.gcsUrl) ||
    (nestedOriginal && typeof nestedOriginal.gcsUrl === 'string' && nestedOriginal.gcsUrl) ||
    undefined;

  let publicUrl =
    (typeof record.publicUrl === 'string' && record.publicUrl) ||
    (typeof record.videoUrl === 'string' && record.videoUrl) ||
    (typeof record.imageUrl === 'string' && record.imageUrl) ||
    (typeof record.url === 'string' && record.url) ||
    undefined;

  if (!gcsUrl && !publicUrl && !localUrl && !localPath) {
    // Relative filePath without /uploads prefix — encode as localUrl-ish for extraLocalRoots
    if (typeof record.filePath === 'string' && record.filePath) {
      const fp = record.filePath.startsWith('/') ? record.filePath : `/${record.filePath}`;
      if (fp.includes('uploads') || fp.includes('audio')) {
        localUrl = fp.startsWith('/uploads') ? fp : `/uploads/${fp.replace(/^\/+/, '')}`;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  if (
    publicUrl &&
    !gcsUrl &&
    typeof publicUrl === 'string' &&
    publicUrl.includes('storage.googleapis.com')
  ) {
    return normalizeStorageRef(
      { localPath, localUrl, gcsUrl: publicUrl, publicUrl, service },
      service,
    );
  }

  return normalizeStorageRef(
    { localPath, localUrl, gcsUrl, publicUrl, service },
    service,
  );
}

/**
 * Ensure a legacy media record is available on local disk for FFmpeg.
 * Respects STORAGE_PRIORITY (GCS-first when set to gcs).
 */
export async function ensureLocalMedia(
  record: Record<string, any> | StorageRef | string | null | undefined,
  options: ResolveStorageRefOptions & { service?: StorageService },
): Promise<ResolvedStorageRef | null> {
  if (record == null) return null;

  if (typeof record === 'string') {
    return resolveStorageRefToLocalPath(
      normalizeStorageRef(record, options.service),
      options,
    );
  }

  // Already a StorageRef-shaped object without scene metadata
  const obj = record as Record<string, any>;
  const looksLikeStorageRef =
    ('gcsUrl' in obj || 'localUrl' in obj || 'localPath' in obj || 'publicUrl' in obj) &&
    !('sceneNumber' in obj) &&
    !('filePath' in obj) &&
    !('videoUrl' in obj);

  if (looksLikeStorageRef) {
    return resolveStorageRefToLocalPath(
      normalizeStorageRef(obj as StorageRef, options.service),
      options,
    );
  }

  const ref = legacyMediaRecordToRef(obj, options.service);
  if (!ref) return null;

  // Also try relative filePath against extraLocalRoots when disk-first / as fallback
  const resolved = await resolveStorageRefToLocalPath(ref, options);
  if (resolved) return resolved;

  if (typeof obj.filePath === 'string' && !path.isAbsolute(obj.filePath)) {
    const rel = obj.filePath.replace(/^\/+/, '');
    const roots = [
      options.uploadsDir,
      ...(options.extraLocalRoots || []),
    ];
    for (const root of roots) {
      for (const candidate of [
        path.join(root, rel),
        path.join(root, 'uploads', rel),
        path.join(root, rel.replace(/^uploads[/\\]/, '')),
      ]) {
        if (fs.existsSync(candidate)) {
          return {
            localPath: candidate,
            isTemp: false,
            externalUrl: getExternalUrl(ref),
          };
        }
      }
    }
  }

  return null;
}
