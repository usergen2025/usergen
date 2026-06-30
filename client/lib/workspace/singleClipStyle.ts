/** Video styles that produce one continuous HeyGen clip (no per-scene b-roll). */
export const SINGLE_CLIP_STYLES = ['AVATAR_ONLY', 'ANIMATED_AVATAR'] as const;

export type SingleClipStyle = (typeof SINGLE_CLIP_STYLES)[number];

export interface SingleClipProjectFields {
  style?: string | null;
  status?: string | null;
  videoUrl?: string | null;
  renderingStatus?: string | null;
  metadata?: Record<string, unknown> | null;
}

function projectMeta(project: SingleClipProjectFields): Record<string, unknown> {
  const m = project.metadata;
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

export function isSingleClipVideoStyle(style: string | null | undefined): boolean {
  if (!style) return false;
  return SINGLE_CLIP_STYLES.includes(style as SingleClipStyle);
}

/** Raw HeyGen clip is ready; user should edit music/captions before export. */
export function isRawAvatarClipEditingPhase(project: SingleClipProjectFields): boolean {
  if (!isSingleClipVideoStyle(project.style)) return false;
  const meta = projectMeta(project);
  return Boolean(meta.rawAvatarClipReady && project.videoUrl && !meta.finalExportedAt);
}

export function isSingleClipFinalExported(project: SingleClipProjectFields): boolean {
  if (!isSingleClipVideoStyle(project.style)) return false;
  return Boolean(projectMeta(project).finalExportedAt);
}

/** True when a final export finished and translation API should accept the project. */
export function isVideoTranslationEligible(project: SingleClipProjectFields): boolean {
  if (!project.videoUrl) return false;
  if (isSingleClipVideoStyle(project.style)) {
    return project.status === 'COMPLETED' && isSingleClipFinalExported(project);
  }
  return project.status === 'COMPLETED';
}

/** IN_PROGRESS render in flight — not the raw-clip "completed" staging state. */
export function isProjectActivelyRendering(project: SingleClipProjectFields): boolean {
  if (project.status !== 'IN_PROGRESS' || !project.renderingStatus) return false;
  if (isRawAvatarClipEditingPhase(project)) return false;
  const rs = String(project.renderingStatus);
  return rs !== 'completed' && rs !== 'failed';
}
