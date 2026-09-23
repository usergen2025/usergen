import type { Metadata } from 'next';
import { Star } from 'lucide-react';
import MarketingTheme from '@/components/marketing/MarketingTheme';
import MarketingEyebrow from '@/components/marketing/MarketingEyebrow';
import HeroGeneratorWidget from '@/components/marketing/sections/HeroGeneratorWidget';
import { MKT_CONTAINER } from '@/components/marketing/MarketingSection';
import { landing } from '@/lib/content/landing';

/**
 * Home for a signed-in creator.
 *
 * `/` serves this instead of the landing page once the session hint is set —
 * `proxy.ts` rewrites rather than redirects, so the URL stays `/` and a
 * returning user lands on their own home rather than being thrown at
 * `/projects`. It is also reachable directly at `/home`.
 *
 * One screen, no scroll, as the previous home page was: `h-dvh` with the
 * content centred in the leftover space. The overflow is `auto` rather than
 * `hidden` purely as a floor — on a viewport too short to fit the widget,
 * scrolling beats clipping. At any normal size nothing scrolls.
 *
 * The page is only the hero. Someone who has already signed up does not need
 * the social proof count or the feature badges pitching them the product.
 */
export const metadata: Metadata = {
  // Crawlers carry no session hint, so they only ever see the landing page at
  // `/`. This path stays reachable though, and indexing it would put a second,
  // near-identical page in front of the one that is meant to rank.
  robots: { index: false, follow: false },
};

export default function SignedInHomePage() {
  const { hero } = landing;

  return (
    <MarketingTheme className="flex min-h-0 flex-1 flex-col">
      <section className="relative flex h-dvh flex-col overflow-x-hidden overflow-y-auto bg-white pt-[calc(43px+64px)]">
        {/* The landing hero's wash. Pinned to the section rather than given a
            fixed height, so it fades out on the bottom edge whatever the
            viewport is instead of banding partway down. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 opacity-40"
          style={{ background: 'var(--mkt-gradient-hero)' }}
        />

        <div
          className={`${MKT_CONTAINER} relative z-10 flex flex-1 flex-col items-center justify-center py-8`}
        >
          <MarketingEyebrow variant="sticker">Start a new ad</MarketingEyebrow>

          <h1 className="mt-[18px] max-w-[560px] text-center font-mkt-display text-[34px] font-extrabold leading-[40px] tracking-[-0.02em] text-[#26283E] md:max-w-[680px] md:text-[58px] md:leading-[64px] md:tracking-[-0.029em]">
            Turn imagination into <span className="mkt-text-gradient">impact</span>
          </h1>

          <p className="mt-[18px] max-w-[543px] text-center font-mkt-sans text-[15px] leading-6 text-black/[0.43] md:text-[17.5px] md:leading-[27px]">
            Paste a product link or describe your ad. We&rsquo;ll write, voice and edit it for you.
          </p>

          <div className="mt-8 w-full max-w-[780px]">
            <HeroGeneratorWidget mode="authenticated" />
          </div>

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
    </MarketingTheme>
  );
}
