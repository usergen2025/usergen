import { readStorageJson, removeStorage, writeStorage } from '@/lib/utils/safeStorage';

/**
 * What the landing page hero collected, held across sign-up.
 *
 * The hero asks for an ad description, a video style, a language, a duration
 * and optional product assets, then sends the visitor through the sign-up
 * modals. The generation funnel (`/create-video/ai-chat`) reads its state from
 * a server `VideoProject` record that does not exist yet at that point, so
 * the answers live in the browser until the funnel can apply them.
 *
 * Session storage rather than local: this is one visitor's half-finished
 * thought, not a preference. Closing the tab should throw it away. Image
 * files cannot survive that store (or a full reload); they are held in module
 * memory, which client-side navigation to the funnel keeps alive.
 */
export type GenerationIntent = {
  /** Bumped when the shape changes; a mismatched version is discarded. */
  version: 2;
  /** Ad description. May be empty — the funnel still applies the other choices. */
  value: string;
  videoStyle: GenerationVideoStyle;
  duration: GenerationDuration;
  /** Already narrowed to what `generate-video-script` accepts. */
  language: GenerationLanguage;
  createdAt: number;
};

/** The five styles the AI chat style step currently offers. */
export type GenerationVideoStyle =
  | 'avatar-only'
  | 'alternate'
  | 'product-only'
  | 'broll-only'
  | 'avatar-product';

/** Matches `VIDEO_DURATION_OPTIONS` in the AI chat page. */
export type GenerationDuration = '30 seconds' | '45 seconds' | '1 minute' | '90 seconds';

/** The only three the script generator understands. */
export type GenerationLanguage = 'english' | 'hindi' | 'hinglish';

export type HeroAssetKind = 'logo' | 'product' | 'url';

/** A file or URL picked in the hero, not yet uploaded. `id` uses the chat prefixes (`logo-`, `product-`, `url-`). */
export type HeroAssetDraft = {
  id: string;
  name: string;
  kind: HeroAssetKind;
  file?: File;
  preview?: string;
  url?: string;
};

const STORAGE_KEY = 'ug_generation_intent';

/**
 * Long enough to survive sign-up including an OAuth round trip and an OTP
 * email, short enough that a tab left open over lunch does not silently
 * pre-fill a funnel the user opened for something else.
 */
const TTL_MS = 30 * 60 * 1000;

/** Hero pill labels are display copy; the API wants these. */
const LANGUAGE_BY_LABEL: Record<string, GenerationLanguage> = {
  english: 'english',
  hindi: 'hindi',
  hinglish: 'hinglish',
};

const VIDEO_STYLES = new Set<GenerationVideoStyle>([
  'avatar-only',
  'alternate',
  'product-only',
  'broll-only',
  'avatar-product',
]);

const DURATIONS = new Set<GenerationDuration>([
  '30 seconds',
  '45 seconds',
  '1 minute',
  '90 seconds',
]);

/** Survives `router.push` within the tab. Cleared with the intent. */
let stagedAssets: HeroAssetDraft[] = [];

/**
 * React Strict Mode runs the funnel's effect twice in development and throws
 * away the first result. Keep the consumed intent briefly so the second run
 * still receives it. Production only consumes once.
 */
let recentConsume: { at: number; value: ConsumedIntent } | null = null;
const RECONSUME_MS = 2000;

export function languageFromLabel(label: string): GenerationLanguage | null {
  return LANGUAGE_BY_LABEL[label.trim().toLowerCase()] ?? null;
}

export function stageHeroAssets(assets: HeroAssetDraft[]): void {
  stagedAssets = assets;
}

function takeHeroAssets(): HeroAssetDraft[] {
  const next = stagedAssets;
  stagedAssets = [];
  return next;
}

/**
 * Stores what the hero collected. Returns false when the style, duration or
 * language is not one the funnel understands, so the caller can still open
 * sign-up without leaving a half-intent behind.
 */
export function writeIntent(input: {
  value: string;
  videoStyle: GenerationVideoStyle;
  duration: GenerationDuration;
  language: GenerationLanguage;
}): boolean {
  if (!VIDEO_STYLES.has(input.videoStyle)) return false;
  if (!DURATIONS.has(input.duration)) return false;
  if (!LANGUAGE_BY_LABEL[input.language]) return false;

  const intent: GenerationIntent = {
    version: 2,
    value: input.value.trim(),
    videoStyle: input.videoStyle,
    duration: input.duration,
    language: input.language,
    createdAt: Date.now(),
  };

  return writeStorage(STORAGE_KEY, JSON.stringify(intent), 'session');
}

export type ConsumedIntent = {
  intent: GenerationIntent;
  assets: HeroAssetDraft[];
};

/**
 * Reads the intent and clears it in the same breath, including any staged files.
 *
 * Single use on purpose: the funnel is re-entered constantly — resuming a
 * draft, starting a second video, a plain refresh — and an intent left in
 * storage would seed every one of those with copy from a landing page the
 * user saw once.
 */
export function consumeIntent(): ConsumedIntent | null {
  if (recentConsume && Date.now() - recentConsume.at < RECONSUME_MS) {
    return recentConsume.value;
  }

  const stored = readStorageJson<GenerationIntent>(STORAGE_KEY, 'session');
  const assets = takeHeroAssets();
  removeStorage(STORAGE_KEY, 'session');

  if (!stored || stored.version !== 2) return null;
  if (typeof stored.value !== 'string') return null;
  if (!VIDEO_STYLES.has(stored.videoStyle)) return null;
  if (!DURATIONS.has(stored.duration)) return null;
  if (!LANGUAGE_BY_LABEL[stored.language]) return null;
  if (typeof stored.createdAt !== 'number' || Date.now() - stored.createdAt > TTL_MS) return null;

  const value = { intent: stored, assets };
  recentConsume = { at: Date.now(), value };
  return value;
}

/**
 * Drops the intent without reading it — used when the visitor picks Brand in
 * the role picker. Brands land on their own dashboard and never enter the
 * generation funnel, so their intent would otherwise sit in storage until it
 * expired and then seed whatever they opened next.
 */
export function clearIntent(): void {
  removeStorage(STORAGE_KEY, 'session');
  stagedAssets = [];
  recentConsume = null;
}
