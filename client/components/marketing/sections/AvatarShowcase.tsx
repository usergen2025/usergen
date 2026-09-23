import { ArrowRight } from 'lucide-react';
import MarketingMedia from '../MarketingMedia';
import ResponsiveCopy from '../ResponsiveCopy';
import GetStartedButton from '../GetStartedButton';
import { MarketingSection, MarketingSectionHeading } from '../MarketingSection';
import { landing, baseValue } from '@/lib/content/landing';

/**
 * The avatar capability section: a 2x2 grid of feature cards inside a cream
 * panel, each pairing an illustration with a serif title.
 */
export default function AvatarShowcase() {
  const { avatars } = landing;

  return (
    <MarketingSection className="bg-white pt-16 md:pt-[84px]">
      <MarketingSectionHeading
        eyebrow={avatars.eyebrow}
        lead={avatars.headline.lead}
        trail={avatars.headline.trail}
        subcopy={avatars.subcopy}
      />

      <div className="mt-8 rounded-2xl border border-mkt-line-cool bg-mkt-cream p-4">
        <div className="grid gap-4 md:grid-cols-2 md:gap-5">
          {avatars.features.map((feature) => (
            <article
              key={baseValue(feature.title)}
              className="flex flex-col gap-6 rounded-xl bg-white p-6 md:gap-11 md:px-[30px] md:py-6"
            >
              <MarketingMedia
                media={feature.media}
                className="h-[200px] w-full rounded-xl border-b border-mkt-line-cool md:h-[253px]"
                sizes="(min-width: 768px) 560px, 100vw"
              />
              <div className="flex flex-col gap-4 md:gap-[22px]">
                <h3 className="font-mkt-serif text-[26px] leading-[34px] text-black md:text-[32px] md:leading-[36px]">
                  <ResponsiveCopy value={feature.title} />
                </h3>
                <p className="font-mkt-sans text-[15px] leading-[26px] tracking-[-0.007em] text-black/70 md:text-[18px] md:leading-[29px]">
                  <ResponsiveCopy value={feature.body} />
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-4 md:flex-row md:justify-center md:gap-6">
        <p className="max-w-[420px] text-center font-mkt-sans text-[14px] leading-[22px] text-mkt-muted md:text-left">
          {avatars.proof}
        </p>
        <GetStartedButton className="max-md:w-full">
          {avatars.cta}
          <ArrowRight className="size-4" strokeWidth={2.5} />
        </GetStartedButton>
      </div>
    </MarketingSection>
  );
}
