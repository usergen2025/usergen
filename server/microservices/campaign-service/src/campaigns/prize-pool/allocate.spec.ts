import { allocate, groupAllocationByTier } from './allocate';
import { buildFromTemplate } from './templates';

describe('allocate (tier model)', () => {
  const balanced = buildFromTemplate('BALANCED');
  const pool = 50_000_00n; // Rs 50,000 in paise

  it('distributes full pool for N=1000', () => {
    const result = allocate(balanced.tiers, 1000, pool);
    expect(result.perRank).toHaveLength(1000);
    expect(result.distributedPaise).toBe(pool);
    const groups = groupAllocationByTier(result.perRank, balanced.tiers);
    expect(groups[0].fromRank).toBe(1);
    expect(groups[0].creatorCount).toBe(1);
    expect(groups[1].fromRank).toBe(2);
    expect(groups[2].fromRank).toBe(3);
  });

  it('groups each tier once at N=1000 (no duplicate rank-range rows)', () => {
    const result = allocate(balanced.tiers, 1000, pool);
    const groups = groupAllocationByTier(result.perRank, balanced.tiers);
    expect(groups).toHaveLength(6);
    expect(groups[3].fromRank).toBe(4);
    expect(groups[3].toRank).toBe(10);
    expect(groups[3].creatorCount).toBe(7);
    expect(groups[4].fromRank).toBe(11);
    expect(groups[4].toRank).toBe(100);
    expect(groups[4].creatorCount).toBe(90);
    const tier4Labels = groups.filter((g) => g.fromRank === 4 && g.toRank === 10);
    expect(tier4Labels).toHaveLength(1);
  });

  it('gives rank 1, 2, 3 distinct payouts', () => {
    const result = allocate(balanced.tiers, 100, pool);
    const r1 = result.perRank[0].payoutPaise;
    const r2 = result.perRank[1].payoutPaise;
    const r3 = result.perRank[2].payoutPaise;
    expect(r1).not.toBe(r2);
    expect(r2).not.toBe(r3);
    expect(r1).toBeGreaterThan(r2);
    expect(r2).toBeGreaterThan(r3);
  });

  it('collapses tail tiers when N=3 and still distributes full pool', () => {
    const result = allocate(balanced.tiers, 3, pool);
    expect(result.perRank).toHaveLength(3);
    expect(result.distributedPaise).toBe(pool);
  });

  it('handles N=1', () => {
    const result = allocate(balanced.tiers, 1, pool);
    expect(result.perRank).toHaveLength(1);
    expect(result.distributedPaise).toBe(pool);
    expect(result.perRank[0].rank).toBe(1);
  });

  it('handles N=8 with grouped equal payouts in tier 4-10', () => {
    const result = allocate(balanced.tiers, 8, pool);
    expect(result.perRank).toHaveLength(8);
    const tier4to8 = result.perRank.slice(3);
    const first = tier4to8[0].payoutPaise;
    expect(tier4to8.every((e) => e.payoutPaise === first)).toBe(true);
  });

  it('handles N=50', () => {
    const result = allocate(balanced.tiers, 50, pool);
    expect(result.perRank).toHaveLength(50);
    expect(result.distributedPaise).toBe(pool);
  });

  it('handles N=10000', () => {
    const result = allocate(balanced.tiers, 10000, pool);
    expect(result.perRank).toHaveLength(10000);
    expect(result.distributedPaise).toBe(pool);
    const last = result.perRank[9999];
    expect(last.payoutPaise).toBeGreaterThan(0n);
  });

  it('returns empty for N=0', () => {
    const result = allocate(balanced.tiers, 0, pool);
    expect(result.perRank).toHaveLength(0);
    expect(result.distributedPaise).toBe(0n);
  });
});
