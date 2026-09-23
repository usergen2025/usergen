import GetStartedButton from './GetStartedButton';
import SalesContactButton from './SalesContactButton';
import MarketingEyebrow from './MarketingEyebrow';
import { MKT_CONTAINER } from './MarketingSection';
import type { SubPageIntro } from '@/lib/content/landing';

/**
 * The top of a secondary marketing page.
 *
 * The landing hero is a bespoke frame built around the generator widget and
 * cannot be reused here, so this is a stripped copy of it: same top padding to
 * clear the floating header, same 40%-opacity coral wash, same eyebrow
 * sticker, with the heading and a single CTA in place of the widget. Nothing
 * on these routes is designed yet, and inventing a second hero treatment would
 * only create something else to throw away.
 */
export default function PageIntro({
  intro,
  cta,
  ctaKind = 'generate',
}: {
  intro: SubPageIntro;
  cta?: string;
  /** Agencies are sold to, not signed up — their CTA goes to sales. */
  ctaKind?: 'generate' | 'contact';
}) {
  return (
    <section className="relative overflow-hidden bg-white pb-12 pt-[120px] md:pb-16 md:pt-[168px]">
      {/*
       * `inset-0` rather than the hero's fixed 765px box: these sections are
       * shorter than the wash is tall, and `overflow-hidden` would cut the
       * gradient off mid-pink, leaving a hard seam where it meets the white
       * below. Spanning the section lands the gradient's white stop exactly
       * on its bottom edge at any height.
       */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-40"
        style={{ background: 'var(--mkt-gradient-hero)' }}
      />

      <div className={`${MKT_CONTAINER} relative z-10 flex flex-col items-center text-center`}>
        <MarketingEyebrow variant="sticker">{intro.eyebrow}</MarketingEyebrow>

        <h1 className="mt-[18px] max-w-[760px] font-mkt-display text-[32px] font-extrabold leading-[38px] tracking-[-0.02em] text-[#26283E] md:text-[54px] md:leading-[60px] md:tracking-[-0.029em]">
          {intro.headline.lead}
          <br />
          <span className="font-mkt-serif text-[34px] font-normal leading-[40px] md:text-[58px] md:leading-[62px]">
            {intro.headline.trail}
          </span>
        </h1>

        <p className="mt-[18px] max-w-[560px] font-mkt-sans text-[15px] leading-6 text-black/[0.43] md:text-[17.5px] md:leading-[27px]">
          {intro.subcopy}
        </p>

        {cta && ctaKind === 'contact' ? (
          <SalesContactButton variant="primary" className="mt-8" subject="Agency enquiry">
            {cta}
          </SalesContactButton>
        ) : null}
        {cta && ctaKind === 'generate' ? (
          <GetStartedButton className="mt-8">{cta}</GetStartedButton>
        ) : null}
      </div>
    </section>
  );
}
