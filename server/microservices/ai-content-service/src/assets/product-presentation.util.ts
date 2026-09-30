import { resolveFormAwareShotMix } from './product-form.util';
import { inferProductForm } from './product-form-core.util';

export type PresentationProfile =
  | 'wearable_jewelry'
  | 'wearable_apparel'
  | 'wearable_accessory'
  | 'handheld_gadget'
  | 'vehicle'
  | 'home_furniture'
  | 'food_beverage'
  | 'beauty_cosmetic'
  | 'footwear'
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
  /**
   * Share of scenes that must show a person using the product.
   * 0 when human interaction is discouraged (vehicles).
   */
  humanShareTarget?: number;
}

const DEFAULT_SHOT_MIX: Record<PresentationProfile, ProductPresentationShotMix[]> = {
  wearable_jewelry: [
    { mode: 'hero_flat_lay', share: 0.25, framingHint: 'Product on neutral luxury surface, full item visible' },
    { mode: 'detail_macro', share: 0.2, framingHint: 'Craftsmanship close-up' },
    { mode: 'hands_interaction', share: 0.2, framingHint: 'Hands presenting product as in reference' },
    { mode: 'on_model', share: 0.2, framingHint: 'Model wearing or holding product naturally' },
    { mode: 'lifestyle_context', share: 0.15, framingHint: 'Elegant lifestyle setting' },
  ],
  wearable_apparel: [
    { mode: 'hero_flat_lay', share: 0.17 },
    { mode: 'on_model', share: 0.33, framingHint: 'Full or three-quarter body fashion shot' },
    { mode: 'on_model', share: 0.17, framingHint: 'Alternate angle or movement pose' },
    { mode: 'lifestyle_context', share: 0.17 },
    { mode: 'detail_macro', share: 0.16 },
  ],
  wearable_accessory: [
    { mode: 'hero_flat_lay', share: 0.2 },
    { mode: 'on_model', share: 0.3 },
    { mode: 'hands_interaction', share: 0.2 },
    { mode: 'lifestyle_context', share: 0.15 },
    { mode: 'detail_macro', share: 0.15 },
  ],
  handheld_gadget: [
    { mode: 'hero_flat_lay', share: 0.25 },
    { mode: 'hands_interaction', share: 0.25 },
    { mode: 'hands_interaction', share: 0.15 },
    { mode: 'lifestyle_context', share: 0.2 },
    { mode: 'detail_macro', share: 0.15 },
  ],
  vehicle: [
    { mode: 'environment_scale', share: 0.35 },
    { mode: 'environment_scale', share: 0.25 },
    { mode: 'detail_macro', share: 0.2 },
    { mode: 'hero_flat_lay', share: 0.2 },
  ],
  home_furniture: [
    { mode: 'environment_scale', share: 0.35 },
    { mode: 'hero_flat_lay', share: 0.2 },
    { mode: 'lifestyle_context', share: 0.25 },
    { mode: 'detail_macro', share: 0.2 },
  ],
  food_beverage: [
    { mode: 'hero_flat_lay', share: 0.3 },
    { mode: 'lifestyle_context', share: 0.3 },
    { mode: 'hands_interaction', share: 0.2 },
    { mode: 'detail_macro', share: 0.2 },
  ],
  beauty_cosmetic: [
    { mode: 'hero_flat_lay', share: 0.2 },
    { mode: 'hands_interaction', share: 0.25 },
    { mode: 'on_model', share: 0.25, framingHint: 'Beauty application or hold near face, product visible' },
    { mode: 'detail_macro', share: 0.15 },
    { mode: 'lifestyle_context', share: 0.15 },
  ],
  footwear: [
    { mode: 'hero_flat_lay', share: 0.17, framingHint: 'Full shoe on a clean surface, both shoes if a pair' },
    { mode: 'on_model', share: 0.33, framingHint: 'Person wearing the shoe, mid-stride or standing, product clearly visible' },
    { mode: 'hands_interaction', share: 0.17, framingHint: 'Hands tying laces or holding the shoe' },
    { mode: 'lifestyle_context', share: 0.17, framingHint: 'The shoe in the lifestyle setting the brief names' },
    { mode: 'detail_macro', share: 0.16, framingHint: 'Sole, stitching or material close-up' },
  ],
  generic: [
    { mode: 'hero_flat_lay', share: 0.2, framingHint: 'Full product on a clean surface' },
    { mode: 'on_model', share: 0.25, framingHint: 'Person using or wearing the product' },
    { mode: 'hands_interaction', share: 0.25, framingHint: 'Hands interacting with the product' },
    { mode: 'lifestyle_context', share: 0.15, framingHint: 'Product in its real-world setting' },
    { mode: 'detail_macro', share: 0.15, framingHint: 'Material or feature close-up' },
  ],
};

const VALID_PROFILES = new Set<string>(Object.keys(DEFAULT_SHOT_MIX));

export function isWatchProduct(productType?: string): boolean {
  return inferProductForm({ productType, profile: 'wearable_accessory' }) === 'watch';
}

function resolveDefaultShotMix(
  profile: PresentationProfile,
  productType?: string,
  jewelryForm?: string,
  visualScriptContext?: string,
): ProductPresentationShotMix[] {
  const formMix = resolveFormAwareShotMix(profile, productType, jewelryForm);
  if (formMix.length) return formMix;
  return DEFAULT_SHOT_MIX[profile];
}

export function inferProfileFromProductType(productType?: string): PresentationProfile {
  const t = (productType || '').toLowerCase();
  if (/necklace|ring|earring|bracelet|jewel|pendant|anklet|bangle/.test(t)) return 'wearable_jewelry';
  if (/shirt|dress|pant|jean|jacket|coat|saree|kurta|hoodie|apparel|clothing|wear|outfit|garment/.test(t)) {
    return 'wearable_apparel';
  }
  if (/bag|wallet|belt|watch|sunglass|scarf|hat|cap|accessory/.test(t)) return 'wearable_accessory';
  if (/car|vehicle|automobile|bike|motorcycle|scooter|truck|suv/.test(t)) return 'vehicle';
  if (/phone|laptop|tablet|gadget|device|earbud|headphone|camera|electronics/.test(t)) return 'handheld_gadget';
  if (/sofa|chair|table|furniture|bed|mattress|desk/.test(t)) return 'home_furniture';
  if (/food|snack|beverage|drink|coffee|tea|meal|noodle|packaged/.test(t)) return 'food_beverage';
  if (/cosmetic|makeup|skincare|beauty|lipstick|perfume|cream|serum/.test(t)) return 'beauty_cosmetic';
  if (/shoe|sneaker|footwear|boot|sandal|loafer|heel|trainer/.test(t)) return 'footwear';
  return 'generic';
}

function humanInteractionForProfile(profile: PresentationProfile): HumanInteraction {
  switch (profile) {
    case 'wearable_jewelry':
    case 'wearable_apparel':
      return 'required';
    case 'wearable_accessory':
    case 'beauty_cosmetic':
    case 'handheld_gadget':
    case 'footwear':
      return 'recommended';
    case 'vehicle':
      return 'discouraged';
    default:
      return 'optional';
  }
}

function defaultPresenterDescription(profile: PresentationProfile): string | undefined {
  if (humanInteractionForProfile(profile) === 'discouraged') return undefined;
  const base =
    'Professional Indian commercial fashion model, adult 25-35, neutral studio gray backdrop, front-facing, soft even lighting, waist-up portrait reference, natural confident expression, no product in frame, no microphone, silent ad still';
  if (profile === 'wearable_jewelry') {
    return `${base}, elegant styling suitable for jewelry advertisement`;
  }
  if (profile === 'wearable_apparel' || profile === 'footwear') {
    return `${base}, contemporary casual fashion styling`;
  }
  return base;
}

export function buildProductPresentationPlan(input: {
  presentationProfile?: string;
  humanInteraction?: string;
  recommendedShotMix?: Array<{ mode?: string; share?: number; framingHint?: string }>;
  presenterDescription?: string;
  productType?: string;
  jewelryForm?: string;
  visualScriptContext?: string;
  rationale?: string;
}): ProductPresentationPlan {
  let profile = input.presentationProfile as PresentationProfile;
  if (!profile || !VALID_PROFILES.has(profile)) {
    profile = inferProfileFromProductType(input.productType);
  }

  const humanInteraction =
    (input.humanInteraction as HumanInteraction) || humanInteractionForProfile(profile);

  const productForm = inferProductForm({
    productType: input.productType,
    jewelryForm: input.jewelryForm,
    visualScriptContext: input.visualScriptContext,
    profile,
  });

  let shotMix: ProductPresentationShotMix[] = resolveDefaultShotMix(
    profile,
    input.productType,
    input.jewelryForm || productForm,
    input.visualScriptContext,
  );

  if (input.recommendedShotMix?.length) {
    const parsed = input.recommendedShotMix.map((s) => ({
      mode: (s.mode || 'hero_flat_lay') as PresentationMode,
      share: typeof s.share === 'number' ? s.share : 0.2,
      framingHint: s.framingHint,
    }));
    if (parsed.length) shotMix = parsed;
  }

  if (humanInteraction === 'discouraged') {
    shotMix = shotMix.filter((s) => s.mode !== 'on_model' && s.mode !== 'hands_interaction');
  }

  const humanShareTarget = humanInteraction === 'discouraged' ? 0 : 0.5;

  const needsPresenter = shotMix.some((s) => s.mode === 'on_model');
  const presenterDescription =
    input.presenterDescription?.trim() ||
    (needsPresenter && humanInteraction !== 'discouraged'
      ? defaultPresenterDescription(profile)
      : undefined);

  return {
    profile,
    humanInteraction,
    shotMix,
    presenterDescription,
    rationale: input.rationale || `Inferred from product type: ${input.productType || profile}`,
    productType: input.productType?.trim() || undefined,
    productForm,
    jewelryForm: input.jewelryForm || productForm,
    humanShareTarget,
  };
}

export function extractPresentationFieldsFromAnalysis(analysis: any): Partial<ProductPresentationPlan> & {
  presentationProfile?: string;
  humanInteraction?: string;
  recommendedShotMix?: ProductPresentationShotMix[];
} {
  if (!analysis || typeof analysis !== 'object') return {};
  return {
    presentationProfile: analysis.presentationProfile || analysis.productPresentation?.profile,
    humanInteraction: analysis.humanInteraction || analysis.productPresentation?.humanInteraction,
    recommendedShotMix: analysis.recommendedShotMix || analysis.productPresentation?.shotMix,
    presenterDescription: analysis.presenterDescription || analysis.productPresentation?.presenterDescription,
    rationale: analysis.presentationRationale,
    productType: analysis.productInfo?.type || analysis.productType,
    jewelryForm: analysis.jewelryForm || analysis.productForm,
    visualScriptContext: analysis.visualScriptContext,
  } as any;
}
