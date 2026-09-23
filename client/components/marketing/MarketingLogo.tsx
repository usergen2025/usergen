import { cn } from '@/lib/utils/cn';

/**
 * Wordmark for the marketing pages.
 *
 * TODO(assets): the design references the logo as a cropped screenshot
 * (`Screenshot 2026-08-29 at 3.46.32 PM.png`) rather than an exported asset,
 * so there is nothing to place yet. This sets the same box the design gives it
 * — 152x43 desktop, 112x32 mobile — as live text, which reads correctly at any
 * density and is a single-line swap once a real SVG arrives.
 */
export default function MarketingLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex items-center font-mkt-display text-xl font-extrabold tracking-[-0.02em] text-mkt-ink md:text-2xl',
        className
      )}
    >
      UserGen
      <span className="mkt-text-gradient">.ai</span>
    </span>
  );
}
