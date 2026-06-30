/**
 * Shared camera motion vocabulary for PRODUCT_ONLY scripts and video generation.
 */

export type PresentationMode =
  | 'hero_flat_lay'
  | 'on_model'
  | 'display_mannequin'
  | 'hands_interaction'
  | 'lifestyle_context'
  | 'detail_macro'
  | 'environment_scale';

export type CameraMotion =
  | 'slow_push_in'
  | 'fast_push_slow_end'
  | 'lateral_slide'
  | 'orbit_light'
  | 'handheld_micro'
  | 'static_hold'
  | 'slow_pan'
  | 'ambient_drift'
  | 'rack_focus';

export const VALID_CAMERA_MOTIONS: readonly CameraMotion[] = [
  'slow_push_in',
  'fast_push_slow_end',
  'lateral_slide',
  'orbit_light',
  'handheld_micro',
  'static_hold',
  'slow_pan',
  'ambient_drift',
  'rack_focus',
];

const MOTION_SET = new Set<string>(VALID_CAMERA_MOTIONS);

/** Motions allowed per presentation mode (TVC-style variety). */
export const MODE_CAMERA_MOTIONS: Record<PresentationMode, CameraMotion[]> = {
  hero_flat_lay: ['slow_push_in', 'fast_push_slow_end', 'lateral_slide', 'static_hold', 'rack_focus'],
  on_model: ['handheld_micro', 'slow_push_in', 'ambient_drift', 'orbit_light', 'slow_pan'],
  display_mannequin: ['slow_pan', 'slow_push_in', 'lateral_slide', 'static_hold', 'ambient_drift'],
  hands_interaction: ['handheld_micro', 'slow_push_in', 'rack_focus', 'lateral_slide', 'ambient_drift'],
  lifestyle_context: ['slow_pan', 'ambient_drift', 'handheld_micro', 'lateral_slide', 'slow_push_in'],
  detail_macro: ['rack_focus', 'slow_push_in', 'static_hold', 'fast_push_slow_end'],
  environment_scale: ['slow_pan', 'lateral_slide', 'ambient_drift', 'slow_push_in', 'orbit_light'],
};

const MOTION_PROMPT_SUFFIX: Record<CameraMotion, string> = {
  slow_push_in:
    '[MOTION: slow cinematic push-in toward the product; subtle in-frame only; do NOT zoom out or reveal new packaging areas]',
  fast_push_slow_end:
    '[MOTION: quick initial move toward product then ease to a gentle hold; in-frame only; do NOT pull back to reveal new product areas]',
  lateral_slide:
    '[MOTION: smooth lateral slide past the product with shallow depth; in-frame parallax only; product stays identical to reference]',
  orbit_light:
    '[MOTION: very slight orbit or arc around the product (max 15 degrees); in-frame only; no geometry change]',
  handheld_micro:
    '[MOTION: subtle handheld micro-movement with natural commercial ad feel; in-frame only; no dramatic shake]',
  static_hold:
    '[MOTION: mostly static frame with minimal ambient light shift or micro parallax; in-frame only]',
  slow_pan:
    '[MOTION: slow horizontal pan across the scene while product remains fully visible; in-frame only]',
  ambient_drift:
    '[MOTION: gentle ambient drift — soft light shift or environmental micro-motion; product unchanged]',
  rack_focus:
    '[MOTION: subtle rack focus on product detail already visible in frame; no zoom-out revealing new areas]',
};

export function normalizeCameraMotion(
  raw: unknown,
  mode: PresentationMode = 'hero_flat_lay',
): CameraMotion {
  const s = String(raw || '').trim().toLowerCase().replace(/-/g, '_');
  if (MOTION_SET.has(s)) return s as CameraMotion;
  return inferDefaultCameraMotion(mode, 0);
}

export function inferDefaultCameraMotion(
  mode: PresentationMode,
  sceneIndex: number,
): CameraMotion {
  const pool = MODE_CAMERA_MOTIONS[mode] || MODE_CAMERA_MOTIONS.hero_flat_lay;
  return pool[sceneIndex % pool.length];
}

export function buildCameraMotionSuffix(motion: CameraMotion): string {
  return ` ${MOTION_PROMPT_SUFFIX[motion]}`;
}

export function buildProductOnlyVideoMotionSuffix(
  mode: PresentationMode,
  cameraMotion?: CameraMotion,
  sceneIndex = 0,
): string {
  const motion = cameraMotion || inferDefaultCameraMotion(mode, sceneIndex);
  return buildCameraMotionSuffix(motion);
}

export const CAMERA_MOTION_SCRIPT_GUIDE = `
CAMERA MOTION (assign exactly one per scene via "camera_motion"):
- slow_push_in: classic slow push toward product
- fast_push_slow_end: fast approach that eases near the product (swing-by / snap-in feel)
- lateral_slide: side slide with shallow depth
- orbit_light: slight arc (max ~15°) around product
- handheld_micro: natural micro handheld commercial feel
- static_hold: near-static with ambient light shift
- slow_pan: horizontal pan while product stays in frame
- ambient_drift: gentle environmental motion
- rack_focus: focus pull on detail already in frame

RULES:
- Vary camera_motion across scenes — no two consecutive scenes with the same motion unless only 2 scenes total.
- Match motion to presentation_mode (e.g. hands_interaction → handheld_micro or rack_focus; environment_scale → slow_pan or lateral_slide).
- broll_video_prompt MUST describe the same motion as camera_motion in natural language.
- NEVER zoom out, pull back, or pan to reveal packaging/product areas not visible in the still image.
`;
