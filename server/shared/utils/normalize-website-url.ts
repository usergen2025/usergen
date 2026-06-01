const PLACEHOLDER_PATTERNS = ['example.com', 'placeholder', 'x.png'];

/**
 * Normalize a user-entered website string to a fetchable https URL.
 * Returns null for empty or placeholder values.
 */
export function normalizeWebsiteUrl(input: string): string | null {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  let url = trimmed;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url.replace(/^\/+/, '')}`;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    const lower = url.toLowerCase();
    if (PLACEHOLDER_PATTERNS.some((p) => lower.includes(p))) {
      return null;
    }
    if (!parsed.hostname.includes('.')) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/** Extract hostname from a normalized or raw URL string. */
export function extractDomainFromUrl(input: string): string {
  const normalized = normalizeWebsiteUrl(input) || input;
  try {
    return new URL(normalized.startsWith('http') ? normalized : `https://${normalized}`).hostname;
  } catch {
    return input.replace(/^https?:\/\//i, '').split('/')[0] || input;
  }
}
