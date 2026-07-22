import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingAudience,
  PaymentAttemptStatus,
  PaymentProvider,
  PurchaseOrderStatus,
  PurchaseSource,
} from '@prisma/client';
import { BillingEmailService } from '../billing-emails/billing-email.service';
import { DatabaseService } from '../common/database/database.service';
import { PricingEngine } from '../billing/pricing.engine';
import { BillingQuote, QuoteInputMode } from '../billing/pricing.types';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { PaymentGatewayFactory } from '../payments/gateway/payment-gateway.factory';
import { RazorpayGateway } from '../payments/gateway/razorpay.gateway';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pricingEngine: PricingEngine,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly razorpay: RazorpayGateway,
    private readonly fulfillment: FulfillmentService,
    private readonly billingEmail: BillingEmailService,
  ) {}

  async createCheckoutOrder(params: {
    userId: string;
    audience: BillingAudience;
    packageId?: string;
    inputMode?: QuoteInputMode;
    amountPaise?: number;
    creditsDesired?: number;
    discountCode?: string;
    customerEmail?: string;
    customerName?: string;
  }) {
    if (!params.userId) throw new BadRequestException('userId is required');

    let quote: BillingQuote;
    let source: PurchaseSource;
    if (params.packageId) {
      quote = await this.pricingEngine.quotePackage({
        packageId: params.packageId,
        userId: params.userId,
        audience: params.audience,
        discountCode: params.discountCode,
      });
      source = PurchaseSource.PACKAGE;
    } else {
      quote = await this.pricingEngine.quoteCustom({
        audience: params.audience,
        userId: params.userId,
        inputMode: params.inputMode || 'AMOUNT',
        amountPaise: params.amountPaise,
        creditsDesired: params.creditsDesired,
        discountCode: params.discountCode,
      });
      source = PurchaseSource.CUSTOM;
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
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
    const providerOrder = await gateway.createCheckoutOrder({
      amountPaise: order.totalChargePaise,
      currency: order.currency,
      receipt: order.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40),
      notes: {
        purchaseOrderId: order.id,
        userId: params.userId,
        audience: order.audience,
        email: params.customerEmail || '',
      },
    });

    await this.db.paymentAttempt.create({
      data: {
        purchaseOrderId: order.id,
        provider: PaymentProvider.RAZORPAY,
        providerOrderId: providerOrder.providerOrderId,
        amountPaise: order.totalChargePaise,
        currency: order.currency,
        status: PaymentAttemptStatus.CREATED,
        rawPayload: providerOrder.raw as any,
      },
    });

    return {
      purchaseOrderId: order.id,
      quote,
      amountPaise: order.totalChargePaise,
      currency: order.currency,
      creditsToGrant: order.creditsToGrant,
      provider: 'razorpay',
      razorpayOrderId: providerOrder.providerOrderId,
      razorpayKeyId: this.razorpay.getPublicKeyId(),
      expiresAt: order.expiresAt,
    };
  }

  async verifyAndFulfill(params: {
    userId: string;
    purchaseOrderId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }) {
    const order = await this.db.purchaseOrder.findUnique({ where: { id: params.purchaseOrderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== params.userId) {
      throw new BadRequestException('Order does not belong to user');
    }
    return this.fulfillment.fulfillFromCheckoutVerify({
      purchaseOrderId: params.purchaseOrderId,
      providerOrderId: params.razorpayOrderId,
      providerPaymentId: params.razorpayPaymentId,
      signature: params.razorpaySignature,
    });
  }

  async getOrder(purchaseOrderId: string, userId?: string) {
    const order = await this.db.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        paymentAttempts: { orderBy: { createdAt: 'desc' } },
        invoices: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (userId && order.userId && order.userId !== userId) {
      throw new BadRequestException('Order does not belong to user');
    }
    return order;
  }

  async listUserOrders(userId: string, take = 50) {
    return this.db.purchaseOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { invoices: true },
    });
  }

  /** Email a complete-payment link when the user abandons checkout. */
  async sendIncompleteReminder(purchaseOrderId: string, userId: string) {
    const order = await this.db.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) {
      throw new BadRequestException('Order does not belong to user');
    }
    if (order.status !== PurchaseOrderStatus.AWAITING_PAYMENT) {
      return { sent: false, reason: 'not_awaiting_payment' };
    }
    void this.billingEmail.sendIncompletePayment(order);
    return { sent: true };
  }
}
