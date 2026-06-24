import {
  HumanInteraction,
  PresentationMode,
  PresentationProfile,
  ProductPresentationPlan,
  ProductPresentationShotMix,
} from './product-presentation.types';

const DEFAULT_SHOT_MIX: Record<PresentationProfile, ProductPresentationShotMix[]> = {
  wearable_jewelry: [
    { mode: 'hero_flat_lay', share: 0.17, framingHint: 'Full necklace/bracelet on neutral surface' },
    {
      mode: 'display_mannequin',
      share: 0.17,
      framingHint: 'Black velvet necklace/jewelry bust, store showroom display — NO living person',
    },
    {
      mode: 'display_mannequin',
      share: 0.1,
      framingHint: 'Earring T-stand or ring cone holder for secondary piece — retail display prop only',
    },
    { mode: 'on_model', share: 0.28, framingHint: 'Medium close-up waist-up, product clearly visible' },
    { mode: 'hands_interaction', share: 0.1, framingHint: 'Hand presenting earring or adjusting necklace near bust' },
    { mode: 'detail_macro', share: 0.1, framingHint: 'Craftsmanship close-up' },
    { mode: 'lifestyle_context', share: 0.08, framingHint: 'Elegant lifestyle setting' },
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
  generic: [
    { mode: 'hero_flat_lay', share: 0.33 },
    { mode: 'lifestyle_context', share: 0.34 },
    { mode: 'detail_macro', share: 0.33 },
  ],
};

const WATCH_ACCESSORY_SHOT_MIX: ProductPresentationShotMix[] = [
  { mode: 'hero_flat_lay', share: 0.17, framingHint: 'Watch on clean surface, dial and strap fully visible' },
  {
    mode: 'display_mannequin',
    share: 0.22,
    framingHint: 'Watch on leather pillow or T-bar stand, luxury showroom counter display',
  },
  {
    mode: 'hands_interaction',
    share: 0.22,
    framingHint: 'Hand presenting watch or wrist shot, product identical to reference',
  },
  { mode: 'detail_macro', share: 0.17, framingHint: 'Dial, clasp, or craftsmanship close-up' },
  { mode: 'lifestyle_context', share: 0.12, framingHint: 'Watch in elegant lifestyle setting' },
  { mode: 'on_model', share: 0.1, framingHint: 'Wrist on model, watch clearly visible, silent ad still' },
];

const VALID_PROFILES = new Set<string>(Object.keys(DEFAULT_SHOT_MIX));

export function isWatchProduct(productType?: string): boolean {
  const t = (productType || '').toLowerCase();
  return /\bwatch\b|wristwatch|smartwatch|timepiece|chronograph/.test(t);
}

function resolveDefaultShotMix(
  profile: PresentationProfile,
  productType?: string,
): ProductPresentationShotMix[] {
  if (profile === 'wearable_accessory' && isWatchProduct(productType)) {
    return WATCH_ACCESSORY_SHOT_MIX;
  }
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
  if (profile === 'wearable_apparel') {
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
  rationale?: string;
}): ProductPresentationPlan {
  let profile = input.presentationProfile as PresentationProfile;
  if (!profile || !VALID_PROFILES.has(profile)) {
    profile = inferProfileFromProductType(input.productType);
  }

  const humanInteraction =
    (input.humanInteraction as HumanInteraction) || humanInteractionForProfile(profile);

  let shotMix: ProductPresentationShotMix[] = resolveDefaultShotMix(profile, input.productType);
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
  };
}
