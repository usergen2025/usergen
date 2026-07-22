import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PurchaseOrder, Invoice, RefundRecord } from '@prisma/client';
import axios from 'axios';
import { DatabaseService } from '../common/database/database.service';

@Injectable()
export class BillingEmailService {
  private readonly logger = new Logger(BillingEmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {}

  private notificationUrl() {
    const base =
      this.config.get<string>('NOTIFICATION_SERVICE_URL') || 'http://localhost:9006/api';
    return base.replace(/\/$/, '');
  }

  private appUrl() {
    return (this.config.get<string>('APP_URL') || 'http://localhost:3200').replace(/\/$/, '');
  }

  private authUrl() {
    return (this.config.get<string>('AUTH_SERVICE_URL') || 'http://localhost:9000').replace(
      /\/$/,
      '',
    );
  }

  private paiseToInr(paise: number) {
    return (paise / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private wrapHtml(title: string, bodyHtml: string) {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#faf8f5;color:#212121;">
  <div style="background:linear-gradient(135deg,#E86412,#F12A4C);padding:24px;border-radius:12px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;">${title}</h1>
  </div>
  <div style="padding:28px 16px;background:#fff;border-radius:0 0 12px 12px;border:1px solid #E8E2DB;border-top:none;">
    ${bodyHtml}
  </div>
  <div style="padding-top:16px;text-align:center;color:#9E9E9E;font-size:12px;">
    <p>UserGen.ai — Payments &amp; Billing</p>
  </div>
</body></html>`;
  }

  async sendEmail(to: string, subject: string, html: string, text: string) {
    if (!to) {
      this.logger.warn(`Skip email "${subject}" — no recipient`);
      return;
    }
    try {
      await axios.post(
        `${this.notificationUrl()}/notifications/send-email`,
        { to, subject, html, text },
        { timeout: 30000 },
      );
      this.logger.log(`Billing email sent to ${to}: ${subject}`);
    } catch (err: any) {
      this.logger.error(`Failed billing email to ${to}: ${err?.message}`);
    }
  }

  async resolveRecipient(order: PurchaseOrder): Promise<{ email?: string; name?: string }> {
    const snap = (order.quoteSnapshot || {}) as Record<string, any>;
    if (snap.buyerEmail) {
      return { email: snap.buyerEmail, name: snap.buyerName };
    }

    const link = await this.db.paymentLinkRecord.findFirst({
      where: { purchaseOrderId: order.id },
      orderBy: { createdAt: 'desc' },
    });
    if (link?.customerEmail) {
      return { email: link.customerEmail, name: link.customerName || undefined };
    }

    const attempt = await this.db.paymentAttempt.findFirst({
      where: { purchaseOrderId: order.id },
      orderBy: { createdAt: 'desc' },
    });
    const raw = (attempt?.rawPayload || {}) as any;
    const rzEmail = raw?.email || raw?.customer?.email || raw?.notes?.email;
    if (rzEmail) return { email: rzEmail };

    if (order.userId) {
      try {
        const { data } = await axios.get(
          `${this.authUrl()}/api/admin/users/batch?ids=${encodeURIComponent(order.userId)}`,
          {
            timeout: 8000,
            headers: { 'x-service-request': 'true' },
          },
        );
        const users = data?.data || data || [];
        const u = Array.isArray(users) ? users[0] : null;
        if (u?.email) return { email: u.email, name: u.name || undefined };
      } catch {
        // Auth batch may require admin JWT — ignore for background emails
      }
    }

    return {};
  }

  private billingPath(audience: string) {
    return audience === 'BRAND' ? '/brand/wallet' : '/billing?action=add';
  }

  async sendPaymentSuccess(order: PurchaseOrder, invoice: Invoice | null) {
    const { email, name } = await this.resolveRecipient(order);
    if (!email) return;

    const invoiceLabel =
      invoice?.providerInvoiceNumber || invoice?.invoiceNumber || 'Invoice';
    const invoiceViewUrl = invoice?.id
      ? `${this.appUrl()}/billing/invoice/${invoice.id}`
      : null;
    const invoiceBlock = invoice
      ? `<p><strong>Invoice:</strong> ${invoiceLabel} <span style="color:#2e7d32;font-weight:600;">(PAID)</span></p>
         ${
           invoiceViewUrl
             ? `<p style="margin-top:20px;text-align:center;">
                  <a href="${invoiceViewUrl}"
                     style="display:inline-block;background:#212121;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
                    View / download invoice
                  </a>
                </p>
                <p style="font-size:13px;color:#616161;text-align:center;">
                  Sign in to view your tax invoice. Use Print → Save as PDF to download.
                </p>`
             : ''
         }`
      : '';
    const subject = `Payment successful — ${invoiceLabel}`;
    const html = this.wrapHtml(
      'Payment successful',
      `<p>Hi ${name || 'there'},</p>
       <p>Your credit top-up was successful.</p>
       <ul>
         <li><strong>Order:</strong> ${order.id.slice(0, 10)}…</li>
         <li><strong>Amount paid:</strong> ₹${this.paiseToInr(order.totalChargePaise)}</li>
         <li><strong>Credits added:</strong> ${order.creditsToGrant.toLocaleString('en-IN')}</li>
         <li><strong>Base:</strong> ₹${this.paiseToInr(order.baseAmountPaise)}</li>
         <li><strong>GST:</strong> ₹${this.paiseToInr(order.gstAmountPaise)}</li>
       </ul>
       ${invoiceBlock}
       <p style="margin-top:24px;text-align:center;">
         <a href="${this.appUrl()}${this.billingPath(order.audience)}"
            style="display:inline-block;background:linear-gradient(135deg,#E86412,#F12A4C);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
           View billing
         </a>
       </p>`,
    );
    const text = [
      'Payment successful.',
      `Amount: ₹${this.paiseToInr(order.totalChargePaise)}`,
      `Credits: ${order.creditsToGrant}`,
      `Invoice: ${invoiceLabel} (PAID)`,
      invoiceViewUrl ? `View invoice: ${invoiceViewUrl}` : '',
      `${this.appUrl()}${this.billingPath(order.audience)}`,
    ]
      .filter(Boolean)
      .join('\n');
    await this.sendEmail(email, subject, html, text);
  }

  async sendPaymentFailed(order: PurchaseOrder) {
    const { email, name } = await this.resolveRecipient(order);
    if (!email) return;

    const completeUrl = `${this.appUrl()}${this.billingPath(order.audience)}`;
    const subject = 'Payment failed — complete your UserGen top-up';
    const html = this.wrapHtml(
      'Payment failed',
      `<p>Hi ${name || 'there'},</p>
       <p>We couldn't complete your payment for order <strong>${order.id.slice(0, 10)}…</strong>.</p>
       <p>Amount attempted: <strong>₹${this.paiseToInr(order.totalChargePaise)}</strong> for <strong>${order.creditsToGrant}</strong> credits.</p>
       <p>You can try again using the button below. No credits were added.</p>
       <p style="margin-top:24px;text-align:center;">
         <a href="${completeUrl}"
            style="display:inline-block;background:linear-gradient(135deg,#E86412,#F12A4C);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
           Retry payment
         </a>
       </p>`,
    );
    const text = `Payment failed for order ${order.id}. Retry: ${completeUrl}`;
    await this.sendEmail(email, subject, html, text);
  }

  async sendIncompletePayment(order: PurchaseOrder, paymentLinkUrl?: string | null) {
    const { email, name } = await this.resolveRecipient(order);
    if (!email) return;

    const completeUrl =
      paymentLinkUrl || `${this.appUrl()}${this.billingPath(order.audience)}`;
    const subject = 'Complete your UserGen payment';
    const html = this.wrapHtml(
      'Payment incomplete',
      `<p>Hi ${name || 'there'},</p>
       <p>Your credit top-up is still awaiting payment.</p>
       <ul>
         <li><strong>Order:</strong> ${order.id.slice(0, 10)}…</li>
         <li><strong>Amount:</strong> ₹${this.paiseToInr(order.totalChargePaise)}</li>
         <li><strong>Credits:</strong> ${order.creditsToGrant.toLocaleString('en-IN')}</li>
       </ul>
       <p style="margin-top:24px;text-align:center;">
         <a href="${completeUrl}"
            style="display:inline-block;background:linear-gradient(135deg,#E86412,#F12A4C);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
           Complete payment
         </a>
       </p>`,
    );
    const text = `Complete your payment for order ${order.id}: ${completeUrl}`;
    await this.sendEmail(email, subject, html, text);
  }

  async sendRefundProcessed(
    order: PurchaseOrder,
    refund: RefundRecord,
    clawback: { clawedBack: number; shortfall: number },
  ) {
    const { email, name } = await this.resolveRecipient(order);
    if (!email) return;

    const subject = `Refund processed — ₹${this.paiseToInr(refund.amountPaise)}`;
    const shortfallNote =
      clawback.shortfall > 0
        ? `<p style="color:#b45309;">Note: ${clawback.shortfall} credits could not be clawed back (insufficient balance).</p>`
        : '';
    const html = this.wrapHtml(
      'Refund processed',
      `<p>Hi ${name || 'there'},</p>
       <p>A refund has been processed for your order.</p>
       <ul>
         <li><strong>Order:</strong> ${order.id.slice(0, 10)}…</li>
         <li><strong>Refund amount:</strong> ₹${this.paiseToInr(refund.amountPaise)}</li>
         <li><strong>Credits reversed:</strong> ${clawback.clawedBack}</li>
         ${refund.reason ? `<li><strong>Reason:</strong> ${refund.reason}</li>` : ''}
       </ul>
       ${shortfallNote}
       <p>The refund will appear in your original payment method as per your bank / Razorpay timelines.</p>`,
    );
    const text = `Refund of ₹${this.paiseToInr(refund.amountPaise)} processed for order ${order.id}. Credits reversed: ${clawback.clawedBack}.`;
    await this.sendEmail(email, subject, html, text);
  }
}
