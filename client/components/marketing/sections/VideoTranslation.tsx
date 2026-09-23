import { ArrowRight, Play } from 'lucide-react';
import GetStartedButton from '../GetStartedButton';
import PlaceholderMedia from '../PlaceholderMedia';
import ResponsiveCopy from '../ResponsiveCopy';
import { MarketingSection, MarketingSectionHeading } from '../MarketingSection';
import { landing } from '@/lib/content/landing';
import { cn } from '@/lib/utils/cn';

/**
 * Language coverage section: a player panel with the language list beside it,
 * then three supporting claims.
 *
 * The first three pills are shown selected in the design, each with its label
 * in warm-gradient text on near-black. That is a static state in the frame,
 * not a control — the list is illustrative, so these are rendered as
 * non-interactive items rather than as buttons that would do nothing.
 */
export default function VideoTranslation() {
  const { translation } = landing;

  return (
    <MarketingSection className="bg-white pt-16 md:pt-[84px]">
      <MarketingSectionHeading
        eyebrow={translation.eyebrow}
        lead={translation.headline.lead}
        trail={translation.headline.trail}
        subcopy={translation.subcopy}
      >
        <GetStartedButton className="mt-6 max-md:w-full">
          {translation.cta}
          <ArrowRight className="size-4" strokeWidth={2.5} />
        </GetStartedButton>
      </MarketingSectionHeading>

      <div className="mt-8 rounded-2xl border border-mkt-line-cool bg-[#F4F4F4] p-4">
        <div className="flex flex-col gap-4 rounded-[15px] bg-white p-4 md:flex-row md:gap-[15px] md:p-5">
          <div className="relative flex-1">
            <PlaceholderMedia className="aspect-[16/11] w-full rounded-[13px]">
              <span className="flex size-14 items-center justify-center rounded-full bg-white/70 shadow-sm">
                <Play className="size-5 fill-mkt-ink text-mkt-ink" />
              </span>
            </PlaceholderMedia>

            {/* Presenter chip, overlaid on the player as in the design. */}
            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-[10px] border border-mkt-line-warm bg-white px-2 py-[5px]">
              <span aria-hidden="true" className="size-[22px] rounded-full bg-[#E8E8E8]" />
              <span className="flex items-center gap-1 px-1 font-mkt-sans text-[12.5px] font-semibold text-mkt-ink-soft">
                {translation.sample.name}
                <span aria-hidden="true" className="h-3 w-px bg-mkt-ink-soft/40" />
                {translation.sample.language}
              </span>
            </div>
          </div>

          <ul className="flex flex-wrap gap-2 md:w-[78px] md:flex-col md:justify-center md:gap-[9px]">
            {translation.languages.map((language, index) => (
              <li
                key={language}
                className={cn(
                  'flex h-[35px] items-center justify-center rounded-full px-3 font-mkt-sans text-[12.5px] font-semibold',
                  index < 3
                    ? 'border border-mkt-ink bg-mkt-ink'
                    : 'border border-mkt-line-warm bg-white text-mkt-ink-soft'
                )}
              >
                {index < 3 ? (
                  <span className="mkt-text-gradient-warm">{language}</span>
                ) : (
                  language
                )}
              </li>
            ))}
          </ul>
        </div>

        {/*
         * The row shows eight languages but only the first three can be
         * written in; the rest come from translating the finished video.
         * Without this line the pills read as eight equal choices.
         */}
        <p className="mt-3 px-1 font-mkt-sans text-[13px] leading-5 text-mkt-muted">
          {translation.languagesNote}
        </p>

        <ul className="mt-4 grid gap-4 md:mt-5 md:grid-cols-3 md:gap-5">
          {translation.features.map((feature, index) => (
            <li
              key={index}
              className="flex flex-col gap-4 rounded-[15px] bg-white p-5"
            >
              <PlaceholderMedia className="h-[160px] w-full rounded-xl" />
              <h3 className="font-mkt-serif text-[26px] leading-[32px] text-mkt-ink md:text-[28px]">
                <ResponsiveCopy value={feature} />
              </h3>
            </li>
          ))}
        </ul>
      </div>
    </MarketingSection>
  );
}
