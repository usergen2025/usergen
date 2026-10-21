/**
 * Publish a stored file to a URL an external API (fal, BytePlus, OpenAI) can fetch.
 *
 * A localhost or private URL is a local fallback from a failed Cloud Storage upload.
 * Callers that talk to those APIs must run the value through ensureExternallyReachableUrl,
 * which uploads the bytes and returns the Cloud Storage URL.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { StorageRef, normalizeStorageRef } from './storage-ref.types';
import { StorageResult } from './storage.types';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function isExternallyReachableUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    return false;
  }
  if (isPrivateIpv4(host)) return false;
  return true;
}

function isPrivateIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export interface EnsureExternalUrlDeps {
  /** Directories that may contain /uploads/... files (this service, and sibling services). */
  uploadsDirs: string[];
  uploadFromBuffer: (
    buffer: Buffer,
    subPath: string,
    filename: string,
    contentType: string,
  ) => Promise<Pick<StorageResult, 'publicUrl' | 'gcsUrl' | 'gcsUploaded' | 'localUrl'>>;
}

/**
 * Return a URL fal / BytePlus / vision can fetch.
 * Cloud Storage URLs are returned as-is. Local and localhost URLs are uploaded first.
 */
export async function ensureExternallyReachableUrl(
  input: string | StorageRef | null | undefined,
  deps: EnsureExternalUrlDeps,
): Promise<string> {
  const ref = toStorageRef(input);
  const preferred = [ref?.gcsUrl, ref?.publicUrl].filter((url): url is string => !!url);
  for (const url of preferred) {
    if (isExternallyReachableUrl(url)) return url;
  }

  const label =
    ref?.publicUrl ||
    ref?.localUrl ||
    ref?.localPath ||
    (typeof input === 'string' ? input : 'asset');

  const buffer = await readLocalOrFetch(ref, deps.uploadsDirs);
  if (!buffer || buffer.length === 0) {
    throw new Error(
      `Cannot publish media for an external API. The file is not on Cloud Storage and could not be read locally: ${label}`,
    );
  }

  const filename = filenameFor(label);
  const uploaded = await deps.uploadFromBuffer(buffer, 'external-refs', filename, contentTypeFor(filename));
  const published = [uploaded.gcsUrl, uploaded.publicUrl].find((url) => isExternallyReachableUrl(url));
  if (!published) {
    throw new Error(
      'Cloud Storage upload did not return a public URL. External image APIs cannot use a localhost address. Sign in to Google Cloud and retry.',
    );
  }
  return published;
}

/** Replace exact stored copies of a local URL with the Cloud Storage URL. */
export function replaceStoredUrl<T>(value: T, from: string, to: string): T {
  if (!from || from === to) return value;
  if (typeof value === 'string') return (value === from ? to : value) as T;
  if (Array.isArray(value)) return value.map((item) => replaceStoredUrl(item, from, to)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = replaceStoredUrl(child, from, to);
    }
    return out as T;
  }
  return value;
}

function toStorageRef(input: string | StorageRef | null | undefined): StorageRef | undefined {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const parsed = new URL(trimmed);
        if (!isExternallyReachableUrl(trimmed) && parsed.pathname.startsWith('/uploads/')) {
          return {
            publicUrl: trimmed,
            localUrl: parsed.pathname,
            gcsUrl: trimmed.includes('storage.googleapis.com') ? trimmed : undefined,
          };
        }
      } catch {
        /* fall through */
      }
    }
    if (path.isAbsolute(trimmed) && fs.existsSync(trimmed) && !trimmed.startsWith('/uploads')) {
      return { localPath: trimmed };
    }
  }
  return typeof input === 'string' || input == null ? normalizeStorageRef(input as string) : { ...input };
}

async function readLocalOrFetch(
  ref: StorageRef | undefined,
  uploadsDirs: string[],
): Promise<Buffer | null> {
  if (ref?.localPath && fs.existsSync(ref.localPath)) {
    return fs.readFileSync(ref.localPath);
  }

  if (ref?.localUrl) {
    const relative = ref.localUrl.replace(/^\/uploads\/?/, '');
    for (const root of uploadsDirs) {
      if (!root) continue;
      const candidate = path.join(root, relative);
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
    }
  }

  const remote = [ref?.publicUrl, ref?.gcsUrl].find((url) => url && (url.startsWith('http://') || url.startsWith('https://')));
  if (remote) return fetchBuffer(remote);
  return null;
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > 25 * 1024 * 1024) return null;
    return buffer;
  } catch {
    return null;
  }
}

function filenameFor(label: string): string {
  let base = 'asset';
  try {
    const pathname = label.startsWith('http') ? new URL(label).pathname : label;
    const name = path.basename(pathname).replace(/[^a-zA-Z0-9._-]/g, '');
    if (name) base = name;
  } catch {
    /* keep default */
  }
  const hash = crypto.createHash('sha256').update(label).digest('hex').slice(0, 12);
  return `${hash}-${base}`;
}

function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}
