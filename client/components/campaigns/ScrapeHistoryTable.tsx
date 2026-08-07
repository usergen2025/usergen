'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';

interface ScrapeRunRow {
  id: string;
  scope: string;
  status: string;
  triggeredBy: string;
  postsRequested: number;
  postsScraped: number;
  postsFailed: number;
  postsDisqualified: number;
  startedAt: string;
  finishedAt?: string | null;
  error?: string | null;
}

interface ScrapeResultRow {
  id: string;
  status: string;
  videoPlayCount?: number | null;
  ownerUsername?: string | null;
  errorMessage?: string | null;
  postSubmission?: { postUrl?: string; creatorId?: string };
}

interface ScrapeHistoryTableProps {
  campaignId: string;
  className?: string;
}

export function ScrapeHistoryTable({ campaignId, className }: ScrapeHistoryTableProps) {
  const [runs, setRuns] = useState<ScrapeRunRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ScrapeResultRow[]>>({});
  const [loading, setLoading] = useState(true);

  const loadRuns = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.getCampaignScrapeRuns(campaignId);
      setRuns((res.data as ScrapeRunRow[]) || []);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const toggleExpand = async (runId: string) => {
    if (expandedId === runId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(runId);
    if (!details[runId]) {
      const res = await apiClient.getCampaignScrapeRun(campaignId, runId);
      const payload = res.data as { results?: ScrapeResultRow[] };
      setDetails((prev) => ({ ...prev, [runId]: payload?.results || [] }));
    }
  };

  if (loading) {
    return (
      <div className={cn('rounded-2xl border border-[#E8E2DB] bg-white p-4', className)}>
        <div className="h-3 w-40 animate-pulse rounded bg-[#F0E9E2]" />
      </div>
    );
  }

  if (!runs.length) {
    return null;
  }

  return (
    <div className={cn('rounded-2xl border border-[#E8E2DB] bg-white p-4', className)}>
      <p className="font-heading text-sm font-medium text-[#212121]">Scrape history</p>
      <p className="mb-3 text-xs text-text-secondary">Apify Instagram reel sync runs for this campaign.</p>
      <div className="space-y-1">
        {runs.map((run) => {
          const expanded = expandedId === run.id;
          return (
            <div key={run.id} className="rounded-lg border border-[#F0E9E2]">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left text-xs"
                onClick={() => void toggleExpand(run.id)}
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#9E9E9E]" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9E9E9E]" />
                )}
                <span className="font-medium text-[#212121]">
                  {run.scope} · {run.status}
                </span>
                <span className="text-text-secondary">
                  {new Date(run.startedAt).toLocaleString('en-IN')}
                </span>
                <span className="ml-auto text-text-secondary">
                  {run.postsScraped}/{run.postsRequested} ok
                  {run.postsDisqualified > 0 ? ` · ${run.postsDisqualified} DQ` : ''}
                </span>
              </button>
              {expanded && (
                <ul className="max-h-48 overflow-y-auto border-t border-[#F0E9E2] px-2 py-1">
                  {(details[run.id] || []).map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1 text-[11px]"
                    >
                      <span className="truncate text-[#212121]">
                        {r.status} · {r.postSubmission?.creatorId?.slice(-8) || '—'}
                      </span>
                      <span className="shrink-0 text-text-secondary">
                        {r.videoPlayCount != null ? `${r.videoPlayCount.toLocaleString()} plays` : r.errorMessage || ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
