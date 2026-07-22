import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import {
  CheckoutVerifyInput,
  CreateCheckoutOrderInput,
  CreatePaymentLinkInput,
  CreateProviderInvoiceInput,
  NormalizedWebhookEvent,
  NormalizedWebhookEventType,
  PaymentGateway,
  ProviderInvoice,
  ProviderOrder,
  ProviderPayment,
  ProviderPaymentLink,
  ProviderRefund,
  RefundInput,
} from './payment-gateway.types';

@Injectable()
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay' as const;
  private readonly logger = new Logger(RazorpayGateway.name);
  private readonly client: AxiosInstance;
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.keyId = this.config.get<string>('RAZORPAY_KEY_ID') || '';
    this.keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET') || '';
    this.webhookSecret = this.config.get<string>('RAZORPAY_WEBHOOK_SECRET') || '';
    this.client = axios.create({
      baseURL: 'https://api.razorpay.com/v1',
      auth: { username: this.keyId, password: this.keySecret },
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  isConfigured(): boolean {
    return !!(this.keyId && this.keySecret);
  }

  getPublicKeyId(): string {
    return this.keyId;
  }

  async createCheckoutOrder(input: CreateCheckoutOrderInput): Promise<ProviderOrder> {
    this.assertConfigured();
    try {
      const { data } = await this.client.post('/orders', {
        amount: input.amountPaise,
        currency: input.currency || 'INR',
        receipt: input.receipt.slice(0, 40),
        notes: input.notes || {},
      });
      return {
        provider: 'razorpay',
        providerOrderId: data.id,
        amountPaise: data.amount,
        currency: data.currency,
        status: data.status,
        raw: data,
      };
    } catch (err: any) {
      const status = err?.response?.status;
      const rzpMessage =
        err?.response?.data?.error?.description ||
        err?.response?.data?.error?.reason ||
        err?.message;
      if (status === 401 || status === 403) {
        throw new BadRequestException(
          'Razorpay authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
        );
      }
      throw new BadRequestException(rzpMessage || 'Failed to create Razorpay order');
    }
  }

  async verifyCheckoutSignature(input: CheckoutVerifyInput): Promise<boolean> {
    this.assertConfigured();
    const payload = `${input.providerOrderId}|${input.providerPaymentId}`;
    const expected = crypto.createHmac('sha256', this.keySecret).update(payload).digest('hex');
    return timingSafeEqualHex(expected, input.signature);
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<ProviderPaymentLink> {
    this.assertConfigured();
    const body: Record<string, unknown> = {
      amount: input.amountPaise,
      currency: input.currency || 'INR',
      accept_partial: false,
      reference_id: input.referenceId.slice(0, 40),
      description: input.description,
      notes: input.notes || {},
      notify: {
        email: input.notifyEmail ?? true,
        sms: input.notifySms ?? false,
      },
      reminder_enable: true,
    };
    if (input.customer) {
      body.customer = {
        name: input.customer.name,
        email: input.customer.email,
        contact: input.customer.contact,
      };
    }
    if (input.callbackUrl) {
      body.callback_url = input.callbackUrl;
      body.callback_method = 'get';
    }
    if (input.expireByUnix) {
      body.expire_by = input.expireByUnix;
    }
    const { data } = await this.client.post('/payment_links', body);
    return {
      provider: 'razorpay',
      providerLinkId: data.id,
      shortUrl: data.short_url,
      referenceId: data.reference_id,
      status: data.status,
      raw: data,
    };
  }

  async cancelPaymentLink(providerLinkId: string): Promise<void> {
    this.assertConfigured();
    await this.client.post(`/payment_links/${providerLinkId}/cancel`);
  }

  async notifyPaymentLink(providerLinkId: string, medium: 'email' | 'sms'): Promise<void> {
    this.assertConfigured();
    await this.client.post(`/payment_links/${providerLinkId}/notify_by/${medium}`);
  }

  async fetchPayment(providerPaymentId: string): Promise<ProviderPayment> {
    this.assertConfigured();
    const { data } = await this.client.get(`/payments/${providerPaymentId}`);
    return {
      provider: 'razorpay',
      providerPaymentId: data.id,
      providerOrderId: data.order_id || undefined,
      amountPaise: data.amount,
      currency: data.currency,
      status: data.status,
      method: data.method,
      email: data.email,
      contact: data.contact,
      raw: data,
    };
  }

  async createRefund(input: RefundInput): Promise<ProviderRefund> {
    this.assertConfigured();
    const { data } = await this.client.post(`/payments/${input.providerPaymentId}/refund`, {
      amount: input.amountPaise,
      notes: input.notes || {},
    });
    return {
      provider: 'razorpay',
      providerRefundId: data.id,
      providerPaymentId: input.providerPaymentId,
      amountPaise: data.amount,
      status: data.status,
      raw: data,
    };
  }

  /**
   * Creates a Razorpay Invoice (payment request). Prefer app-owned tax invoices for
   * post-Checkout receipts — issued Razorpay invoices always show "Proceed to Pay".
   */
  async createAndIssueInvoice(input: CreateProviderInvoiceInput): Promise<ProviderInvoice> {
    this.assertConfigured();
    if (!input.customer?.email) {
      throw new BadRequestException('Customer email is required to create a Razorpay invoice');
    }
    const lineItems = (input.lineItems || [])
      .filter((li) => li.amountPaise > 0)
      .map((li) => ({
        name: li.name.slice(0, 120),
        description: (li.description || '').slice(0, 255) || undefined,
        amount: li.amountPaise,
        currency: input.currency || 'INR',
        quantity: li.quantity ?? 1,
      }));
    if (!lineItems.length) {
      throw new BadRequestException('At least one invoice line item is required');
    }

    // Razorpay requires expire_by ≥ 15 minutes; use 20m buffer for clock skew
    const minExpire = Math.floor(Date.now() / 1000) + 20 * 60;
    const expireBy = Math.max(input.expireByUnix ?? minExpire, minExpire);

    try {
      const { data: created } = await this.client.post('/invoices', {
        type: 'invoice',
        description: input.description.slice(0, 255),
        receipt: input.receipt.slice(0, 40),
        customer: {
          name: input.customer.name || input.customer.email.split('@')[0],
          email: input.customer.email,
          contact: input.customer.contact || undefined,
          gstin: input.customer.gstin || undefined,
        },
        line_items: lineItems,
        sms_notify: input.smsNotify ? 1 : 0,
        email_notify: input.emailNotify === false ? 0 : 1,
        currency: input.currency || 'INR',
        notes: input.notes || {},
        expire_by: expireBy,
      });

      let invoice = created;
      if (created.status === 'draft') {
        const { data: issued } = await this.client.post(`/invoices/${created.id}/issue`);
        invoice = issued;
      }

      // Ensure customer gets Razorpay's invoice email/PDF link
      if (input.emailNotify !== false && invoice.id) {
        try {
          await this.client.post(`/invoices/${invoice.id}/notify_by/email`);
        } catch (notifyErr: any) {
          this.logger.warn(
            `Razorpay invoice notify failed: ${notifyErr?.response?.data?.error?.description || notifyErr?.message}`,
          );
        }
      }

      return {
        provider: 'razorpay',
        providerInvoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number || invoice.receipt || undefined,
        shortUrl: invoice.short_url || undefined,
        status: invoice.status,
        amountPaise: invoice.amount,
        currency: invoice.currency,
        raw: invoice,
      };
    } catch (err: any) {
      const rzpMessage =
        err?.response?.data?.error?.description ||
        err?.response?.data?.error?.reason ||
        err?.message;
      this.logger.error(`Razorpay create invoice failed: ${rzpMessage}`);
      throw new BadRequestException(rzpMessage || 'Failed to create Razorpay invoice');
    }
  }

  async notifyInvoice(providerInvoiceId: string, medium: 'email' | 'sms'): Promise<void> {
    this.assertConfigured();
    await this.client.post(`/invoices/${providerInvoiceId}/notify_by/${medium}`);
  }

  /** Cancel an issued/draft invoice so "Proceed to Pay" is disabled. */
  async cancelInvoice(providerInvoiceId: string): Promise<void> {
    this.assertConfigured();
    await this.client.post(`/invoices/${providerInvoiceId}/cancel`);
  }

  async parseAndVerifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<NormalizedWebhookEvent> {
    const signatureHeader = headerValue(headers, 'x-razorpay-signature');
    const eventId = headerValue(headers, 'x-razorpay-event-id') || crypto.randomUUID();

    if (!this.webhookSecret) {
      this.logger.warn('RAZORPAY_WEBHOOK_SECRET not set — rejecting webhook');
      throw new BadRequestException('Webhook secret not configured');
    }
    if (!signatureHeader) {
      throw new BadRequestException('Missing webhook signature');
    }

    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    if (!timingSafeEqualHex(expected, signatureHeader)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventType: string = payload.event || 'unknown';
    const entity = payload?.payload?.payment?.entity
      || payload?.payload?.order?.entity
      || payload?.payload?.payment_link?.entity
      || payload?.payload?.refund?.entity
      || {};

    let type: NormalizedWebhookEventType = 'UNKNOWN';
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      type = 'CHECKOUT_PAID';
    } else if (eventType === 'payment_link.paid') {
      type = 'PAYMENT_LINK_PAID';
    } else if (eventType === 'payment.failed') {
      type = 'PAYMENT_FAILED';
    } else if (eventType === 'refund.processed') {
      type = 'REFUND_PROCESSED';
    }

    const paymentEntity = payload?.payload?.payment?.entity;
    const linkEntity = payload?.payload?.payment_link?.entity;

    return {
      provider: 'razorpay',
      providerEventId: eventId,
      type,
      providerPaymentId: paymentEntity?.id || linkEntity?.payments?.[0]?.payment_id,
      providerOrderId: paymentEntity?.order_id || entity?.order_id,
      providerPaymentLinkId: linkEntity?.id || payload?.payload?.payment_link?.entity?.id,
      amountPaise: paymentEntity?.amount ?? linkEntity?.amount_paid ?? entity?.amount,
      currency: paymentEntity?.currency || linkEntity?.currency || entity?.currency,
      status: paymentEntity?.status || linkEntity?.status || entity?.status,
      raw: payload,
    };
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new BadRequestException('Razorpay is not configured (missing KEY_ID/KEY_SECRET)');
    }
  }
}

/** Stub for future creator withdrawals / RazorpayX. */
@Injectable()
export class RazorpayPayoutGateway {
  async createPayout(_input: unknown): Promise<never> {
    throw new BadRequestException('Payouts are not implemented yet');
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const v = headers[key];
  return Array.isArray(v) ? v[0] : v;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
