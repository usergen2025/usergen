'use client';

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

const DEBUG = process.env.NEXT_PUBLIC_ANALYTICS_DEBUG === 'true';

export type GtmEvent = Record<string, unknown> & { event: string };

export function pushEvent(payload: GtmEvent): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  if (DEBUG) {
    console.debug('[gtm]', payload.event, payload);
  }
  window.dataLayer.push(payload);
}

/**
 * GA4 merges ecommerce objects across pushes; reset before each ecommerce event
 * so items from a previous event do not leak into the next one.
 */
export function pushEcommerce(
  payload: GtmEvent & { ecommerce: Record<string, unknown> },
): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ ecommerce: null });
  pushEvent(payload);
}

export function paiseToUnits(paise: number): number {
  return Math.round(paise) / 100;
}

/** Reads the `_ga` cookie, e.g. "GA1.1.1234567890.1699999999" -> "1234567890.1699999999" */
export function getGaClientId(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(/_ga=GA\d\.\d\.(\d+\.\d+)/);
  return match?.[1];
}

/**
 * Reads the `_ga_<STREAM>` cookie for session attribution (Measurement Protocol).
 * Pass the numeric stream ID from your GA4 web data stream if known.
 */
export function getGaSessionId(streamId?: string): string | undefined {
  if (typeof document === 'undefined') return undefined;

  const resolvedStreamId =
    streamId || process.env.NEXT_PUBLIC_GA_STREAM_ID || undefined;

  if (resolvedStreamId) {
    const specific = document.cookie.match(
      new RegExp(`_ga_${resolvedStreamId}=GS\\d\\.\\d\\.(\\d+)`),
    );
    if (specific?.[1]) return specific[1];
  }

  const cookies = document.cookie.split(';');
  for (const raw of cookies) {
    const [name, value] = raw.trim().split('=');
    if (name?.startsWith('_ga_') && name !== '_ga') {
      const match = value?.match(/^GS\d\.\d\.(\d+)/);
      if (match?.[1]) return match[1];
    }
  }

  return undefined;
}
