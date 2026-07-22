'use client';

import { usePathname } from 'next/navigation';
import Header from './Header';

interface ConditionalHeaderProps {
  position?: 'fixed' | 'relative' | 'sticky';
}

export default function ConditionalHeader({ position = 'fixed' }: ConditionalHeaderProps) {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isAuthCallbackPage = pathname === '/auth/callback';
  const isAIChatPage = pathname === '/create-video/ai-chat';
  const isWorkspacePage = pathname === '/create-video/workspace';
  const isBrandRoute = pathname?.startsWith('/brand');
  const isBillingRoute = pathname === '/billing' || pathname?.startsWith('/billing/');
  const isProjectsPage = pathname === '/projects';
  const isCreatorCampaignRoute = pathname === '/campaigns' || pathname?.startsWith('/campaigns/');
  const isCreatorEarningsPage = pathname === '/earnings';
  const isAdminRoute = pathname?.startsWith('/admin');
  
  // Don't show header on auth pages, auth callback, or admin routes (admin has its own layout)
  if (isAuthPage || isAuthCallbackPage || isAdminRoute) {
    return null;
  }
  
  // Use relative positioning so page content is not covered by the fixed floating header bar
  const headerPosition = (
    isAIChatPage ||
    isBrandRoute ||
    isWorkspacePage ||
    isBillingRoute ||
    isProjectsPage ||
    isCreatorCampaignRoute ||
    isCreatorEarningsPage
  ) ? 'relative' : position;
  const floatingBarSurface = isWorkspacePage ? 'translucent' : 'solid';

  return <Header position={headerPosition} floatingBarSurface={floatingBarSurface} />;
}

