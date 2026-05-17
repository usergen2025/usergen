'use client';

import { useEffect, useState } from 'react';
import { Hourglass, AlertCircle } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { rupeesIN, templateLabel, normalizePoolTiers, type PrizePoolTier } from '@/lib/campaigns/prize-pool';
import { TierLeaderboard, type TierLeaderboardEntry } from '@/components/campaigns/TierLeaderboard';

interface LeaderboardData {
  campaignId: string;
  payoutModel: 'CPM' | 'POOL';
  totalPoolPaise: string;
  totalPoolRupees: number;
  qualifiersCount: number;
  approvedCount: number;
  approvedWithVerifiedPostCount: number;
  entries: Array<{
    rank: number;
    creatorId: string;
    postSubmissionId?: string;
    postUrl?: string;
    platform?: string;
    views: number;
    hasVerifiedPost: boolean;
    qualifies: boolean;
    projectedPayoutPaise: string;
    projectedPayoutRupees: number;
    percentageBps: number;
    caveat?: string;
  }>;
  caveat: string;
  finalizationStatus: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | null;
  finalizedAt: string | null;
  endDate: string;
  gracePeriodHours: number;
  tiers?: unknown[];
  tierGroups?: unknown[];
}

interface LeaderboardCardProps {
  campaignId: string;
  highlightCreatorId?: string;
  showSnapshot?: boolean;
  limit?: number;
  onLoaded?: (data: LeaderboardData) => void;
}

export function LeaderboardCard({
  campaignId,
  highlightCreatorId,
  showSnapshot,
  onLoaded,
}: LeaderboardCardProps) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [snapshot, setSnapshot] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const res = await apiClient.getCampaignLeaderboard(campaignId);
        if (cancelled) return;
        const payload = (res.data ?? null) as LeaderboardData | null;
        setData(payload);
        if (payload) onLoaded?.(payload);
        if (showSnapshot && payload?.finalizationStatus === 'COMPLETED') {
          const snap = await apiClient.getCampaignLeaderboardSnapshot(campaignId);
          if (!cancelled) setSnapshot(snap.data ?? []);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [campaignId, showSnapshot, onLoaded]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#E8E2DB] bg-white p-4">
        <div className="h-3 w-32 animate-pulse rounded bg-[#F0E9E2]" />
        <div className="mt-3 h-3 w-full animate-pulse rounded bg-[#F0E9E2]" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        {error || 'Leaderboard not available for this campaign.'}
      </div>
    );
  }
  if (data.payoutModel === 'CPM') {
    return null;
  }

  const tierEntries: TierLeaderboardEntry[] = data.entries.map((e) => ({
    rank: e.rank,
    creatorId: e.creatorId,
    views: e.views,
    projectedPayoutPaise: e.projectedPayoutPaise,
    projectedPayoutRupees: e.projectedPayoutRupees,
    qualifies: e.qualifies,
    caveat: e.caveat,
  }));

  const previewN = Math.max(data.qualifiersCount || 1, data.approvedCount || 1);

  return (
    <div className="rounded-2xl border border-[#E8E2DB] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-heading text-sm font-medium text-[#212121]">
            Prize pool leaderboard · {data.qualifiersCount} qualifying / {data.approvedCount} approved
          </p>
          <p className="text-xs text-text-secondary">
            Pool ₹{rupeesIN(data.totalPoolRupees)} · ends {new Date(data.endDate).toLocaleDateString('en-IN')}
            {data.gracePeriodHours ? ` (+${data.gracePeriodHours}h grace)` : ''}
          </p>
        </div>
        {data.finalizationStatus === 'COMPLETED' && (
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
            Finalized {data.finalizedAt ? new Date(data.finalizedAt).toLocaleDateString('en-IN') : ''}
          </span>
        )}
        {data.finalizationStatus === 'RUNNING' && (
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
            <Hourglass className="h-3 w-3" /> Finalizing…
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-text-secondary">{data.caveat}</p>

      <div className="mt-3">
        <TierLeaderboard
          tiers={data.tiers || []}
          tierGroups={data.tierGroups as never}
          entries={tierEntries}
          highlightCreatorId={highlightCreatorId}
          totalPoolRupees={data.totalPoolRupees}
          participants={previewN}
        />
      </div>

      {showSnapshot && snapshot && snapshot.length > 0 && (
        <div className="mt-3 rounded-xl border border-[#E8E2DB] bg-[#FFFCF7] p-3">
          <p className="text-xs font-medium text-[#212121]">Final snapshot</p>
          <p className="text-[11px] text-text-secondary">
            {snapshot.filter((s) => s.rank).length} qualifiers · {snapshot.filter((s) => !s.rank).length} dropped
          </p>
        </div>
      )}
    </div>
  );
}


export function PrizePoolSummary({ campaignId }: { campaignId: string }) {
  const [pool, setPool] = useState<{
    totalBudget: number;
    templateKey?: string;
    tiers?: unknown[];
    tieBreaker?: string;
    minViewsToQualify?: number;
    gracePeriodHours?: number;
    payoutModel?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getCampaignPrizePool(campaignId)
      .then((res) => {
        if (cancelled) return;
        setPool(res.data || null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#E8E2DB] bg-white p-4">
        <div className="h-3 w-40 animate-pulse rounded bg-[#F0E9E2]" />
      </div>
    );
  }
  if (!pool || pool.payoutModel !== 'POOL') return null;

  const tiers = normalizePoolTiers({
    tiers: pool.tiers as PrizePoolTier[] | undefined,
    templateKey: pool.templateKey,
  });

  return (
    <div className="rounded-2xl border border-[#E8E2DB] bg-white p-4">
      <p className="font-heading text-sm font-medium text-[#212121]">
        Prize pool · ₹{rupeesIN(pool.totalBudget)} · {templateLabel(pool.templateKey)}
      </p>
      <p className="mt-1 text-xs text-text-secondary">
        Tie-breaker: {pool.tieBreaker} · Min views: {pool.minViewsToQualify} · Grace: {pool.gracePeriodHours}h
      </p>
      <div className="mt-3">
        <TierLeaderboard tiers={tiers} totalPoolRupees={pool.totalBudget} participants={1000} />
      </div>
    </div>
  );
}
