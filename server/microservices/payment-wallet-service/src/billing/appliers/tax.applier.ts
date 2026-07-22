import { Injectable } from '@nestjs/common';
import { BillingQuote } from '../pricing.types';

/**
 * Tax is applied inside PricingEngine / pricing.math (GST on top of base).
 * This applier exists so future tax jurisdictions can plug in without changing controllers.
 */
@Injectable()
export class TaxApplier {
  apply(quote: BillingQuote): BillingQuote {
    return quote;
  }
}
