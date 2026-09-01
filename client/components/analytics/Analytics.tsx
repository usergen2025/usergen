'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { pushEvent } from '@/lib/analytics/gtm';

function sectionFor(pathname: string): string {
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/brand')) return 'brand';
  if (pathname.startsWith('/create-video')) return 'creation';
  if (pathname.startsWith('/campaigns')) return 'campaigns';
  if (pathname.startsWith('/billing') || pathname.startsWith('/usage')) return 'billing';
  return 'marketing';
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    pushEvent({
      event: 'spa_page_view',
      page_path: qs ? `${pathname}?${qs}` : pathname,
      page_location: window.location.href,
      page_title: document.title,
      page_section: sectionFor(pathname),
    });
  }, [pathname, searchParams]);

  return null;
}

function IdentityTracker() {
  const { user, isAuthenticated, isLoading } = useAuth();
  // useAuth polls every 100ms; guard so we only push when identity actually changes.
  const lastPushed = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading) return;

    const identity = isAuthenticated && user?.id ? user.id : 'anonymous';
    const signature = `${identity}:${user?.role ?? ''}`;
    if (lastPushed.current === signature) return;
    lastPushed.current = signature;

    pushEvent({
      event: 'user_identity',
      user_id: isAuthenticated && user?.id ? user.id : undefined,
      user_role: user?.role ?? undefined,
      user_type: user?.role === 'BRAND' ? 'brand' : 'creator',
    });
  }, [isAuthenticated, isLoading, user?.id, user?.role]);

  return null;
}

export default function Analytics() {
  if (!process.env.NEXT_PUBLIC_GTM_ID) return null;

  return (
    <>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      <IdentityTracker />
    </>
  );
}
