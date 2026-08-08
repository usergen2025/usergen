/**
 * Guarded access to Web Storage.
 *
 * iOS Safari throws `SecurityError` on *any* `localStorage` access — including
 * reads — when "Block All Cookies" is enabled, and older versions throw
 * `QuotaExceededError` on writes in Private Browsing. Some Android in-app
 * browsers (Instagram, WhatsApp) behave the same way. An unguarded read
 * therefore takes down whichever effect touches it first, which strands the
 * calling component on its initial loading state with nothing logged.
 *
 * Every storage access in the app should go through these helpers so a locked
 * down browser degrades to "logged out" instead of a blank or frozen page.
 */

type StorageKind = 'local' | 'session';

function getStore(kind: StorageKind): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStorage(key: string, kind: StorageKind = 'local'): string | null {
  try {
    return getStore(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns false when the browser refused the write, so callers can react. */
export function writeStorage(key: string, value: string, kind: StorageKind = 'local'): boolean {
  try {
    const store = getStore(kind);
    if (!store) return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string, kind: StorageKind = 'local'): void {
  try {
    getStore(kind)?.removeItem(key);
  } catch {
    /* nothing to clean up if storage is unavailable */
  }
}

/** Reads and parses JSON, returning null for missing, blocked or corrupt values. */
export function readStorageJson<T>(key: string, kind: StorageKind = 'local'): T | null {
  const raw = readStorage(key, kind);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** True when Web Storage is readable — useful for warning the user. */
export function isStorageAvailable(kind: StorageKind = 'local'): boolean {
  const store = getStore(kind);
  if (!store) return false;
  try {
    const probe = '__usergen_storage_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
