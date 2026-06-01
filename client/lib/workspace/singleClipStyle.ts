/** Video styles that produce one continuous HeyGen clip (no per-scene b-roll). */
export const SINGLE_CLIP_STYLES = ['AVATAR_ONLY', 'ANIMATED_AVATAR'] as const;

export type SingleClipStyle = (typeof SINGLE_CLIP_STYLES)[number];

export function isSingleClipVideoStyle(style: string | null | undefined): boolean {
  if (!style) return false;
  return SINGLE_CLIP_STYLES.includes(style as SingleClipStyle);
}
