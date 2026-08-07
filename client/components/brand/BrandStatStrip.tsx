'use client';

import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { BrandIconChip } from './BrandIconChip';

export interface BrandStatItem {
  value: string;
  label: string;
  Icon: LucideIcon;
}

export function BrandStatStrip({
  items,
  className,
  /** Default 4-up; use 3 for billing-style rows */
  columns = 4,
  /** `inline` = icon + value + label on one line (My Campaigns). `stacked` = value on top, icon+label below (dashboard/billing). */
  layout = 'stacked',
}: {
  items: BrandStatItem[];
  className?: string;
  columns?: 3 | 4;
  layout?: 'inline' | 'stacked';
}) {
  return (
    <div
      className={cn(
        'grid gap-1.5 sm:gap-3',
        columns === 3 ? 'grid-cols-3' : 'grid-cols-4',
        className,
      )}
    >
      {items.map((item) => {
        const Icon = item.Icon;
        if (layout === 'inline') {
          return (
            <div key={item.label} className="brand-stat-tile--inline">
              <BrandIconChip>
                <Icon className="h-4 w-4 text-white" strokeWidth={1.8} />
              </BrandIconChip>
              <p className="brand-stat-tile__value--inline font-heading text-[#212121]">{item.value}</p>
              <span className="brand-stat-tile__label-inline font-heading font-medium text-[#212121] min-w-0">
                {item.label}
              </span>
            </div>
          );
        }
        return (
          <div key={item.label} className="brand-stat-tile">
            <p className="brand-stat-tile__value">{item.value}</p>
            <div className="brand-stat-tile__footer">
              <BrandIconChip>
                <Icon className="h-4 w-4 text-white" strokeWidth={1.8} />
              </BrandIconChip>
              <span className="font-heading text-sm sm:text-lg sm:leading-6 font-medium text-[#212121]">
                {item.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
