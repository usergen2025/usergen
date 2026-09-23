import { Check } from 'lucide-react';
import GetStartedButton from '../GetStartedButton';
import SalesContactButton from '../SalesContactButton';
import ResponsiveCopy from '../ResponsiveCopy';
import { MarketingSection, MarketingSectionHeading } from '../MarketingSection';
import { landing } from '@/lib/content/landing';
import { cn } from '@/lib/utils/cn';

/**
 * Plan cards.
 *
 * NOTE: these prices describe a flat per-video and monthly-bundle model, which
 * is not what the app bills today — the wallet charges credits per operation
 * (script, audio, render). Publishing this page commits to reconciling the
 * two; the CTAs deliberately route into sign-up rather than into checkout, so
 * nothing here can take money against a plan that does not exist yet.
 */
export default function Pricing({ heading = true }: { heading?: boolean }) {
  const { pricing } = landing;

  return (
    <MarketingSection className="bg-white pt-16 md:pt-[84px]">
      {/*
       * `heading={false}` on /pricing, where the page already opens with
       * "Pay for videos, not for retainers" — stacking "Simple pricing, no
       * hidden charges" under it says the same thing twice.
       */}
      {heading ? (
        <MarketingSectionHeading
          eyebrow={pricing.eyebrow}
          lead={pricing.headline.lead}
          trail={pricing.headline.trail}
        />
      ) : null}

      {/*
       * Three across only from 1024px. The design has no tablet frame, and at
       * 768 three cards leave ~210px each, which wraps "Most popular", the
       * "Let's talk" price and every CTA label onto two lines. Stacked and
       * centred is the better trade below that.
       */}
      <div
        className={cn(
          'mx-auto grid w-full max-w-[420px] gap-5 lg:max-w-none lg:grid-cols-3 lg:items-center lg:gap-[25px]',
          heading ? 'mt-10 lg:mt-[45px]' : 'mt-0'
        )}
      >
        {pricing.plans.map((plan) => {
          const featured = plan.popular === true;
          return (
            <article
              key={plan.name}
              className={cn(
                'flex flex-col gap-5 rounded-2xl p-6',
                featured
                  ? 'border border-mkt-ink bg-[#110B3B] shadow-[0px_25px_44px_rgba(14,15,26,0.28)] lg:-my-5 lg:py-9'
                  : 'border border-mkt-line-cool bg-mkt-cream'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h3
                  className={cn(
                    'font-mkt-sans text-[15px] font-bold',
                    featured ? 'text-white' : 'text-mkt-ink-navy'
                  )}
                >
                  {plan.name}
                </h3>
                {featured ? (
                  <span className="inline-flex h-[30px] items-center rounded-full border-2 border-black bg-white px-3 font-mkt-display text-[11.5px] font-bold text-mkt-ink">
                    {pricing.popularBadge}
                  </span>
                ) : null}
              </div>

              <div>
                <p
                  className={cn(
                    'font-mkt-price text-[40px] font-extrabold leading-[1.15]',
                    featured ? 'mkt-text-gradient' : 'text-mkt-ink-navy'
                  )}
                >
                  {plan.price}
                </p>
                <p
                  className={cn(
                    'font-mkt-sans text-[13.5px]',
                    featured ? 'text-white' : 'text-mkt-ink-navy'
                  )}
                >
                  <ResponsiveCopy value={plan.priceSuffix} />
                </p>
              </div>

              {plan.note ? (
                /* Green savings sticker, with the same hard offset shadow as
                   the hero eyebrow. */
                <span className="inline-flex w-fit items-center rounded-[9px] border-2 border-[#2D951F] bg-[#E1FFE7] px-2.5 py-1 font-mkt-sans text-[12px] font-bold text-[#2D951F] shadow-[-2px_3px_0px_#1D6213]">
                  {plan.note}
                </span>
              ) : null}

              <ul className="flex flex-col gap-3">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className={cn(
                      'flex items-center gap-2.5 font-mkt-sans text-[14px]',
                      featured ? 'text-white' : 'text-mkt-ink'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-[18px] shrink-0 items-center justify-center rounded-full',
                        featured ? 'bg-white/15' : 'bg-mkt-ink-navy/10'
                      )}
                    >
                      <Check
                        className={cn('size-3', featured ? 'text-white' : 'text-mkt-ink-navy')}
                        strokeWidth={3}
                      />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              {/* On the dark card the label is warm-gradient text, which is
                  how the design distinguishes it from the plain navy CTA. */}
              {plan.contact ? (
                <SalesContactButton
                  variant={featured ? 'light' : 'dark'}
                  fullWidth
                  className="mt-auto"
                  subject={`Custom Project enquiry — ${plan.name}`}
                >
                  <span className="mkt-text-gradient-warm">{plan.cta}</span>
                </SalesContactButton>
              ) : (
                <GetStartedButton
                  variant={featured ? 'light' : 'dark'}
                  fullWidth
                  className="mt-auto"
                >
                  {featured ? plan.cta : <span className="mkt-text-gradient-warm">{plan.cta}</span>}
                </GetStartedButton>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3 md:flex-row md:justify-center md:gap-4">
        <span className="font-mkt-sans text-[14px] text-mkt-muted">{pricing.payment.label}</span>
        <ul className="flex flex-wrap items-center justify-center gap-2">
          {pricing.payment.methods.map((method) => (
            <li
              key={method}
              className="rounded-[10px] border border-mkt-line-warm bg-white px-3 py-1.5 font-mkt-sans text-[12.5px] font-semibold text-mkt-ink-soft"
            >
              {method}
            </li>
          ))}
        </ul>
        <span className="flex items-center gap-1.5 font-mkt-sans text-[13px] text-mkt-muted">
          <Check className="size-4 text-[#2D951F]" strokeWidth={3} />
          {pricing.payment.assurance}
        </span>
      </div>
    </MarketingSection>
  );
}
