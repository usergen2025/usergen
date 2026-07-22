import { Injectable } from '@nestjs/common';
import { FeeType } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';
import { PricingEngine } from './pricing.engine';

export interface UpdateBillingSettingsDto {
  currency?: string;
  creditRateBps?: number;
  creatorFeeBps?: number;
  brandFeeBps?: number;
  feeType?: FeeType;
  minTopUpPaise?: number;
  maxTopUpPaise?: number;
  gstEnabled?: boolean;
  gstRateBps?: number;
  platformGstin?: string | null;
  platformLegalName?: string | null;
  platformAddress?: string | null;
  invoicePrefix?: string;
  updatedBy?: string;
}

@Injectable()
export class BillingSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pricingEngine: PricingEngine,
  ) {}

  async get() {
    return this.pricingEngine.ensureSettings();
  }

  async update(dto: UpdateBillingSettingsDto) {
    const current = await this.pricingEngine.ensureSettings();
    return this.db.billingSettings.update({
      where: { id: current.id },
      data: {
        currency: dto.currency ?? undefined,
        creditRateBps: dto.creditRateBps ?? undefined,
        creatorFeeBps: dto.creatorFeeBps ?? undefined,
        brandFeeBps: dto.brandFeeBps ?? undefined,
        feeType: dto.feeType ?? undefined,
        minTopUpPaise: dto.minTopUpPaise ?? undefined,
        maxTopUpPaise: dto.maxTopUpPaise ?? undefined,
        gstEnabled: dto.gstEnabled ?? undefined,
        gstRateBps: dto.gstRateBps ?? undefined,
        platformGstin: dto.platformGstin === undefined ? undefined : dto.platformGstin,
        platformLegalName: dto.platformLegalName === undefined ? undefined : dto.platformLegalName,
        platformAddress: dto.platformAddress === undefined ? undefined : dto.platformAddress,
        invoicePrefix: dto.invoicePrefix ?? undefined,
        updatedBy: dto.updatedBy ?? undefined,
      },
    });
  }

  async upsertUserOverride(params: {
    userId: string;
    feeBps?: number | null;
    feeType?: FeeType | null;
    feeFixedPaise?: number | null;
    taxExempt?: boolean;
    notes?: string | null;
    updatedBy?: string;
  }) {
    return this.db.userBillingOverride.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        feeBps: params.feeBps ?? null,
        feeType: params.feeType ?? null,
        feeFixedPaise: params.feeFixedPaise ?? null,
        taxExempt: params.taxExempt ?? false,
        notes: params.notes ?? null,
        updatedBy: params.updatedBy,
      },
      update: {
        feeBps: params.feeBps === undefined ? undefined : params.feeBps,
        feeType: params.feeType === undefined ? undefined : params.feeType,
        feeFixedPaise: params.feeFixedPaise === undefined ? undefined : params.feeFixedPaise,
        taxExempt: params.taxExempt ?? undefined,
        notes: params.notes === undefined ? undefined : params.notes,
        updatedBy: params.updatedBy,
      },
    });
  }

  async getUserOverride(userId: string) {
    return this.db.userBillingOverride.findUnique({ where: { userId } });
  }

  async deleteUserOverride(userId: string) {
    try {
      await this.db.userBillingOverride.delete({ where: { userId } });
      return { success: true };
    } catch {
      return { success: true, deleted: false };
    }
  }
}
