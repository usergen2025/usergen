import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider, PurchaseOrderStatus } from '@prisma/client';
import { BillingEmailService } from '../billing-emails/billing-email.service';
import { DatabaseService } from '../common/database/database.service';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { PaymentGatewayFactory } from '../payments/gateway/payment-gateway.factory';
import { RefundsService } from '../refunds/refunds.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly fulfillment: FulfillmentService,
    private readonly refunds: RefundsService,
    private readonly billingEmail: BillingEmailService,
  ) {}

  async handleRazorpay(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const gateway = this.gatewayFactory.getGateway('razorpay');
    const event = await gateway.parseAndVerifyWebhook(rawBody, headers);

    const existing = await this.db.webhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: PaymentProvider.RAZORPAY,
          providerEventId: event.providerEventId,
        },
      },
    });
    if (existing?.processedAt) {
      return { ok: true, duplicate: true };
    }

    const webhookRow = existing
      || (await this.db.webhookEvent.create({
        data: {
          provider: PaymentProvider.RAZORPAY,
          providerEventId: event.providerEventId,
          eventType: event.type,
          payload: event.raw as any,
        },
      }));

    try {
      if (event.type === 'CHECKOUT_PAID' || event.type === 'PAYMENT_LINK_PAID') {
        if (!event.providerPaymentId) {
          throw new Error('Webhook missing providerPaymentId');
        }

        let purchaseOrderId: string | undefined;
        const notes = (event.raw as any)?.payload?.payment?.entity?.notes
          || (event.raw as any)?.payload?.payment_link?.entity?.notes;
        if (notes?.purchaseOrderId) purchaseOrderId = notes.purchaseOrderId;

        if (!purchaseOrderId && event.providerPaymentLinkId) {
          const link = await this.db.paymentLinkRecord.findUnique({
            where: { providerLinkId: event.providerPaymentLinkId },
          });
          purchaseOrderId = link?.purchaseOrderId;
        }

        await this.fulfillment.fulfillByProviderPayment({
          providerPaymentId: event.providerPaymentId,
          providerOrderId: event.providerOrderId,
          purchaseOrderId,
          expectedAmountPaise: event.amountPaise,
        });
      } else if (event.type === 'PAYMENT_FAILED') {
        const notes = (event.raw as any)?.payload?.payment?.entity?.notes;
        const purchaseOrderId = notes?.purchaseOrderId;
        if (purchaseOrderId) {
          await this.db.purchaseOrder.updateMany({
            where: {
              id: purchaseOrderId,
              status: PurchaseOrderStatus.AWAITING_PAYMENT,
            },
            data: { status: PurchaseOrderStatus.FAILED },
          });
          const failedOrder = await this.db.purchaseOrder.findUnique({
            where: { id: purchaseOrderId },
          });
          if (failedOrder) {
            void this.billingEmail.sendPaymentFailed(failedOrder);
          }
        }
      } else if (event.type === 'REFUND_PROCESSED') {
        const refundEntity = (event.raw as any)?.payload?.refund?.entity;
        await this.refunds.markProcessedFromWebhook({
          providerRefundId: refundEntity?.id,
          providerPaymentId: refundEntity?.payment_id || event.providerPaymentId,
          amountPaise: refundEntity?.amount ?? event.amountPaise,
        });
      }

      await this.db.webhookEvent.update({
        where: { id: webhookRow.id },
        data: { processedAt: new Date(), error: null },
      });
      return { ok: true, type: event.type };
    } catch (err: any) {
      this.logger.error(`Webhook processing failed: ${err?.message}`, err?.stack);
      await this.db.webhookEvent.update({
        where: { id: webhookRow.id },
        data: { error: err?.message || 'processing failed' },
      });
      throw err;
    }
  }
}
