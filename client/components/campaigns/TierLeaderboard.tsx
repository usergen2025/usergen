'use client';

import { useMemo, useState } from 'react';
import { Trophy, ChevronDown, ChevronRight } from 'lucide-react';
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
  tiers: PrizePoolTier[] | unknown[];
  perRank?: Array<{ rank: number; payoutPaise: bigint | string; tierIndex: number }>;
  tierGroups?: TierAllocationGroup[];
  entries?: TierLeaderboardEntry[];
  highlightCreatorId?: string;
  totalPoolRupees?: number;
  participants?: number;
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
  className,
}: TierLeaderboardProps) {
  const [expandedTier, setExpandedTier] = useState<number | null>(null);
  const tiers = useMemo(
    () => normalizePoolTiers({ tiers: tiersInput as PrizePoolTier[] }),
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

  const creatorByRank = useMemo(() => {
    const map = new Map<number, TierLeaderboardEntry>();
    for (const e of entries || []) {
      if (e.qualifies !== false) map.set(e.rank, e);
    }
    return map;
  }, [entries]);

  const highlightRank = useMemo(() => {
    if (!highlightCreatorId || !entries?.length) return null;
    const found = entries.find((e) => e.creatorId === highlightCreatorId && e.qualifies);
    return found?.rank ?? null;
  }, [entries, highlightCreatorId]);

  if (!tierGroups.length) {
    return (
      <p className="rounded-lg bg-[#FFFCF7] p-3 text-xs text-text-secondary">
        Prize pool tiers will appear once creators qualify.
      </p>
    );
  }

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
        const containsHighlight =
          highlightRank !== null && highlightRank >= group.fromRank && highlightRank <= group.toRank;
        const expanded = expandedTier === group.tierIndex;
        const tierEntries = (entries || []).filter(
          (e) => e.rank >= group.fromRank && e.rank <= group.toRank && e.qualifies !== false,
        );

        return (
          <div
            key={`tier-${group.tierIndex}-${group.fromRank}`}
            className={cn(
              'rounded-xl border transition-colors',
              containsHighlight ? 'border-[#E86412] bg-[#FFF1E6]' : 'border-[#F0E9E2] bg-white',
              isTop1 && 'shadow-sm',
            )}
          >
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-3 px-3 py-2.5 text-left',
                tierEntries.length > 0 && 'cursor-pointer hover:bg-[#FFFCF7]/80',
              )}
              onClick={() => {
                if (tierEntries.length > 0) {
                  setExpandedTier(expanded ? null : group.tierIndex);
                }
              }}
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
              {tierEntries.length > 0 && (
                <span className="text-[#9E9E9E]">
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
              )}
            </button>
            {containsHighlight && highlightRank !== null && (
              <p className="border-t border-[#F0E9E2] px-3 py-1.5 text-xs text-[#9A460C]">
                You&apos;re rank {highlightRank} · projected ₹
                {rupeesIN(
                  creatorByRank.get(highlightRank)?.projectedPayoutRupees ??
                    paiseToRupees(creatorByRank.get(highlightRank)?.projectedPayoutPaise ?? 0),
                )}
              </p>
            )}
            {expanded && tierEntries.length > 0 && (
              <ul className="max-h-48 overflow-y-auto border-t border-[#F0E9E2] px-2 py-1">
                {tierEntries.map((e) => (
                  <li
                    key={e.creatorId}
                    className={cn(
                      'flex items-center justify-between rounded-lg px-2 py-1 text-xs',
                      e.creatorId === highlightCreatorId && 'bg-[#FFF1E6]',
                    )}
                  >
                    <span className="truncate text-[#212121]">
                      #{e.rank} · {e.creatorId.slice(-8)}
                    </span>
                    <span className="text-text-secondary">
                      {e.views !== undefined ? `${e.views.toLocaleString('en-IN')} views` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
