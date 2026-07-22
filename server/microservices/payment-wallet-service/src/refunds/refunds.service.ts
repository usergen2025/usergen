import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PaymentAttemptStatus,
  PurchaseOrderStatus,
  RefundStatus,
} from '@prisma/client';
import { BillingEmailService } from '../billing-emails/billing-email.service';
import { DatabaseService } from '../common/database/database.service';
import { PaymentGatewayFactory } from '../payments/gateway/payment-gateway.factory';
import { TransactionsService } from '../transactions/transactions.service';

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly transactions: TransactionsService,
    private readonly billingEmail: BillingEmailService,
  ) {}

  async list(take = 50) {
    return this.db.refundRecord.findMany({
      take: Math.min(take, 200),
      orderBy: { createdAt: 'desc' },
      include: {
        purchaseOrder: {
          include: { invoices: true },
        },
      },
    });
  }

  async createAdminRefund(params: {
    purchaseOrderId: string;
    adminUserId: string;
    amountPaise?: number;
    reason?: string;
  }) {
    if (!params.adminUserId) throw new BadRequestException('adminUserId is required');

    const order = await this.db.purchaseOrder.findUnique({
      where: { id: params.purchaseOrderId },
      include: {
        paymentAttempts: {
          where: { status: PaymentAttemptStatus.CAPTURED },
          orderBy: { createdAt: 'desc' },
        },
        refunds: true,
      },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (!order.userId) throw new BadRequestException('Order has no user to claw back from');
    if (
      order.status !== PurchaseOrderStatus.FULFILLED &&
      order.status !== PurchaseOrderStatus.PARTIALLY_REFUNDED &&
      order.status !== PurchaseOrderStatus.PAID
    ) {
      throw new BadRequestException(`Cannot refund order in status ${order.status}`);
    }

    const attempt = order.paymentAttempts[0];
    if (!attempt?.providerPaymentId) {
      throw new BadRequestException('No captured payment found for this order');
    }

    const alreadyRefundedPaise = order.refunds
      .filter((r) => r.status === RefundStatus.PROCESSED || r.status === RefundStatus.PENDING)
      .reduce((sum, r) => sum + r.amountPaise, 0);
    const maxRefundable = order.totalChargePaise - alreadyRefundedPaise;
    if (maxRefundable <= 0) {
      throw new BadRequestException('Order is already fully refunded');
    }

    const amountPaise = params.amountPaise ?? maxRefundable;
    if (amountPaise <= 0 || amountPaise > maxRefundable) {
      throw new BadRequestException(`amountPaise must be between 1 and ${maxRefundable}`);
    }

    const creditsAlreadyClawed = order.refunds.reduce((sum, r) => sum + r.creditsClawedBack, 0);
    const creditsTarget = Math.min(
      order.creditsToGrant - creditsAlreadyClawed,
      Math.round((amountPaise / order.totalChargePaise) * order.creditsToGrant),
    );

    await this.db.purchaseOrder.update({
      where: { id: order.id },
      data: { status: PurchaseOrderStatus.REFUND_PENDING },
    });

    const refundRow = await this.db.refundRecord.create({
      data: {
        purchaseOrderId: order.id,
        provider: order.provider,
        providerPaymentId: attempt.providerPaymentId,
        amountPaise,
        creditsToClawBack: Math.max(0, creditsTarget),
        status: RefundStatus.PENDING,
        reason: params.reason,
        adminUserId: params.adminUserId,
      },
    });

    const gateway = this.gatewayFactory.getGateway(order.provider.toLowerCase());
    let providerRefund;
    try {
      providerRefund = await gateway.createRefund({
        providerPaymentId: attempt.providerPaymentId,
        amountPaise,
        notes: {
          purchaseOrderId: order.id,
          refundRecordId: refundRow.id,
          adminUserId: params.adminUserId,
        },
      });
    } catch (err: any) {
      await this.db.refundRecord.update({
        where: { id: refundRow.id },
        data: {
          status: RefundStatus.FAILED,
          rawPayload: { error: err?.message } as any,
        },
      });
      await this.db.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status:
            alreadyRefundedPaise > 0
              ? PurchaseOrderStatus.PARTIALLY_REFUNDED
              : PurchaseOrderStatus.FULFILLED,
        },
      });
      throw new BadRequestException(err?.message || 'Gateway refund failed');
    }

    const clawback = await this.transactions.clawbackCredits({
      userId: order.userId,
      amount: refundRow.creditsToClawBack,
      description: `Refund clawback for order ${order.id.slice(0, 8)}`,
      metadata: {
        purchaseOrderId: order.id,
        refundRecordId: refundRow.id,
        providerRefundId: providerRefund.providerRefundId,
      },
      idempotencyKey: `refund-clawback:${refundRow.id}`,
    });

    const isFull = amountPaise + alreadyRefundedPaise >= order.totalChargePaise;
    const updated = await this.db.refundRecord.update({
      where: { id: refundRow.id },
      data: {
        providerRefundId: providerRefund.providerRefundId,
        creditsClawedBack: clawback.clawedBack,
        shortfallCredits: clawback.shortfall,
        status: RefundStatus.PROCESSED,
        rawPayload: providerRefund.raw as any,
      },
    });

    const updatedOrder = await this.db.purchaseOrder.update({
      where: { id: order.id },
      data: {
        status: isFull
          ? PurchaseOrderStatus.REFUNDED
          : PurchaseOrderStatus.PARTIALLY_REFUNDED,
      },
    });

    this.logger.log(
      `Refund ${updated.id}: ₹${amountPaise / 100}, clawed ${clawback.clawedBack} credits (shortfall ${clawback.shortfall})`,
    );

    void this.billingEmail.sendRefundProcessed(updatedOrder, updated, {
      clawedBack: clawback.clawedBack,
      shortfall: clawback.shortfall,
    });

    return {
      refund: updated,
      clawback,
      orderStatus: isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    };
  }

  async markProcessedFromWebhook(params: {
    providerRefundId?: string;
    providerPaymentId?: string;
    amountPaise?: number;
  }) {
    if (!params.providerRefundId && !params.providerPaymentId) return null;

    const existing = params.providerRefundId
      ? await this.db.refundRecord.findUnique({
          where: { providerRefundId: params.providerRefundId },
        })
      : await this.db.refundRecord.findFirst({
          where: {
            providerPaymentId: params.providerPaymentId,
            status: RefundStatus.PENDING,
          },
          orderBy: { createdAt: 'desc' },
        });

    if (!existing) return null;
    if (existing.status === RefundStatus.PROCESSED) return existing;

    return this.db.refundRecord.update({
      where: { id: existing.id },
      data: { status: RefundStatus.PROCESSED },
    });
  }
}
