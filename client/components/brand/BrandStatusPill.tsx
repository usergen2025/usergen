'use client';

import { cn } from '@/lib/utils/cn';

type PublicStatus = 'LIVE' | 'IN_PROGRESS' | 'PAUSED' | 'DRAFT' | 'COMPLETED';

const LABEL: Record<PublicStatus, string> = {
  LIVE: 'LIVE',
  IN_PROGRESS: 'IN PROGRESS',
  PAUSED: 'PAUSED',
  DRAFT: 'DRAFT',
  COMPLETED: 'COMPLETED',
};

export function brandStatusPillClass(status: PublicStatus) {
  if (status === 'LIVE') return 'brand-status-pill--live';
  if (status === 'DRAFT') return 'brand-status-pill--draft';
  if (status === 'COMPLETED') return 'brand-status-pill--completed';
  if (status === 'PAUSED') return 'brand-status-pill--paused';
  return 'brand-status-pill--in-progress';
}

export function BrandStatusPill({ status }: { status: PublicStatus }) {
  return (
    <span className={cn('brand-status-pill', brandStatusPillClass(status))} translate="no">
      {LABEL[status]}
    </span>
  );
}
