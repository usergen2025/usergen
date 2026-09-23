import { cn } from '@/lib/utils/cn';

/**
 * The small label above a heading. The design uses three treatments, and they
 * are not interchangeable:
 *
 * - `sticker` — hero only. Uppercase and letter-spaced inside a white box with
 *   a hard offset shadow (a flat colour with no blur, which is what gives it
 *   the sticker look).
 * - `chip` — every other section. A thin outline, sentence case, no shadow.
 * - `plain` — the output reel, which drops the outline and sits directly on
 *   the panel.
 */
type Variant = 'sticker' | 'chip' | 'plain';

const VARIANTS: Record<Variant, string> = {
  sticker:
    'rounded-[10px] border border-mkt-coral bg-white px-3.5 py-1.5 shadow-[2px_4px_0px_var(--color-mkt-orange-bright)] font-mkt-display text-[12.5px] font-extrabold uppercase leading-[19px] tracking-[0.128em] text-mkt-coral',
  chip:
    'rounded-[5px] border border-[#EC5A4A] px-[7px] py-1.5 font-mkt-sans text-[13px] font-medium leading-[13px] tracking-[-0.01em] text-[#EC5A4A]',
  plain:
    'font-mkt-display text-[12.5px] font-extrabold uppercase leading-[19px] tracking-[0.128em] text-mkt-ink',
};

export default function MarketingEyebrow({
  variant = 'chip',
  children,
  className,
}: {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center justify-center', VARIANTS[variant], className)}>
      {children}
    </span>
  );
}
