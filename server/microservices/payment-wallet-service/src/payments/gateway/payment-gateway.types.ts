export type GatewayProviderName = 'razorpay' | 'stripe' | 'manual';

export interface CreateCheckoutOrderInput {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface ProviderOrder {
  provider: GatewayProviderName;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  status: string;
  raw?: unknown;
}

export interface CheckoutVerifyInput {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface CreatePaymentLinkInput {
  amountPaise: number;
  currency: string;
  description: string;
  referenceId: string;
  customer?: { name?: string; email?: string; contact?: string };
  notifyEmail?: boolean;
  notifySms?: boolean;
  callbackUrl?: string;
  expireByUnix?: number;
  notes?: Record<string, string>;
}

export interface ProviderPaymentLink {
  provider: GatewayProviderName;
  providerLinkId: string;
  shortUrl: string;
  referenceId: string;
  status: string;
  raw?: unknown;
}

export interface ProviderPayment {
  provider: GatewayProviderName;
  providerPaymentId: string;
  providerOrderId?: string;
  amountPaise: number;
  currency: string;
  status: string;
  method?: string;
  email?: string;
  contact?: string;
  raw?: unknown;
}

export interface RefundInput {
  providerPaymentId: string;
  amountPaise: number;
  notes?: Record<string, string>;
}

export interface ProviderRefund {
  provider: GatewayProviderName;
  providerRefundId: string;
  providerPaymentId: string;
  amountPaise: number;
  status: string;
  raw?: unknown;
}

export interface CreateProviderInvoiceInput {
  receipt: string;
  description: string;
  currency?: string;
  customer: {
    name?: string;
    email: string;
    contact?: string;
    gstin?: string;
  };
  lineItems: Array<{
    name: string;
    description?: string;
    amountPaise: number;
    quantity?: number;
  }>;
  notes?: Record<string, string>;
  /** When true, Razorpay emails the invoice to the customer */
  emailNotify?: boolean;
  smsNotify?: boolean;
  /** Unix expiry — keep short for post-paid record invoices */
  expireByUnix?: number;
}

export interface ProviderInvoice {
  provider: GatewayProviderName;
  providerInvoiceId: string;
  invoiceNumber?: string;
  shortUrl?: string;
  status: string;
  amountPaise?: number;
  currency?: string;
  raw?: unknown;
}

export type NormalizedWebhookEventType =
  | 'CHECKOUT_PAID'
  | 'PAYMENT_LINK_PAID'
  | 'PAYMENT_FAILED'
  | 'REFUND_PROCESSED'
  | 'UNKNOWN';

export interface NormalizedWebhookEvent {
  provider: GatewayProviderName;
  providerEventId: string;
  type: NormalizedWebhookEventType;
  providerPaymentId?: string;
  providerOrderId?: string;
  providerPaymentLinkId?: string;
  amountPaise?: number;
  currency?: string;
  status?: string;
  raw: unknown;
}

export interface PaymentGateway {
  readonly name: GatewayProviderName;
  createCheckoutOrder(input: CreateCheckoutOrderInput): Promise<ProviderOrder>;
  verifyCheckoutSignature(input: CheckoutVerifyInput): Promise<boolean>;
  createPaymentLink(input: CreatePaymentLinkInput): Promise<ProviderPaymentLink>;
  cancelPaymentLink(providerLinkId: string): Promise<void>;
  notifyPaymentLink(providerLinkId: string, medium: 'email' | 'sms'): Promise<void>;
  fetchPayment(providerPaymentId: string): Promise<ProviderPayment>;
  createRefund(input: RefundInput): Promise<ProviderRefund>;
  /** Create + issue a Razorpay (or provider) invoice document for the customer */
  createAndIssueInvoice(input: CreateProviderInvoiceInput): Promise<ProviderInvoice>;
  notifyInvoice(providerInvoiceId: string, medium: 'email' | 'sms'): Promise<void>;
  cancelInvoice(providerInvoiceId: string): Promise<void>;
  parseAndVerifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<NormalizedWebhookEvent>;
}

/** Future payouts — not implemented in v1. */
export interface PayoutGateway {
  createPayout(_input: unknown): Promise<never>;
}
