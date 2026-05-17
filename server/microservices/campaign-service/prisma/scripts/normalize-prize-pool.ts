/**
 * Backfill prizePoolJson to canonical tiers shape.
 * Usage: npx ts-node --transpile-only prisma/scripts/normalize-prize-pool.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { normalizeStoredPool } from '../../src/campaigns/prize-pool/normalize';

const db = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const campaigns = await db.campaign.findMany({
    where: { payoutModel: 'POOL', prizePoolJson: { not: null } },
    select: { id: true, name: true, prizePoolJson: true },
  });
  let updated = 0;
  for (const c of campaigns) {
    const raw = c.prizePoolJson as Record<string, unknown>;
    const hasNew =
      Array.isArray(raw?.tiers) &&
      raw.tiers.length > 0 &&
      typeof (raw.tiers[0] as Record<string, unknown>)?.rankCutoff !== 'undefined';
    if (hasNew) continue;
    const normalized = normalizeStoredPool(raw);
    const next = {
      templateKey: normalized.templateKey,
      tiers: normalized.tiers,
      tieBreaker: normalized.tieBreaker,
      minViewsToQualify: normalized.minViewsToQualify,
      gracePeriodHours: normalized.gracePeriodHours,
      frozenAt: normalized.frozenAt,
      frozenBy: normalized.frozenBy,
    };
    console.log(`${dryRun ? '[dry-run] ' : ''}Update ${c.id} (${c.name}) -> ${normalized.templateKey}`);
    if (!dryRun) {
      await db.campaign.update({
        where: { id: c.id },
        data: { prizePoolJson: next as object },
      });
    }
    updated += 1;
  }
  console.log(`Done. ${updated} campaign(s) ${dryRun ? 'would be ' : ''}updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
