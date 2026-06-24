export type { ProductForm } from './product-form.util';
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
} from './product-form.util';
export type { ProductFormContext } from './product-form.util';

// Backward-compatible watch helper
export function isWatchProduct(productType?: string): boolean {
  const t = (productType || '').toLowerCase();
  return /\bwatch\b|wristwatch|smartwatch|timepiece|chronograph/.test(t);
}
