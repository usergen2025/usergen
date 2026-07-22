import { Injectable, Logger } from '@nestjs/common';
import { Invoice, PurchaseOrder } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';
import { PricingEngine } from '../billing/pricing.engine';
import { PaymentGatewayFactory } from '../payments/gateway/payment-gateway.factory';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly pricingEngine: PricingEngine,
    private readonly gatewayFactory: PaymentGatewayFactory,
  ) {}

  async issueForOrder(order: PurchaseOrder, buyerGstin?: string | null) {
    const existing = await this.db.invoice.findFirst({
      where: { purchaseOrderId: order.id },
    });
    if (existing) return existing;

    const settings = await this.pricingEngine.ensureSettings();
    const invoiceNumber = await this.allocateInvoiceNumber(settings.id, settings.invoicePrefix);

    const lineItems = [
      { code: 'BASE', label: 'Credit top-up', amountPaise: order.baseAmountPaise },
      { code: 'PLATFORM_FEE', label: 'Platform fee (informational)', amountPaise: order.feeAmountPaise },
      { code: 'DISCOUNT', label: 'Discount', amountPaise: order.discountAmountPaise },
      {
        code: 'GST',
        label: `GST (${(order.gstRateBpsApplied / 100).toFixed(2)}%)`,
        amountPaise: order.gstAmountPaise,
      },
      { code: 'TOTAL', label: 'Total charged', amountPaise: order.totalChargePaise },
      { code: 'CREDITS', label: 'Credits granted', amountPaise: order.creditsToGrant * 100 },
    ];

    // Local tax invoice only. We do NOT create Razorpay Invoices after Checkout —
    // Razorpay Invoices are payment requests and always show "Proceed to Pay".
    return this.db.invoice.create({
      data: {
        invoiceNumber,
        purchaseOrderId: order.id,
        userId: order.userId,
        currency: order.currency,
        baseAmountPaise: order.baseAmountPaise,
        feeAmountPaise: order.feeAmountPaise,
        discountAmountPaise: order.discountAmountPaise,
        gstAmountPaise: order.gstAmountPaise,
        gstRateBps: order.gstRateBpsApplied,
        totalChargePaise: order.totalChargePaise,
        creditsGranted: order.creditsToGrant,
        platformGstin: settings.platformGstin,
        buyerGstin: buyerGstin ?? null,
        platformLegalName: settings.platformLegalName,
        lineItems,
      },
    });
  }

  /**
   * @deprecated Razorpay Invoices are payment-collection docs, not receipts.
   * Kept for admin backfill / cancel of older mistaken invoices only.
   */
  async attachProviderInvoice(invoice: Invoice, order: PurchaseOrder): Promise<Invoice> {
    if (invoice.providerInvoiceId) return invoice;

    const snap = (order.quoteSnapshot || {}) as Record<string, any>;
    let email = snap.buyerEmail as string | undefined;
    let name = snap.buyerName as string | undefined;

    if (!email) {
      const link = await this.db.paymentLinkRecord.findFirst({
        where: { purchaseOrderId: order.id },
        orderBy: { createdAt: 'desc' },
      });
      email = link?.customerEmail || undefined;
      name = name || link?.customerName || undefined;
    }

    if (!email) {
      const attempt = await this.db.paymentAttempt.findFirst({
        where: { purchaseOrderId: order.id },
        orderBy: { createdAt: 'desc' },
      });
      const raw = (attempt?.rawPayload || {}) as any;
      email = raw?.email || raw?.customer?.email;
    }

    if (!email) {
      this.logger.warn(
        `Skip Razorpay invoice for ${invoice.invoiceNumber}: no customer email on order ${order.id}`,
      );
      return invoice;
    }

    const paymentAttempt = await this.db.paymentAttempt.findFirst({
      where: { purchaseOrderId: order.id },
      orderBy: { createdAt: 'desc' },
    });

    const gateway = this.gatewayFactory.getGateway(order.provider.toLowerCase());
    const gstLabel = `GST (${(order.gstRateBpsApplied / 100).toFixed(2)}%)`;
    const payload = {
      receipt: invoice.invoiceNumber.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40),
      description: `UserGen credit top-up — ${order.creditsToGrant} credits (PAID · ${invoice.invoiceNumber})`,
      currency: order.currency || 'INR',
      customer: {
        email,
        name: name || email.split('@')[0],
        gstin: invoice.buyerGstin || undefined,
      },
      lineItems: [
        {
          name: 'Credit top-up',
          description: `${order.creditsToGrant} credits · platform fee ₹${(order.feeAmountPaise / 100).toFixed(2)} (informational)`,
          amountPaise: order.baseAmountPaise,
        },
        ...(order.gstAmountPaise > 0
          ? [
              {
                name: gstLabel,
                description: 'GST on top-up amount',
                amountPaise: order.gstAmountPaise,
              },
            ]
          : []),
      ],
      notes: {
        purchaseOrderId: order.id,
        localInvoiceNumber: invoice.invoiceNumber,
        providerPaymentId: paymentAttempt?.providerPaymentId || '',
        creditsGranted: String(order.creditsToGrant),
        alreadyPaid: 'true',
      },
      emailNotify: true,
      smsNotify: false,
      // Razorpay requires ≥ 15 minutes (use 20m for clock skew)
      expireByUnix: Math.floor(Date.now() / 1000) + 20 * 60,
    };

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const providerInvoice = await gateway.createAndIssueInvoice(payload);
        return this.db.invoice.update({
          where: { id: invoice.id },
          data: {
            providerInvoiceId: providerInvoice.providerInvoiceId,
            providerInvoiceNumber: providerInvoice.invoiceNumber || null,
            providerInvoiceUrl: providerInvoice.shortUrl || null,
            providerInvoiceStatus: providerInvoice.status || null,
            providerPayload: providerInvoice.raw as any,
          },
        });
      } catch (err: any) {
        const msg = String(err?.message || '');
        const rateLimited = /too many requests/i.test(msg);
        this.logger.error(
          `Razorpay invoice attach failed for ${invoice.invoiceNumber} (attempt ${attempt}): ${msg}`,
        );
        if (rateLimited && attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 2500));
          continue;
        }
        return invoice;
      }
    }
    return invoice;
  }

  async getById(id: string) {
    return this.db.invoice.findUnique({ where: { id } });
  }

  async getByOrderId(purchaseOrderId: string) {
    return this.db.invoice.findFirst({ where: { purchaseOrderId } });
  }

  async listForUser(userId: string, take = 50) {
    return this.db.invoice.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
      take,
    });
  }

  /**
   * @deprecated Do not create Razorpay invoices after Checkout — they show Pay.
   * Kept as a no-op so older admin callers do not recreate payable invoices.
   */
  async backfillMissingProviderInvoices(_take = 50) {
    return {
      scanned: 0,
      attached: 0,
      results: [] as Array<{ invoiceId: string; ok: boolean; url?: string; error?: string }>,
      message:
        'Razorpay post-payment invoices disabled. Use /billing/invoice/:id for paid tax invoices.',
    };
  }

  /** Cancel previously issued Razorpay invoices so customers cannot pay twice. */
  async cancelIssuedProviderInvoices(take = 50) {
    const rows = await this.db.invoice.findMany({
      where: {
        providerInvoiceId: { not: null },
        OR: [
          { providerInvoiceStatus: null },
          { providerInvoiceStatus: { notIn: ['cancelled', 'paid'] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 100),
    });

    const gateway = this.gatewayFactory.getGateway();
    const results: Array<{ invoiceId: string; providerInvoiceId: string; ok: boolean; error?: string }> =
      [];

    for (const row of rows) {
      const providerInvoiceId = row.providerInvoiceId!;
      try {
        await gateway.cancelInvoice(providerInvoiceId);
        await this.db.invoice.update({
          where: { id: row.id },
          data: { providerInvoiceStatus: 'cancelled' },
        });
        results.push({ invoiceId: row.id, providerInvoiceId, ok: true });
        await new Promise((r) => setTimeout(r, 800));
      } catch (err: any) {
        const msg = err?.response?.data?.error?.description || err?.message || 'failed';
        // Already cancelled / expired is fine
        if (/cancel|expired|already/i.test(msg)) {
          await this.db.invoice.update({
            where: { id: row.id },
            data: { providerInvoiceStatus: 'cancelled' },
          });
          results.push({ invoiceId: row.id, providerInvoiceId, ok: true, error: msg });
        } else {
          results.push({ invoiceId: row.id, providerInvoiceId, ok: false, error: msg });
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    return {
      scanned: rows.length,
      cancelled: results.filter((r) => r.ok).length,
      results,
    };
  }

  private async allocateInvoiceNumber(settingsId: string, prefix: string): Promise<string> {
    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.billingSettings.update({
        where: { id: settingsId },
        data: { invoiceNextNumber: { increment: 1 } },
      });
      const n = row.invoiceNextNumber - 1;
      return `${prefix}-${String(n).padStart(6, '0')}`;
    });
    return updated;
  }
}
