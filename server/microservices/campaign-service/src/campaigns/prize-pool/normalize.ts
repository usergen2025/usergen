import { Logger } from '@nestjs/common';
import { buildFromTemplate, PRIZE_POOL_TEMPLATES } from './templates';
import { PrizePoolConfig, PrizePoolTier } from './types';
import { validateTiers } from './validator';

const logger = new Logger('PrizePoolNormalize');

interface LegacyPercentileBand {
  cumulativePercentile?: number;
  bps?: number;
  forceTopOne?: boolean;
  label?: string;
}

interface LegacyClientBand {
  from?: number;
  to?: number;
  percentageBps?: number;
  label?: string;
}

function isNewTierShape(t: unknown): t is PrizePoolTier {
  if (typeof t !== 'object' || t === null) return false;
  const o = t as Record<string, unknown>;
  return (
    ('rankCutoff' in o && (typeof o.rankCutoff === 'number' || o.rankCutoff === null)) &&
    typeof o.bps === 'number'
  );
}

function normalizeFromLegacyPercentileBands(
  bands: LegacyPercentileBand[],
  templateKey?: string,
): PrizePoolTier[] | null {
  const key = templateKey as keyof typeof PRIZE_POOL_TEMPLATES;
  if (key && key in PRIZE_POOL_TEMPLATES) {
    return PRIZE_POOL_TEMPLATES[key].tiers.map((t) => ({ ...t }));
  }
  return null;
}

function normalizeFromLegacyClientBands(bands: LegacyClientBand[]): PrizePoolTier[] | null {
  if (!bands.length) return null;
  const sorted = [...bands].sort((a, b) => (a.to ?? 0) - (b.to ?? 0));
  const tiers: PrizePoolTier[] = [];
  let bpsRemaining = 10_000;

  const topBand = sorted[0];
  if (topBand && (topBand.to ?? 0) <= 0.05) {
    const topBps = topBand.percentageBps ?? 0;
    const third = Math.floor(topBps / 3);
    tiers.push(
      { rankCutoff: 1, bps: third, label: 'Rank 1' },
      { rankCutoff: 2, bps: third, label: 'Rank 2' },
      { rankCutoff: 3, bps: topBps - 2 * third, label: 'Rank 3' },
    );
    bpsRemaining -= topBps;
    sorted.shift();
  }

  const ladder = [10, 100, 1000, null] as const;
  let ladderIdx = 0;
  for (const band of sorted) {
    if (ladderIdx >= ladder.length) break;
    const bps = band.percentageBps ?? 0;
    if (bps <= 0) continue;
    tiers.push({
      rankCutoff: ladder[ladderIdx],
      bps,
      label: band.label,
    });
    bpsRemaining -= bps;
    ladderIdx += 1;
  }

  if (bpsRemaining !== 0 && tiers.length) {
    tiers[tiers.length - 1].bps += bpsRemaining;
  }

  if (tiers.length >= 4 && tiers[0].rankCutoff === 1) {
    try {
      validateTiers(tiers, { allowCustomLadder: true });
      return tiers;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Normalize stored prizePoolJson from any historical shape into canonical tiers config.
 */
export function normalizeStoredPool(raw: unknown): PrizePoolConfig {
  if (!raw || typeof raw !== 'object') {
    return buildFromTemplate('BALANCED');
  }

  const obj = raw as Record<string, unknown>;
  const templateKey = (obj.templateKey as PrizePoolConfig['templateKey']) || 'BALANCED';

  if (Array.isArray(obj.tiers) && obj.tiers.length > 0 && isNewTierShape(obj.tiers[0])) {
    try {
      const tiers = (obj.tiers as PrizePoolTier[]).map((t) => ({ ...t }));
      validateTiers(tiers, { allowCustomLadder: templateKey === 'CUSTOM' });
      return {
        templateKey,
        tiers,
        tieBreaker: (obj.tieBreaker as PrizePoolConfig['tieBreaker']) || 'EARLIER_VERIFIED_POST',
        minViewsToQualify: Number(obj.minViewsToQualify ?? 0),
        gracePeriodHours: Number(obj.gracePeriodHours ?? 24),
        frozenAt: obj.frozenAt as string | undefined,
        frozenBy: obj.frozenBy as string | undefined,
      };
    } catch (err) {
      logger.warn(`Stored tiers failed validation: ${(err as Error).message}`);
    }
  }

  if (Array.isArray(obj.bands) && obj.bands.length > 0) {
    const first = obj.bands[0] as Record<string, unknown>;
    if (typeof first.cumulativePercentile === 'number') {
      const converted = normalizeFromLegacyPercentileBands(
        obj.bands as LegacyPercentileBand[],
        templateKey,
      );
      if (converted) {
        return {
          templateKey: templateKey in PRIZE_POOL_TEMPLATES ? templateKey : 'BALANCED',
          tiers: converted,
          tieBreaker: (obj.tieBreaker as PrizePoolConfig['tieBreaker']) || 'EARLIER_VERIFIED_POST',
          minViewsToQualify: Number(obj.minViewsToQualify ?? 0),
          gracePeriodHours: Number(obj.gracePeriodHours ?? 24),
          frozenAt: obj.frozenAt as string | undefined,
          frozenBy: obj.frozenBy as string | undefined,
        };
      }
    }
    if (typeof first.from === 'number' || typeof first.to === 'number') {
      const converted = normalizeFromLegacyClientBands(obj.bands as LegacyClientBand[]);
      if (converted) {
        return {
          templateKey: 'CUSTOM',
          tiers: converted,
          tieBreaker: (obj.tieBreaker as PrizePoolConfig['tieBreaker']) || 'EARLIER_VERIFIED_POST',
          minViewsToQualify: Number(obj.minViewsToQualify ?? 0),
          gracePeriodHours: Number(obj.gracePeriodHours ?? 24),
          frozenAt: obj.frozenAt as string | undefined,
          frozenBy: obj.frozenBy as string | undefined,
        };
      }
    }
  }

  logger.warn('Could not normalize prize pool JSON; falling back to BALANCED');
  return buildFromTemplate('BALANCED');
}
