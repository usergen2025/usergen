import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentGatewayFactory, PAYMENT_GATEWAY } from './gateway/payment-gateway.factory';
import { RazorpayGateway, RazorpayPayoutGateway } from './gateway/razorpay.gateway';

@Module({
  imports: [ConfigModule],
  providers: [
    RazorpayGateway,
    RazorpayPayoutGateway,
    PaymentGatewayFactory,
    {
      provide: PAYMENT_GATEWAY,
      useFactory: (factory: PaymentGatewayFactory) => factory.getGateway(),
      inject: [PaymentGatewayFactory],
    },
  ],
  exports: [
    PAYMENT_GATEWAY,
    PaymentGatewayFactory,
    RazorpayGateway,
    RazorpayPayoutGateway,
  ],
})
export class PaymentsModule {}
