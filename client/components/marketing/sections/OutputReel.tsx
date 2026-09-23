import { Info, Play } from 'lucide-react';
import MarketingEyebrow from '../MarketingEyebrow';
import ResponsiveCopy from '../ResponsiveCopy';
import { MKT_CONTAINER } from '../MarketingSection';
import { landing } from '@/lib/content/landing';

/**
 * The sample-output carousel.
 *
 * The card row deliberately runs off the panel's right edge instead of
 * fitting inside: the cut-off card is the only cue that the row scrolls,
 * since the design shows no scrollbar.
 *
 * The desktop frame appears to overlap this panel onto the hero — it starts
 * at y=776 while the hero box runs to y=827 — but the hero's last element
 * ends at y=712, so the two only overlap in empty space. It is an artefact of
 * Figma's absolute positioning, not a visual effect, and the mobile frame
 * stacks the two normally. Reproduced as ordinary flow with the gap the
 * desktop frame implies.
 */
export default function OutputReel() {
  const { reel } = landing;

  return (
    <section className="relative bg-white pb-16 md:pb-24">
      <div className={MKT_CONTAINER}>
        <div className="rounded-2xl border border-mkt-line-cool bg-mkt-cream pt-8 md:pt-[45px]">
          <div className="px-5 md:px-[50px]">
            <MarketingEyebrow variant="plain">{reel.eyebrow}</MarketingEyebrow>

            <h2 className="mt-4 flex flex-col md:mt-[18px]">
              <span className="font-mkt-display text-2xl font-bold leading-[30px] tracking-[-0.024em] text-mkt-ink md:text-[33px] md:leading-[37px]">
                {reel.headline.lead}
              </span>
              {/* The serif italic second line, in amber-brown rather than ink. */}
              <span className="mt-1 font-mkt-serif text-[32px] italic leading-[34px] tracking-[-0.019em] text-[#9B640B] md:mt-2 md:text-[48px] md:leading-[42px]">
                {reel.headline.trail}
              </span>
            </h2>
          </div>

          {/*
           * `pr-5` on the list rather than the scroller so the last card can
           * still scroll fully into view, and `pl` matches the header inset.
           */}
          <div className="mkt-scroll-x mt-6 md:mt-8">
            <ul className="flex w-max items-center gap-4 px-5 py-2 md:gap-[26px] md:px-[40px]">
              {reel.items.map((item) => (
                <ReelCard key={item.title} title={item.title} caption={item.caption} />
              ))}
            </ul>
          </div>

          <p className="flex items-start gap-2 px-5 pb-8 pt-2 font-mkt-sans text-[14px] leading-6 text-mkt-muted md:px-[50px] md:pb-[45px] md:text-[15.5px]">
            <Info className="mt-0.5 size-[18px] shrink-0" />
            <ResponsiveCopy value={reel.footnote} />
          </p>
        </div>
      </div>
    </section>
  );
}

function ReelCard({ title, caption }: { title: string; caption: string }) {
  return (
    <li className="relative h-[300px] w-[210px] shrink-0 overflow-hidden rounded-[22px] bg-mkt-ink-soft">
      {/*
       * TODO(assets): the design leaves these as empty `url(.png)` fills with
       * a hidden "VIDEO PLACEHOLDER" label, so there is no poster to place
       * yet. The tile is intentionally not a button until it has a video
       * behind it — a play control that does nothing is worse than none.
       */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[158px]"
        style={{ background: 'var(--mkt-gradient-scrim)' }}
      />

      <span
        aria-hidden="true"
        className="absolute right-[13px] top-[13px] flex size-[30px] items-center justify-center rounded-full bg-white/15"
      >
        <Play className="size-3 fill-white text-white" />
      </span>

      <div className="absolute inset-x-[15px] bottom-[22px]">
        <p className="font-mkt-serif text-[25px] leading-[23px] text-white">{title}</p>
        <span className="mt-2 inline-flex rounded-[7px] bg-white/[0.18] px-[9px] py-[5px] font-mkt-sans text-[11px] font-semibold leading-[17px] text-[#B9B9B9]">
          {caption}
        </span>
      </div>
    </li>
  );
}
