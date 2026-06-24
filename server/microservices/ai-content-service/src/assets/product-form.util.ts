import {
  ProductForm,
  ProductFormContext,
  buildProductFormLockSuffix,
  conflictingFormKeywordsInPrompt,
  hasDedicatedDisplayHolder,
  inferHandsInteractionHint,
  inferOnModelWearHint,
  inferProductForm,
  inferRetailDisplayHolderHint,
  normalizeProductForm,
  sanitizePromptForProductForm,
  getProductFormLabel,
} from './product-form-core.util';
import { PresentationProfile, ProductPresentationShotMix } from './product-presentation.util';

export type { ProductForm, ProductFormContext };
export {
  buildProductFormLockSuffix,
  conflictingFormKeywordsInPrompt,
  hasDedicatedDisplayHolder,
  inferHandsInteractionHint,
  inferOnModelWearHint,
  inferProductForm,
  inferRetailDisplayHolderHint,
  normalizeProductForm,
  sanitizePromptForProductForm,
  getProductFormLabel,
};

export function isWatchProduct(productType?: string): boolean {
  return inferProductForm({ productType, profile: 'wearable_accessory' }) === 'watch';
}

function formContext(
  productType?: string,
  profile?: PresentationProfile,
  jewelryForm?: string,
  visualScriptContext?: string,
): ProductFormContext {
  return { productType, profile, jewelryForm, visualScriptContext };
}

/** Form-specific shot mix overrides generic wearable_jewelry defaults. */
export function resolveFormAwareShotMix(
  profile: PresentationProfile,
  productType?: string,
  jewelryForm?: string,
): ProductPresentationShotMix[] {
  const ctx = formContext(productType, profile, jewelryForm);
  const form = inferProductForm(ctx);

  if (profile === 'wearable_accessory' && form === 'watch') {
    return [
      { mode: 'hero_flat_lay', share: 0.17, framingHint: 'Watch on clean surface, dial and strap fully visible' },
      {
        mode: 'display_mannequin',
        share: 0.22,
        framingHint: inferRetailDisplayHolderHint(ctx),
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
  }

  if (form === 'bracelet') {
    return [
      { mode: 'hero_flat_lay', share: 0.2, framingHint: 'Full bracelet on neutral luxury surface' },
      {
        mode: 'display_mannequin',
        share: 0.18,
        framingHint: inferRetailDisplayHolderHint(ctx),
      },
      {
        mode: 'on_model',
        share: 0.22,
        framingHint: `Wrist close-up, ${inferOnModelWearHint(form)}, product clearly visible`,
      },
      {
        mode: 'hands_interaction',
        share: 0.18,
        framingHint: inferHandsInteractionHint(ctx) || 'Hands and bracelet on wrist',
      },
      { mode: 'detail_macro', share: 0.12, framingHint: 'Craftsmanship and clasp close-up' },
      { mode: 'lifestyle_context', share: 0.1, framingHint: 'Elegant lifestyle wrist shot' },
    ];
  }

  if (form === 'necklace') {
    return [
      { mode: 'hero_flat_lay', share: 0.17, framingHint: 'Full necklace on neutral surface' },
      {
        mode: 'display_mannequin',
        share: 0.2,
        framingHint: inferRetailDisplayHolderHint(ctx),
      },
      {
        mode: 'on_model',
        share: 0.28,
        framingHint: `Medium close-up, ${inferOnModelWearHint(form)}, product clearly visible`,
      },
      {
        mode: 'hands_interaction',
        share: 0.12,
        framingHint: inferHandsInteractionHint(ctx) || 'Hands adjusting necklace',
      },
      { mode: 'detail_macro', share: 0.13, framingHint: 'Pendant or craftsmanship close-up' },
      { mode: 'lifestyle_context', share: 0.1, framingHint: 'Elegant lifestyle setting' },
    ];
  }

  if (form === 'ring') {
    return [
      { mode: 'hero_flat_lay', share: 0.2, framingHint: 'Ring on neutral surface' },
      { mode: 'display_mannequin', share: 0.2, framingHint: inferRetailDisplayHolderHint(ctx) },
      { mode: 'hands_interaction', share: 0.25, framingHint: inferHandsInteractionHint(ctx) || 'Hand wearing ring' },
      { mode: 'detail_macro', share: 0.2, framingHint: 'Ring detail macro' },
      { mode: 'lifestyle_context', share: 0.15, framingHint: 'Lifestyle hand shot' },
    ];
  }

  if (form === 'earring') {
    return [
      { mode: 'hero_flat_lay', share: 0.2, framingHint: 'Earrings on neutral surface' },
      { mode: 'display_mannequin', share: 0.22, framingHint: inferRetailDisplayHolderHint(ctx) },
      { mode: 'hands_interaction', share: 0.22, framingHint: inferHandsInteractionHint(ctx) || 'Hand presenting earring' },
      { mode: 'on_model', share: 0.18, framingHint: 'Model with earring visible, silent ad still' },
      { mode: 'detail_macro', share: 0.18, framingHint: 'Earring detail macro' },
    ];
  }

  if (!hasDedicatedDisplayHolder(form) && profile === 'wearable_jewelry') {
    return [
      { mode: 'hero_flat_lay', share: 0.3, framingHint: 'Product on neutral luxury surface, full item visible' },
      { mode: 'detail_macro', share: 0.25, framingHint: 'Craftsmanship close-up' },
      { mode: 'hands_interaction', share: 0.2, framingHint: 'Hands presenting product as in reference' },
      { mode: 'on_model', share: 0.15, framingHint: 'Model wearing or holding product naturally' },
      { mode: 'lifestyle_context', share: 0.1, framingHint: 'Lifestyle context' },
    ];
  }

  return [];
}
