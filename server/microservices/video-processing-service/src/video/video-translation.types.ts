export type VideoTranslationVariantStatus =
  | 'pending'
  | 'translating_scenes'
  | 'stitching'
  | 'post_processing'
  | 'completed'
  | 'failed';

export type SceneTranslationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface SceneTranslationEntry {
  sceneNumber: number;
  role: 'avatar' | 'broll';
  heygenTranslationId?: string;
  translatedClipUrl?: string;
  translatedClipLocalPath?: string;
  duration?: number;
  status: SceneTranslationStatus;
  error?: string;
}

export interface VideoTranslationVariant {
  id: string;
  language: string;
  languageCode?: string;
  status: VideoTranslationVariantStatus;
  progress: number;
  jobId?: string;
  sceneTranslations?: SceneTranslationEntry[];
  translatedVoiceovers?: Array<{ sceneNumber: number; voiceover: string; duration?: number }>;
  videoUrl?: string;
  localVideoUrl?: string;
  previewVideoUrl?: string;
  duration?: number;
  thumbnailUrl?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
  /** Set when wallet credits were deducted for this variant. */
  creditsCharged?: boolean;
  creditSnapshotId?: string;
}

export function parseVideoTranslations(raw: unknown): VideoTranslationVariant[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => v && typeof v === 'object') as VideoTranslationVariant[];
}

export function upsertVideoTranslationVariant(
  variants: VideoTranslationVariant[],
  updated: VideoTranslationVariant,
): VideoTranslationVariant[] {
  const idx = variants.findIndex((v) => v.id === updated.id);
  if (idx >= 0) {
    const next = [...variants];
    next[idx] = { ...next[idx], ...updated };
    return next;
  }
  return [...variants, updated];
}
