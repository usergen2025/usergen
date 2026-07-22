import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingAudience } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';
import { DiscountApplier } from './appliers/discount.applier';
import { TaxApplier } from './appliers/tax.applier';
import {
  buildCustomQuote,
  buildPackageQuote,
  formulaCreditsForAmount,
} from './pricing.math';
import {
  BillingQuote,
  PricingSettingsSnapshot,
  QuoteInputMode,
  UserFeeOverrideSnapshot,
} from './pricing.types';

@Injectable()
export class PricingEngine {
  constructor(
    private readonly db: DatabaseService,
    private readonly discountApplier: DiscountApplier,
    private readonly taxApplier: TaxApplier,
  ) {}

  async getSettings(): Promise<PricingSettingsSnapshot> {
    const row = await this.ensureSettings();
    return {
      currency: row.currency,
      creditRateBps: row.creditRateBps,
      creatorFeeBps: row.creatorFeeBps,
      brandFeeBps: row.brandFeeBps,
      feeType: row.feeType,
      minTopUpPaise: row.minTopUpPaise,
      maxTopUpPaise: row.maxTopUpPaise,
      gstEnabled: row.gstEnabled,
      gstRateBps: row.gstRateBps,
    };
  }

  async ensureSettings() {
    const existing = await this.db.billingSettings.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existing) return existing;
    return this.db.billingSettings.create({
      data: {
        currency: 'INR',
        creditRateBps: 10000,
        creatorFeeBps: 500,
        brandFeeBps: 1000,
        gstEnabled: true,
        gstRateBps: 1800,
        platformLegalName: 'UserGen',
        invoicePrefix: 'UG',
      },
    });
  }

  async getUserOverride(userId?: string): Promise<UserFeeOverrideSnapshot | null> {
    if (!userId) return null;
    const row = await this.db.userBillingOverride.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      feeBps: row.feeBps,
      feeType: row.feeType,
      feeFixedPaise: row.feeFixedPaise,
      taxExempt: row.taxExempt,
    };
  }

  async quoteCustom(params: {
    audience: BillingAudience;
    userId?: string;
    inputMode: QuoteInputMode;
    amountPaise?: number;
    creditsDesired?: number;
    discountCode?: string;
  }): Promise<BillingQuote> {
    const settings = await this.getSettings();
    const override = await this.getUserOverride(params.userId);
    try {
      let quote = buildCustomQuote({
        audience: params.audience,
        settings,
        override,
        inputMode: params.inputMode,
        amountPaise: params.amountPaise,
        creditsDesired: params.creditsDesired,
      });
      quote = this.discountApplier.apply(quote, params.discountCode);
      quote = this.taxApplier.apply(quote);
      return quote;
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Invalid quote request');
    }
  }

  async quotePackage(params: {
    packageId: string;
    userId?: string;
    audience?: BillingAudience;
    discountCode?: string;
  }): Promise<BillingQuote> {
    const pkg = await this.db.creditPackage.findUnique({ where: { id: params.packageId } });
    if (!pkg || !pkg.isActive) {
      throw new NotFoundException('Credit package not found or inactive');
    }
    if (params.audience && pkg.audience !== params.audience) {
      throw new BadRequestException('Package is not available for this audience');
    }
    const settings = await this.getSettings();
    const override = await this.getUserOverride(params.userId);
    try {
      let quote = buildPackageQuote({
        audience: pkg.audience,
        settings,
        override,
        packageId: pkg.id,
        packageTitle: pkg.title,
        amountPaise: pkg.amountPaise,
        creditsToGrant: pkg.creditsToGrant,
      });
      quote = this.discountApplier.apply(quote, params.discountCode);
      quote = this.taxApplier.apply(quote);
      return quote;
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Invalid package quote');
    }
  }

  async formulaCredits(amountPaise: number, audience: BillingAudience): Promise<number> {
    const settings = await this.getSettings();
    return formulaCreditsForAmount(amountPaise, audience, settings);
  }
}
