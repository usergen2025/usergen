'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Dismisses a transient overlay (dropdown, popover, mobile menu) once the app
 * lands on a different route. Header overlays outlive the click that triggered
 * navigation because they are not unmounted by the route change.
 */
export function useCloseOnRouteChange(close: () => void) {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    closeRef.current();
  }, [pathname]);
}
