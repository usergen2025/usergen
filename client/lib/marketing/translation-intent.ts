import { readStorage, removeStorage, writeStorage } from '@/lib/utils/safeStorage';

/**
 * Home hero "Translate your video" handoff across sign-up.
 *
 * Either a public video URL or a local File (IndexedDB) is held until
 * `/create-video/translate` bootstraps a shell project and opens workspace.
 */
export const TRANSLATION_FUNNEL_PATH = '/create-video/translate';

const STORAGE_KEY = 'ug_translation_intent';
const FROM_TRANSLATE_KEY = 'fromTranslateVideo';
const IDB_NAME = 'ug-translation-source';
const IDB_STORE = 'files';
const IDB_KEY = 'current';
const TTL_MS = 30 * 60 * 1000;

export type TranslationIntent = {
  version: 1;
  /** Public http(s) video URL, when the user pasted a link. */
  videoUrl?: string;
  /** Display name when a file was staged. */
  fileName?: string;
  createdAt: number;
};

/** In-tab file before IndexedDB finishes (or when IDB is unavailable). */
let stagedFile: File | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function persistFile(file: File): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(
      { name: file.name, mime: file.type, blob: file },
      IDB_KEY,
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

async function readPersistedFile(): Promise<File | null> {
  const db = await openDb();
  if (!db) return null;
  const stored = await new Promise<{ name: string; mime?: string; blob: Blob } | undefined>(
    (resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const request = tx.objectStore(IDB_STORE).get(IDB_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    },
  );
  db.close();
  if (!stored?.blob) return null;
  return new File([stored.blob], stored.name || 'video.mp4', {
    type: stored.mime || stored.blob.type || 'video/mp4',
  });
}

function clearPersistedFile(): void {
  void (async () => {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  })();
}

export function hasPendingTranslationFunnel(): boolean {
  if (readStorage(FROM_TRANSLATE_KEY, 'session') === 'true') return true;
  const raw = readStorage(STORAGE_KEY, 'session');
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as TranslationIntent;
    return parsed?.version === 1 && typeof parsed.createdAt === 'number';
  } catch {
    return false;
  }
}

/** Stage a public URL for the translate funnel. */
export function writeTranslationUrlIntent(videoUrl: string): boolean {
  stagedFile = null;
  clearPersistedFile();
  const intent: TranslationIntent = {
    version: 1,
    videoUrl: videoUrl.trim(),
    createdAt: Date.now(),
  };
  writeStorage(FROM_TRANSLATE_KEY, 'true', 'session');
  return writeStorage(STORAGE_KEY, JSON.stringify(intent), 'session');
}

/** Stage an uploaded file for the translate funnel. */
export function writeTranslationFileIntent(file: File): boolean {
  stagedFile = file;
  void persistFile(file);
  const intent: TranslationIntent = {
    version: 1,
    fileName: file.name,
    createdAt: Date.now(),
  };
  writeStorage(FROM_TRANSLATE_KEY, 'true', 'session');
  return writeStorage(STORAGE_KEY, JSON.stringify(intent), 'session');
}

export type ConsumedTranslationIntent = {
  videoUrl?: string;
  file?: File | null;
};

/**
 * Read and clear the pending translate handoff (URL and/or file).
 */
export async function consumeTranslationIntent(): Promise<ConsumedTranslationIntent | null> {
  const raw = readStorage(STORAGE_KEY, 'session');
  removeStorage(STORAGE_KEY, 'session');
  removeStorage(FROM_TRANSLATE_KEY, 'session');

  let intent: TranslationIntent | null = null;
  if (raw) {
    try {
      intent = JSON.parse(raw) as TranslationIntent;
    } catch {
      intent = null;
    }
  }

  const memoryFile = stagedFile;
  stagedFile = null;
  const diskFile = memoryFile || (await readPersistedFile());
  clearPersistedFile();

  if (
    !intent ||
    intent.version !== 1 ||
    typeof intent.createdAt !== 'number' ||
    Date.now() - intent.createdAt > TTL_MS
  ) {
    if (diskFile) return { file: diskFile };
    return null;
  }

  const videoUrl = intent.videoUrl?.trim();
  if (videoUrl) return { videoUrl };
  if (diskFile) return { file: diskFile };
  return null;
}

export function clearTranslationIntent(): void {
  removeStorage(STORAGE_KEY, 'session');
  removeStorage(FROM_TRANSLATE_KEY, 'session');
  stagedFile = null;
  clearPersistedFile();
}
