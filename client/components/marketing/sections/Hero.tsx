import { Star } from 'lucide-react';
import MarketingEyebrow from '../MarketingEyebrow';
import ResponsiveCopy from '../ResponsiveCopy';
import HeroGeneratorWidget from './HeroGeneratorWidget';
import { MKT_CONTAINER } from '../MarketingSection';
import { landing } from '@/lib/content/landing';

export default function Hero() {
  const { hero } = landing;

  return (
    <section className="relative overflow-hidden bg-white pb-12 pt-[120px] md:pb-16 md:pt-[168px]">
      {/*
       * The coral-to-white wash behind the headline. Painted as a gradient on
       * a positioned box rather than a blurred shape: `filter: blur()` on an
       * element this size forces WebKit to allocate a backing store several
       * times the element's area, which is what took down iOS Safari on the
       * previous landing page (see `.landing-glow` in globals.css).
       */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[765px] opacity-40"
        style={{ background: 'var(--mkt-gradient-hero)' }}
      />

      <div className={`${MKT_CONTAINER} relative z-10 flex flex-col items-center`}>
        <MarketingEyebrow variant="sticker">{hero.eyebrow}</MarketingEyebrow>

        <h1 className="mt-[18px] max-w-[560px] text-center font-mkt-display text-[38px] font-extrabold leading-[44px] tracking-[-0.02em] text-[#26283E] md:max-w-[680px] md:text-[67px] md:leading-[71px] md:tracking-[-0.029em]">
          {hero.headline.lead}
          <br />
          {hero.headline.priceLine}{' '}
          {/* The figure is smaller and coral on mobile, and inline at full
              size on desktop — the one place the two frames disagree on more
              than wording. */}
          <span className="text-[28px] leading-[35px] text-mkt-coral md:text-[67px] md:leading-[71px] md:text-[#26283E]">
            {hero.headline.price}
          </span>
        </h1>

        <p className="mt-[18px] max-w-[543px] text-center font-mkt-sans text-[15px] leading-6 text-black/[0.43] md:text-[17.5px] md:leading-[27px]">
          <ResponsiveCopy value={hero.subcopy} />
        </p>

        <div className="mt-9 w-full max-w-[780px]">
          <HeroGeneratorWidget />
        </div>

        {/* Assurance strip: a bordered bar on desktop, a plain stacked list on
            mobile, where the design drops the outline. */}
        <ul className="mt-6 flex flex-col items-center gap-3 md:mt-[18px] md:w-auto md:flex-row md:justify-center md:gap-[25px] md:rounded-[10px] md:border md:border-mkt-line-cool md:bg-white md:px-6 md:py-4">
          {hero.assurances.map((item) => (
            <li
              key={item}
              className="flex items-center gap-2 font-mkt-sans text-[13px] font-bold leading-5 text-mkt-muted-soft"
            >
              <Star className="size-[14px] shrink-0 fill-mkt-amber text-mkt-amber" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
