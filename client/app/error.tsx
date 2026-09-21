'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Route-level error boundary.
 *
 * Without one, a client-side exception unmounts the segment and leaves the
 * viewer staring at an empty page — indistinguishable from a slow network, and
 * impossible to report usefully. Showing the message matters most on phones,
 * where there is no console to open.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[route-error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] w-full items-center justify-center px-4 py-10">
      <div className="brand-gradient-frame w-full max-w-[440px] rounded-[20px] p-2.5 sm:p-3">
        <div className="rounded-[16px] bg-white p-4 shadow-sm sm:p-5">
          <h1 className="brand-campaign-page-title">Something went wrong</h1>
          <p className="brand-campaign-meta mt-1 text-[#616161]">
            This page hit an unexpected error. You can retry, and if it keeps happening the details
            below help us track it down.
          </p>

          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[12px] bg-[#FFF6F1] p-2.5 font-mono text-[11px] leading-relaxed text-[#8A3B12]">
            {error.message || 'Unknown error'}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>

          <button type="button" onClick={reset} className="brand-cta-primary mt-4 w-full">
            <RefreshCw className="h-4 w-4" strokeWidth={2} aria-hidden />
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
