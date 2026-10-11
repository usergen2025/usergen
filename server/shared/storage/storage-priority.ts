/**
 * Storage priority: controls read/write preference between GCS and local disk.
 *
 * STORAGE_PRIORITY=gcs  — prefer GCS URLs (download to cache); local is fallback/cache
 * STORAGE_PRIORITY=local — current behavior: prefer local disk, then HTTP/GCS (default)
 *
 * Revert to today’s behavior by setting STORAGE_PRIORITY=local (or unset).
 */

export type StoragePriority = 'gcs' | 'local';

export function getStoragePriority(env: NodeJS.ProcessEnv = process.env): StoragePriority {
  const raw = (env.STORAGE_PRIORITY || 'local').trim().toLowerCase();
  if (raw === 'gcs' || raw === 'cloud') return 'gcs';
  return 'local';
}

export function isGcsPriority(env: NodeJS.ProcessEnv = process.env): boolean {
  return getStoragePriority(env) === 'gcs';
}
