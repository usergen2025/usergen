import { BillingAudience, FeeType } from '@prisma/client';
import {
  buildCustomQuote,
  buildPackageQuote,
  computeFeePaise,
  computeGstPaise,
  formulaCreditsForAmount,
  resolveFee,
  roundHalfUp,
} from './pricing.math';
import { PricingSettingsSnapshot } from './pricing.types';

const settings: PricingSettingsSnapshot = {
  currency: 'INR',
  creditRateBps: 10000,
  creatorFeeBps: 500,
  brandFeeBps: 1000,
  feeType: FeeType.PERCENT,
  minTopUpPaise: 10000,
  maxTopUpPaise: 100000000,
  gstEnabled: true,
  gstRateBps: 1800,
};

describe('pricing.math', () => {
  it('rounds GST half-up', () => {
    expect(roundHalfUp(1.4)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
  });

  it('computes 5% fee from ₹1000 top-up → 950 credits and GST on top', () => {
    const quote = buildCustomQuote({
      audience: BillingAudience.CREATOR,
      settings,
      inputMode: 'AMOUNT',
      amountPaise: 100000,
    });
    expect(quote.feeAmountPaise).toBe(5000);
    expect(quote.creditsToGrant).toBe(950);
    expect(quote.gstAmountPaise).toBe(18000);
    expect(quote.totalChargePaise).toBe(118000);
  });

  it('uses brand 10% fee by default', () => {
    const quote = buildCustomQuote({
      audience: BillingAudience.BRAND,
      settings,
      inputMode: 'AMOUNT',
      amountPaise: 100000,
    });
    expect(quote.feeAmountPaise).toBe(10000);
    expect(quote.creditsToGrant).toBe(900);
    expect(quote.totalChargePaise).toBe(118000);
  });

  it('honours user fee override', () => {
    const quote = buildCustomQuote({
      audience: BillingAudience.CREATOR,
      settings,
      override: { feeBps: 0, feeType: FeeType.PERCENT },
      inputMode: 'AMOUNT',
      amountPaise: 100000,
    });
    expect(quote.feeAmountPaise).toBe(0);
    expect(quote.creditsToGrant).toBe(1000);
    expect(quote.feeSource).toBe('USER_OVERRIDE');
  });

  it('skips GST when tax exempt', () => {
    const quote = buildCustomQuote({
      audience: BillingAudience.CREATOR,
      settings,
      override: { taxExempt: true },
      inputMode: 'AMOUNT',
      amountPaise: 100000,
    });
    expect(quote.gstAmountPaise).toBe(0);
    expect(quote.totalChargePaise).toBe(100000);
  });

  it('inverse credits mode targets enough credits', () => {
    const quote = buildCustomQuote({
      audience: BillingAudience.CREATOR,
      settings,
      inputMode: 'CREDITS',
      creditsDesired: 950,
    });
    expect(quote.creditsToGrant).toBeGreaterThanOrEqual(950);
    expect(quote.baseAmountPaise).toBeGreaterThanOrEqual(100000);
    expect(quote.totalChargePaise).toBe(quote.baseAmountPaise + quote.gstAmountPaise);
  });

  it('package quote uses explicit credits but still adds GST on base', () => {
    const quote = buildPackageQuote({
      audience: BillingAudience.CREATOR,
      settings,
      packageId: 'pkg_1',
      packageTitle: 'Promo',
      amountPaise: 100000,
      creditsToGrant: 1000, // promo waives fee effect
    });
    expect(quote.creditsToGrant).toBe(1000);
    expect(quote.totalChargePaise).toBe(118000);
  });

  it('formulaCreditsForAmount matches custom quote credits', () => {
    const credits = formulaCreditsForAmount(100000, BillingAudience.CREATOR, settings);
    expect(credits).toBe(950);
  });

  it('rejects below minimum top-up', () => {
    expect(() =>
      buildCustomQuote({
        audience: BillingAudience.CREATOR,
        settings,
        inputMode: 'AMOUNT',
        amountPaise: 5000,
      }),
    ).toThrow(/Minimum top-up/);
  });

  it('resolveFee and computeFeePaise for fixed fee', () => {
    const fee = resolveFee(BillingAudience.CREATOR, settings, {
      feeType: FeeType.FIXED,
      feeFixedPaise: 2500,
    });
    expect(computeFeePaise(100000, fee)).toBe(2500);
  });

  it('computeGstPaise returns zero when disabled', () => {
    expect(computeGstPaise(100000, 1800, false, false)).toEqual({
      gstAmountPaise: 0,
      gstRateBpsApplied: 0,
    });
  });
});
