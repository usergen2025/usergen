import axios, { type AxiosResponse } from 'axios';

const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

const ALLOWED_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.avi']);

export type ExternalMediaProvider =
  | 'google-drive'
  | 'dropbox'
  | 'onedrive'
  | 'box'
  | 'direct';

export interface DownloadedExternalVideo {
  buffer: Buffer;
  mimeType: string;
  ext: string;
  provider: ExternalMediaProvider;
  resolvedUrl: string;
}

/** Extract Google Drive file id from common share URL shapes. */
export function extractGoogleDriveFileId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (!host.endsWith('google.com') && host !== 'drive.google.com') {
      if (host === 'docs.google.com') {
        const m = /\/file\/d\/([^/]+)/.exec(parsed.pathname);
        return m?.[1] ?? null;
      }
      return null;
    }

    const pathMatch = /\/file\/d\/([^/]+)/.exec(parsed.pathname);
    if (pathMatch?.[1]) return pathMatch[1];

    const openId = parsed.searchParams.get('id');
    if (openId) return openId;

    const ucId = parsed.searchParams.get('id');
    if (ucId && parsed.pathname.includes('/uc')) return ucId;

    return null;
  } catch {
    return null;
  }
}

export function detectExternalMediaProvider(url: string): ExternalMediaProvider {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

    if (extractGoogleDriveFileId(url)) return 'google-drive';
    if (host.includes('dropbox.com')) return 'dropbox';
    if (host.includes('1drv.ms') || host.includes('onedrive.live.com') || host.includes('sharepoint.com')) {
      return 'onedrive';
    }
    if (host.includes('box.com')) return 'box';
    return 'direct';
  } catch {
    return 'direct';
  }
}

/** Normalize share links into a fetchable download URL where possible. */
export function normalizeExternalMediaUrl(url: string): { url: string; provider: ExternalMediaProvider } {
  const provider = detectExternalMediaProvider(url);

  if (provider === 'google-drive') {
    const fileId = extractGoogleDriveFileId(url);
    if (!fileId) {
      throw new Error('Could not parse Google Drive file id from URL');
    }
    return {
      provider,
      url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
    };
  }

  if (provider === 'dropbox') {
    const parsed = new URL(url);
    parsed.searchParams.set('dl', '1');
    if (!parsed.searchParams.has('dl')) {
      parsed.searchParams.set('raw', '1');
    }
    return { provider, url: parsed.toString() };
  }

  if (provider === 'onedrive') {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('download')) {
      parsed.searchParams.set('download', '1');
    }
    return { provider, url: parsed.toString() };
  }

  if (provider === 'box') {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/s/') && !parsed.searchParams.has('download')) {
      parsed.searchParams.set('download', '1');
    }
    return { provider, url: parsed.toString() };
  }

  return { provider: 'direct', url };
}

function isHtmlPayload(buf: Buffer, contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return true;
  const head = buf.slice(0, 256).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

/** Sniff video container from magic bytes (content-type from hosts is often wrong). */
export function sniffVideoFormat(buf: Buffer): { ext: string; mimeType: string } | null {
  if (buf.length < 12) return null;

  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { ext: '.webm', mimeType: 'video/webm' };
  }

  if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand.startsWith('qt')) return { ext: '.mov', mimeType: 'video/quicktime' };
    return { ext: '.mp4', mimeType: 'video/mp4' };
  }

  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'AVI ') {
    return { ext: '.avi', mimeType: 'video/x-msvideo' };
  }

  return null;
}

function extFromUrl(url: string): string {
  try {
    const ext = new URL(url).pathname.match(/(\.[a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (ext && ALLOWED_EXT.has(ext)) return ext;
  } catch {
    /* ignore */
  }
  return '.mp4';
}

function parseGoogleDriveConfirmUrl(html: string, fileId: string): string | null {
  const confirmMatch =
    html.match(/confirm=([0-9A-Za-z_-]+)/) ||
    html.match(/"confirm","([0-9A-Za-z_-]+)"/) ||
    html.match(/confirm%3D([0-9A-Za-z_-]+)/);
  const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/i);

  if (confirmMatch?.[1]) {
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${encodeURIComponent(confirmMatch[1])}`;
  }
  if (uuidMatch?.[1]) {
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t&uuid=${encodeURIComponent(uuidMatch[1])}`;
  }
  return null;
}

async function axiosGetBuffer(
  url: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; contentType: string; finalUrl: string }> {
  const response: AxiosResponse<ArrayBuffer> = await axios.get(url, {
    responseType: 'arraybuffer',
    maxRedirects: 10,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    timeout: 120000,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; UserGen-CampaignMedia/1.0)',
      Accept: '*/*',
    },
  });
  const buffer = Buffer.from(response.data);
  const contentType = String(response.headers['content-type'] || '');
  const finalUrl = String(response.request?.res?.responseUrl || url);
  return { buffer, contentType, finalUrl };
}

async function downloadGoogleDrive(fileId: string, maxBytes: number): Promise<Buffer> {
  const initialUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
  let { buffer, contentType } = await axiosGetBuffer(initialUrl, maxBytes);

  if (isHtmlPayload(buffer, contentType)) {
    const confirmUrl = parseGoogleDriveConfirmUrl(buffer.toString('utf8'), fileId);
    if (!confirmUrl) {
      throw new Error(
        'Google Drive returned a confirmation page instead of the video. Ensure the file is shared as "Anyone with the link" and try again.',
      );
    }
    ({ buffer, contentType } = await axiosGetBuffer(confirmUrl, maxBytes));
  }

  if (isHtmlPayload(buffer, contentType)) {
    throw new Error(
      'Could not download video from Google Drive. The link may be private, expired, or not a video file.',
    );
  }

  return buffer;
}

/**
 * Download video bytes from a public share URL (Drive, Dropbox, OneDrive, or direct file link).
 */
export async function downloadExternalVideo(
  sourceUrl: string,
  maxBytes: number = MAX_DOWNLOAD_BYTES,
): Promise<DownloadedExternalVideo> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http(s) URLs are allowed');
  }

  const provider = detectExternalMediaProvider(sourceUrl);
  let buffer: Buffer;
  let resolvedUrl: string;

  if (provider === 'google-drive') {
    const fileId = extractGoogleDriveFileId(sourceUrl);
    if (!fileId) {
      throw new Error('Could not parse Google Drive file id from URL');
    }
    buffer = await downloadGoogleDrive(fileId, maxBytes);
    resolvedUrl = `google-drive:${fileId}`;
  } else {
    let fetchUrl = normalizeExternalMediaUrl(sourceUrl).url;

    if (provider === 'onedrive' && sourceUrl.includes('1drv.ms')) {
      try {
        const head = await axios.head(sourceUrl, {
          maxRedirects: 10,
          timeout: 30000,
          validateStatus: (s) => s >= 200 && s < 400,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UserGen-CampaignMedia/1.0)' },
        });
        const resolved = String(head.request?.res?.responseUrl || sourceUrl);
        const parsed = new URL(resolved);
        parsed.searchParams.set('download', '1');
        fetchUrl = parsed.toString();
      } catch {
        /* use normalized URL */
      }
    }

    const result = await axiosGetBuffer(fetchUrl, maxBytes);
    buffer = result.buffer;
    resolvedUrl = fetchUrl;

    if (isHtmlPayload(buffer, result.contentType)) {
      const providerLabel =
        provider === 'dropbox'
          ? 'Dropbox'
          : provider === 'onedrive'
            ? 'OneDrive'
            : provider === 'box'
              ? 'Box'
              : 'This host';
      throw new Error(
        `${providerLabel} returned a web page instead of a video file. Use a direct download link or ensure the file is publicly accessible.`,
      );
    }
  }

  if (buffer.length > maxBytes) {
    throw new Error('Video is too large');
  }
  if (buffer.length < 1024) {
    throw new Error('Downloaded file is too small to be a valid video');
  }

  const sniffed = sniffVideoFormat(buffer);
  if (!sniffed) {
    const urlExt = extFromUrl(sourceUrl);
    if (!ALLOWED_EXT.has(urlExt)) {
      throw new Error(
        'Downloaded file does not appear to be a video. Use a direct link to mp4, mov, webm, or m4v, or a public Google Drive / Dropbox / OneDrive share link.',
      );
    }
    return {
      buffer,
      mimeType: 'video/mp4',
      ext: urlExt,
      provider,
      resolvedUrl,
    };
  }

  return {
    buffer,
    mimeType: sniffed.mimeType,
    ext: sniffed.ext,
    provider,
    resolvedUrl,
  };
}
