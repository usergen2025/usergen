/**
 * Resolve a single speakable brand name from multilingual logo OCR / vision fields.
 */

export type ScriptLanguage = 'english' | 'hindi' | 'hinglish';

export interface LogoBrandVoiceoverContext {
  /** Full OCR text from logo (all scripts). */
  rawLogoText?: string;
  /** Vision primary brand name (single form preferred). */
  brandName?: string;
  /** All language/script variants of the same brand. */
  brandNameVariants?: string[];
  tagline?: string;
}

const DEVANAGARI_RE = /[\u0900-\u097F]/;
const LATIN_RE = /[A-Za-z]/;

function hasDevanagari(text: string): boolean {
  return DEVANAGARI_RE.test(text);
}

function hasLatin(text: string): boolean {
  return LATIN_RE.test(text);
}

export function isMixedScript(text: string): boolean {
  return hasDevanagari(text) && hasLatin(text);
}

/** True when raw OCR or variants span multiple scripts (e.g. Hindi + English logo). */
export function isMultilingualLogoText(
  text?: string,
  variants: string[] = [],
): boolean {
  if (variants.length > 1) return true;
  const raw = (text || '').trim();
  if (!raw) return false;
  if (isMixedScript(raw)) return true;
  return splitLogoTextIntoScriptSegments(raw).length > 1;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cleanupBrandSegment(text: string): string {
  let t = normalizeWhitespace(text);
  t = t.replace(/!+/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

function titleCaseEnglish(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      if (w === w.toUpperCase() && w.length > 1) {
        return w.charAt(0) + w.slice(1).toLowerCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Split raw OCR into script-homogeneous segments. */
export function splitLogoTextIntoScriptSegments(raw: string): string[] {
  const text = normalizeWhitespace(raw);
  if (!text) return [];

  const byDelimiter = text
    .split(/[\n|]+/)
    .map((s) => cleanupBrandSegment(s))
    .filter((s) => s.length >= 2);
  if (byDelimiter.length > 1) return byDelimiter;

  if (!isMixedScript(text)) return [cleanupBrandSegment(text)];

  const segments: string[] = [];
  let current = '';
  let currentScript: 'devanagari' | 'latin' | 'other' | null = null;

  for (const char of text) {
    let script: 'devanagari' | 'latin' | 'other' = 'other';
    if (DEVANAGARI_RE.test(char)) script = 'devanagari';
    else if (LATIN_RE.test(char)) script = 'latin';

    if (script === 'other') {
      current += char;
      continue;
    }

    if (currentScript && script !== currentScript && current.trim()) {
      segments.push(cleanupBrandSegment(current));
      current = '';
    }
    currentScript = script;
    current += char;
  }
  if (current.trim()) segments.push(cleanupBrandSegment(current));

  return segments.filter((s) => s.length >= 2);
}

function pickSegmentForLanguage(
  segments: string[],
  language: ScriptLanguage,
): string | undefined {
  if (segments.length === 0) return undefined;
  if (segments.length === 1) return segments[0];

  const devanagari = segments.filter((s) => hasDevanagari(s) && !hasLatin(s));
  const latin = segments.filter((s) => hasLatin(s) && !hasDevanagari(s));
  const mixed = segments.filter((s) => isMixedScript(s));

  if (language === 'hindi') {
    return devanagari[0] || mixed[0] || segments[0];
  }
  return latin[0] || mixed[0] || segments[0];
}

function pickVariantForLanguage(
  variants: string[],
  language: ScriptLanguage,
): string | undefined {
  if (!variants.length) return undefined;
  const cleaned = variants.map((v) => cleanupBrandSegment(v)).filter((v) => v.length >= 2);
  return pickSegmentForLanguage(cleaned, language);
}

function polishForLanguage(text: string, language: ScriptLanguage): string {
  const t = cleanupBrandSegment(text);
  if (language === 'english' || language === 'hinglish') {
    if (hasLatin(t) && !hasDevanagari(t)) {
      return titleCaseEnglish(t);
    }
  }
  return t;
}

/**
 * Resolve one canonical brand string for voiceover based on script language.
 */
export function resolveCanonicalBrandName(
  ctx: LogoBrandVoiceoverContext,
  language: ScriptLanguage,
): string | undefined {
  const raw = ctx.rawLogoText?.trim() || '';
  const variants = (ctx.brandNameVariants || []).map((v) => v.trim()).filter(Boolean);

  if (variants.length > 1) {
    const fromVariants = pickVariantForLanguage(variants, language);
    if (fromVariants) return polishForLanguage(fromVariants, language);
  }

  const primary = ctx.brandName?.trim();
  if (primary) {
    if (!isMixedScript(primary)) {
      return polishForLanguage(primary, language);
    }
    const fromPrimary = pickSegmentForLanguage(splitLogoTextIntoScriptSegments(primary), language);
    if (fromPrimary) return polishForLanguage(fromPrimary, language);
  }

  if (raw) {
    const segments = splitLogoTextIntoScriptSegments(raw);
    const picked = pickSegmentForLanguage(segments, language);
    if (picked) return polishForLanguage(picked, language);
  }

  if (variants.length === 1) {
    return polishForLanguage(variants[0], language);
  }

  return primary ? polishForLanguage(primary, language) : undefined;
}

/** Latin tokens from text for overlap detection. */
function latinBrandTokens(text: string): string[] {
  return (text.match(/[A-Za-z]{2,}/g) || []).map((t) => t.toUpperCase());
}

/** Heuristic: Devanagari word chunks for overlap (2+ chars). */
function devanagariChunks(text: string): string[] {
  const matches = text.match(/[\u0900-\u097F]{2,}/g) || [];
  return matches;
}

/**
 * True when voiceover likely speaks the same brand in two scripts (e.g. Hindi + English).
 */
export function detectMultilingualBrandDuplication(voiceover: string): boolean {
  const vo = (voiceover || '').trim();
  if (!vo) return false;

  if (!hasDevanagari(vo) || !hasLatin(vo)) return false;

  const latin = latinBrandTokens(vo);
  const deva = devanagariChunks(vo);

  if (latin.length === 0 || deva.length === 0) return false;

  const latinJoined = latin.join(' ');
  const bangLike = latin.some((t) => /^BANG$/i.test(t) || /^BANG!$/i.test(t));
  const devaBangLike = deva.some((d) => d.includes('बैंग') || d.includes('बांग'));

  if (bangLike && devaBangLike) return true;

  if (latin.length >= 2 && deva.length >= 1) {
    const hasNoodle = /NOODLE/i.test(latinJoined);
    const hasNudol = vo.includes('नूडल') || vo.includes('नूड');
    if (hasNoodle && hasNudol) return true;
  }

  return latin.length >= 2 && deva.length >= 2;
}

/**
 * Count how many distinct variants from the list appear in voiceover.
 */
export function countVariantMentionsInVoiceover(
  voiceover: string,
  variants: string[],
): number {
  const vo = (voiceover || '').toLowerCase();
  let count = 0;
  for (const v of variants) {
    const norm = v.trim().toLowerCase();
    if (norm.length < 2) continue;
    if (vo.includes(norm)) count++;
  }
  return count;
}

/**
 * True if product name is likely the same brand as canonical (avoid double tracking).
 */
export function isProductNameDuplicateOfBrand(
  productName: string | undefined,
  canonicalBrand: string | undefined,
): boolean {
  if (!productName?.trim() || !canonicalBrand?.trim()) return false;
  const p = productName.trim().toLowerCase();
  const b = canonicalBrand.trim().toLowerCase();
  if (p === b) return true;
  if (p.includes(b) || b.includes(p)) return true;

  const pLatin = latinBrandTokens(productName);
  const bLatin = latinBrandTokens(canonicalBrand);
  if (pLatin.length && bLatin.length) {
    const overlap = pLatin.filter((t) => bLatin.includes(t));
    if (overlap.length >= Math.min(2, pLatin.length)) return true;
  }

  return false;
}

/**
 * Infer variants from raw OCR when vision did not return brandNameVariants.
 */
export function inferBrandNameVariantsFromRaw(rawLogoText?: string): string[] {
  const segments = splitLogoTextIntoScriptSegments(rawLogoText || '');
  const unique = new Set<string>();
  for (const s of segments) {
    if (s.length >= 2) unique.add(s);
  }
  return Array.from(unique);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build replaceable non-canonical brand strings (longest first). */
export function collectBrandVoiceoverReplacementPatterns(
  canonicalBrand: string,
  variants: string[] = [],
  rawLogoText?: string,
): string[] {
  const canonical = canonicalBrand.trim();
  const patterns = new Set<string>();

  const add = (p?: string) => {
    const t = (p || '').trim();
    if (t.length >= 2 && t.toLowerCase() !== canonical.toLowerCase()) {
      patterns.add(t);
    }
  };

  add(rawLogoText);
  for (const v of variants) add(v);
  for (const seg of splitLogoTextIntoScriptSegments(rawLogoText || '')) add(seg);

  return Array.from(patterns).sort((a, b) => b.length - a.length);
}

function patternToFlexibleRegex(pattern: string): RegExp {
  const parts = pattern
    .trim()
    .split(/\s+/)
    .map((w) => escapeRegex(w).replace(/!/g, '!?'));
  return new RegExp(parts.join('\\s+'), 'gi');
}

function collapseDuplicateCanonicalMentions(text: string, canonical: string): string {
  const flex = escapeRegex(canonical).replace(/\s+/g, '\\s+');
  return text.replace(new RegExp(`(${flex})([\\s!.,;:—–-]*\\1)+`, 'gi'), canonical);
}

/**
 * Deterministically replace multilingual / OCR brand recitation with one canonical name.
 */
export function dedupeMultilingualBrandInVoiceover(
  voiceover: string,
  canonicalBrand: string,
  variants: string[] = [],
  rawLogoText?: string,
): string {
  if (!voiceover?.trim() || !canonicalBrand?.trim()) return voiceover;

  const canonical = canonicalBrand.trim();
  let result = voiceover;
  const patterns = collectBrandVoiceoverReplacementPatterns(
    canonical,
    variants,
    rawLogoText,
  );

  for (const pattern of patterns) {
    result = result.replace(patternToFlexibleRegex(pattern), canonical);
    result = result.replace(new RegExp(escapeRegex(pattern), 'gi'), canonical);
  }

  result = collapseDuplicateCanonicalMentions(result, canonical);

  if (detectMultilingualBrandDuplication(result)) {
    for (const pattern of patterns) {
      if (hasDevanagari(pattern) && hasLatin(canonical) && !hasDevanagari(canonical)) {
        result = result.replace(patternToFlexibleRegex(pattern), canonical);
        for (const chunk of devanagariChunks(pattern)) {
          if (chunk.length >= 2) {
            result = result.replace(new RegExp(escapeRegex(chunk) + '!?', 'g'), canonical);
          }
        }
      }
      if (hasLatin(pattern) && hasDevanagari(canonical) && !hasLatin(canonical)) {
        result = result.replace(new RegExp(escapeRegex(pattern), 'gi'), canonical);
      }
    }
    result = collapseDuplicateCanonicalMentions(result, canonical);
  }

  return normalizeWhitespace(result);
}
