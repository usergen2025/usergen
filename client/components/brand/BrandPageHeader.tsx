'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface BrandPageHeaderProps {
  backHref?: string;
  /** Used when `left` is not provided (a11y / default heading) */
  title?: string;
  /** Right area: CTA, filters */
  right?: ReactNode;
  className?: string;
  /** e.g. custom heading; when set, `title` can be omitted */
  left?: ReactNode;
  hideBackButton?: boolean;
}

export function BrandPageHeader({
  backHref,
  title,
  right,
  className,
  left,
  hideBackButton = false,
}: BrandPageHeaderProps) {
  return (
    <div
      className={cn('flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4', className)}
    >
      <div className="flex items-center gap-2 min-w-0">
        {!hideBackButton && backHref ? (
          <Link
            href={backHref}
            className="p-1.5 rounded-lg hover:bg-white/50 transition-colors shrink-0 -ml-0.5"
          >
            <ArrowLeft className="h-4 w-4 text-[#212121]" aria-hidden />
          </Link>
        ) : null}
        {left || (
          <h1 className="brand-campaign-page-title min-w-0 break-words">{title ?? ''}</h1>
        )}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-stretch sm:justify-end">{right}</div> : null}
    </div>
  );
}
