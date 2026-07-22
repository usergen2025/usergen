import { Injectable } from '@nestjs/common';
import { PaymentAttemptStatus, PurchaseOrderStatus, TransactionType } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';

@Injectable()
export class ReconciliationService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Lightweight reconciliation report for recent fulfilled / refunded orders.
   */
  async run(params?: { take?: number }) {
    const take = Math.min(params?.take ?? 50, 200);
    const orders = await this.db.purchaseOrder.findMany({
      where: {
        status: {
          in: [
            PurchaseOrderStatus.FULFILLED,
            PurchaseOrderStatus.REFUNDED,
            PurchaseOrderStatus.PARTIALLY_REFUNDED,
            PurchaseOrderStatus.REFUND_PENDING,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        paymentAttempts: true,
        invoices: true,
        refunds: true,
      },
    });

    const issues: Array<{
      orderId: string;
      severity: 'error' | 'warn';
      code: string;
      message: string;
    }> = [];

    let matched = 0;

    for (const order of orders) {
      const captured = order.paymentAttempts.find(
        (a) => a.status === PaymentAttemptStatus.CAPTURED && a.providerPaymentId,
      );
      const invoice = order.invoices[0];

      if (!captured) {
        issues.push({
          orderId: order.id,
          severity: 'error',
          code: 'MISSING_CAPTURE',
          message: 'Fulfilled/refunded order has no captured payment attempt',
        });
        continue;
      }

      if (captured.amountPaise !== order.totalChargePaise) {
        issues.push({
          orderId: order.id,
          severity: 'error',
          code: 'AMOUNT_MISMATCH',
          message: `Payment ${captured.amountPaise} ≠ order ${order.totalChargePaise}`,
        });
      }

      if (!invoice) {
        issues.push({
          orderId: order.id,
          severity: 'warn',
          code: 'MISSING_INVOICE',
          message: 'No invoice issued for order',
        });
      } else if (invoice.totalChargePaise !== order.totalChargePaise) {
        issues.push({
          orderId: order.id,
          severity: 'error',
          code: 'INVOICE_MISMATCH',
          message: `Invoice ${invoice.totalChargePaise} ≠ order ${order.totalChargePaise}`,
        });
      }

      if (order.userId && order.status === PurchaseOrderStatus.FULFILLED) {
        const purchased = await this.db.transaction.findFirst({
          where: {
            userId: order.userId,
            type: TransactionType.PURCHASED,
            amount: order.creditsToGrant,
            metadata: {
              path: ['purchaseOrderId'],
              equals: order.id,
            },
          },
        });
        if (!purchased) {
          // Fallback: metadata filter may be dialect-sensitive; soft warn
          issues.push({
            orderId: order.id,
            severity: 'warn',
            code: 'PURCHASE_TX_NOT_FOUND',
            message: 'Could not locate PURCHASED transaction via metadata',
          });
        }
      }

      if (
        issues.filter((i) => i.orderId === order.id && i.severity === 'error').length === 0
      ) {
        matched += 1;
      }
    }

    return {
      scanned: orders.length,
      matched,
      issueCount: issues.length,
      issues,
      generatedAt: new Date().toISOString(),
    };
  }
}
