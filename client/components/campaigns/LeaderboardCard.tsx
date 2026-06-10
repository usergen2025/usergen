'use client';

import { useEffect, useState } from 'react';
import { Trophy, Info, AlertCircle, Hourglass } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { rupeesIN, templateLabel } from '@/lib/campaigns/prize-pool';
import { TierLeaderboard, type TierLeaderboardEntry } from '@/components/campaigns/TierLeaderboard';
import Tooltip from '@/components/ui/Tooltip';

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

interface PrizePoolData {
  totalBudget: number;
  templateKey?: string;
  tieBreaker?: string;
  minViewsToQualify?: number;
  gracePeriodHours?: number;
  payoutModel?: string;
}

interface LeaderboardCardProps {
  campaignId: string;
  highlightCreatorId?: string;
  showSnapshot?: boolean;
  refreshToken?: number;
  onLoaded?: (data: LeaderboardData) => void;
}

export function LeaderboardCard({
  campaignId,
  highlightCreatorId,
  showSnapshot,
  refreshToken,
  onLoaded,
}: LeaderboardCardProps) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [poolData, setPoolData] = useState<PrizePoolData | null>(null);
  const [snapshot, setSnapshot] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const [leaderboardRes, poolRes] = await Promise.all([
          apiClient.getCampaignLeaderboard(campaignId),
          apiClient.getCampaignPrizePool(campaignId),
        ]);
        if (cancelled) return;
        const payload = (leaderboardRes.data ?? null) as LeaderboardData | null;
        const pool = (poolRes.data ?? null) as PrizePoolData | null;
        setData(payload);
        setPoolData(pool);
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
  }, [campaignId, showSnapshot, refreshToken, onLoaded]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#E8E2DB] bg-white p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-[#F0E9E2]" />
        <div className="mt-3 h-3 w-full animate-pulse rounded bg-[#F0E9E2]" />
        <div className="mt-2 h-12 w-full animate-pulse rounded bg-[#F0E9E2]" />
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

  const infoTooltipContent = (
    <div className="max-w-xs space-y-1.5 text-xs">
      <p><strong>Pool:</strong> ₹{rupeesIN(data.totalPoolRupees)}</p>
      {poolData?.templateKey && (
        <p><strong>Template:</strong> {templateLabel(poolData.templateKey)}</p>
      )}
      {poolData?.tieBreaker && (
        <p><strong>Tie-breaker:</strong> {poolData.tieBreaker.replace(/_/g, ' ')}</p>
      )}
      <p><strong>Min views:</strong> {poolData?.minViewsToQualify ?? 0}</p>
      <p><strong>Grace period:</strong> {data.gracePeriodHours}h</p>
      <p><strong>Ends:</strong> {new Date(data.endDate).toLocaleDateString('en-IN')}</p>
      <p className="mt-2 pt-2 border-t border-white/20 text-[11px] opacity-80">
        Final payouts computed after campaign ends plus grace period. 
        Creators without verified post at finalization are dropped.
      </p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-[#E8E2DB] bg-white p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-[#E86412]" />
          <h3 className="font-heading text-base font-semibold text-[#212121]">Leaderboard</h3>
        </div>
        <div className="flex items-center gap-2">
          {data.finalizationStatus === 'COMPLETED' && (
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
              Finalized
            </span>
          )}
          {data.finalizationStatus === 'RUNNING' && (
            <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
              <Hourglass className="h-3 w-3" /> Finalizing…
            </span>
          )}
          <Tooltip content={infoTooltipContent} position="left">
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-full text-text-secondary hover:bg-[#F0E9E2] hover:text-[#212121] transition-colors"
            >
              <Info className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      <p className="mb-3 text-xs text-text-secondary">
        Pool ₹{rupeesIN(data.totalPoolRupees)} · {data.qualifiersCount} qualifying / {data.approvedCount} approved
        {data.gracePeriodHours ? ` · ends ${new Date(data.endDate).toLocaleDateString('en-IN')} (+${data.gracePeriodHours}h grace)` : ''}
      </p>

      <TierLeaderboard
        entries={tierEntries}
        highlightCreatorId={highlightCreatorId}
        qualifiersCount={data.qualifiersCount}
      />

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
  return null;
}
