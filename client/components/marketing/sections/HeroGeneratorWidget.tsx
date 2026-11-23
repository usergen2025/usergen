'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Link2, Paperclip, Upload } from 'lucide-react';
import MarketingButton from '../MarketingButton';
import { useOptionalMarketingAuth } from '../MarketingAuthProvider';
import { landing, baseValue, mobileValue } from '@/lib/content/landing';
import {
  stageHeroAssets,
  writeIntent,
  type HeroAssetDraft,
} from '@/lib/marketing/generation-intent';
import {
  TRANSLATION_FUNNEL_PATH,
  writeTranslationFileIntent,
  writeTranslationUrlIntent,
} from '@/lib/marketing/translation-intent';
import { cn } from '@/lib/utils/cn';
import { useToast } from '@/lib/toast/toast';
import HeroAssetsModal from './HeroAssetsModal';

type HeroTab = 'brief' | 'translate';

const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v';
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/**
 * The hero panel that starts a video — generate an ad, or translate one.
 *
 * Describe tab: ad copy (+ optional assets) → AI chat.
 * Translate tab: public video URL or file upload → translate funnel.
 */
export default function HeroGeneratorWidget({
  mode = 'signup',
}: {
  mode?: 'signup' | 'authenticated';
}) {
  const { widget } = landing.hero;
  const { showToast } = useToast();
  const [tab, setTab] = useState<HeroTab>('brief');
  const [value, setValue] = useState('');
  const [translateUrl, setTranslateUrl] = useState('');
  const [translateFile, setTranslateFile] = useState<File | null>(null);
  const [assets, setAssets] = useState<HeroAssetDraft[]>([]);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const marketingAuth = useOptionalMarketingAuth();

  const goTranslate = () => {
    if (mode === 'authenticated') {
      router.push(TRANSLATION_FUNNEL_PATH);
      return;
    }
    marketingAuth?.openGetStarted({ startTranslation: true });
  };

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) {
      showToast('Video is too large (max 200MB)', 'error');
      return;
    }
    const okType =
      file.type.startsWith('video/') ||
      /\.(mp4|mov|webm|m4v)$/i.test(file.name);
    if (!okType) {
      showToast('Please choose an mp4, mov, webm, or m4v video', 'error');
      return;
    }
    setTranslateFile(file);
    setTranslateUrl('');
  };

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();

          if (tab === 'translate') {
            const url = translateUrl.trim();
            if (translateFile) {
              writeTranslationFileIntent(translateFile);
              goTranslate();
              return;
            }
            if (url) {
              try {
                const parsed = new URL(url);
                if (!['http:', 'https:'].includes(parsed.protocol)) {
                  showToast('Enter a public http(s) video URL', 'error');
                  return;
                }
              } catch {
                showToast('Enter a valid video URL', 'error');
                return;
              }
              writeTranslationUrlIntent(url);
              goTranslate();
              return;
            }
            showToast('Paste a video URL or upload a video file', 'error');
            return;
          }

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
        <div className="flex items-center gap-4" role="tablist" aria-label="Start options">
          {(
            [
              { id: 'brief' as const, label: widget.tabs.brief },
              { id: 'translate' as const, label: widget.tabs.translate },
            ] as const
          ).map((item) => {
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(item.id)}
                className={cn(
                  'font-mkt-display text-[12.5px] font-semibold leading-[19px] transition-colors',
                  selected ? 'text-[#212121]' : 'text-[#8A8C99] hover:text-mkt-ink-soft',
                )}
              >
                <span className="md:hidden">{mobileValue(item.label)}</span>
                <span className="hidden md:inline">{baseValue(item.label)}</span>
              </button>
            );
          })}
        </div>

        {tab === 'brief' ? (
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
        ) : (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="hero-translate-url">
              Video URL
            </label>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Link2 className="size-4 shrink-0 text-[#8A8C99]" aria-hidden />
              <input
                id="hero-translate-url"
                name="translateUrl"
                type="url"
                value={translateFile ? translateFile.name : translateUrl}
                onChange={(event) => {
                  setTranslateFile(null);
                  setTranslateUrl(event.target.value);
                }}
                placeholder={widget.translatePlaceholder}
                readOnly={!!translateFile}
                className="min-w-0 flex-1 bg-transparent font-mkt-display text-[15.5px] leading-6 text-mkt-ink caret-[#E8920A] outline-none placeholder:text-[#8A8C99]"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={VIDEO_ACCEPT}
              className="hidden"
              onChange={(event) => {
                onPickFile(event.target.files?.[0] || null);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-[#7B695E] hover:bg-white"
              aria-label={translateFile ? `Replace video, ${translateFile.name}` : 'Upload video'}
            >
              <Upload className="size-4" strokeWidth={2} />
            </button>
            <MarketingButton
              type="submit"
              className="h-9 shrink-0 rounded-full px-3 text-[13px] md:px-4 md:text-[14.5px]"
            >
              <span className="md:hidden">Translate</span>
              <span className="hidden md:inline">{widget.translateSubmit}</span>
              <ArrowRight className="size-[14px]" strokeWidth={2.5} />
            </MarketingButton>
          </div>
        )}
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
