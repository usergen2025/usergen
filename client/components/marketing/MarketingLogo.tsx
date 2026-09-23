import Image from 'next/image';
import { cn } from '@/lib/utils/cn';

/**
 * Wordmark for the marketing pages.
 *
 * The design has the logo as a cropped screenshot of the whole lockup on a
 * white plate, which would show a white box on any surface that is not white.
 * Only the mark is taken from it — cut out to transparency — and the words are
 * set live, so the pair stays sharp at any density and the ".ai" keeps the
 * gradient the rest of the page uses. The box matches the design's: 152x43 on
 * desktop, 112x32 on mobile.
 */
export default function MarketingLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 font-mkt-display text-xl font-extrabold tracking-[-0.02em] text-mkt-ink md:gap-2 md:text-2xl',
        className
      )}
    >
      <Image
        src="/marketing/logo-mark.png"
        alt=""
        width={160}
        height={160}
        priority
        className="size-7 md:size-8"
      />
      UserGen
      <span className="mkt-text-gradient -ml-1 md:-ml-1.5">.ai</span>
    </span>
  );
}
