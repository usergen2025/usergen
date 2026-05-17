import { PrizePoolConfig, PrizePoolTier, TAIL_RANK_CUTOFFS } from './types';

export const TEMPLATE_DEFAULTS = {
  tieBreaker: 'EARLIER_VERIFIED_POST' as const,
  minViewsToQualify: 0,
  gracePeriodHours: 24,
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

const WINNER_HEAVY_TIERS = buildStandardTiers([3000, 1800, 1200, 2000, 1300, 500, 200]);

const BALANCED_TIERS = buildStandardTiers([1800, 1200, 800, 2400, 2200, 1200, 400]);

const WIDE_REACH_TIERS = buildStandardTiers([1000, 700, 500, 1800, 2400, 2200, 1400]);

export const PRIZE_POOL_TEMPLATES = {
  WINNER_HEAVY: {
    key: 'WINNER_HEAVY' as const,
    title: 'Winner Heavy',
    description: 'Concentrates payouts at the top of the leaderboard.',
    tiers: WINNER_HEAVY_TIERS,
  },
  BALANCED: {
    key: 'BALANCED' as const,
    title: 'Balanced',
    description: 'Recommended default. Rewards top creators while keeping a meaningful long tail.',
    tiers: BALANCED_TIERS,
  },
  WIDE_REACH: {
    key: 'WIDE_REACH' as const,
    title: 'Wide Reach',
    description: 'Spreads payouts across many creators, smaller top prizes.',
    tiers: WIDE_REACH_TIERS,
  },
};

export function buildFromTemplate(
  templateKey: 'WINNER_HEAVY' | 'BALANCED' | 'WIDE_REACH',
): PrizePoolConfig {
  const template = PRIZE_POOL_TEMPLATES[templateKey];
  if (!template) {
    throw new Error(`Unknown prize pool template: ${templateKey}`);
  }
  return {
    templateKey,
    tiers: cloneTiers(template.tiers),
    tieBreaker: TEMPLATE_DEFAULTS.tieBreaker,
    minViewsToQualify: TEMPLATE_DEFAULTS.minViewsToQualify,
    gracePeriodHours: TEMPLATE_DEFAULTS.gracePeriodHours,
  };
}

export function buildFromCustomTiers(
  tiers: PrizePoolTier[],
  options: Partial<Pick<PrizePoolConfig, 'tieBreaker' | 'minViewsToQualify' | 'gracePeriodHours'>> = {},
): PrizePoolConfig {
  return {
    templateKey: 'CUSTOM',
    tiers: cloneTiers(tiers),
    tieBreaker: options.tieBreaker || TEMPLATE_DEFAULTS.tieBreaker,
    minViewsToQualify: options.minViewsToQualify ?? TEMPLATE_DEFAULTS.minViewsToQualify,
    gracePeriodHours: options.gracePeriodHours ?? TEMPLATE_DEFAULTS.gracePeriodHours,
  };
}

function cloneTiers(tiers: PrizePoolTier[]): PrizePoolTier[] {
  return tiers.map((t) => ({ ...t }));
}

export type PrizePoolTemplateKey = keyof typeof PRIZE_POOL_TEMPLATES;
