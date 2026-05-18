'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { BrandPrimaryButton } from '@/components/brand';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';

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

interface LeaderboardRefreshButtonProps {
  campaignId: string;
  isPrivileged?: boolean;
  cooldownSec?: number;
  lastManualScrapeAt?: string | null;
  onRefreshComplete?: () => void;
  className?: string;
}

export function LeaderboardRefreshButton({
  campaignId,
  isPrivileged = false,
  cooldownSec = 21600,
  lastManualScrapeAt,
  onRefreshComplete,
  className,
}: LeaderboardRefreshButtonProps) {
  const { showToast } = useToast();
  const [runs, setRuns] = useState<ScrapeRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
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
    void loadRuns();
  }, [loadRuns]);

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
    if (loading || polling) return;
    if (cooldownActive && !force) {
      showToast(`Please wait ${formatCooldown(cooldownRemainingMs)} before refreshing again`, 'info');
      return;
    }
    setLoading(true);
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
      setLoading(false);
    }
  };

  const formatCooldown = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.ceil((ms % 3600000) / 60000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className={cn('rounded-2xl border border-[#E8E2DB] bg-white p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading text-sm font-medium text-[#212121]">Leaderboard sync</p>
          <p className="text-xs text-text-secondary">
            {latestRun?.finishedAt
              ? `Last sync ${new Date(latestRun.finishedAt).toLocaleString('en-IN')} (${latestRun.scope}, ${latestRun.status})`
              : latestRun?.status === 'RUNNING' || latestRun?.status === 'PENDING'
                ? 'Sync in progress…'
                : 'No sync yet — refresh to pull view counts from Instagram'}
          </p>
          {cooldownActive && (
            <p className="mt-0.5 text-[11px] text-amber-700">
              Next manual refresh in {formatCooldown(cooldownRemainingMs)}
            </p>
          )}
        </div>
        <BrandPrimaryButton
          type="button"
          size="sm"
          disabled={loading || polling || (cooldownActive && !isPrivileged)}
          onClick={() => void handleRefresh(isPrivileged)}
          className="shrink-0"
        >
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', (loading || polling) && 'animate-spin')} />
          {polling ? 'Syncing…' : loading ? 'Starting…' : 'Refresh views'}
        </BrandPrimaryButton>
      </div>
    </div>
  );
}
