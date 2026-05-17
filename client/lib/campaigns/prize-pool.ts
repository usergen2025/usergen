export type PrizePoolTemplateKey = 'WINNER_HEAVY' | 'BALANCED' | 'WIDE_REACH' | 'CUSTOM';

export interface PrizePoolTier {
  rankCutoff: number | null;
  bps: number;
  label?: string;
}

export interface PrizePoolConfig {
  templateKey: PrizePoolTemplateKey;
  tiers: PrizePoolTier[];
  tieBreaker?: string;
  minViewsToQualify?: number;
  gracePeriodHours?: number;
}

const BPS_TOTAL = 10_000;

export const TAIL_RANK_CUTOFFS = [10, 100, 1000] as const;

export const PRIZE_POOL_TEMPLATES: Record<Exclude<PrizePoolTemplateKey, 'CUSTOM'>, {
  key: Exclude<PrizePoolTemplateKey, 'CUSTOM'>;
  label: string;
  description: string;
  tiers: PrizePoolTier[];
}> = {
  WINNER_HEAVY: {
    key: 'WINNER_HEAVY',
    label: 'Winner-heavy',
    description: 'Skews payouts to the top performers. Best for crowning a few breakout creators.',
    tiers: buildStandardTiers([3000, 1800, 1200, 2000, 1300, 500, 200]),
  },
  BALANCED: {
    key: 'BALANCED',
    label: 'Balanced',
    description: 'Rewards top performers while still paying out the rest of the pool.',
    tiers: buildStandardTiers([1800, 1200, 800, 2400, 2200, 1200, 400]),
  },
  WIDE_REACH: {
    key: 'WIDE_REACH',
    label: 'Wide reach',
    description: 'Spreads payouts evenly to maximize reach across creators.',
    tiers: buildStandardTiers([1000, 700, 500, 1800, 2400, 2200, 1400]),
  },
};

function buildStandardTiers(
  bpsBySlot: [number, number, number, number, number, number, number],
): PrizePoolTier[] {
  const [r1, r2, r3, r4_10, r11_100, r101_1000, r1001_plus] = bpsBySlot;
  return [
    { rankCutoff: 1, bps: r1, label: 'Rank 1' },
    { rankCutoff: 2, bps: r2, label: 'Rank 2' },
    { rankCutoff: 3, bps: r3, label: 'Rank 3' },
    { rankCutoff: TAIL_RANK_CUTOFFS[0], bps: r4_10, label: 'Rank 4–10' },
    { rankCutoff: TAIL_RANK_CUTOFFS[1], bps: r11_100, label: 'Rank 11–100' },
    { rankCutoff: TAIL_RANK_CUTOFFS[2], bps: r101_1000, label: 'Rank 101–1000' },
    { rankCutoff: null, bps: r1001_plus, label: 'Rank 1001+' },
  ];
}

export function tiersForTemplate(key: PrizePoolTemplateKey): PrizePoolTier[] {
  if (key === 'CUSTOM') return [];
  return PRIZE_POOL_TEMPLATES[key].tiers.map((t) => ({ ...t }));
}

/** @deprecated use tiersForTemplate */
export function bandsForTemplate(key: PrizePoolTemplateKey): PrizePoolTier[] {
  return tiersForTemplate(key);
}

export function templateLabel(key?: string | null): string {
  if (!key) return 'Balanced';
  if (key === 'CUSTOM') return 'Custom';
  return PRIZE_POOL_TEMPLATES[key as keyof typeof PRIZE_POOL_TEMPLATES]?.label || 'Balanced';
}

export function totalBps(tiers: PrizePoolTier[]): number {
  return tiers.reduce((sum, t) => sum + (t.bps || 0), 0);
}

export function isTiersValid(tiers: PrizePoolTier[]): { ok: boolean; error?: string } {
  if (!tiers.length) return { ok: false, error: 'Add at least one tier.' };
  let prevCutoff = 0;
  let total = 0;
  let nullSeen = false;
  for (let i = 0; i < tiers.length; i += 1) {
    const t = tiers[i];
    if (nullSeen) return { ok: false, error: `Tier ${i + 1}: cannot follow open-ended tier` };
    if (i < 3) {
      const required = i + 1;
      if (t.rankCutoff !== required) {
        return { ok: false, error: `Tier ${i + 1}: must be individual rank ${required}` };
      }
    } else if (t.rankCutoff !== null) {
      if (!Number.isInteger(t.rankCutoff) || t.rankCutoff <= prevCutoff) {
        return { ok: false, error: `Tier ${i + 1}: rankCutoff must increase` };
      }
    }
    if (t.bps < 0 || !Number.isFinite(t.bps)) {
      return { ok: false, error: `Tier ${i + 1}: invalid bps` };
    }
    total += t.bps;
    if (t.rankCutoff === null) nullSeen = true;
    else prevCutoff = t.rankCutoff;
  }
  if (!nullSeen) return { ok: false, error: 'Last tier must be open-ended (rankCutoff null)' };
  if (total !== BPS_TOTAL) {
    return { ok: false, error: `Tier bps must sum to 100% (currently ${total / 100}%)` };
  }
  return { ok: true };
}

/** @deprecated use isTiersValid */
export function isBandsValid(tiers: PrizePoolTier[]): { ok: boolean; error?: string } {
  return isTiersValid(tiers);
}

export const PREVIEW_N_STOPS = [3, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

export function snapPreviewN(n: number): number {
  const clamped = Math.max(3, Math.min(10000, Math.round(n)));
  let best: number = PREVIEW_N_STOPS[0];
  for (const stop of PREVIEW_N_STOPS) {
    if (Math.abs(stop - clamped) < Math.abs(best - clamped)) best = stop;
  }
  return best;
}

function resolveTierBoundaries(tiers: PrizePoolTier[], n: number): { boundaries: number[]; tierBps: number[] } {
  if (n <= 0 || !tiers.length) return { boundaries: [], tierBps: [] };
  const rawBoundaries = tiers.map((tier) => {
    if (tier.rankCutoff === null) return n;
    return Math.min(Math.max(tier.rankCutoff, 1), n);
  });
  for (let i = 1; i < rawBoundaries.length; i += 1) {
    if (rawBoundaries[i] < rawBoundaries[i - 1]) rawBoundaries[i] = rawBoundaries[i - 1];
  }
  rawBoundaries[rawBoundaries.length - 1] = n;

  const slotCounts: number[] = [];
  for (let i = 0; i < rawBoundaries.length; i += 1) {
    const lower = i === 0 ? 0 : rawBoundaries[i - 1];
    slotCounts.push(Math.max(0, rawBoundaries[i] - lower));
  }

  const mergedBps = tiers.map((t) => t.bps);
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

export function allocatePoolPaise(
  tiers: PrizePoolTier[],
  n: number,
  totalPoolPaise: bigint,
): Array<{ rank: number; payoutPaise: bigint; percentageBps: number; tierIndex: number }> {
  if (n <= 0 || totalPoolPaise <= 0n) return [];
  const { boundaries, tierBps } = resolveTierBoundaries(tiers, n);
  const perRank: Array<{ rank: number; payoutPaise: bigint; percentageBps: number; tierIndex: number }> = [];
  let distributed = 0n;

  for (let i = 0; i < boundaries.length; i += 1) {
    const lower = i === 0 ? 0 : boundaries[i - 1];
    const upper = boundaries[i];
    const slotCount = upper - lower;
    if (slotCount <= 0) continue;
    const bps = tierBps[i];
    if (bps <= 0) {
      for (let r = lower + 1; r <= upper; r += 1) {
        perRank.push({ rank: r, payoutPaise: 0n, percentageBps: 0, tierIndex: i });
      }
      continue;
    }
    const tierPaise = (totalPoolPaise * BigInt(bps)) / BigInt(BPS_TOTAL);
    const baseShare = tierPaise / BigInt(slotCount);
    let tierRemainder = tierPaise - baseShare * BigInt(slotCount);
    const perSlotBps = Math.floor(bps / slotCount);
    for (let r = lower + 1; r <= upper; r += 1) {
      let payout = baseShare;
      if (tierRemainder > 0n) {
        payout += 1n;
        tierRemainder -= 1n;
      }
      perRank.push({ rank: r, payoutPaise: payout, percentageBps: perSlotBps, tierIndex: i });
      distributed += payout;
    }
  }

  let slush = totalPoolPaise - distributed;
  for (let i = 0; i < perRank.length && slush > 0n; i += 1) {
    perRank[i].payoutPaise += 1n;
    slush -= 1n;
  }
  return perRank;
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

export function groupAllocationByTier(
  perRank: Array<{ rank: number; payoutPaise: bigint; tierIndex: number }>,
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
        payoutRupees: paiseToRupees(entry.payoutPaise),
        bps: tiers[entry.tierIndex]?.bps ?? 0,
        label: tiers[entry.tierIndex]?.label,
      });
    }
  }
  for (const group of groups) {
    const slice = perRank.filter(
      (e) => e.tierIndex === group.tierIndex && e.rank >= group.fromRank && e.rank <= group.toRank,
    );
    if (!slice.length) continue;
    const totalPaise = slice.reduce((sum, e) => sum + e.payoutPaise, 0n);
    group.payoutPaise = totalPaise / BigInt(slice.length);
    group.payoutRupees = paiseToRupees(group.payoutPaise);
  }
  return groups;
}

export function formatTierRankLabel(fromRank: number, toRank: number): string {
  if (fromRank === toRank) return `Rank ${fromRank}`;
  return `Rank ${fromRank}–${toRank}`;
}

/** Normalize API pool payload (tiers or legacy bands) for display. */
export function normalizePoolTiers(raw: {
  tiers?: PrizePoolTier[];
  bands?: unknown[];
  templateKey?: string;
} | null | undefined): PrizePoolTier[] {
  if (!raw) return tiersForTemplate('BALANCED');
  if (Array.isArray(raw.tiers) && raw.tiers.length > 0) {
    return raw.tiers.map((t) => ({ ...t }));
  }
  const key = (raw.templateKey as PrizePoolTemplateKey) || 'BALANCED';
  if (key !== 'CUSTOM' && key in PRIZE_POOL_TEMPLATES) {
    return tiersForTemplate(key);
  }
  return tiersForTemplate('BALANCED');
}

export function rupeesToPaise(rupees: number): bigint {
  if (!Number.isFinite(rupees) || rupees <= 0) return 0n;
  return BigInt(Math.round(rupees * 100));
}

export function paiseToRupees(paise: bigint | string | number): number {
  if (typeof paise === 'bigint') return Number(paise) / 100;
  if (typeof paise === 'string') {
    try {
      return Number(BigInt(paise)) / 100;
    } catch {
      const n = Number(paise);
      return Number.isFinite(n) ? n / 100 : 0;
    }
  }
  return paise / 100;
}

/** BigInt-safe INR formatting from paise. */
export function formatPaiseToINR(paise: bigint | string | number, options?: { maximumFractionDigits?: number }): string {
  const maxFrac = options?.maximumFractionDigits ?? 0;
  let bigintPaise: bigint;
  if (typeof paise === 'bigint') bigintPaise = paise;
  else if (typeof paise === 'string') {
    try {
      bigintPaise = BigInt(paise);
    } catch {
      return '0';
    }
  } else {
    bigintPaise = BigInt(Math.round(paise));
  }
  const rupees = bigintPaise / 100n;
  const frac = bigintPaise % 100n;
  if (maxFrac === 0) {
    return rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  const whole = Number(rupees) + Number(frac) / 100;
  return whole.toLocaleString('en-IN', { maximumFractionDigits: maxFrac });
}

export function rupeesIN(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  return amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
