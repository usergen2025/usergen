'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowRight, Paperclip } from 'lucide-react';
import MarketingButton from '../MarketingButton';
import { useOptionalMarketingAuth } from '../MarketingAuthProvider';
import { landing, baseValue, mobileValue } from '@/lib/content/landing';
import {
  languageFromLabel,
  stageHeroAssets,
  writeIntent,
  type GenerationDuration,
  type GenerationVideoStyle,
  type HeroAssetDraft,
} from '@/lib/marketing/generation-intent';
import { cn } from '@/lib/utils/cn';
import HeroAssetsModal from './HeroAssetsModal';

/**
 * The five styles the AI chat style step offers, using the same illustrations
 * as those cards. Half-n-half, avatar cut-out and animated avatar stay out
 * while they are commented out of that step.
 */
const VIDEO_STYLES: { id: GenerationVideoStyle; label: string; image: string }[] = [
  { id: 'avatar-only', label: 'Avatar Only', image: '/assets/style-avatar-only.svg' },
  { id: 'alternate', label: 'Alternate', image: '/assets/style-alternate.svg' },
  { id: 'product-only', label: 'Product Only', image: '/assets/style-product-only.svg' },
  { id: 'broll-only', label: 'B-roll Only', image: '/assets/style-alternate.svg' },
  { id: 'avatar-product', label: 'Avatar with Product', image: '/assets/style-avatar-product.svg' },
];

/** Values match the AI chat durations. Labels are seconds, so the row stays short. */
const DURATIONS: { value: GenerationDuration; label: string; title: string }[] = [
  { value: '30 seconds', label: '30', title: '30 seconds' },
  { value: '45 seconds', label: '45', title: '45 seconds' },
  { value: '1 minute', label: '60', title: '1 minute' },
  { value: '90 seconds', label: '90', title: '1 min 30 sec' },
];

/** Short marks so the three languages fit beside the style icons. */
const LANGUAGES: { label: string; mark: string }[] = [
  { label: 'Hindi', mark: 'अ' },
  { label: 'English', mark: 'Aa' },
  { label: 'Hinglish', mark: 'Hi' },
];

/**
 * The hero panel that starts a video.
 *
 * Collects an ad description, optional product assets, a video style, a
 * language and a duration, then either opens sign-up or goes straight to the
 * AI chat. The funnel reads the intent back, applies those four choices, and
 * leaves the description in the script box for the visitor to send.
 *
 * The product-link tab is paused below. Restore it by rendering the tab list
 * again and branching `writeIntent` on the selected tab.
 */
export default function HeroGeneratorWidget({
  mode = 'signup',
}: {
  mode?: 'signup' | 'authenticated';
}) {
  const { widget } = landing.hero;
  const [value, setValue] = useState('');
  const [assets, setAssets] = useState<HeroAssetDraft[]>([]);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [videoStyle, setVideoStyle] = useState<GenerationVideoStyle>('avatar-only');
  const [duration, setDuration] = useState<GenerationDuration>('30 seconds');
  const [language, setLanguage] = useState(baseValue(widget.languages)[0]);
  const router = useRouter();
  const marketingAuth = useOptionalMarketingAuth();

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const scriptLanguage = languageFromLabel(language);
          if (scriptLanguage) {
            const stored = writeIntent({
              value,
              videoStyle,
              duration,
              language: scriptLanguage,
            });
            if (stored) stageHeroAssets(assets);
          }

          if (mode === 'authenticated') {
            router.push('/create-video/ai-chat');
            return;
          }
          marketingAuth?.openGetStarted({ startGeneration: true });
        }}
        className="flex w-full flex-col gap-3 rounded-2xl border border-mkt-line-cool bg-mkt-cream p-4 md:gap-[13px] md:px-[17px]"
      >
        {/*
          Product link tab — paused. The brief is the only input for now.
          Restore by rendering `widget.tabs` as a tablist and keeping a
          `link` | `brief` mode on the field below.
        */}
        <p className="font-mkt-display text-[12.5px] font-semibold leading-[19px] text-[#212121]">
          <span className="md:hidden">{mobileValue(widget.tabs.brief)}</span>
          <span className="hidden md:inline">{baseValue(widget.tabs.brief)}</span>
        </p>

        <div className="flex items-center gap-2 border-b border-mkt-line-warm pb-2 md:pb-3">
          <label className="sr-only" htmlFor="hero-brief">
            {baseValue(widget.tabs.brief)}
          </label>
          <input
            id="hero-brief"
            name="brief"
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={widget.briefPlaceholder}
            className="min-w-0 flex-1 bg-transparent font-mkt-display text-[15.5px] leading-6 text-mkt-ink caret-[#E8920A] outline-none placeholder:text-[#8A8C99]"
          />
          <button
            type="button"
            onClick={() => setAssetsOpen(true)}
            className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-[#7B695E] hover:bg-white"
            aria-label={assets.length > 0 ? `Attach assets, ${assets.length} attached` : 'Attach assets'}
          >
            <Paperclip className="size-4" strokeWidth={2} />
            {assets.length > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[#E86412] font-mkt-sans text-[10px] font-semibold text-white">
                {assets.length}
              </span>
            ) : null}
          </button>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1" role="group" aria-label="Video style">
              {VIDEO_STYLES.map((style) => {
                const selected = videoStyle === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    title={style.label}
                    aria-label={style.label}
                    aria-pressed={selected}
                    onClick={() => setVideoStyle(style.id)}
                    className={cn(
                      'flex size-9 items-center justify-center overflow-hidden rounded-full border-2 bg-white',
                      selected ? 'border-[#FFAD1F]' : 'border-mkt-line-warm hover:border-[#FFAD1F]/60',
                    )}
                  >
                    <Image
                      src={style.image}
                      alt=""
                      width={18}
                      height={24}
                      className="h-[22px] w-auto object-contain"
                    />
                  </button>
                );
              })}
            </div>

            <span className="px-0.5 font-mkt-sans text-[13px] text-[#C4B8B0]" aria-hidden>
              |
            </span>

            <div className="flex items-center gap-1" role="group" aria-label="Language">
              {LANGUAGES.map((item) => (
                <Mark
                  key={item.label}
                  selected={language === item.label}
                  label={item.label}
                  onClick={() => setLanguage(item.label)}
                  hindi={item.mark === 'अ'}
                >
                  {item.mark}
                </Mark>
              ))}
            </div>

            <span className="px-0.5 font-mkt-sans text-[13px] text-[#C4B8B0]" aria-hidden>
              |
            </span>

            <div className="flex items-center gap-1" role="group" aria-label="Duration">
              {DURATIONS.map((option) => (
                <Mark
                  key={option.value}
                  selected={duration === option.value}
                  label={option.title}
                  onClick={() => setDuration(option.value)}
                >
                  {option.label}
                </Mark>
              ))}
            </div>
          </div>

          <MarketingButton type="submit" className="h-9 shrink-0 rounded-full px-4 text-[14.5px] max-md:w-full md:h-9">
            {widget.submit}
            <ArrowRight className="size-[14px]" strokeWidth={2.5} />
          </MarketingButton>
        </div>
      </form>

      <HeroAssetsModal
        open={assetsOpen}
        initial={assets}
        onClose={() => setAssetsOpen(false)}
        onAttach={setAssets}
      />
    </>
  );
}

function Mark({
  selected,
  onClick,
  label,
  hindi,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hindi?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex size-9 items-center justify-center rounded-full border-2 bg-white font-mkt-sans text-[12px] font-semibold leading-none transition-colors',
        hindi && 'text-[15px]',
        selected
          ? 'border-[#FFAD1F] text-[#9B640B]'
          : 'border-mkt-line-warm text-[#969696] hover:text-mkt-ink-soft',
      )}
    >
      {children}
    </button>
  );
}
