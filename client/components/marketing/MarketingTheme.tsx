import {
  Bricolage_Grotesque,
  Instrument_Sans,
  Instrument_Serif,
  Plus_Jakarta_Sans,
} from 'next/font/google';
import { cn } from '@/lib/utils/cn';

/*
 * The marketing design uses four families, none of which the signed-in app
 * loads. Declaring them here rather than in the root layout keeps next/font
 * from preloading four extra typefaces on every authenticated screen.
 *
 * Every family includes `latin-ext`: the rupee sign (U+20B9) is outside the
 * `latin` subset, and the design sets prices — the single most important
 * number on the page — in these faces. With `latin` alone each "₹" silently
 * falls back to a system font. Unused subsets are never fetched, so the extra
 * declaration costs nothing for visitors who do not hit those glyphs.
 *
 * The subset list is repeated per call rather than shared: next/font reads
 * these arguments by static analysis at build time and rejects a spread.
 */
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-plus-jakarta',
});

const instrumentSans = Instrument_Sans({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-instrument-sans',
});

// Instrument Serif ships a single weight; the design uses it upright and italic.
const instrumentSerif = Instrument_Serif({
  subsets: ['latin', 'latin-ext'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-instrument-serif',
});

const bricolage = Bricolage_Grotesque({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-bricolage',
});

/**
 * Puts the new design's type and colour tokens in scope.
 *
 * `mkt-root` binds the `--font-mkt-*` tokens to these four families, and has
 * to sit on the same element that carries the next/font variables: a custom
 * property is substituted on the element that declares it, so the `:root`
 * copies that `@theme` emits cannot see fonts scoped further down the tree.
 *
 * Shared by the marketing layout and the signed-in home page, which borrows
 * the new hero styling while living outside the marketing route group.
 */
export default function MarketingTheme({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'mkt-root font-mkt-sans text-mkt-ink',
        plusJakarta.variable,
        instrumentSans.variable,
        instrumentSerif.variable,
        bricolage.variable,
        className
      )}
    >
      {children}
    </div>
  );
}
