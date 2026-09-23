import MarketingEyebrow from './MarketingEyebrow';
import ResponsiveCopy from './ResponsiveCopy';
import { cn } from '@/lib/utils/cn';
import type { Responsive } from '@/lib/content/landing';

/**
 * The 1280px frame lays its sections out in a 1138px column, and the 390px
 * frame in a 358px one. Both come out of this: 1186 - 48px of padding is
 * 1138, and 390 - 32px is 358.
 */
export const MKT_CONTAINER = 'mx-auto w-full max-w-[1186px] px-4 md:px-6';

export function MarketingSection({
  id,
  className,
  containerClassName,
  children,
}: {
  id?: string;
  className?: string;
  containerClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn('relative', className)}>
      <div className={cn(MKT_CONTAINER, containerClassName)}>{children}</div>
    </section>
  );
}

/**
 * Every section opens with the same three parts: an outlined badge, a
 * two-line heading, and sometimes a paragraph.
 *
 * The heading's second line is often set in Instrument Serif against a Plus
 * Jakarta Sans first line — the design's one recurring typographic move — so
 * which line takes the serif is a prop rather than two near-identical
 * components.
 */
export function MarketingSectionHeading({
  eyebrow,
  eyebrowVariant = 'chip',
  eyebrowClassName,
  as: Heading = 'h2',
  lead,
  trail,
  serif = 'none',
  subcopy,
  align = 'center',
  className,
  children,
}: {
  eyebrow: string;
  eyebrowVariant?: 'chip' | 'plain';
  /** The FAQ badge is violet where every other section's is coral. */
  eyebrowClassName?: string;
  /**
   * `h2` suits the landing page, where the hero owns the `h1`. Pages that open
   * with this block instead of the hero pass `h1` so the document still starts
   * at the top of the outline.
   */
  as?: 'h1' | 'h2';
  lead: string;
  trail?: string;
  serif?: 'none' | 'lead' | 'trail';
  subcopy?: Responsive<string>;
  align?: 'center' | 'left';
  className?: string;
  children?: React.ReactNode;
}) {
  const centered = align === 'center';
  const sans = 'font-mkt-display font-bold tracking-[-0.01em] text-[24px] leading-[30px] md:text-[37px] md:leading-[42px]';
  const serifStyle = 'font-mkt-serif font-normal text-[28px] leading-[34px] md:text-[48px] md:leading-[52px]';

  return (
    <div
      className={cn(
        'flex flex-col',
        centered ? 'items-center text-center' : 'items-start text-left',
        className
      )}
    >
      <MarketingEyebrow variant={eyebrowVariant} className={eyebrowClassName}>
        {eyebrow}
      </MarketingEyebrow>
      <Heading className={cn('mt-4 text-mkt-ink md:mt-5', sans)}>
        <span className={serif === 'lead' ? serifStyle : undefined}>{lead}</span>
        {trail ? (
          <>
            <br />
            <span className={serif === 'trail' ? serifStyle : undefined}>{trail}</span>
          </>
        ) : null}
      </Heading>
      {subcopy ? (
        <p className="mt-3 max-w-[640px] font-mkt-sans text-[15px] leading-[24px] text-mkt-muted md:mt-4 md:text-[17px] md:leading-[27px]">
          <ResponsiveCopy value={subcopy} />
        </p>
      ) : null}
      {children}
    </div>
  );
}
