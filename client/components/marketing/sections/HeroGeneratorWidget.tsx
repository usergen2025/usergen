'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Paperclip } from 'lucide-react';
import MarketingButton from '../MarketingButton';
import { useOptionalMarketingAuth } from '../MarketingAuthProvider';
import { landing, baseValue, mobileValue } from '@/lib/content/landing';
import {
  stageHeroAssets,
  writeIntent,
  type HeroAssetDraft,
} from '@/lib/marketing/generation-intent';
import { cn } from '@/lib/utils/cn';
import HeroAssetsModal from './HeroAssetsModal';

/**
 * The hero panel that starts a video.
 *
 * Collects an ad description and optional product assets, then either opens
 * sign-up or goes straight to the AI chat. Style, language, and duration are
 * chosen in the chat funnel. Only the description is carried over and applied
 * when the user reaches the script-input step.
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
  const router = useRouter();
  const marketingAuth = useOptionalMarketingAuth();

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const stored = writeIntent({ value });
          if (stored) stageHeroAssets(assets);

          if (mode === 'authenticated') {
            router.push('/create-video/ai-chat');
            return;
          }
          marketingAuth?.openGetStarted({ startGeneration: true });
        }}
        className="flex w-full flex-col gap-2.5 rounded-2xl border border-mkt-line-cool bg-mkt-cream px-4 py-3.5 md:gap-2.5 md:px-[17px] md:py-3.5"
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

        <div className="flex items-center gap-2">
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
            className={cn(
              'relative flex size-8 shrink-0 items-center justify-center rounded-full text-[#7B695E] hover:bg-white',
            )}
            aria-label={assets.length > 0 ? `Attach assets, ${assets.length} attached` : 'Attach assets'}
          >
            <Paperclip className="size-4" strokeWidth={2} />
            {assets.length > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[#E86412] font-mkt-sans text-[10px] font-semibold text-white">
                {assets.length}
              </span>
            ) : null}
          </button>
          <MarketingButton
            type="submit"
            className="h-9 shrink-0 rounded-full px-3 text-[13px] md:px-4 md:text-[14.5px]"
          >
            <span className="md:hidden">Generate</span>
            <span className="hidden md:inline">{widget.submit}</span>
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
