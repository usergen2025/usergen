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

function uploadsPathFromLocalUrl(localUrl: string, uploadsDir: string): string {
  const relative = localUrl.replace(/^\/uploads\/?/, '');
  return path.join(uploadsDir, relative);
}

async function downloadToTemp(url: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-ref-'));
  const ext = path.extname(new URL(url, 'http://local').pathname) || '.bin';
  const dest = path.join(dir, `file${ext}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

/**
 * Resolve StorageRef to a local filesystem path for FFmpeg / Sharp internal use.
 */
export async function resolveStorageRefToLocalPath(
  input: StorageRef | string | null | undefined,
  options: ResolveStorageRefOptions,
): Promise<ResolvedStorageRef | null> {
  const ref = normalizeStorageRef(input);
  if (!ref) return null;

  const { uploadsDir, aiContentServiceUrl, backendBaseUrl, aiContentUploadsDir } = options;

  if (ref.localPath && fs.existsSync(ref.localPath)) {
    return {
      localPath: ref.localPath,
      isTemp: false,
      externalUrl: getExternalUrl(ref),
    };
  }

  if (ref.localUrl) {
    const localPath = uploadsPathFromLocalUrl(ref.localUrl, uploadsDir);
    if (fs.existsSync(localPath)) {
      return { localPath, isTemp: false, externalUrl: getExternalUrl(ref) };
    }
    if (aiContentUploadsDir && (ref.service === 'ai-content' || !ref.service)) {
      const crossPath = uploadsPathFromLocalUrl(ref.localUrl, aiContentUploadsDir);
      if (fs.existsSync(crossPath)) {
        return { localPath: crossPath, isTemp: false, externalUrl: getExternalUrl(ref) };
      }
    }
  }

  const fetchUrls: string[] = [];
  if (ref.localUrl) {
    if (aiContentServiceUrl) fetchUrls.push(`${aiContentServiceUrl.replace(/\/$/, '')}${ref.localUrl}`);
    if (backendBaseUrl) fetchUrls.push(`${backendBaseUrl.replace(/\/$/, '')}${ref.localUrl}`);
  }
  if (ref.gcsUrl) fetchUrls.push(ref.gcsUrl);
  if (ref.publicUrl && !fetchUrls.includes(ref.publicUrl)) fetchUrls.push(ref.publicUrl);

  for (const url of fetchUrls) {
    if (!url?.startsWith('http')) continue;
    try {
      const tempPath = await downloadToTemp(url);
      return { localPath: tempPath, isTemp: true, externalUrl: getExternalUrl(ref) || url };
    } catch {
      /* try next */
    }
  }

  return null;
}

/**
 * Resolve for external APIs — returns HTTP URL without downloading.
 */
export function resolveStorageRefExternalUrl(
  input: StorageRef | string | null | undefined,
  options?: Pick<ResolveStorageRefOptions, 'aiContentServiceUrl' | 'backendBaseUrl'>,
): string | undefined {
  const ref = normalizeStorageRef(input);
  if (!ref) return typeof input === 'string' && input.startsWith('http') ? input : undefined;

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
