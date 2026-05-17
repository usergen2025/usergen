import { BadRequestException } from '@nestjs/common';
import { PrizePoolConfig, PrizePoolTier, TAIL_RANK_CUTOFFS } from './types';
import { PRIZE_POOL_TEMPLATES, TEMPLATE_DEFAULTS } from './templates';

export const TOTAL_BPS = 10_000;

const REQUIRED_TOP_CUTOFFS = [1, 2, 3] as const;

export function validateTiers(tiers: PrizePoolTier[], options?: { allowCustomLadder?: boolean }): void {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new BadRequestException('prizePool.tiers must be a non-empty array');
  }

  let prevCutoff = 0;
  let totalBps = 0;
  let nullSeen = false;

  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i];
    if (nullSeen) {
      throw new BadRequestException(`Tier ${i + 1}: no tiers allowed after open-ended (null) cutoff`);
    }

    if (i < 3) {
      const required = REQUIRED_TOP_CUTOFFS[i];
      if (tier.rankCutoff !== required) {
        throw new BadRequestException(
          `Tier ${i + 1}: rankCutoff must be ${required} (top 3 are always individual)`,
        );
      }
    } else if (tier.rankCutoff !== null) {
      if (!Number.isInteger(tier.rankCutoff) || tier.rankCutoff <= prevCutoff) {
        throw new BadRequestException(
          `Tier ${i + 1}: rankCutoff must be an integer greater than previous cutoff (${prevCutoff})`,
        );
      }
    }

    if (!Number.isInteger(tier.bps) || tier.bps < 0) {
      throw new BadRequestException(`Tier ${i + 1}: bps must be a non-negative integer`);
    }
    if (tier.bps > TOTAL_BPS) {
      throw new BadRequestException(`Tier ${i + 1}: bps must be at most ${TOTAL_BPS}`);
    }

    totalBps += tier.bps;
    if (tier.rankCutoff === null) {
      nullSeen = true;
    } else {
      prevCutoff = tier.rankCutoff;
    }
  }

  if (!nullSeen) {
    throw new BadRequestException('Last tier must have rankCutoff null (open-ended rest tier)');
  }

  if (totalBps !== TOTAL_BPS) {
    throw new BadRequestException(`Sum of tier bps must equal ${TOTAL_BPS}; got ${totalBps}`);
  }

  if (!options?.allowCustomLadder) {
    // For named templates the ladder is fixed; CUSTOM may use any ascending cutoffs >= 3.
  }
}

/** Enforce standard tail ladder for non-CUSTOM templates. */
export function assertStandardTailLadder(tiers: PrizePoolTier[]): void {
  const tailTiers = tiers.slice(3);
  const expectedCutoffs: Array<number | null> = [...TAIL_RANK_CUTOFFS, null];
  if (tailTiers.length !== expectedCutoffs.length) {
    throw new BadRequestException(
      `Expected ${expectedCutoffs.length} tail tiers after top 3; got ${tailTiers.length}`,
    );
  }
  for (let i = 0; i < tailTiers.length; i += 1) {
    if (tailTiers[i].rankCutoff !== expectedCutoffs[i]) {
      throw new BadRequestException(
        `Tail tier ${i + 4}: rankCutoff must be ${expectedCutoffs[i]}`,
      );
    }
  }
}

export interface PrizePoolInputDto {
  templateKey?: 'WINNER_HEAVY' | 'BALANCED' | 'WIDE_REACH' | 'CUSTOM';
  tiers?: PrizePoolTier[];
  /** @deprecated use tiers */
  bands?: unknown[];
  /** @deprecated use tiers */
  customBands?: unknown[];
  tieBreaker?: 'EARLIER_VERIFIED_POST';
  minViewsToQualify?: number;
  gracePeriodHours?: number;
}

export function resolvePrizePoolConfig(input?: PrizePoolInputDto): PrizePoolConfig {
  const templateKey = input?.templateKey || 'BALANCED';
  if (templateKey !== 'CUSTOM' && !(templateKey in PRIZE_POOL_TEMPLATES)) {
    throw new BadRequestException(`Unknown prize pool template: ${templateKey}`);
  }

  let tiers: PrizePoolTier[];
  if (templateKey === 'CUSTOM') {
    const customTiers = input?.tiers || (input?.customBands as PrizePoolTier[]) || (input?.bands as PrizePoolTier[]);
    if (!customTiers?.length) {
      throw new BadRequestException('Custom prize pool requires at least one tier in tiers');
    }
    validateTiers(customTiers, { allowCustomLadder: true });
    tiers = customTiers.map((t) => ({ ...t }));
  } else {
    tiers = PRIZE_POOL_TEMPLATES[templateKey].tiers.map((t) => ({ ...t }));
    validateTiers(tiers);
    assertStandardTailLadder(tiers);
  }

  const tieBreaker: 'EARLIER_VERIFIED_POST' = input?.tieBreaker || TEMPLATE_DEFAULTS.tieBreaker;
  const minViewsToQualify = clampInt(input?.minViewsToQualify, 0, 1_000_000_000, TEMPLATE_DEFAULTS.minViewsToQualify);
  const gracePeriodHours = clampInt(input?.gracePeriodHours, 0, 168, TEMPLATE_DEFAULTS.gracePeriodHours);

  return {
    templateKey,
    tiers,
    tieBreaker,
    minViewsToQualify,
    gracePeriodHours,
  };
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || Number.isNaN(value)) return fallback;
  const n = Math.floor(Number(value));
  if (Number.isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** @deprecated use validateTiers */
export function validateBands(bands: unknown): void {
  validateTiers(bands as PrizePoolTier[]);
}
