const PLACEHOLDER_PATTERNS = ['example.com', 'placeholder', 'x.png'];

/** Normalize a user-entered website string to https URL, or null if invalid. */
export function normalizeWebsiteUrl(input: string): string | null {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  let url = trimmed;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url.replace(/^\/+/, '')}`;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return null;
    }
    const lower = url.toLowerCase();
    if (PLACEHOLDER_PATTERNS.some((p) => lower.includes(p))) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}
