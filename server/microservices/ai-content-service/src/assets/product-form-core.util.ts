import { PresentationProfile } from './product-presentation.util';

/** Canonical physical form of the product — locked across all scenes. */
export type ProductForm =
  | 'bracelet'
  | 'necklace'
  | 'ring'
  | 'earring'
  | 'anklet'
  | 'brooch'
  | 'maang_tikka'
  | 'watch'
  | 'apparel'
  | 'bag'
  | 'footwear'
  | 'handheld_gadget'
  | 'generic_wearable'
  | 'unknown';

export interface ProductFormContext {
  productType?: string;
  jewelryForm?: string;
  visualScriptContext?: string;
  profile?: PresentationProfile;
}

const FORM_LABEL: Record<ProductForm, string> = {
  bracelet: 'bracelet (wrist jewelry)',
  necklace: 'necklace (neck jewelry)',
  ring: 'ring (finger jewelry)',
  earring: 'earring',
  anklet: 'anklet (ankle jewelry)',
  brooch: 'brooch',
  maang_tikka: 'maang tikka (forehead jewelry)',
  watch: 'watch (wrist timepiece)',
  apparel: 'apparel/garment',
  bag: 'bag',
  footwear: 'footwear',
  handheld_gadget: 'handheld device',
  generic_wearable: 'wearable product',
  unknown: 'product',
};

const DEDICATED_HOLDER_FORMS = new Set<ProductForm>([
  'bracelet',
  'necklace',
  'ring',
  'earring',
  'anklet',
  'brooch',
  'maang_tikka',
  'watch',
  'apparel',
]);

export function normalizeProductForm(raw: unknown): ProductForm | undefined {
  const s = String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
  const map: Record<string, ProductForm> = {
    bracelet: 'bracelet',
    bangle: 'bracelet',
    kada: 'bracelet',
    cuff_bracelet: 'bracelet',
    necklace: 'necklace',
    pendant: 'necklace',
    choker: 'necklace',
    mangalsutra: 'necklace',
    haar: 'necklace',
    ring: 'ring',
    band: 'ring',
    wedding_band: 'ring',
    earring: 'earring',
    earrings: 'earring',
    stud: 'earring',
    jhumka: 'earring',
    anklet: 'anklet',
    payal: 'anklet',
    brooch: 'brooch',
    maang_tikka: 'maang_tikka',
    tikka: 'maang_tikka',
    watch: 'watch',
    wristwatch: 'watch',
    smartwatch: 'watch',
    timepiece: 'watch',
    apparel: 'apparel',
    garment: 'apparel',
    clothing: 'apparel',
    bag: 'bag',
    handbag: 'bag',
    footwear: 'footwear',
    shoe: 'footwear',
    phone: 'handheld_gadget',
    gadget: 'handheld_gadget',
  };
  return map[s];
}

export function inferProductForm(ctx: ProductFormContext): ProductForm {
  const fromAnalysis = normalizeProductForm(ctx.jewelryForm);
  if (fromAnalysis) return fromAnalysis;

  const t = (ctx.productType || '').toLowerCase();
  const visual = (ctx.visualScriptContext || '').toLowerCase();
  const combined = `${t} ${visual}`;

  if (/\bwatch\b|wristwatch|smartwatch|timepiece|chronograph/.test(combined)) return 'watch';

  if (
    /\bbracelet\b|\bbangle\b|\bkada\b|cuff bracelet|wrist jewelry|wrist chain|on wrist|wrist-worn|lobster claw clasp|bracelet length|short chain.*motif/.test(
      combined,
    )
  ) {
    return 'bracelet';
  }

  if (/maang tikka|forehead jewelry|\btikka\b/.test(combined)) return 'maang_tikka';
  if (/\bearring\b|\bstud\b|jhumka|drop earring/.test(combined)) return 'earring';
  if (/\bring\b|wedding band|engagement ring/.test(combined) && !/earring/.test(combined)) {
    return 'ring';
  }
  if (/\bnecklace\b|\bpendant\b|mangalsutra|\bchoker\b|\bhaar\b|neck jewelry|on neck|draped on neck/.test(combined)) {
    return 'necklace';
  }
  if (/\banklet\b|\bpayal\b|ankle jewelry/.test(combined)) return 'anklet';
  if (/brooch|lapel pin/.test(combined)) return 'brooch';

  if (ctx.profile === 'wearable_apparel' || /shirt|dress|pant|jacket|saree|kurta|garment/.test(combined)) {
    return 'apparel';
  }
  if (/handbag|tote|clutch|\bbag\b/.test(combined)) return 'bag';
  if (/phone|laptop|tablet|gadget|device|earbud|headphone/.test(combined)) return 'handheld_gadget';

  if (ctx.profile === 'wearable_jewelry' || /jewel/.test(combined)) return 'generic_wearable';

  return 'unknown';
}

export function hasDedicatedDisplayHolder(form: ProductForm): boolean {
  return DEDICATED_HOLDER_FORMS.has(form);
}

export function getProductFormLabel(form: ProductForm): string {
  return FORM_LABEL[form] || FORM_LABEL.unknown;
}

export function inferRetailDisplayHolderHint(ctx: ProductFormContext): string {
  const form = inferProductForm(ctx);

  switch (form) {
    case 'bracelet':
      return 'bracelet on curved bracelet bar or cuff display stand on velvet jewelry tray, wrist-length chain kept in bracelet shape, showroom counter';
    case 'necklace':
      return 'necklace draped on black velvet necklace bust, neck form display, bridal jewelry store showroom';
    case 'ring':
      return 'ring on ring cone holder or velvet ring display pad, jewelry counter';
    case 'earring':
      return 'earrings on T-stand or velvet earring display post, jewelry store counter';
    case 'anklet':
      return 'anklet on ankle display form or curved jewelry tray, retail showcase';
    case 'brooch':
      return 'brooch on velvet jewelry pad or small collar display bust';
    case 'maang_tikka':
      return 'maang tikka on jewelry bust crown display, bridal showroom';
    case 'watch':
      return 'watch on leather display cushion or T-bar watch stand, luxury showroom counter';
    case 'apparel':
      return 'garment on dress-form torso mannequin or ghost mannequin, boutique retail display, no living person';
    case 'bag':
      return 'bag on acrylic pedestal or boutique shelf display, upright product presentation';
    case 'footwear':
      return 'footwear on retail shoe display stand or angled acrylic riser';
    case 'handheld_gadget':
      return 'device on clean acrylic product riser or minimal tech retail stand';
    case 'generic_wearable':
    case 'unknown':
    default:
      return 'same exact product as reference on neutral luxury display surface or acrylic riser matching the product category — use best judgment from reference; do NOT use a display prop meant for a different product type (no neck bust for wrist items, no wrist stand for neck items)';
  }
}

export function buildProductFormLockSuffix(ctx: ProductFormContext): string {
  const form = inferProductForm(ctx);
  const label = getProductFormLabel(form);
  const parts = [
    `[PRODUCT FORM LOCK: This is a ${label}. Keep the exact same product category and physical form as the reference image in every scene.]`,
  ];

  switch (form) {
    case 'bracelet':
      parts.push(
        'NEVER render as a necklace, choker, or neck piece. Show on wrist, bracelet stand, or flat-lay only.',
      );
      break;
    case 'necklace':
      parts.push('NEVER render as a bracelet or wrist piece unless reference shows otherwise.');
      break;
    case 'ring':
      parts.push('NEVER render as a bracelet or necklace.');
      break;
    case 'earring':
      parts.push('NEVER render as a necklace or bracelet.');
      break;
    case 'watch':
      parts.push('NEVER render as a bracelet or necklace; show on wrist or watch stand only.');
      break;
    default:
      parts.push(
        'Do NOT change the product category. Do not substitute a different jewelry type or product form.',
      );
  }

  if (ctx.productType?.trim()) {
    parts.push(`Analyzed product type: ${ctx.productType.trim()}.`);
  }

  return parts.join(' ');
}

export function inferOnModelWearHint(form: ProductForm): string | undefined {
  switch (form) {
    case 'bracelet':
    case 'watch':
      return 'worn on wrist, wrist clearly visible';
    case 'necklace':
      return 'worn around neck, neckline visible';
    case 'ring':
      return 'worn on finger, hand visible';
    case 'earring':
      return 'worn on ear or held near ear, product visible';
    case 'anklet':
      return 'worn on ankle or lower leg visible';
    case 'apparel':
      return 'model wearing the exact garment';
    default:
      return undefined;
  }
}

export function inferHandsInteractionHint(ctx: ProductFormContext): string | undefined {
  const form = inferProductForm(ctx);
  switch (form) {
    case 'bracelet':
      return 'hands fastening or adjusting bracelet on wrist, crop to hands and wrist, product identical to reference';
    case 'watch':
      return 'hand presenting watch or wrist wearing watch, natural showroom ad pose, no face required';
    case 'necklace':
      return 'hands adjusting necklace clasp near neck or presenting pendant, product identical to reference';
    case 'ring':
      return 'fingers wearing or presenting ring, crop to hand and product';
    case 'earring':
      return 'hand holding or presenting earring near ear, product identical to reference';
    default:
      if (ctx.profile === 'wearable_jewelry') {
        return 'hands presenting jewelry piece, crop to hands and product, no face required';
      }
      return undefined;
  }
}

export function sanitizePromptForProductForm(text: string, ctx: ProductFormContext): string {
  const form = inferProductForm(ctx);
  let result = text || '';

  const replacements: Array<{ pattern: RegExp; replacement: string }> = [];

  if (form === 'bracelet') {
    replacements.push(
      { pattern: /\bnecklace\b/gi, replacement: 'bracelet' },
      { pattern: /\bneck bust\b/gi, replacement: 'bracelet display stand' },
      { pattern: /\bnecklace bust\b/gi, replacement: 'bracelet bar' },
      { pattern: /\bon neck\b/gi, replacement: 'on wrist' },
      { pattern: /\baround neck\b/gi, replacement: 'on wrist' },
      { pattern: /\bchoker\b/gi, replacement: 'bracelet' },
    );
  } else if (form === 'necklace') {
    replacements.push(
      { pattern: /\bbracelet\b/gi, replacement: 'necklace' },
      { pattern: /\bon wrist\b/gi, replacement: 'around neck' },
      { pattern: /\bbracelet bar\b/gi, replacement: 'necklace bust' },
    );
  } else if (form === 'watch') {
    replacements.push(
      { pattern: /\bnecklace\b/gi, replacement: 'watch' },
      { pattern: /\bbracelet\b/gi, replacement: 'watch' },
    );
  }

  for (const { pattern, replacement } of replacements) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

export function conflictingFormKeywordsInPrompt(text: string, form: ProductForm): string[] {
  const t = (text || '').toLowerCase();
  const conflicts: string[] = [];
  if (form === 'bracelet') {
    if (/\bnecklace\b|\bneck bust\b|\baround neck\b|\bon neck\b|\bchoker\b/.test(t)) {
      conflicts.push('necklace/neck terms in bracelet scene');
    }
  }
  if (form === 'necklace') {
    if (/\bon wrist\b|\bbracelet bar\b/.test(t) && !/wristwatch|\bwatch\b/.test(t)) {
      conflicts.push('wrist/bracelet terms in necklace scene');
    }
  }
  return conflicts;
}
