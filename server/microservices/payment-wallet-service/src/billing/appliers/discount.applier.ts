import { Injectable } from '@nestjs/common';
import { BillingQuote } from '../pricing.types';

/**
 * Future coupon/discount pipeline step. v1 is a no-op.
 */
@Injectable()
export class DiscountApplier {
  apply(quote: BillingQuote, _discountCode?: string): BillingQuote {
    return quote;
  }
}
