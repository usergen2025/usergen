import {
  buildProductOnlyVideoMotionSuffix as buildSharedProductOnlyVideoMotionSuffix,
  CameraMotion,
  PresentationMode as SharedPresentationMode,
} from '@shared/product/product-camera-motion';
import {
  PresentationMode,
  ProductPresentationPlan,
} from './product-presentation.types';
import {
  ProductFormContext,
  buildProductFormLockSuffix,
  inferHandsInteractionHint,
  inferProductForm,
  inferRetailDisplayHolderHint,
  sanitizePromptForProductForm,
} from './product-form.util';

export function buildProductFormContextFromPlan(
  plan?: ProductPresentationPlan,
  productType?: string,
  visualScriptContext?: string,
): ProductFormContext {
  return {
    productType: productType || plan?.productType,
    jewelryForm: plan?.jewelryForm || plan?.productForm,
    visualScriptContext,
    profile: plan?.profile,
  };
}

export function buildProductOnlyPromptSuffix(
  mode: PresentationMode,
  plan?: ProductPresentationPlan,
  cameraShot?: string,
  productType?: string,
  visualScriptContext?: string,
): string {
  const ctx = buildProductFormContextFromPlan(plan, productType, visualScriptContext);
  const form = inferProductForm(ctx);
  const camera = cameraShot ? ` ${cameraShot}.` : '';
  const productConsistency =
    '[CRITICAL PRODUCT CONSISTENCY: The product MUST be IDENTICAL to the reference image — same exact product, shape, colors, design, packaging, and branding. Only change angle, lighting, or context.]';
  const formLock = buildProductFormLockSuffix(ctx);

  switch (mode) {
    case 'on_model': {
      const wearHint =
        form === 'bracelet' || form === 'watch'
          ? 'worn on wrist, wrist clearly visible'
          : form === 'necklace'
            ? 'worn around neck, neckline visible'
            : '';
      return `${productConsistency} ${formLock} [on_model: fashion model wearing or holding the exact product.${wearHint}${camera} Silent commercial fashion ad still, no microphone, no talking, no presenter desk. Generate ONE single image.]`;
    }
    case 'display_mannequin': {
      const holderHint = cameraShot?.trim() || inferRetailDisplayHolderHint(ctx);
      return `${productConsistency} ${formLock} [display_mannequin: RETAIL DISPLAY HOLDER — ${holderHint}. Product showcased exactly as in reference. NO living person, NO human face, NO hands in frame unless mode is hands_interaction. Generate ONE single image.]`;
    }
    case 'hands_interaction': {
      const handsHint =
        cameraShot?.trim() ||
        inferHandsInteractionHint(ctx) ||
        'crop to hands and product only, natural ad pose, product identical to reference';
      return `${productConsistency} ${formLock} [hands_interaction: ${handsHint}. Generate ONE single image.]`;
    }
    case 'detail_macro':
      return `${productConsistency} ${formLock} [detail_macro: tight craftsmanship/detail shot; detail must be fully visible in frame. Generate ONE single image.]`;
    case 'environment_scale':
      return `${productConsistency} ${formLock} [environment_scale: room-scale or exterior product in context${plan?.profile === 'vehicle' ? ', automotive commercial' : ''}. Generate ONE single image.]`;
    case 'lifestyle_context':
      return `${productConsistency} ${formLock} [lifestyle_context: authentic use setting with product as hero.${camera} Generate ONE single image.]`;
    case 'hero_flat_lay':
    default:
      return `${productConsistency} ${formLock} [hero_flat_lay: product on clean surface, full product in frame, primary label readable. Generate ONE single image.]`;
  }
}

export function buildProductOnlyReferenceImages(
  mode: PresentationMode,
  publicProductImageUrl: string,
  assetReferenceImages: string[],
  ephemeralPresenterUrl?: string,
  requiresHuman?: boolean,
): string[] {
  const productRefs = [publicProductImageUrl, ...assetReferenceImages].filter(Boolean);

  if (mode === 'on_model' && ephemeralPresenterUrl) {
    return [publicProductImageUrl, ephemeralPresenterUrl, ...assetReferenceImages].filter(Boolean);
  }
  if (mode === 'lifestyle_context' && requiresHuman && ephemeralPresenterUrl) {
    return [publicProductImageUrl, ephemeralPresenterUrl, ...assetReferenceImages].filter(Boolean);
  }
  return productRefs;
}

export function getProductPresentationPlanFromMetadata(
  metadata: unknown,
): ProductPresentationPlan | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const plan = (metadata as Record<string, unknown>).productPresentationPlan;
  if (!plan || typeof plan !== 'object') return undefined;
  return plan as ProductPresentationPlan;
}

export function getEphemeralPresenterUrl(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const presenter = (metadata as Record<string, unknown>).ephemeralPresenter;
  if (!presenter || typeof presenter !== 'object') return undefined;
  const url = (presenter as { publicUrl?: string }).publicUrl;
  return typeof url === 'string' && url.trim() ? url.trim() : undefined;
}

export function extractPrimaryProductType(
  analyzedAssets?: Array<{
    category?: string;
    productInfo?: { type?: string; name?: string };
    visualScriptContext?: string;
  }>,
  plan?: ProductPresentationPlan,
  metadata?: Record<string, unknown>,
): string | undefined {
  const fromAsset = analyzedAssets?.find((a) => a.category === 'product')?.productInfo?.type;
  if (fromAsset?.trim()) return fromAsset.trim();
  const metaProducts = metadata?.analyzedAssets;
  if (Array.isArray(metaProducts)) {
    const p = metaProducts.find((a: any) => a?.category === 'product');
    const t = p?.productInfo?.type || p?.productType;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  if (plan?.productType?.trim()) return plan.productType.trim();
  return undefined;
}

export function extractVisualScriptContext(
  analyzedAssets?: Array<{ category?: string; visualScriptContext?: string }>,
  metadata?: Record<string, unknown>,
): string | undefined {
  const fromAsset = analyzedAssets?.find((a) => a.category === 'product')?.visualScriptContext;
  if (fromAsset?.trim()) return fromAsset.trim();
  const metaProducts = metadata?.analyzedAssets;
  if (Array.isArray(metaProducts)) {
    const p = metaProducts.find((a: any) => a?.category === 'product');
    if (typeof p?.visualScriptContext === 'string' && p.visualScriptContext.trim()) {
      return p.visualScriptContext.trim();
    }
  }
  return undefined;
}

export function sanitizeProductOnlyScenePrompt(
  prompt: string,
  plan?: ProductPresentationPlan,
  productType?: string,
  visualScriptContext?: string,
): string {
  return sanitizePromptForProductForm(
    prompt,
    buildProductFormContextFromPlan(plan, productType, visualScriptContext),
  );
}

export function buildProductOnlyVideoMotionSuffix(
  mode: PresentationMode,
  cameraMotion?: CameraMotion,
  sceneIndex = 0,
): string {
  return buildSharedProductOnlyVideoMotionSuffix(
    mode as SharedPresentationMode,
    cameraMotion,
    sceneIndex,
  );
}

export { inferProductForm, buildProductFormLockSuffix } from './product-form.util';
