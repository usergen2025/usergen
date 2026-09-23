import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Buttons for the marketing pages.
 *
 * Separate from `components/ui/Button` because that component hardcodes the
 * app's tokens — the 26–40px pill radii, the #E86412 gradient and the
 * `typography` presets — none of which the new design uses. Its geometry is
 * the thing being replaced, so there is nothing left to share beyond the
 * `<button>` element itself.
 *
 * Heights are per-variant rather than shared: the design gives the CTAs 45px,
 * the header chip 46px and the pricing buttons 44px, and each grows to 48px on
 * mobile where it fills the column.
 */
type Variant = 'primary' | 'quiet' | 'dark' | 'light' | 'whatsapp';

const VARIANTS: Record<Variant, string> = {
  // Hero and section CTAs. The amber border is part of the design, not a
  // focus artefact — it reads as a lip on the gradient fill.
  primary:
    'h-12 md:h-[45px] px-5 mkt-gradient-cta border-2 border-mkt-amber text-white font-mkt-display font-bold text-base leading-5 rounded-[9px] hover:brightness-105',
  // Header "Log in": a recessed cream chip rather than a filled button.
  quiet:
    'h-[35px] md:h-[46px] px-4 md:px-5 bg-mkt-cream border border-mkt-line-cool text-mkt-ink font-mkt-display font-semibold text-[13px] md:text-[14.5px] rounded-lg md:rounded-[14px] hover:bg-white',
  // Pricing cards on light surfaces.
  dark:
    'h-12 md:h-[44px] px-5 bg-mkt-ink-navy text-white font-mkt-sans font-semibold text-[14.5px] rounded-[9px] hover:opacity-90',
  // Pricing card that sits on the warm gradient panel.
  light:
    'h-12 md:h-[44px] px-5 bg-white text-mkt-ink-navy font-mkt-sans font-semibold text-[14.5px] rounded-[9px] hover:bg-mkt-cream',
  // Outline on the dark bottom-CTA panel.
  whatsapp:
    'h-12 md:h-[45px] px-[18px] border border-white text-[#B5F3AC] font-mkt-display font-bold text-base leading-5 rounded-[10px] hover:bg-white/10',
};

const BASE =
  'inline-flex items-center justify-center gap-2.5 transition-all duration-200 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-coral ' +
  'disabled:pointer-events-none disabled:opacity-50';

type CommonProps = {
  variant?: Variant;
  children: ReactNode;
  icon?: ReactNode;
  fullWidth?: boolean;
  className?: string;
};

type Props = CommonProps &
  (
    | ({ href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className'>)
    | ({ href?: never } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>)
  );

export default function MarketingButton({
  variant = 'primary',
  children,
  icon,
  fullWidth = false,
  className,
  ...rest
}: Props) {
  const classes = cn(
    BASE,
    VARIANTS[variant],
    fullWidth ? 'w-full' : 'w-auto',
    className
  );

  if (rest.href !== undefined) {
    const { href, ...anchorProps } = rest;
    return (
      <Link href={href} className={classes} {...anchorProps}>
        {icon}
        {children}
      </Link>
    );
  }

  return (
    <button type="button" className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
}
