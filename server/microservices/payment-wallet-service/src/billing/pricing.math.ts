import { BillingAudience, FeeType } from '@prisma/client';
import {
  BillingQuote,
  FeeResolution,
  PricingSettingsSnapshot,
  QuoteInputMode,
  UserFeeOverrideSnapshot,
} from './pricing.types';

/** Round half-up for GST paise (common invoice practice). */
export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

/** Floor in platform's favor for fee. */
export function floorFee(n: number): number {
  return Math.floor(n);
}

export function resolveFee(
  audience: BillingAudience,
  settings: PricingSettingsSnapshot,
  override?: UserFeeOverrideSnapshot | null,
): FeeResolution {
  if (override?.feeType === FeeType.FIXED && override.feeFixedPaise != null) {
    return {
      feeType: FeeType.FIXED,
      feeBps: 0,
      feeFixedPaise: override.feeFixedPaise,
      source: 'USER_OVERRIDE',
    };
  }
  if (override?.feeBps != null) {
    return {
      feeType: override.feeType ?? FeeType.PERCENT,
      feeBps: override.feeBps,
      feeFixedPaise: 0,
      source: 'USER_OVERRIDE',
    };
  }
  const feeBps = audience === BillingAudience.BRAND ? settings.brandFeeBps : settings.creatorFeeBps;
  return {
    feeType: settings.feeType,
    feeBps: settings.feeType === FeeType.PERCENT ? feeBps : 0,
    feeFixedPaise: settings.feeType === FeeType.FIXED ? feeBps : 0,
    source: 'GLOBAL_DEFAULT',
  };
}

export function computeFeePaise(baseAmountPaise: number, fee: FeeResolution): number {
  if (baseAmountPaise <= 0) return 0;
  if (fee.feeType === FeeType.FIXED) {
    return Math.min(baseAmountPaise, Math.max(0, fee.feeFixedPaise));
  }
  return floorFee((baseAmountPaise * fee.feeBps) / 10000);
}

export function computeCreditsFromNet(netPaise: number, creditRateBps: number): number {
  if (netPaise <= 0) return 0;
  return Math.floor((netPaise * creditRateBps) / (100 * 10000));
}

export function computeNetPaiseFromCredits(credits: number, creditRateBps: number): number {
  if (credits <= 0) return 0;
  // credits = floor(netPaise * rateBps / 1_000_000) → invert with ceil for enough net
  return Math.ceil((credits * 100 * 10000) / creditRateBps);
}

export function computeBaseFromNetAndFee(netPaise: number, fee: FeeResolution): number {
  if (netPaise <= 0) return 0;
  if (fee.feeType === FeeType.FIXED) {
    return netPaise + Math.max(0, fee.feeFixedPaise);
  }
  if (fee.feeBps >= 10000) {
    throw new Error('Platform fee cannot be 100% or more when converting credits to amount');
  }
  // net = base - floor(base * bps / 10000) ≈ base * (1 - bps/10000)
  return Math.ceil((netPaise * 10000) / (10000 - fee.feeBps));
}

export function computeGstPaise(
  taxablePaise: number,
  gstRateBps: number,
  gstEnabled: boolean,
  taxExempt: boolean,
): { gstAmountPaise: number; gstRateBpsApplied: number } {
  if (!gstEnabled || taxExempt || taxablePaise <= 0 || gstRateBps <= 0) {
    return { gstAmountPaise: 0, gstRateBpsApplied: 0 };
  }
  return {
    gstAmountPaise: roundHalfUp((taxablePaise * gstRateBps) / 10000),
    gstRateBpsApplied: gstRateBps,
  };
}

export function buildCustomQuote(params: {
  audience: BillingAudience;
  settings: PricingSettingsSnapshot;
  override?: UserFeeOverrideSnapshot | null;
  inputMode: QuoteInputMode;
  amountPaise?: number;
  creditsDesired?: number;
}): BillingQuote {
  const { audience, settings, override, inputMode } = params;
  const fee = resolveFee(audience, settings, override);

  let baseAmountPaise: number;
  let feeAmountPaise: number;
  let creditsToGrant: number;

  if (inputMode === 'CREDITS') {
    const creditsDesired = params.creditsDesired ?? 0;
    if (creditsDesired <= 0) {
      throw new Error('creditsDesired must be positive');
    }
    const netPaise = computeNetPaiseFromCredits(creditsDesired, settings.creditRateBps);
    baseAmountPaise = computeBaseFromNetAndFee(netPaise, fee);
    feeAmountPaise = computeFeePaise(baseAmountPaise, fee);
    const netAfterFee = baseAmountPaise - feeAmountPaise;
    creditsToGrant = computeCreditsFromNet(netAfterFee, settings.creditRateBps);
  } else {
    baseAmountPaise = params.amountPaise ?? 0;
    if (baseAmountPaise <= 0) {
      throw new Error('amountPaise must be positive');
    }
    feeAmountPaise = computeFeePaise(baseAmountPaise, fee);
    creditsToGrant = computeCreditsFromNet(baseAmountPaise - feeAmountPaise, settings.creditRateBps);
  }

  if (baseAmountPaise < settings.minTopUpPaise) {
    throw new Error(`Minimum top-up is ₹${(settings.minTopUpPaise / 100).toFixed(2)}`);
  }
  if (baseAmountPaise > settings.maxTopUpPaise) {
    throw new Error(`Maximum top-up is ₹${(settings.maxTopUpPaise / 100).toFixed(2)}`);
  }

  const { gstAmountPaise, gstRateBpsApplied } = computeGstPaise(
    baseAmountPaise,
    settings.gstRateBps,
    settings.gstEnabled,
    !!override?.taxExempt,
  );

  const discountAmountPaise = 0; // DiscountApplier no-op in v1
  const totalChargePaise = baseAmountPaise - discountAmountPaise + gstAmountPaise;

  return {
    audience,
    source: 'CUSTOM',
    currency: settings.currency,
    creditRateBps: settings.creditRateBps,
    baseAmountPaise,
    feeAmountPaise,
    feeBpsApplied: fee.feeType === FeeType.PERCENT ? fee.feeBps : 0,
    feeTypeApplied: fee.feeType,
    feeSource: fee.source,
    discountAmountPaise,
    gstAmountPaise,
    gstRateBpsApplied,
    gstEnabled: settings.gstEnabled && !override?.taxExempt,
    creditsToGrant,
    totalChargePaise,
    inputMode,
    lineItems: [
      { code: 'BASE', label: 'Top-up amount', amountPaise: baseAmountPaise },
      { code: 'PLATFORM_FEE', label: 'Platform fee', amountPaise: feeAmountPaise },
      { code: 'GST', label: 'GST', amountPaise: gstAmountPaise },
      { code: 'TOTAL', label: 'Total payable', amountPaise: totalChargePaise },
    ],
  };
}

export function buildPackageQuote(params: {
  audience: BillingAudience;
  settings: PricingSettingsSnapshot;
  override?: UserFeeOverrideSnapshot | null;
  packageId: string;
  packageTitle: string;
  amountPaise: number;
  creditsToGrant: number;
}): BillingQuote {
  const { audience, settings, override } = params;
  const fee = resolveFee(audience, settings, override);
  const baseAmountPaise = params.amountPaise;

  if (baseAmountPaise < settings.minTopUpPaise) {
    throw new Error(`Minimum top-up is ₹${(settings.minTopUpPaise / 100).toFixed(2)}`);
  }
  if (baseAmountPaise > settings.maxTopUpPaise) {
    throw new Error(`Maximum top-up is ₹${(settings.maxTopUpPaise / 100).toFixed(2)}`);
  }

  // Fee shown for transparency; package credits are explicit (may differ from formula for promos)
  const feeAmountPaise = computeFeePaise(baseAmountPaise, fee);
  const { gstAmountPaise, gstRateBpsApplied } = computeGstPaise(
    baseAmountPaise,
    settings.gstRateBps,
    settings.gstEnabled,
    !!override?.taxExempt,
  );
  const discountAmountPaise = 0;
  const totalChargePaise = baseAmountPaise - discountAmountPaise + gstAmountPaise;

  return {
    audience,
    source: 'PACKAGE',
    packageId: params.packageId,
    packageTitle: params.packageTitle,
    currency: settings.currency,
    creditRateBps: settings.creditRateBps,
    baseAmountPaise,
    feeAmountPaise,
    feeBpsApplied: fee.feeType === FeeType.PERCENT ? fee.feeBps : 0,
    feeTypeApplied: fee.feeType,
    feeSource: fee.source,
    discountAmountPaise,
    gstAmountPaise,
    gstRateBpsApplied,
    gstEnabled: settings.gstEnabled && !override?.taxExempt,
    creditsToGrant: params.creditsToGrant,
    totalChargePaise,
    lineItems: [
      { code: 'BASE', label: params.packageTitle, amountPaise: baseAmountPaise },
      { code: 'PLATFORM_FEE', label: 'Platform fee', amountPaise: feeAmountPaise },
      { code: 'GST', label: 'GST', amountPaise: gstAmountPaise },
      { code: 'TOTAL', label: 'Total payable', amountPaise: totalChargePaise },
    ],
  };
}

/** Default credits for a package amount using audience fee (formula seed helper). */
export function formulaCreditsForAmount(
  amountPaise: number,
  audience: BillingAudience,
  settings: PricingSettingsSnapshot,
): number {
  const fee = resolveFee(audience, settings, null);
  const feeAmountPaise = computeFeePaise(amountPaise, fee);
  return computeCreditsFromNet(amountPaise - feeAmountPaise, settings.creditRateBps);
}
