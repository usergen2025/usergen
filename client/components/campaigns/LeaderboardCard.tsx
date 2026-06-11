'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy, Info, AlertCircle, Hourglass, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { rupeesIN, templateLabel } from '@/lib/campaigns/prize-pool';
import { TierLeaderboard, type TierLeaderboardEntry } from '@/components/campaigns/TierLeaderboard';
import Tooltip from '@/components/ui/Tooltip';
import { BrandPrimaryButton } from '@/components/brand';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';

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

interface ScrapeRunSummary {
  id: string;
  scope: string;
  status: string;
  postsRequested: number;
  postsScraped: number;
  postsFailed: number;
  postsDisqualified: number;
  startedAt: string;
  finishedAt?: string | null;
  error?: string | null;
}

interface LeaderboardCardProps {
  campaignId: string;
  highlightCreatorId?: string;
  showSnapshot?: boolean;
  refreshToken?: number;
  onLoaded?: (data: LeaderboardData) => void;
  isPrivileged?: boolean;
  cooldownSec?: number;
  lastManualScrapeAt?: string | null;
  onRefreshComplete?: () => void;
  showRefreshButton?: boolean;
}

export function LeaderboardCard({
  campaignId,
  highlightCreatorId,
  showSnapshot,
  refreshToken,
  onLoaded,
  isPrivileged = false,
  cooldownSec = 21600,
  lastManualScrapeAt,
  onRefreshComplete,
  showRefreshButton = true,
}: LeaderboardCardProps) {
  const { showToast } = useToast();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [poolData, setPoolData] = useState<PrizePoolData | null>(null);
  const [snapshot, setSnapshot] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [runs, setRuns] = useState<ScrapeRunSummary[]>([]);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const loadRuns = useCallback(async () => {
    try {
      const res = await apiClient.getCampaignScrapeRuns(campaignId);
      setRuns((res.data as ScrapeRunSummary[]) || []);
    } catch {
      /* ignore */
    }
  }, [campaignId]);

  useEffect(() => {
    if (showRefreshButton) {
      void loadRuns();
    }
  }, [loadRuns, showRefreshButton]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const latestRun = runs[0];
  const cooldownRemainingMs = useMemo(() => {
    if (isPrivileged) return 0;
    if (!lastManualScrapeAt) return 0;
    const elapsed = now - new Date(lastManualScrapeAt).getTime();
    return Math.max(0, cooldownSec * 1000 - elapsed);
  }, [isPrivileged, lastManualScrapeAt, cooldownSec, now]);

  const cooldownActive = cooldownRemainingMs > 0;

  const formatCooldown = (ms: number) => {
    const totalMinutes = Math.ceil(ms / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    
    if (h === 0) {
      return m === 1 ? '1 minute' : `${m} minutes`;
    }
    if (m === 0) {
      return h === 1 ? '1 hour' : `${h} hours`;
    }
    const hourStr = h === 1 ? '1 hour' : `${h} hours`;
    const minStr = m === 1 ? '1 minute' : `${m} minutes`;
    return `${hourStr} ${minStr}`;
  };

  const pollUntilDone = useCallback(
    async (runId: string) => {
      setPolling(true);
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const res = await apiClient.getCampaignScrapeRuns(campaignId);
        const list = (res.data as ScrapeRunSummary[]) || [];
        setRuns(list);
        const run = list.find((r) => r.id === runId);
        if (run && ['COMPLETED', 'PARTIAL', 'FAILED'].includes(run.status)) {
          setPolling(false);
          onRefreshComplete?.();
          if (run.status === 'FAILED') {
            showToast(run.error || 'Scrape failed', 'error');
          } else {
            showToast(
              `Leaderboard updated (${run.postsScraped} posts, ${run.postsDisqualified} disqualified)`,
              'success',
            );
          }
          return;
        }
      }
      setPolling(false);
      showToast('Scrape is still running — refresh the page in a minute', 'info');
      onRefreshComplete?.();
    },
    [campaignId, onRefreshComplete, showToast],
  );

  const handleRefresh = async (force?: boolean) => {
    if (refreshLoading || polling) return;
    if (cooldownActive && !force) {
      showToast(`Please wait ${formatCooldown(cooldownRemainingMs)} before refreshing again`, 'info');
      return;
    }
    setRefreshLoading(true);
    try {
      const res = await apiClient.refreshCampaignLeaderboard(campaignId, { force: force || isPrivileged });
      const runId = res.data?.runId;
      showToast('Refreshing views from Instagram…', 'info');
      if (runId) {
        await pollUntilDone(runId);
      } else {
        await loadRuns();
        onRefreshComplete?.();
      }
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { retryAfterSec?: number; message?: string } } };
      if (ax.response?.status === 429) {
        const sec = ax.response.data?.retryAfterSec;
        showToast(
          ax.response.data?.message ||
            `Cooldown active${sec ? ` — try again in ${Math.ceil(sec / 60)} min` : ''}`,
          'info',
        );
      } else {
        showToast(err instanceof Error ? err.message : 'Failed to refresh leaderboard', 'error');
      }
    } finally {
      setRefreshLoading(false);
    }
  };

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
      <div className="brand-gradient-frame rounded-[20px] p-2.5 sm:p-3 shadow-card">
        <div className="rounded-[17px] bg-white/95 p-4">
          <div className="h-4 w-32 animate-pulse rounded bg-[#F0E9E2]" />
          <div className="mt-3 h-3 w-full animate-pulse rounded bg-[#F0E9E2]" />
          <div className="mt-2 h-12 w-full animate-pulse rounded bg-[#F0E9E2]" />
        </div>
      </div>
    );
  }
  
  if (error || !data) {
    return (
      <div className="brand-gradient-frame rounded-[20px] p-2.5 sm:p-3 shadow-card">
        <div className="rounded-[17px] bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          {error || 'Leaderboard not available for this campaign.'}
        </div>
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
      <p className="mt-2 pt-2 border-t border-[#E8E2DB] text-[11px] opacity-80">
        Final payouts computed after campaign ends plus grace period. 
        Creators without verified post at finalization are dropped.
      </p>
    </div>
  );

  const lastSyncText = latestRun?.finishedAt
    ? `Last sync: ${new Date(latestRun.finishedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}`
    : latestRun?.status === 'RUNNING' || latestRun?.status === 'PENDING'
      ? 'Sync in progress…'
      : 'No sync yet';

  const refreshButtonDisabled = refreshLoading || polling || (cooldownActive && !isPrivileged);
  const refreshTooltipContent = cooldownActive && !isPrivileged
    ? `Next refresh in ${formatCooldown(cooldownRemainingMs)}`
    : undefined;

  return (
    <div className="brand-gradient-frame rounded-[20px] p-2.5 sm:p-3 shadow-card">
      <div className="rounded-[17px] bg-white/95 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[#E86412]" />
            <h3 className="font-heading text-base font-semibold text-[#212121]">Leaderboard</h3>
            <Tooltip content={infoTooltipContent} position="bottom">
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded-full text-text-secondary hover:bg-[#F0E9E2] hover:text-[#212121] transition-colors"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
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
            {showRefreshButton && (
              refreshTooltipContent ? (
                <Tooltip content={refreshTooltipContent} position="bottom">
                  <span>
                    <BrandPrimaryButton
                      type="button"
                      size="sm"
                      disabled={refreshButtonDisabled}
                      onClick={() => void handleRefresh(isPrivileged)}
                      className="shrink-0 !py-1.5 !px-2.5"
                    >
                      <RefreshCw className={cn('mr-1 h-3.5 w-3.5', (refreshLoading || polling) && 'animate-spin')} />
                      {polling ? 'Syncing…' : refreshLoading ? 'Starting…' : 'Refresh'}
                    </BrandPrimaryButton>
                  </span>
                </Tooltip>
              ) : (
                <BrandPrimaryButton
                  type="button"
                  size="sm"
                  disabled={refreshButtonDisabled}
                  onClick={() => void handleRefresh(isPrivileged)}
                  className="shrink-0 !py-1.5 !px-2.5"
                >
                  <RefreshCw className={cn('mr-1 h-3.5 w-3.5', (refreshLoading || polling) && 'animate-spin')} />
                  {polling ? 'Syncing…' : refreshLoading ? 'Starting…' : 'Refresh'}
                </BrandPrimaryButton>
              )
            )}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-text-secondary">
          <span>
            Pool ₹{rupeesIN(data.totalPoolRupees)} · {data.qualifiersCount} qualifying / {data.approvedCount} approved
            {data.gracePeriodHours ? ` · ends ${new Date(data.endDate).toLocaleDateString('en-IN')} (+${data.gracePeriodHours}h grace)` : ''}
          </span>
          {showRefreshButton && (
            <span className="text-[11px]">{lastSyncText}</span>
          )}
        </div>

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
    </div>
  );
}


export function PrizePoolSummary({ campaignId }: { campaignId: string }) {
  return null;
}
