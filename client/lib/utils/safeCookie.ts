/**
 * Guarded access to `document.cookie`.
 *
 * Same hazard as `safeStorage`: iOS Safari with "Block All Cookies" and some
 * Android in-app browsers throw on cookie access rather than returning empty,
 * so an unguarded write takes down whichever effect touches it first. Cookies
 * also fail silently in ways storage does not — a write can appear to succeed
 * and simply not persist — so no caller should depend on a cookie surviving.
 */

/** Cookies set here are advisory hints only; never store secrets in them. */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const prefix = `${encodeURIComponent(name)}=`;
    const match = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(prefix));
    return match ? decodeURIComponent(match.slice(prefix.length)) : null;
  } catch {
    return null;
  }
}

type CookieOptions = {
  /** Omit to write a session cookie that dies with the tab. */
  maxAgeSeconds?: number;
  path?: string;
};

export function writeCookie(name: string, value: string, options: CookieOptions = {}): void {
  if (typeof document === 'undefined') return;
  try {
    const { maxAgeSeconds, path = '/' } = options;
    const parts = [
      `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
      `path=${path}`,
      // Lax still sends the cookie on top-level navigations, which is the only
      // request middleware reads it on. Strict would drop it when the visitor
      // arrives from an ad or email link — exactly the traffic that matters.
      'samesite=lax',
    ];
    if (maxAgeSeconds !== undefined) parts.push(`max-age=${maxAgeSeconds}`);
    // Conditional so the hint still works over http://localhost in dev.
    if (window.location.protocol === 'https:') parts.push('secure');
    document.cookie = parts.join('; ');
  } catch {
    /* a hint that cannot be written just means the server stays uninformed */
  }
}

export function removeCookie(name: string, path = '/'): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = `${encodeURIComponent(name)}=; path=${path}; max-age=0; samesite=lax`;
  } catch {
    /* nothing to clean up if cookies are unavailable */
  }
}
