/**
 * Dream11-style prize pool tiers.
 *
 * Top 3 ranks are always individual tiers (rankCutoff 1, 2, 3).
 * Tail tiers use absolute rank cutoffs that collapse when N is smaller.
 * Sum of tier `bps` must equal 10_000 (100% of pool).
 */

export interface PrizePoolTier {
  /** Last absolute rank in this tier (null = all remaining ranks up to N). */
  rankCutoff: number | null;
  /** Share of pool in basis points (1/100 of a percent). */
  bps: number;
  label?: string;
}

export interface PrizePoolConfig {
  templateKey: 'WINNER_HEAVY' | 'BALANCED' | 'WIDE_REACH' | 'CUSTOM';
  tiers: PrizePoolTier[];
  tieBreaker: 'EARLIER_VERIFIED_POST';
  minViewsToQualify: number;
  gracePeriodHours: number;
  frozenAt?: string;
  frozenBy?: string;
}

export interface AllocationEntry {
  rank: number;
  slotInTier: number;
  tierIndex: number;
  payoutPaise: bigint;
  percentageBps: number;
}

export interface AllocationResult {
  totalPoolPaise: bigint;
  perRank: AllocationEntry[];
  distributedPaise: bigint;
}

/** Standard tail ladder after the mandatory top-3 individual tiers. */
export const TAIL_RANK_CUTOFFS = [10, 100, 1000] as const;
