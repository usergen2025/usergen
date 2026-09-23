'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import MarketingButton from '../MarketingButton';
import { useOptionalMarketingAuth } from '../MarketingAuthProvider';
import { landing, baseValue, mobileValue } from '@/lib/content/landing';
import { languageFromLabel, writeIntent } from '@/lib/marketing/generation-intent';
import { cn } from '@/lib/utils/cn';

/**
 * The hero's "paste a link, get an ad" panel.
 *
 * Submitting stores what was collected as a generation intent and opens
 * sign-up. The funnel on the other side reads it back and pre-fills its
 * language, avatar and asset steps, so the visitor is not asked the same
 * three questions again two screens later. See `lib/marketing/generation-intent`.
 *
 * The field stays unvalidated and not `required`: a visitor who submits an
 * empty panel still means "I want to start", and the funnel can ask properly.
 * `writeIntent` drops anything it cannot use, including a link that is not a
 * link, rather than seeding the funnel with a broken value.
 *
 * `mode` is what differs between the two places this renders. On the public
 * landing page there is nobody to generate for yet, so it opens sign-up; on
 * the signed-in home it goes straight to the funnel. Either way the intent is
 * written first and read back the same way, so the two paths converge.
 */
export default function HeroGeneratorWidget({
  mode = 'signup',
}: {
  mode?: 'signup' | 'authenticated';
}) {
  const { widget } = landing.hero;
  const [tab, setTab] = useState<'link' | 'brief'>('link');
  const [value, setValue] = useState('');
  const [withAvatar, setWithAvatar] = useState(true);
  const [language, setLanguage] = useState(baseValue(widget.languages)[0]);
  const router = useRouter();
  // Null on the signed-in home, which mounts no sign-up flow.
  const marketingAuth = useOptionalMarketingAuth();

  // Both language sets are rendered and CSS picks one, for the same reason as
  // `ResponsiveCopy`: choosing by viewport width would break server rendering.
  const languageSets = [
    { items: mobileValue(widget.languages), className: 'md:hidden' },
    { items: baseValue(widget.languages), className: 'hidden md:flex' },
  ];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        /*
         * The pills carry display copy ("Hindi"), the script generator wants
         * an enum ("hindi"). An unrecognised label means the two lists have
         * drifted, in which case the funnel should ask rather than guess.
         */
        const scriptLanguage = languageFromLabel(language);
        if (scriptLanguage) {
          writeIntent({ kind: tab, value, withAvatar, language: scriptLanguage });
        }

        if (mode === 'authenticated') {
          router.push('/create-video/ai-chat');
          return;
        }
        marketingAuth?.openGetStarted({ startGeneration: true });
      }}
      className="flex w-full flex-col gap-3 rounded-2xl border border-mkt-line-cool bg-mkt-cream p-4 md:gap-[13px] md:px-[17px]"
    >
      <div className="flex items-center gap-2.5" role="tablist" aria-label="Input type">
        {(['link', 'brief'] as const).map((key) => {
          const selected = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(key)}
              className={cn(
                'rounded-[10px] px-[11px] py-1.5 font-mkt-display text-[12.5px] font-semibold leading-[19px] transition-colors',
                selected
                  ? 'bg-black text-[#FFB97F]'
                  : 'border border-mkt-line-warm text-[#7B695E] hover:bg-white'
              )}
            >
              <span className="md:hidden">{mobileValue(widget.tabs[key])}</span>
              <span className="hidden md:inline">{baseValue(widget.tabs[key])}</span>
            </button>
          );
        })}
      </div>

      <div className="border-b border-mkt-line-warm pb-2 md:pb-3">
        <label className="sr-only" htmlFor="hero-brief">
          {tab === 'link' ? baseValue(widget.tabs.link) : baseValue(widget.tabs.brief)}
        </label>
        <input
          id="hero-brief"
          name="brief"
          type="text"
          inputMode={tab === 'link' ? 'url' : 'text'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={tab === 'link' ? widget.linkPlaceholder : widget.briefPlaceholder}
          className="w-full bg-transparent font-mkt-display text-[15.5px] leading-6 text-mkt-ink caret-[#E8920A] outline-none placeholder:text-[#8A8C99]"
        />
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-[5px]">
          <div className="flex items-center gap-[5px]" role="group" aria-label="Avatar">
            {widget.avatarOptions.map((option, index) => {
              const selected = withAvatar === (index === 0);
              return (
                <Pill
                  key={option}
                  selected={selected}
                  onClick={() => setWithAvatar(index === 0)}
                >
                  {option}
                </Pill>
              );
            })}
          </div>

          {languageSets.map((set) => (
            <div
              key={set.className}
              role="group"
              aria-label="Language"
              className={cn('flex items-center gap-[5px]', set.className)}
            >
              {set.items.map((item) => (
                <Pill key={item} selected={language === item} onClick={() => setLanguage(item)}>
                  {item}
                </Pill>
              ))}
            </div>
          ))}
        </div>

        <MarketingButton type="submit" className="shrink-0 text-[14.5px] max-md:w-full">
          {widget.submit}
          <ArrowRight className="size-[14px]" strokeWidth={2.5} />
        </MarketingButton>
      </div>
    </form>
  );
}

/**
 * Selected pills take an amber outline and amber-brown text; unselected ones a
 * warm hairline and grey text.
 */
function Pill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'rounded-full bg-white px-3.5 py-[5px] font-mkt-sans text-[12.5px] font-semibold leading-[19px] transition-colors',
        selected
          ? 'border border-[#FFAD1F] text-[#9B640B]'
          : 'border border-mkt-line-warm text-[#969696] hover:text-mkt-ink-soft'
      )}
    >
      {children}
    </button>
  );
}
