/**
 * Normalize metadata.assets from legacy JSON string or array into a consistent array.
 */

export interface ParsedMetadataAsset {
  id: string;
  url: string;
  type: 'image' | 'url';
  category?: string;
  userLabel?: string;
  label?: string;
}

function inferCategory(asset: {
  id?: string;
  category?: string;
  userLabel?: string;
  label?: string;
}): string | undefined {
  const cat = asset.category || asset.userLabel || asset.label;
  if (cat) return String(cat).toLowerCase();
  if (typeof asset.id === 'string' && asset.id.startsWith('logo-')) return 'logo';
  if (typeof asset.id === 'string' && asset.id.startsWith('product-')) return 'product';
  return undefined;
}

function normalizeOne(raw: Record<string, unknown>): ParsedMetadataAsset | null {
  const url =
    (typeof raw.url === 'string' && raw.url) ||
    (typeof raw.publicUrl === 'string' && raw.publicUrl) ||
    (typeof raw.imageUrl === 'string' && raw.imageUrl) ||
    (typeof raw.preview === 'string' && raw.preview.startsWith('http') ? raw.preview : '');
  if (!url) return null;

  const id =
    (typeof raw.id === 'string' && raw.id) ||
    `asset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const type = raw.type === 'url' ? 'url' : 'image';
  const category = inferCategory(raw as { id?: string; category?: string; userLabel?: string; label?: string });

  return {
    id,
    url,
    type,
    category,
    userLabel: typeof raw.userLabel === 'string' ? raw.userLabel : category,
    label: typeof raw.label === 'string' ? raw.label : undefined,
  };
}

/**
 * Parse metadata.assets (string | array | undefined) into a normalized array. Never throws.
 */
export function parseMetadataAssets(assets: unknown): ParsedMetadataAsset[] {
  if (!assets) return [];

  let parsed: unknown = assets;
  if (typeof assets === 'string') {
    try {
      parsed = JSON.parse(assets);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const result: ParsedMetadataAsset[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const normalized = normalizeOne(item as Record<string, unknown>);
    if (normalized) result.push(normalized);
  }
  return result;
}

export function metadataHasLogoAsset(assets: unknown): boolean {
  return parseMetadataAssets(assets).some(
    (a) =>
      a.category === 'logo' ||
      a.userLabel === 'logo' ||
      a.id.startsWith('logo-'),
  );
}

export function metadataHasLogoInAnalyzed(analyzedAssets: unknown): boolean {
  if (!Array.isArray(analyzedAssets)) return false;
  return analyzedAssets.some(
    (a: { category?: string }) => a?.category === 'logo',
  );
}
