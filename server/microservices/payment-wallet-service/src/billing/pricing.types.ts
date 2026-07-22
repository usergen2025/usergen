import { BillingAudience, FeeType } from '@prisma/client';

export type QuoteInputMode = 'AMOUNT' | 'CREDITS';

export interface FeeResolution {
  feeType: FeeType;
  feeBps: number;
  feeFixedPaise: number;
  source: 'GLOBAL_DEFAULT' | 'USER_OVERRIDE';
}

export interface QuoteLineItem {
  code: string;
  label: string;
  amountPaise: number;
}

export interface BillingQuote {
  audience: BillingAudience;
  source: 'PACKAGE' | 'CUSTOM';
  packageId?: string;
  packageTitle?: string;
  currency: string;
  creditRateBps: number;
  baseAmountPaise: number;
  feeAmountPaise: number;
  feeBpsApplied: number;
  feeTypeApplied: FeeType;
  feeSource: FeeResolution['source'];
  discountAmountPaise: number;
  gstAmountPaise: number;
  gstRateBpsApplied: number;
  gstEnabled: boolean;
  creditsToGrant: number;
  totalChargePaise: number;
  lineItems: QuoteLineItem[];
  inputMode?: QuoteInputMode;
}

export interface PricingSettingsSnapshot {
  currency: string;
  creditRateBps: number;
  creatorFeeBps: number;
  brandFeeBps: number;
  feeType: FeeType;
  minTopUpPaise: number;
  maxTopUpPaise: number;
  gstEnabled: boolean;
  gstRateBps: number;
}

export interface UserFeeOverrideSnapshot {
  feeBps?: number | null;
  feeType?: FeeType | null;
  feeFixedPaise?: number | null;
  taxExempt?: boolean;
}
