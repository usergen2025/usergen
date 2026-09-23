import { NextResponse, type NextRequest } from 'next/server';
import {
  CREATOR_HOME_PATH,
  SESSION_HINT_COOKIE,
  parseSessionHint,
  signedInPathFor,
} from '@/lib/auth/session-hint';

/**
 * Decides what a signed-in visitor gets on the logged-out-only pages.
 *
 * `/` is special: a returning creator should still have a home page, so it is
 * *rewritten* to `/home` rather than redirected. The URL stays `/`, which is
 * what a home page should be, and the signed-in page is server-rendered on
 * the first response instead of the landing page flashing up and being pulled
 * away. Brands and admins have their own dashboards and keep redirecting,
 * since `/home` is a creator's screen.
 *
 * The marketing subpages have no signed-in equivalent, so they redirect as
 * before.
 *
 * Reads the advisory `ug_session` hint, never a credential — see
 * `lib/auth/session-hint.ts`. A forged or stale hint can only misroute the
 * visitor between dashboards that each enforce their own auth, and `/home`
 * itself renders nothing sensitive.
 */
export function proxy(request: NextRequest) {
  const hint = parseSessionHint(request.cookies.get(SESSION_HINT_COOKIE)?.value);
  if (!hint) {
    return NextResponse.next();
  }

  const destination = signedInPathFor(hint, request.nextUrl.pathname);
  const url = request.nextUrl.clone();
  url.pathname = destination;

  if (destination === CREATOR_HOME_PATH) {
    return NextResponse.rewrite(url);
  }

  if (request.nextUrl.pathname === destination) {
    return NextResponse.next();
  }

  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Scoped to the marketing pages only. A broad matcher would put a
  // cookie-based decision in front of the authenticated app, where the real
  // token is the source of truth and a stale hint could lock a user out.
  //
  // Next.js extracts this by static analysis, so it cannot reference
  // MARKETING_ROUTES — keep the two lists in sync by hand.
  matcher: ['/', '/pricing', '/examples', '/agencies'],
};
