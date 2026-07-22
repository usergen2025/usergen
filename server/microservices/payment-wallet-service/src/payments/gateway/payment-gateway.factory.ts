import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway } from './payment-gateway.types';
import { RazorpayGateway } from './razorpay.gateway';

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

@Injectable()
export class PaymentGatewayFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly razorpay: RazorpayGateway,
  ) {}

  getGateway(provider?: string): PaymentGateway {
    const name = (provider || this.config.get<string>('PAYMENT_GATEWAY_PROVIDER') || 'razorpay').toLowerCase();
    switch (name) {
      case 'razorpay':
        return this.razorpay;
      default:
        // Future: stripe, juspay
        return this.razorpay;
    }
  }
}
