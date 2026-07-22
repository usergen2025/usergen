import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingAudience } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';
import { PricingEngine } from './pricing.engine';

@Injectable()
export class CreditPackagesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pricingEngine: PricingEngine,
  ) {}

  async listActive(audience?: BillingAudience) {
    return this.db.creditPackage.findMany({
      where: {
        isActive: true,
        ...(audience ? { audience } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { amountPaise: 'asc' }],
    });
  }

  async listAll(audience?: BillingAudience) {
    return this.db.creditPackage.findMany({
      where: audience ? { audience } : undefined,
      orderBy: [{ audience: 'asc' }, { sortOrder: 'asc' }, { amountPaise: 'asc' }],
    });
  }

  async getById(id: string) {
    const pkg = await this.db.creditPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Package not found');
    return pkg;
  }

  async create(data: {
    audience: BillingAudience;
    title: string;
    description?: string;
    amountPaise: number;
    creditsToGrant?: number;
    sortOrder?: number;
    isActive?: boolean;
    badge?: string;
    updatedBy?: string;
  }) {
    if (data.amountPaise <= 0) {
      throw new BadRequestException('amountPaise must be positive');
    }
    const creditsToGrant =
      data.creditsToGrant ?? (await this.pricingEngine.formulaCredits(data.amountPaise, data.audience));
    return this.db.creditPackage.create({
      data: {
        audience: data.audience,
        title: data.title,
        description: data.description,
        amountPaise: data.amountPaise,
        creditsToGrant,
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
        badge: data.badge,
        updatedBy: data.updatedBy,
      },
    });
  }

  async update(
    id: string,
    data: {
      title?: string;
      description?: string | null;
      amountPaise?: number;
      creditsToGrant?: number;
      sortOrder?: number;
      isActive?: boolean;
      badge?: string | null;
      updatedBy?: string;
      recalculateCredits?: boolean;
    },
  ) {
    const existing = await this.getById(id);
    let creditsToGrant = data.creditsToGrant;
    const amountPaise = data.amountPaise ?? existing.amountPaise;
    if (data.recalculateCredits || (data.amountPaise != null && data.creditsToGrant == null)) {
      creditsToGrant = await this.pricingEngine.formulaCredits(amountPaise, existing.audience);
    }
    return this.db.creditPackage.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description === undefined ? undefined : data.description,
        amountPaise: data.amountPaise,
        creditsToGrant,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
        badge: data.badge === undefined ? undefined : data.badge,
        updatedBy: data.updatedBy,
      },
    });
  }

  async deactivate(id: string, updatedBy?: string) {
    await this.getById(id);
    return this.db.creditPackage.update({
      where: { id },
      data: { isActive: false, updatedBy },
    });
  }
}
