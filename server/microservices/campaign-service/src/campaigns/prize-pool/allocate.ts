import { AllocationEntry, AllocationResult, PrizePoolTier } from './types';

/**
 * Resolve tier boundaries for N participants.
 * Returns last-rank boundary per tier and merged bps (collapsed tiers fold forward).
 */
export function resolveTierBoundaries(
  tiers: PrizePoolTier[],
  n: number,
): { boundaries: number[]; tierBps: number[] } {
  if (n <= 0 || tiers.length === 0) {
    return { boundaries: [], tierBps: [] };
  }

  const rawBoundaries: number[] = tiers.map((tier) => {
    if (tier.rankCutoff === null) return n;
    return Math.min(Math.max(tier.rankCutoff, 1), n);
  });

  for (let i = 1; i < rawBoundaries.length; i += 1) {
    if (rawBoundaries[i] < rawBoundaries[i - 1]) {
      rawBoundaries[i] = rawBoundaries[i - 1];
    }
  }
  rawBoundaries[rawBoundaries.length - 1] = n;

  const slotCounts: number[] = [];
  for (let i = 0; i < rawBoundaries.length; i += 1) {
    const lower = i === 0 ? 0 : rawBoundaries[i - 1];
    const upper = rawBoundaries[i];
    slotCounts.push(Math.max(0, upper - lower));
  }

  const mergedBps: number[] = tiers.map((t) => t.bps);
  for (let i = 0; i < slotCounts.length; i += 1) {
    if (slotCounts[i] === 0 && i < slotCounts.length - 1) {
      mergedBps[i + 1] += mergedBps[i];
      mergedBps[i] = 0;
    }
  }
  if (slotCounts.length && slotCounts[slotCounts.length - 1] === 0) {
    for (let i = slotCounts.length - 2; i >= 0; i -= 1) {
      if (slotCounts[i] > 0) {
        mergedBps[i] += mergedBps[slotCounts.length - 1];
        mergedBps[slotCounts.length - 1] = 0;
        break;
      }
    }
  }

  return { boundaries: rawBoundaries, tierBps: mergedBps };
}

/**
 * Allocate pool (paise) across N ranks using tier definitions.
 */
export function allocate(tiers: PrizePoolTier[], n: number, totalPoolPaise: bigint): AllocationResult {
  if (n <= 0) {
    return { totalPoolPaise, perRank: [], distributedPaise: 0n };
  }
  if (totalPoolPaise <= 0n) {
    return {
      totalPoolPaise,
      perRank: Array.from({ length: n }, (_, i) => ({
        rank: i + 1,
        slotInTier: 0,
        tierIndex: 0,
        payoutPaise: 0n,
        percentageBps: 0,
      })),
      distributedPaise: 0n,
    };
  }

  const { boundaries, tierBps } = resolveTierBoundaries(tiers, n);
  const perRank: AllocationEntry[] = [];
  let distributed = 0n;

  for (let i = 0; i < boundaries.length; i += 1) {
    const lower = i === 0 ? 0 : boundaries[i - 1];
    const upper = boundaries[i];
    const slotCount = upper - lower;
    if (slotCount <= 0) continue;

    const bps = tierBps[i];
    if (bps <= 0) {
      for (let r = lower + 1; r <= upper; r += 1) {
        perRank.push({
          rank: r,
          slotInTier: slotCount,
          tierIndex: i,
          payoutPaise: 0n,
          percentageBps: 0,
        });
      }
      continue;
    }

    const tierPaise = (totalPoolPaise * BigInt(bps)) / BigInt(10_000);
    const baseShare = tierPaise / BigInt(slotCount);
    let tierRemainder = tierPaise - baseShare * BigInt(slotCount);
    const perSlotBps = Math.floor(bps / slotCount);

    for (let r = lower + 1; r <= upper; r += 1) {
      let payout = baseShare;
      if (tierRemainder > 0n) {
        payout += 1n;
        tierRemainder -= 1n;
      }
      perRank.push({
        rank: r,
        slotInTier: slotCount,
        tierIndex: i,
        payoutPaise: payout,
        percentageBps: perSlotBps,
      });
      distributed += payout;
    }
  }

  let slush = totalPoolPaise - distributed;
  for (let i = 0; i < perRank.length && slush > 0n; i += 1) {
    perRank[i].payoutPaise += 1n;
    distributed += 1n;
    slush -= 1n;
  }

  return { totalPoolPaise, perRank, distributedPaise: distributed };
}

export function allocateFromRupees(
  tiers: PrizePoolTier[],
  n: number,
  totalPoolRupees: number,
): AllocationResult {
  const paise = BigInt(Math.round(totalPoolRupees * 100));
  return allocate(tiers, n, paise);
}

export interface TierAllocationGroup {
  tierIndex: number;
  fromRank: number;
  toRank: number;
  creatorCount: number;
  payoutPaise: bigint;
  payoutRupees: number;
  bps: number;
  label?: string;
}

/** Group per-rank allocation into tier rows for UI display. */
export function groupAllocationByTier(
  perRank: AllocationEntry[],
  tiers: PrizePoolTier[],
): TierAllocationGroup[] {
  if (!perRank.length) return [];
  const groups: TierAllocationGroup[] = [];
  for (const entry of perRank) {
    const last = groups[groups.length - 1];
    if (last && last.tierIndex === entry.tierIndex) {
      last.toRank = entry.rank;
      last.creatorCount += 1;
    } else {
      groups.push({
        tierIndex: entry.tierIndex,
        fromRank: entry.rank,
        toRank: entry.rank,
        creatorCount: 1,
        payoutPaise: entry.payoutPaise,
        payoutRupees: Number(entry.payoutPaise) / 100,
        bps: tiers[entry.tierIndex]?.bps ?? entry.percentageBps,
        label: tiers[entry.tierIndex]?.label,
      });
    }
  }
  for (const group of groups) {
    const slice = perRank.filter(
      (e) =>
        e.tierIndex === group.tierIndex &&
        e.rank >= group.fromRank &&
        e.rank <= group.toRank,
    );
    if (!slice.length) continue;
    const totalPaise = slice.reduce((sum, e) => sum + e.payoutPaise, 0n);
    group.payoutPaise = totalPaise / BigInt(slice.length);
    group.payoutRupees = Number(group.payoutPaise) / 100;
  }
  return groups;
}

/** @deprecated use resolveTierBoundaries */
export function resolveBoundaries(tiers: PrizePoolTier[], n: number) {
  return resolveTierBoundaries(tiers, n);
}
