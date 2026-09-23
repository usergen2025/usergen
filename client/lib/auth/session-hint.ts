/**
 * The session hint is a non-sensitive cookie naming the signed-in user's broad
 * role. Auth tokens live in Web Storage, which the server cannot read, so
 * middleware has no way to tell a signed-in visitor from a stranger. The hint
 * closes that gap without putting the JWT in a cookie, where it would ride
 * along on every same-origin request and open a CSRF surface that does not
 * exist today.
 *
 * It is advisory only. A missing or stale hint costs at most one wrong
 * redirect, which the client-side auth check then corrects — so it is safe for
 * the hint to drift out of sync with the token, which it will: Safari caps
 * script-set cookies at seven days, and the locked-down browsers that
 * `safeStorage` exists for block cookies outright.
 *
 * This module must stay free of DOM and Node APIs: `middleware.ts` imports it
 * and runs on the Edge runtime.
 */

export const SESSION_HINT_COOKIE = 'ug_session';

export type SessionHint = 'creator' | 'brand' | 'admin';

/**
 * Maps an API role onto a hint. Returns null for unrecognised roles so a new
 * role shipped by the backend falls through to "no hint" — the visitor sees
 * the marketing page and the client redirect sorts it out, rather than being
 * bounced somewhere arbitrary.
 */
export function hintForRole(role: string | undefined | null): SessionHint | null {
  switch (role) {
    case 'USER':
    case 'AVATAR_CREATOR':
      return 'creator';
    case 'BRAND':
      return 'brand';
    case 'ADMIN':
    case 'OWNER':
      return 'admin';
    default:
      return null;
  }
}

/** Narrows an arbitrary cookie value, which a user can edit freely. */
export function parseSessionHint(value: string | undefined | null): SessionHint | null {
  return value === 'creator' || value === 'brand' || value === 'admin' ? value : null;
}

/**
 * Where a signed-in visitor belongs instead of the marketing pages. `/projects`
 * mirrors the creator default already used after login in `LoginModal`.
 */
export function dashboardPathForHint(hint: SessionHint): string {
  switch (hint) {
    case 'brand':
      return '/brand/dashboard';
    case 'admin':
      return '/admin';
    case 'creator':
      return '/projects';
  }
}

/**
 * The signed-in creator's home. `proxy.ts` rewrites `/` here rather than
 * redirecting, so this path is normally an implementation detail and the
 * visitor stays on `/`.
 */
export const CREATOR_HOME_PATH = '/home';

/**
 * Where a signed-in visitor lands when they reach a logged-out-only page.
 *
 * Creators keep a home page, so `/` is theirs; the marketing subpages have no
 * signed-in counterpart and hand off to the dashboard. Brands and admins have
 * no home page of their own and always go to their dashboard.
 */
export function signedInPathFor(hint: SessionHint, pathname: string): string {
  return hint === 'creator' && pathname === '/'
    ? CREATOR_HOME_PATH
    : dashboardPathForHint(hint);
}

/** Logged-out-only pages. Kept here so middleware and the client gate agree. */
export const MARKETING_ROUTES = ['/', '/pricing', '/examples', '/agencies'] as const;

export function isMarketingRoute(pathname: string | null | undefined): boolean {
  return !!pathname && (MARKETING_ROUTES as readonly string[]).includes(pathname);
}
