'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/** Circle with brand gradient; pass Lucide icon as child (text-white, size via className on child). */
export function BrandIconChip({
  children,
  className,
  size = 'md',
}: {
  children: ReactNode;
  className?: string;
  /** sm = ~20px chip / ~12px icon; md = 32px / 16px (default) */
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={cn(
        'brand-metric-icon-chip',
        size === 'sm' && 'brand-metric-icon-chip--sm',
        className,
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}
