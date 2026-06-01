/**
 * Authenticated final-video download via same-origin Next.js proxy or video service.
 */

export type VideoDownloadStrategy = 'signed_gcs' | 'proxy_stream' | 'public_gcs';

const VIDEO_SERVICE_API =
  process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004/api';

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

async function readDownloadError(res: Response): Promise<string> {
  let message = `Download failed (${res.status})`;
  try {
    const err = await res.json();
    if (err?.message) message = String(err.message);
  } catch {
    const text = await res.text().catch(() => '');
    if (text) message = text.slice(0, 200);
  }
  return message;
}

async function blobFromDownloadResponse(res: Response): Promise<Blob> {
  const contentType = res.headers.get('content-type') || '';
  const blob = await res.blob();

  if (!contentType.includes('video') && blob.size < 4096) {
    const text = await blob.text();
    try {
      const parsed = JSON.parse(text) as { message?: string };
      throw new Error(parsed.message || 'Download failed');
    } catch (e) {
      if (e instanceof Error && e.message !== 'Download failed') throw e;
      throw new Error('Download failed: unexpected response from server');
    }
  }

  return blob;
}

/**
 * Stream final MP4 through video-processing service with JWT (bypasses Next.js).
 */
export async function downloadViaVideoService(
  projectId: string,
  filename: string,
): Promise<void> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Please log in to download');
  }

  const res = await fetch(
    `${VIDEO_SERVICE_API}/video-projects/${encodeURIComponent(projectId)}/download`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    throw new Error(await readDownloadError(res));
  }

  const blob = await blobFromDownloadResponse(res);
  triggerBlobDownload(blob, filename);
}

/**
 * Stream final MP4 through /api/video/:id/download with JWT (Next.js proxy).
 */
export async function downloadAuthenticatedProxy(
  projectId: string,
  filename: string,
): Promise<void> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Please log in to download');
  }

  const res = await fetch(`/api/video/${projectId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(await readDownloadError(res));
  }

  const blob = await blobFromDownloadResponse(res);
  triggerBlobDownload(blob, filename);
}

/**
 * Proxy stream with one retry on video service, then Next.js proxy.
 */
export async function downloadAuthenticatedProxyWithFallback(
  projectId: string,
  filename: string,
): Promise<void> {
  try {
    await downloadViaVideoService(projectId, filename);
    return;
  } catch (directErr) {
    console.warn('[Download] Direct video-service fetch failed, trying Next proxy:', directErr);
  }

  try {
    await downloadAuthenticatedProxy(projectId, filename);
  } catch (proxyErr) {
    console.warn('[Download] Next proxy failed, retrying video service:', proxyErr);
    await downloadViaVideoService(projectId, filename);
  }
}
