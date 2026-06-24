export type PresentationProfile =
  | 'wearable_jewelry'
  | 'wearable_apparel'
  | 'wearable_accessory'
  | 'handheld_gadget'
  | 'vehicle'
  | 'home_furniture'
  | 'food_beverage'
  | 'beauty_cosmetic'
  | 'generic';

export type HumanInteraction = 'required' | 'recommended' | 'optional' | 'discouraged';

export type PresentationMode =
  | 'hero_flat_lay'
  | 'on_model'
  | 'display_mannequin'
  | 'hands_interaction'
  | 'lifestyle_context'
  | 'detail_macro'
  | 'environment_scale';

export interface ProductPresentationShotMix {
  mode: PresentationMode;
  share: number;
  framingHint?: string;
}

export interface ProductPresentationPlan {
  profile: PresentationProfile;
  humanInteraction: HumanInteraction;
  shotMix: ProductPresentationShotMix[];
  presenterDescription?: string;
  rationale?: string;
  productType?: string;
  productForm?: string;
  jewelryForm?: string;
}

export interface EphemeralPresenterMeta {
  publicUrl: string;
  localUrl?: string;
  localPath?: string;
  generatedAt: string;
  prompt: string;
}

export interface ProductScenePresentation {
  presentation_mode?: PresentationMode;
  requires_human?: boolean;
  camera_shot?: string;
}

const VALID_MODES: PresentationMode[] = [
  'hero_flat_lay',
  'on_model',
  'display_mannequin',
  'hands_interaction',
  'lifestyle_context',
  'detail_macro',
  'environment_scale',
];

export function normalizePresentationMode(raw: unknown): PresentationMode {
  const s = String(raw || '').trim() as PresentationMode;
  if (VALID_MODES.includes(s)) return s;
  return 'hero_flat_lay';
}

export function getScenePresentationFromScript(
  script: unknown,
  sceneNumber: number,
): ProductScenePresentation {
  if (!script || typeof script !== 'object') return {};
  const parsed = script as { scenes?: unknown[]; scene_plan?: unknown[] };
  const scenes = parsed.scenes || parsed.scene_plan || [];
  const scene = (scenes as any[]).find(
    (s) => (s.scene_number || s.sceneNumber) === sceneNumber,
  );
  if (!scene) return {};
  return {
    presentation_mode: normalizePresentationMode(scene.presentation_mode),
    requires_human: Boolean(scene.requires_human),
    camera_shot: typeof scene.camera_shot === 'string' ? scene.camera_shot : undefined,
  };
}

export function scriptHasOnModelScenes(script: unknown): boolean {
  if (!script || typeof script !== 'object') return false;
  const parsed = script as { scenes?: unknown[]; scene_plan?: unknown[] };
  const scenes = parsed.scenes || parsed.scene_plan || [];
  return (scenes as any[]).some(
    (s) => normalizePresentationMode(s.presentation_mode) === 'on_model',
  );
}
