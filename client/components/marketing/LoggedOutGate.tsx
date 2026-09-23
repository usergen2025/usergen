'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { hintForRole, signedInPathFor } from '@/lib/auth/session-hint';

/**
 * Client-side backstop for the redirect `proxy.ts` normally performs.
 *
 * The proxy depends on the `ug_session` cookie, which the browsers
 * `safeStorage` exists for refuse to store, and which Safari expires after
 * seven days regardless. Those visitors reach the marketing page while signed
 * in, so the check is repeated here against the real token.
 *
 * Children are rendered as-is for signed-out visitors, which is everyone the
 * marketing page is built for — the page stays server-rendered and indexable,
 * and this only suppresses output once a redirect is actually in flight.
 */
export default function LoggedOutGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const redirectHint =
    !isLoading && isAuthenticated ? hintForRole(user?.role) : null;

  useEffect(() => {
    if (redirectHint) {
      // Navigating rather than rewriting, so unlike the proxy path a creator
      // recovered here ends up on `/home` in the address bar. This only runs
      // when the cookie failed, so it is the degraded case either way.
      router.replace(signedInPathFor(redirectHint, pathname ?? '/'));
    }
  }, [redirectHint, router, pathname]);

  if (redirectHint) {
    return null;
  }

  return <>{children}</>;
}
