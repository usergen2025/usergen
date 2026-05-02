/**
 * Campaign watermarked preview is served with JWT — the video element cannot send
 * Authorization headers, so we load the full response as a blob (OK for review-sized clips).
 */

const DEFAULT_CAMPAIGN_API = 'http://localhost:9011/api';

/**
 * Normalized campaign-service origin including `/api` (Nest global prefix).
 * Accepts env with or without trailing `/api` so requests hit `/api/creator/...` not `/creator/...`.
 */
export function getCampaignServiceApiRoot(): string {
  const raw = (process.env.NEXT_PUBLIC_CAMPAIGN_SERVICE_URL || DEFAULT_CAMPAIGN_API).trim();
  let base = raw.replace(/\/+$/, '');
  if (!/\/api$/i.test(base)) {
    base = `${base}/api`;
  }
  return base;
}

/** Alias: preview URLs are rooted at the same `/api` base. */
export function getCampaignServiceBaseUrl(): string {
  return getCampaignServiceApiRoot();
}

/** e.g. GET {base}/campaign-media/{id}/preview */
export function campaignMediaPreviewUrl(assetId: string): string {
  return `${getCampaignServiceBaseUrl()}/campaign-media/${encodeURIComponent(assetId)}/preview`;
}

export function parseDraftMediaAssetId(
  draftMediaUrl: string | undefined,
  explicit?: string | null,
): string | null {
  if (explicit) return explicit;
  if (!draftMediaUrl) return null;
  const m = /\/campaign-media\/([^/]+)\/preview/.exec(draftMediaUrl);
  return m?.[1] ?? null;
}

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
}

/**
 * Fetches the watermarked file with Bearer auth and returns a temporary object URL.
 * Call URL.revokeObjectURL when the video is unmounted.
 */
export async function fetchCampaignPreviewObjectUrl(
  assetId: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = campaignMediaPreviewUrl(assetId);
  const token = getAuthToken();
  if (!token) {
    throw new Error('Not signed in');
  }
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `Preview failed (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
