import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PaymentAttemptStatus, PurchaseOrderStatus, TransactionType } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';
import { BillingEmailService } from '../billing-emails/billing-email.service';
import { InvoiceService } from '../invoices/invoice.service';
import { TransactionsService } from '../transactions/transactions.service';
import { PaymentGatewayFactory } from '../payments/gateway/payment-gateway.factory';

@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly transactions: TransactionsService,
    private readonly invoices: InvoiceService,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly billingEmail: BillingEmailService,
  ) {}

  /**
   * Idempotent fulfillment: grant PURCHASED credits + issue invoice.
   */
  async fulfillByProviderPayment(params: {
    providerPaymentId: string;
    providerOrderId?: string;
    purchaseOrderId?: string;
    expectedAmountPaise?: number;
  }) {
    const { providerPaymentId } = params;
    if (!providerPaymentId) {
      throw new BadRequestException('providerPaymentId required');
    }

    const existingAttempt = await this.db.paymentAttempt.findUnique({
      where: { providerPaymentId },
      include: { purchaseOrder: true },
    });

    let order = existingAttempt?.purchaseOrder;
    if (!order && params.purchaseOrderId) {
      order = await this.db.purchaseOrder.findUnique({ where: { id: params.purchaseOrderId } });
    }
    if (!order && params.providerOrderId) {
      const byOrder = await this.db.paymentAttempt.findFirst({
        where: { providerOrderId: params.providerOrderId },
        include: { purchaseOrder: true },
        orderBy: { createdAt: 'desc' },
      });
      order = byOrder?.purchaseOrder;
    }

    if (!order) {
      throw new BadRequestException('Purchase order not found for payment');
    }

    if (order.status === PurchaseOrderStatus.FULFILLED) {
      const invoice = await this.invoices.getByOrderId(order.id);
      return { alreadyFulfilled: true, order, invoice };
    }

    if (!order.userId) {
      throw new BadRequestException('Purchase order has no userId (claim-later not supported yet)');
    }

    const gateway = this.gatewayFactory.getGateway(order.provider.toLowerCase());
    const payment = await gateway.fetchPayment(providerPaymentId);
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      throw new BadRequestException(`Payment not capturable: ${payment.status}`);
    }
    if (payment.amountPaise !== order.totalChargePaise) {
      this.logger.error(
        `Amount mismatch payment=${payment.amountPaise} order=${order.totalChargePaise} orderId=${order.id}`,
      );
      throw new BadRequestException('Payment amount does not match order');
    }

    await this.db.paymentAttempt.upsert({
      where: { providerPaymentId },
      create: {
        purchaseOrderId: order.id,
        provider: order.provider,
        providerOrderId: payment.providerOrderId || params.providerOrderId,
        providerPaymentId,
        amountPaise: payment.amountPaise,
        currency: payment.currency,
        status: PaymentAttemptStatus.CAPTURED,
        rawPayload: payment.raw as any,
      },
      update: {
        status: PaymentAttemptStatus.CAPTURED,
        providerOrderId: payment.providerOrderId || params.providerOrderId,
        rawPayload: payment.raw as any,
      },
    });

    // Mark paid then fulfill credits in sequence (credits service has its own writes)
    await this.db.purchaseOrder.update({
      where: { id: order.id },
      data: { status: PurchaseOrderStatus.PAID },
    });

    const creditResult = await this.transactions.addCredits({
      userId: order.userId,
      amount: order.creditsToGrant,
      type: TransactionType.PURCHASED,
      description: `Credit top-up (${order.creditsToGrant} credits)`,
      metadata: {
        purchaseOrderId: order.id,
        providerPaymentId,
        providerOrderId: payment.providerOrderId,
        baseAmountPaise: order.baseAmountPaise,
        feeAmountPaise: order.feeAmountPaise,
        gstAmountPaise: order.gstAmountPaise,
        totalChargePaise: order.totalChargePaise,
      },
      idempotencyKey: `purchase-fulfill:${order.id}`,
    });

    const fulfilled = await this.db.purchaseOrder.update({
      where: { id: order.id },
      data: {
        status: PurchaseOrderStatus.FULFILLED,
        fulfilledAt: new Date(),
      },
    });

    const invoice = await this.invoices.issueForOrder(fulfilled);

    this.logger.log(
      `Fulfilled order ${order.id}: +${order.creditsToGrant} credits, invoice ${invoice.invoiceNumber}`,
    );

    // Fire-and-forget receipt + invoice email
    void this.billingEmail.sendPaymentSuccess(fulfilled, invoice);

    return {
      alreadyFulfilled: false,
      order: fulfilled,
      invoice,
      creditResult,
    };
  }

  async fulfillFromCheckoutVerify(params: {
    purchaseOrderId: string;
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }) {
    const order = await this.db.purchaseOrder.findUnique({ where: { id: params.purchaseOrderId } });
    if (!order) throw new BadRequestException('Order not found');

    const gateway = this.gatewayFactory.getGateway(order.provider.toLowerCase());
    const ok = await gateway.verifyCheckoutSignature({
      providerOrderId: params.providerOrderId,
      providerPaymentId: params.providerPaymentId,
      signature: params.signature,
    });
    if (!ok) throw new BadRequestException('Invalid payment signature');

    // Prefer webhook for authority; verify path still fulfills for UX if webhook is slow
    return this.fulfillByProviderPayment({
      providerPaymentId: params.providerPaymentId,
      providerOrderId: params.providerOrderId,
      purchaseOrderId: params.purchaseOrderId,
    });
  }
}
