'use client';

import { paiseToUnits, pushEcommerce, pushEvent } from '@/lib/analytics/gtm';

export type AuthMethod = 'email' | 'google' | 'facebook';

const OAUTH_METHOD_KEY = 'oauth_method';

/** Persist OAuth provider before redirect so /auth/callback can attribute method. */
export function rememberOauthMethod(method: 'google' | 'facebook'): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(OAUTH_METHOD_KEY, method);
  } catch {
    // ignore quota / private mode
  }
}

export function consumeOauthMethod(): AuthMethod {
  if (typeof window === 'undefined') return 'google';
  try {
    const raw = sessionStorage.getItem(OAUTH_METHOD_KEY);
    sessionStorage.removeItem(OAUTH_METHOD_KEY);
    if (raw === 'google' || raw === 'facebook' || raw === 'email') return raw;
  } catch {
    // ignore
  }
  return 'google';
}

export function trackLogin(params: { method: AuthMethod }): void {
  pushEvent({
    event: 'login',
    method: params.method,
  });
}

export function trackSignUp(params: {
  method: AuthMethod;
  user_type: 'creator' | 'brand';
}): void {
  pushEvent({
    event: 'sign_up',
    method: params.method,
    user_type: params.user_type,
  });
}

export type CreditItemInput = {
  itemId: string;
  itemName: string;
  pricePaise: number;
  quantity?: number;
};

function creditItem(input: CreditItemInput) {
  return {
    item_id: input.itemId,
    item_name: input.itemName,
    item_category: 'credits',
    price: paiseToUnits(input.pricePaise),
    quantity: input.quantity ?? 1,
  };
}

export function trackViewItem(params: {
  currency?: string;
  valuePaise: number;
  item: CreditItemInput;
}): void {
  const currency = params.currency || 'INR';
  const value = paiseToUnits(params.valuePaise);
  pushEcommerce({
    event: 'view_item',
    ecommerce: {
      currency,
      value,
      items: [creditItem(params.item)],
    },
  });
}

export function trackBeginCheckout(params: {
  currency?: string;
  valuePaise: number;
  purchaseOrderId: string;
  creditsGranted: number;
  item: CreditItemInput;
}): void {
  const currency = params.currency || 'INR';
  const value = paiseToUnits(params.valuePaise);
  pushEcommerce({
    event: 'begin_checkout',
    purchase_order_id: params.purchaseOrderId,
    credits_granted: params.creditsGranted,
    ecommerce: {
      currency,
      value,
      items: [creditItem(params.item)],
    },
  });
}

export function trackPurchase(params: {
  currency?: string;
  valuePaise: number;
  transactionId: string;
  creditsGranted: number;
  item: CreditItemInput;
}): void {
  const currency = params.currency || 'INR';
  const value = paiseToUnits(params.valuePaise);
  pushEcommerce({
    event: 'purchase',
    credits_granted: params.creditsGranted,
    ecommerce: {
      transaction_id: params.transactionId,
      currency,
      value,
      items: [creditItem(params.item)],
    },
  });
}

export function trackPurchaseFailed(params: {
  errorReason?: string;
  purchaseOrderId?: string;
}): void {
  pushEvent({
    event: 'purchase_failed',
    error_reason: params.errorReason,
    purchase_order_id: params.purchaseOrderId,
  });
}

export function trackPurchaseCancelled(params: {
  purchaseOrderId?: string;
}): void {
  pushEvent({
    event: 'purchase_cancelled',
    purchase_order_id: params.purchaseOrderId,
  });
}

export type FunnelKind = 'ai_chat' | 'classic';

function oncePerSession(key: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
}

export function trackVideoFunnelStep(params: {
  stepName: string;
  projectId?: string | null;
  funnel: FunnelKind;
  dedupe?: boolean;
}): void {
  if (params.dedupe !== false) {
    const key = `ga_funnel_${params.funnel}_${params.stepName}_${params.projectId || 'none'}`;
    if (!oncePerSession(key)) return;
  }
  pushEvent({
    event: 'video_funnel_step',
    step_name: params.stepName,
    project_id: params.projectId || undefined,
    funnel: params.funnel,
    page_section: 'creation',
  });
}

export function trackVideoRenderComplete(params: {
  projectId: string;
  funnel: FunnelKind;
  source?: string;
}): void {
  const key = `ga_render_complete_${params.projectId}`;
  if (!oncePerSession(key)) return;
  pushEvent({
    event: 'video_render_complete',
    project_id: params.projectId,
    funnel: params.funnel,
    source: params.source,
    page_section: 'creation',
  });
}

export function trackVideoDownload(params: {
  projectId: string;
}): void {
  pushEvent({
    event: 'video_download',
    project_id: params.projectId,
    page_section: 'creation',
  });
}
