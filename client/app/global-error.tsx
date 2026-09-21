'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for crashes in the root layout itself — the providers in
 * `layout.tsx` sit above every route boundary, so an error thrown there would
 * otherwise blank the whole app with no explanation.
 *
 * This replaces the root layout when it renders, which means it must supply its
 * own `<html>`/`<body>` and cannot rely on the global stylesheet. Everything
 * here is inlined deliberately.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#FFFCF8',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          color: '#212121',
        }}
      >
        <div style={{ maxWidth: 440, width: '100%' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>
            The app failed to start
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#616161', margin: '0 0 12px' }}>
            Something crashed before the page could load. Reloading usually clears it.
          </p>
          <pre
            style={{
              margin: '0 0 16px',
              padding: 10,
              borderRadius: 12,
              background: '#FFF6F1',
              color: '#8A3B12',
              fontSize: 11,
              lineHeight: 1.5,
              maxHeight: 160,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {error.message || 'Unknown error'}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
          <button
            type="button"
            onClick={reset}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              fontSize: 15,
              fontWeight: 500,
              color: '#fff',
              background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
