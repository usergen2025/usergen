'use client';

import { Calendar, CalendarRange, Eye, IndianRupee } from 'lucide-react';
import { BrandIconChip } from '@/components/brand';
import { cn } from '@/lib/utils/cn';

/**
 * The one metrics row every campaign list card shares, on both the creator and
 * brand side: views, pool, apply deadline, then the run dates pinned right.
 */
export function CampaignMetricsRow({
  viewsLabel,
  poolLabel,
  deadline,
  startDate,
  endDate,
}: {
  viewsLabel: string;
  poolLabel: string;
  deadline: string;
  startDate: string;
  endDate: string;
}) {
  const daysRemaining = getDaysRemaining(deadline);
  const urgent = daysRemaining >= 0 && daysRemaining <= 7;

  return (
    <div className="brand-campaign-row flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[#212121] sm:justify-between sm:gap-y-3">
      {/* `contents` lets these join the parent's wrap flow on mobile; a nested
          flex-1 group would collapse to zero width and squash the text */}
      <div className="contents sm:flex sm:min-w-0 sm:flex-1 sm:flex-wrap sm:items-center sm:gap-x-2.5 sm:gap-y-1">
        <div className="inline-flex min-w-0 items-center gap-1.5">
          <BrandIconChip size="sm">
            <Eye className="h-3 w-3" strokeWidth={1.8} />
          </BrandIconChip>
          <span>{viewsLabel}</span>
        </div>
        <div className="inline-flex min-w-0 items-center gap-1.5">
          <BrandIconChip size="sm">
            <IndianRupee className="h-3 w-3" strokeWidth={1.8} />
          </BrandIconChip>
          <span>{poolLabel}</span>
        </div>
        <div className="inline-flex min-w-0 items-center gap-1.5">
          <BrandIconChip size="sm">
            <Calendar className="h-3 w-3" strokeWidth={1.8} />
          </BrandIconChip>
          <span className={cn(urgent && 'text-red-600')}>
            Apply by {formatLineDate(deadline)}
            {daysRemaining >= 0
              ? ` — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left`
              : ' — closed'}
          </span>
        </div>
      </div>
      <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 sm:max-w-[50%] sm:justify-end sm:pl-2 sm:text-right">
        <BrandIconChip size="sm">
          <CalendarRange className="h-3 w-3" strokeWidth={1.8} />
        </BrandIconChip>
        <span className="min-w-0 text-left leading-snug sm:text-right">
          {formatLineDate(startDate)} – {formatLineDate(endDate)}
        </span>
      </div>
    </div>
  );
}

/** `totalBudget` is the prize pool — the CPM budget model has been retired. */
export function campaignPoolLabel(campaign: { totalBudget: number }) {
  return `Pool ₹${Number(campaign.totalBudget || 0).toLocaleString('en-IN')}`;
}

function formatLineDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function getDaysRemaining(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
