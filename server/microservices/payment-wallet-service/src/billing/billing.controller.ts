import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BillingAudience } from '@prisma/client';
import { CreditPackagesService } from './credit-packages.service';
import { PricingEngine } from './pricing.engine';
import { QuoteInputMode } from './pricing.types';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly packages: CreditPackagesService,
    private readonly pricingEngine: PricingEngine,
  ) {}

  @Get('packages')
  async listPackages(@Query('audience') audience?: string) {
    const parsed = this.parseAudience(audience);
    return this.packages.listActive(parsed);
  }

  @Get('settings/public')
  async publicSettings() {
    const s = await this.pricingEngine.getSettings();
    return {
      currency: s.currency,
      creditRateBps: s.creditRateBps,
      minTopUpPaise: s.minTopUpPaise,
      maxTopUpPaise: s.maxTopUpPaise,
      gstEnabled: s.gstEnabled,
      gstRateBps: s.gstRateBps,
      creatorFeeBps: s.creatorFeeBps,
      brandFeeBps: s.brandFeeBps,
    };
  }

  @Post('quote')
  async quote(
    @Body()
    body: {
      audience: BillingAudience;
      userId?: string;
      packageId?: string;
      inputMode?: QuoteInputMode;
      amountPaise?: number;
      creditsDesired?: number;
      discountCode?: string;
    },
  ) {
    if (body.packageId) {
      return this.pricingEngine.quotePackage({
        packageId: body.packageId,
        userId: body.userId,
        audience: body.audience,
        discountCode: body.discountCode,
      });
    }
    return this.pricingEngine.quoteCustom({
      audience: body.audience,
      userId: body.userId,
      inputMode: body.inputMode || 'AMOUNT',
      amountPaise: body.amountPaise,
      creditsDesired: body.creditsDesired,
      discountCode: body.discountCode,
    });
  }

  private parseAudience(audience?: string): BillingAudience | undefined {
    if (!audience) return undefined;
    const upper = audience.toUpperCase();
    if (upper === 'CREATOR' || upper === 'BRAND') return upper as BillingAudience;
    return undefined;
  }
}
