import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingAudience,
  PaymentAttemptStatus,
  PaymentProvider,
  PurchaseOrderStatus,
  PurchaseSource,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { BillingEmailService } from '../billing-emails/billing-email.service';
import { DatabaseService } from '../common/database/database.service';
import { PricingEngine } from '../billing/pricing.engine';
import { BillingQuote } from '../billing/pricing.types';
import { PaymentGatewayFactory } from '../payments/gateway/payment-gateway.factory';

@Injectable()
export class PaymentLinksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pricingEngine: PricingEngine,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly billingEmail: BillingEmailService,
  ) {}

  async createForExistingUser(params: {
    userId: string;
    audience: BillingAudience;
    adminUserId: string;
    packageId?: string;
    amountPaise?: number;
    creditsDesired?: number;
    customerEmail?: string;
    customerName?: string;
    customerPhone?: string;
    description?: string;
    notifyEmail?: boolean;
    expireInHours?: number;
    /** Optional one-off fee override for this deal only (bps). */
    feeBpsOverride?: number;
  }) {
    if (!params.userId) throw new BadRequestException('userId is required');
    if (!params.adminUserId) throw new BadRequestException('adminUserId is required');

    let quote: BillingQuote;
    let source: PurchaseSource;

    if (params.packageId) {
      quote = await this.pricingEngine.quotePackage({
        packageId: params.packageId,
        userId: params.userId,
        audience: params.audience,
      });
      source = PurchaseSource.PACKAGE;
    } else if (params.amountPaise != null) {
      quote = await this.pricingEngine.quoteCustom({
        audience: params.audience,
        userId: params.userId,
        inputMode: 'AMOUNT',
        amountPaise: params.amountPaise,
      });
      source = PurchaseSource.ADMIN_LINK;
    } else if (params.creditsDesired != null) {
      quote = await this.pricingEngine.quoteCustom({
        audience: params.audience,
        userId: params.userId,
        inputMode: 'CREDITS',
        creditsDesired: params.creditsDesired,
      });
      source = PurchaseSource.ADMIN_LINK;
    } else {
      throw new BadRequestException('Provide packageId, amountPaise, or creditsDesired');
    }

    // Optional one-off fee override: rebuild custom quote with temporary override snapshot
    if (params.feeBpsOverride != null && !params.packageId && params.amountPaise != null) {
      const settings = await this.pricingEngine.getSettings();
      const { buildCustomQuote } = await import('../billing/pricing.math');
      quote = buildCustomQuote({
        audience: params.audience,
        settings,
        override: { feeBps: params.feeBpsOverride, feeType: 'PERCENT' as any },
        inputMode: 'AMOUNT',
        amountPaise: params.amountPaise,
      });
      source = PurchaseSource.ADMIN_LINK;
    }

    const expireHours = params.expireInHours ?? 72;
    const expiresAt = new Date(Date.now() + expireHours * 60 * 60 * 1000);
    const referenceId = `pl_${randomBytes(8).toString('hex')}`.slice(0, 40);

    const order = await this.db.purchaseOrder.create({
      data: {
        userId: params.userId,
        audience: quote.audience,
        source,
        status: PurchaseOrderStatus.AWAITING_PAYMENT,
        packageId: quote.packageId,
        baseAmountPaise: quote.baseAmountPaise,
        feeAmountPaise: quote.feeAmountPaise,
        feeBpsApplied: quote.feeBpsApplied,
        feeTypeApplied: quote.feeTypeApplied,
        discountAmountPaise: quote.discountAmountPaise,
        gstAmountPaise: quote.gstAmountPaise,
        gstRateBpsApplied: quote.gstRateBpsApplied,
        totalChargePaise: quote.totalChargePaise,
        creditsToGrant: quote.creditsToGrant,
        currency: quote.currency,
        creditRateBps: quote.creditRateBps,
        quoteSnapshot: {
          ...(quote as any),
          buyerEmail: params.customerEmail,
          buyerName: params.customerName,
        },
        provider: PaymentProvider.RAZORPAY,
        expiresAt,
      },
    });

    const gateway = this.gatewayFactory.getGateway();
    const description =
      params.description ||
      `UserGen credit top-up: ${quote.creditsToGrant} credits (Order ${order.id.slice(0, 8)})`;

    const link = await gateway.createPaymentLink({
      amountPaise: order.totalChargePaise,
      currency: order.currency,
      description,
      referenceId,
      customer: {
        name: params.customerName,
        email: params.customerEmail,
        contact: params.customerPhone,
      },
      notifyEmail: params.notifyEmail ?? true,
      notifySms: false,
      expireByUnix: Math.floor(expiresAt.getTime() / 1000),
      notes: {
        purchaseOrderId: order.id,
        userId: params.userId,
        audience: order.audience,
        createdByAdminId: params.adminUserId,
      },
    });

    await this.db.paymentAttempt.create({
      data: {
        purchaseOrderId: order.id,
        provider: PaymentProvider.RAZORPAY,
        amountPaise: order.totalChargePaise,
        currency: order.currency,
        status: PaymentAttemptStatus.CREATED,
        rawPayload: link.raw as any,
      },
    });

    const record = await this.db.paymentLinkRecord.create({
      data: {
        purchaseOrderId: order.id,
        provider: PaymentProvider.RAZORPAY,
        providerLinkId: link.providerLinkId,
        shortUrl: link.shortUrl,
        referenceId: link.referenceId || referenceId,
        customerEmail: params.customerEmail,
        customerPhone: params.customerPhone,
        customerName: params.customerName,
        expireBy: expiresAt,
        createdByAdminId: params.adminUserId,
      },
    });

    // Branded incomplete-payment email with Razorpay short URL
    void this.billingEmail.sendIncompletePayment(
      {
        ...order,
        quoteSnapshot: {
          ...(order.quoteSnapshot as any),
          buyerEmail: params.customerEmail,
          buyerName: params.customerName,
        },
      },
      link.shortUrl,
    );

    return {
      paymentLink: record,
      purchaseOrder: order,
      quote,
      shortUrl: link.shortUrl,
    };
  }

  async list(take = 50) {
    return this.db.paymentLinkRecord.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        purchaseOrder: {
          include: { invoices: true },
        },
      },
    });
  }

  async notify(id: string, medium: 'email' | 'sms' = 'email') {
    const record = await this.db.paymentLinkRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Payment link not found');
    if (record.cancelledAt) throw new BadRequestException('Payment link is cancelled');
    const gateway = this.gatewayFactory.getGateway();
    await gateway.notifyPaymentLink(record.providerLinkId, medium);
    return { success: true, id, medium };
  }

  async cancel(id: string) {
    const record = await this.db.paymentLinkRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Payment link not found');
    if (record.cancelledAt) return record;
    const gateway = this.gatewayFactory.getGateway();
    try {
      await gateway.cancelPaymentLink(record.providerLinkId);
    } catch {
      // still mark cancelled locally
    }
    const updated = await this.db.paymentLinkRecord.update({
      where: { id },
      data: { cancelledAt: new Date() },
    });
    await this.db.purchaseOrder.updateMany({
      where: {
        id: record.purchaseOrderId,
        status: PurchaseOrderStatus.AWAITING_PAYMENT,
      },
      data: { status: PurchaseOrderStatus.CANCELLED },
    });
    return updated;
  }

  /**
   * Future: pay-first / claim-later links (userId null + claimToken).
   * Schema already supports claimToken; product flow is not enabled in v1.
   */
  async createClaimLaterLink(_params: unknown): Promise<never> {
    throw new BadRequestException(
      'Claim-later payment links are not implemented yet (schema hooks exist via claimToken)',
    );
  }
}
