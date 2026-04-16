/**
 * Resolves the public base URL for auth HTTP routes. Nest uses global prefix `api`,
 * so OAuth redirect URIs must be `{base}/auth/{provider}/callback` where `base` ends with `/api`.
 *
 * Accepts either `http://host:port` or `http://host:port/api` and normalizes to the latter.
 */
export function resolveAuthApiPublicBase(baseUrl: string | undefined): string {
  const raw = (baseUrl || 'http://localhost:9000').trim().replace(/\/$/, '');
  if (raw.endsWith('/api')) {
    return raw;
  }
  return `${raw}/api`;
}
