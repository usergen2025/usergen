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
  const isBillingPage = pathname === '/billing';
  const isAdminRoute = pathname?.startsWith('/admin');
  
  // Don't show header on auth pages, auth callback, or admin routes (admin has its own layout)
  if (isAuthPage || isAuthCallbackPage || isAdminRoute) {
    return null;
  }
  
  // Use relative positioning for AI chat page, workspace page, brand routes, and billing page to prevent overlap
  const headerPosition = (isAIChatPage || isBrandRoute || isWorkspacePage || isBillingPage) ? 'relative' : position;
  
  return <Header position={headerPosition} />;
}

