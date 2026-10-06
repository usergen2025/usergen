'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { hintForRole, signedInPathFor } from '@/lib/auth/session-hint';
import { clearIntent, GENERATION_FUNNEL_PATH, hasPendingGenerationFunnel } from '@/lib/marketing/generation-intent';

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
    if (!redirectHint) return;
    /*
     * A homepage "Generate my ad" is already in flight. Sending a creator to
     * `/home` here blanks the page and races the login modal's chat redirect.
     * Brands never enter that funnel.
     */
    if (redirectHint !== 'creator') {
      if (hasPendingGenerationFunnel()) clearIntent();
      router.replace(signedInPathFor(redirectHint, pathname ?? '/'));
      return;
    }
    if (hasPendingGenerationFunnel()) {
      sessionStorage.removeItem('fromCreateVideo');
      router.replace(GENERATION_FUNNEL_PATH);
      return;
    }
    router.replace(signedInPathFor(redirectHint, pathname ?? '/'));
  }, [redirectHint, router, pathname]);

  if (redirectHint) {
    return null;
  }

  return <>{children}</>;
}
