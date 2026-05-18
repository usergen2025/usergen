/** Extract Instagram shortcode from reel or post URLs. */
export function extractInstagramShortCode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

export function normalizeInstagramUrl(url: string): string {
  return url.trim().split('?')[0].replace(/\/$/, '');
}
