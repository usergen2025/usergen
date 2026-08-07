'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface BrandPageHeaderProps {
  backHref?: string;
  /** Alternative to `backHref` for history-based navigation. */
  onBack?: () => void;
  /** Used when `left` is not provided (a11y / default heading) */
  title?: string;
  /** Rendered under the title; keeps the two-line header consistent across routes. */
  subtitle?: ReactNode;
  /** Right area: CTA, filters */
  right?: ReactNode;
  className?: string;
  /** e.g. custom heading; when set, `title` can be omitted */
  left?: ReactNode;
  hideBackButton?: boolean;
}

const BACK_BUTTON_CLASS =
  'p-1.5 rounded-lg hover:bg-white/50 transition-colors shrink-0 -ml-0.5';

export function BrandPageHeader({
  backHref,
  onBack,
  title,
  subtitle,
  right,
  className,
  left,
  hideBackButton = false,
}: BrandPageHeaderProps) {
  const showBack = !hideBackButton && (backHref || onBack);

  return (
    <div
      className={cn('flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4', className)}
    >
      <div className="flex items-center gap-2 min-w-0">
        {showBack ? (
          backHref ? (
            <Link href={backHref} className={BACK_BUTTON_CLASS} aria-label="Back">
              <ArrowLeft className="h-4 w-4 text-[#212121]" aria-hidden />
            </Link>
          ) : (
            <button type="button" onClick={onBack} className={BACK_BUTTON_CLASS} aria-label="Back">
              <ArrowLeft className="h-4 w-4 text-[#212121]" aria-hidden />
            </button>
          )
        ) : null}
        {left || (
          <div className="min-w-0">
            <h1 className="brand-campaign-page-title min-w-0 break-words">{title ?? ''}</h1>
            {subtitle ? (
              <p className="brand-campaign-meta mt-0.5 text-[#616161]">{subtitle}</p>
            ) : null}
          </div>
        )}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-stretch sm:justify-end">{right}</div> : null}
    </div>
  );
}
