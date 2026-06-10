'use client';

import { useMemo } from 'react';
import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import {
  TierAllocationGroup,
  formatPaiseToINR,
  formatTierRankLabel,
  groupAllocationByTier,
  normalizePoolTiers,
  paiseToRupees,
  rupeesIN,
  type PrizePoolTier,
} from '@/lib/campaigns/prize-pool';

export interface TierLeaderboardEntry {
  rank: number;
  creatorId: string;
  views?: number;
  projectedPayoutPaise?: string | bigint;
  projectedPayoutRupees?: number;
  qualifies?: boolean;
  caveat?: string;
}

interface TierLeaderboardProps {
  tiers?: PrizePoolTier[] | unknown[];
  perRank?: Array<{ rank: number; payoutPaise: bigint | string; tierIndex: number }>;
  tierGroups?: TierAllocationGroup[];
  entries?: TierLeaderboardEntry[];
  highlightCreatorId?: string;
  totalPoolRupees?: number;
  participants?: number;
  qualifiersCount?: number;
  approvedCount?: number;
  className?: string;
}

export function TierLeaderboard({
  tiers: tiersInput,
  perRank,
  tierGroups: tierGroupsProp,
  entries,
  highlightCreatorId,
  totalPoolRupees,
  participants,
  qualifiersCount,
  className,
}: TierLeaderboardProps) {
  const tiers = useMemo(
    () => tiersInput ? normalizePoolTiers({ tiers: tiersInput as PrizePoolTier[] }) : [],
    [tiersInput],
  );

  const tierGroups = useMemo(() => {
    if (tierGroupsProp?.length) return tierGroupsProp;
    if (perRank?.length) {
      return groupAllocationByTier(
        perRank.map((r) => ({
          rank: r.rank,
          payoutPaise: typeof r.payoutPaise === 'string' ? BigInt(r.payoutPaise) : r.payoutPaise,
          tierIndex: r.tierIndex,
        })),
        tiers,
      );
    }
    return [];
  }, [tierGroupsProp, perRank, tiers]);

  const isPreviewMode = !entries?.length && tierGroups.length > 0;

  const qualifyingEntries = useMemo(() => {
    return (entries || []).filter((e) => e.qualifies !== false);
  }, [entries]);

  if (isPreviewMode) {
    return (
      <div className={cn('space-y-1', className)}>
        {(totalPoolRupees !== undefined || participants !== undefined) && (
          <p className="mb-2 text-xs text-text-secondary">
            {totalPoolRupees !== undefined && <>Pool ₹{rupeesIN(totalPoolRupees)}</>}
            {participants !== undefined && <> · {participants.toLocaleString('en-IN')} creators</>}
          </p>
        )}
        {tierGroups.map((group) => {
          const isTop1 = group.fromRank === 1 && group.toRank === 1;
          const isTop3 = group.toRank <= 3;

          return (
            <div
              key={`tier-${group.tierIndex}-${group.fromRank}`}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                'border-[#F0E9E2] bg-white',
                isTop1 && 'shadow-sm',
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {isTop1 ? (
                  <Trophy className="h-5 w-5 shrink-0 text-[#E86412]" aria-hidden />
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-xs font-medium text-[#9E9E9E]">
                    {group.fromRank}
                  </span>
                )}
                <div className="min-w-0">
                  <p
                    className={cn(
                      'font-heading text-[#212121]',
                      isTop1 ? 'text-base font-semibold' : isTop3 ? 'text-sm font-medium' : 'text-sm',
                    )}
                  >
                    {group.label || formatTierRankLabel(group.fromRank, group.toRank)}
                  </p>
                  {group.creatorCount > 1 && (
                    <p className="text-[11px] text-text-secondary">
                      {group.creatorCount} creators · {(group.bps / 100).toFixed(1)}% of pool
                    </p>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className={cn('font-medium text-[#212121]', isTop1 && 'text-base')}>
                  ₹{formatPaiseToINR(group.payoutPaise)}
                  {group.creatorCount > 1 ? (
                    <span className="text-xs font-normal text-text-secondary"> each</span>
                  ) : null}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (!qualifyingEntries.length) {
    return (
      <p className="rounded-lg bg-[#FFFCF7] p-3 text-xs text-text-secondary">
        No qualifying creators yet. Leaderboard will appear once creators have verified posts.
      </p>
    );
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {qualifyingEntries.map((entry) => {
        const isTop1 = entry.rank === 1;
        const isHighlighted = entry.creatorId === highlightCreatorId;
        const payout = entry.projectedPayoutRupees ?? paiseToRupees(entry.projectedPayoutPaise ?? 0);

        return (
          <div
            key={entry.creatorId}
            className={cn(
              'rounded-xl border transition-colors overflow-hidden',
              isHighlighted ? 'border-[#F5D4BC]' : 'border-[#F0E9E2]',
              isTop1 && !isHighlighted && 'shadow-sm',
            )}
          >
            <div
              className={cn(
                'flex items-center gap-3 px-3 py-2.5',
                isHighlighted ? 'bg-[#FFF8F3]' : 'bg-white',
              )}
            >
              {isTop1 ? (
                <Trophy className="h-5 w-5 shrink-0 text-[#E86412]" aria-hidden />
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm font-medium text-[#9E9E9E]">
                  #{entry.rank}
                </span>
              )}
              
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className={cn(
                  'truncate text-[#212121]',
                  isTop1 ? 'font-semibold' : 'font-medium',
                )}>
                  {isTop1 && '#1 · '}{entry.creatorId.slice(-8)}
                </span>
                <span className="text-xs text-text-secondary">
                  {entry.views !== undefined ? `${entry.views.toLocaleString('en-IN')} views` : ''}
                </span>
              </div>
              
              <span className={cn(
                'shrink-0 font-medium text-[#212121]',
                isTop1 && 'text-base',
              )}>
                ₹{rupeesIN(payout)}
              </span>
            </div>
            
            {isHighlighted && (
              <div className="border-t border-[#F5D4BC] bg-[#FFF8F3] px-3 py-1.5 text-xs text-[#B85C1B]">
                You&apos;re rank {entry.rank} · projected ₹{rupeesIN(payout)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
