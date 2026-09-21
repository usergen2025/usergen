'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { getStepFromRoute } from '@/lib/config/video-steps';
import { trackVideoFunnelStep } from '@/lib/analytics/events';

function ClassicFunnelTrackerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    const step = getStepFromRoute(pathname);
    if (!step) return;

    const projectId = searchParams?.get('projectId') || undefined;
    const key = `${step}:${projectId || ''}`;
    if (lastKey.current === key) return;
    lastKey.current = key;

    trackVideoFunnelStep({
      stepName: step,
      projectId,
      funnel: 'classic',
    });
  }, [pathname, searchParams]);

  return null;
}

/** Fires `video_funnel_step` for classic create-video routes (style, avatar, …). */
export default function ClassicFunnelTracker() {
  return (
    <Suspense fallback={null}>
      <ClassicFunnelTrackerInner />
    </Suspense>
  );
}
