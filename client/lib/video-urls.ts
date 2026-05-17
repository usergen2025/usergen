/** Matches server PREVIEW_FORMAT_VERSION — tiled last-portion WM + UserGen outro */
export const PREVIEW_FORMAT_VERSION = 3;

export interface VideoProjectUrlFields {
  videoPublicUrl?: string;
  videoGcsUrl?: string;
  videoUrl?: string;
  metadata?: {
    previewVideoUrl?: string;
    previewFormatVersion?: number;
    previewSourceHash?: string;
    previewGenerationError?: string;
    [key: string]: unknown;
  } | null;
}

/**
 * Clean final master URL (download / export only — never use for in-app playback).
 */
export function getFinalVideoUrl(
  project: VideoProjectUrlFields,
  videoServiceBase?: string,
): string | null {
  if (project.videoPublicUrl?.startsWith('http')) {
    return project.videoPublicUrl;
  }
  if (project.videoGcsUrl?.startsWith('http')) {
    return project.videoGcsUrl;
  }
  if (project.videoUrl?.startsWith('http')) {
    return project.videoUrl;
  }
  if (project.videoUrl && videoServiceBase) {
    const path = project.videoUrl.startsWith('/') ? project.videoUrl : `/${project.videoUrl}`;
    return `${videoServiceBase.replace(/\/$/, '')}${path}`;
  }
  return project.videoUrl || null;
}

/**
 * Watermarked preview URL if present in metadata (any version).
 */
export function getPreviewPlaybackUrl(
  project: VideoProjectUrlFields,
  videoServiceBase?: string,
): string | null {
  const preview = project.metadata?.previewVideoUrl;
  if (typeof preview !== 'string' || !preview.length) {
    return null;
  }
  if (preview.startsWith('http')) {
    return preview;
  }
  if (videoServiceBase) {
    const path = preview.startsWith('/') ? preview : `/${preview}`;
    return `${videoServiceBase.replace(/\/$/, '')}${path}`;
  }
  return preview;
}

/** v3 preview ready for workspace player (tiled WM + outro). */
export function isPreviewReady(project: VideoProjectUrlFields): boolean {
  const url = project.metadata?.previewVideoUrl;
  const version = Number(project.metadata?.previewFormatVersion ?? 0);
  return Boolean(url) && version >= PREVIEW_FORMAT_VERSION;
}

export function hasPreviewPlaybackUrl(project: VideoProjectUrlFields): boolean {
  return Boolean(getPreviewPlaybackUrl(project));
}

export function hasFinalVideo(project: VideoProjectUrlFields): boolean {
  return Boolean(
    project.videoPublicUrl || project.videoGcsUrl || project.videoUrl,
  );
}

export function hasPreviewGenerationError(project: VideoProjectUrlFields): boolean {
  return Boolean(project.metadata?.previewGenerationError);
}

export function isFinalReady(
  project: VideoProjectUrlFields,
  videoServiceBase?: string,
): boolean {
  return Boolean(getFinalVideoUrl(project, videoServiceBase));
}
