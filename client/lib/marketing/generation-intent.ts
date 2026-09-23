import { readStorageJson, removeStorage, writeStorage } from '@/lib/utils/safeStorage';
import { normalizeWebsiteUrl } from '@/lib/utils/normalize-website-url';

/**
 * What the landing page hero collected, held across sign-up.
 *
 * The hero asks for a product link or a brief, an avatar preference and a
 * language, then sends the visitor through the sign-up modals. The generation
 * funnel it lands in (`/create-video/ai-chat`) reads its state from a server
 * `VideoProject` record that does not exist yet at that point, so there is
 * nowhere to put these answers except the browser. Without this they are
 * discarded and the funnel asks for all three again, two screens later.
 *
 * Session storage rather than local: this is one visitor's half-finished
 * thought, not a preference. Closing the tab should throw it away.
 */
export type GenerationIntent = {
  /** Bumped when the shape changes; a mismatched version is discarded. */
  version: 1;
  /** Which hero tab produced `value` — a URL to analyse, or a brief to write from. */
  kind: 'link' | 'brief';
  /** Normalized URL for `link`, raw text for `brief`. Never empty. */
  value: string;
  withAvatar: boolean;
  /** Already narrowed to what `generate-video-script` accepts. */
  language: GenerationLanguage;
  createdAt: number;
};

/** The only three the script generator understands. */
export type GenerationLanguage = 'english' | 'hindi' | 'hinglish';

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

export function languageFromLabel(label: string): GenerationLanguage | null {
  return LANGUAGE_BY_LABEL[label.trim().toLowerCase()] ?? null;
}

/**
 * Stores what the hero collected. Returns false when there was nothing worth
 * keeping — an empty field, or a link that is not a link — so the caller can
 * still open sign-up without leaving a half-intent behind for the funnel to
 * act on.
 */
export function writeIntent(input: {
  kind: 'link' | 'brief';
  value: string;
  withAvatar: boolean;
  language: GenerationLanguage;
}): boolean {
  const trimmed = input.value.trim();
  if (!trimmed) return false;

  // A link that will not normalize cannot become a `type: 'url'` asset, and
  // passing it through as a brief would put a broken URL in the prompt.
  const value = input.kind === 'link' ? normalizeWebsiteUrl(trimmed) : trimmed;
  if (!value) return false;

  const intent: GenerationIntent = {
    version: 1,
    kind: input.kind,
    value,
    withAvatar: input.withAvatar,
    language: input.language,
    createdAt: Date.now(),
  };

  return writeStorage(STORAGE_KEY, JSON.stringify(intent), 'session');
}

/**
 * Reads the intent and clears it in the same breath.
 *
 * Single use on purpose: the funnel is re-entered constantly — resuming a
 * draft, starting a second video, a plain refresh — and an intent left in
 * storage would seed every one of those with copy from a landing page the
 * user saw once.
 */
export function consumeIntent(): GenerationIntent | null {
  const stored = readStorageJson<GenerationIntent>(STORAGE_KEY, 'session');
  clearIntent();

  if (!stored || stored.version !== 1) return null;
  if (typeof stored.value !== 'string' || !stored.value.trim()) return null;
  if (!LANGUAGE_BY_LABEL[stored.language]) return null;
  if (stored.kind !== 'link' && stored.kind !== 'brief') return null;
  if (typeof stored.createdAt !== 'number' || Date.now() - stored.createdAt > TTL_MS) return null;

  return stored;
}

/**
 * Drops the intent without reading it — used when the visitor picks Brand in
 * the role picker. Brands land on their own dashboard and never enter the
 * generation funnel, so their intent would otherwise sit in storage until it
 * expired and then seed whatever they opened next.
 */
export function clearIntent(): void {
  removeStorage(STORAGE_KEY, 'session');
}
