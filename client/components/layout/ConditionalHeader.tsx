'use client';

import { usePathname } from 'next/navigation';
import Header from './Header';
import { useAuth } from '@/hooks/useAuth';
import { isMarketingRoute } from '@/lib/auth/session-hint';

interface ConditionalHeaderProps {
  position?: 'fixed' | 'relative' | 'sticky';
}

export default function ConditionalHeader({ position = 'fixed' }: ConditionalHeaderProps) {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isAuthCallbackPage = pathname === '/auth/callback';
  const isAIChatPage = pathname === '/create-video/ai-chat';
  const isWorkspacePage = pathname === '/create-video/workspace';
  const isBrandRoute = pathname?.startsWith('/brand');
  const isBillingRoute = pathname === '/billing' || pathname?.startsWith('/billing/');
  const isUsagePage = pathname === '/usage';
  const isProjectsPage = pathname === '/projects';
  const isCreatorCampaignRoute = pathname === '/campaigns' || pathname?.startsWith('/campaigns/');
  const isCreatorEarningsPage = pathname === '/earnings';
  const isAdminRoute = pathname?.startsWith('/admin');
  
  /*
   * The marketing pages ship their own header, on the new design's type and
   * colour system rather than the app's — but only for signed-out visitors.
   * `proxy.ts` rewrites `/` to the signed-in home for creators, which keeps
   * the browser path at `/` while rendering an app screen that does need this
   * header, so the check is on the session rather than the path alone.
   *
   * The header is fixed, so appearing after the auth check resolves costs a
   * fade-in and no layout shift.
   */
  if (isAuthPage || isAuthCallbackPage || isAdminRoute) {
    return null;
  }
  if (isMarketingRoute(pathname) && !isAuthenticated) {
    return null;
  }
  
  // Use relative positioning so page content is not covered by the fixed floating header bar
  const headerPosition = (
    isAIChatPage ||
    isBrandRoute ||
    isWorkspacePage ||
    isBillingRoute ||
    isUsagePage ||
    isProjectsPage ||
    isCreatorCampaignRoute ||
    isCreatorEarningsPage
  ) ? 'relative' : position;
  const floatingBarSurface = isWorkspacePage ? 'translucent' : 'solid';

  return <Header position={headerPosition} floatingBarSurface={floatingBarSurface} />;
}

