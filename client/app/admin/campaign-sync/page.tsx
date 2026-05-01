'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';

interface WalletSyncEvent {
  id: string;
  eventType: string;
  status: 'SYNCED' | 'RETRY_PENDING' | 'FAILED';
  attempts: number;
  payload: Record<string, unknown> | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'admin_campaign_sync_filters_v1';

export default function AdminCampaignSyncPage() {
  const { showToast } = useToast();
  const [events, setEvents] = useState<WalletSyncEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [isBulkRetrying, setIsBulkRetrying] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SYNCED' | 'RETRY_PENDING' | 'FAILED'>('ALL');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [summary, setSummary] = useState({
    syncedCount: 0,
    retryPendingCount: 0,
    failedCount: 0,
    totalCount: 0,
  });

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        statusFilter?: 'ALL' | 'SYNCED' | 'RETRY_PENDING' | 'FAILED';
        eventTypeFilter?: string;
        startDate?: string;
        endDate?: string;
      };
      if (parsed.statusFilter) setStatusFilter(parsed.statusFilter);
      if (parsed.eventTypeFilter) setEventTypeFilter(parsed.eventTypeFilter);
      if (parsed.startDate) setStartDate(parsed.startDate);
      if (parsed.endDate) setEndDate(parsed.endDate);
    } catch {
      // Ignore persisted filter parsing errors.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ statusFilter, eventTypeFilter, startDate, endDate }),
    );
  }, [statusFilter, eventTypeFilter, startDate, endDate]);

  const loadSummary = useCallback(async () => {
    try {
      const response = await apiClient.getCampaignWalletSyncSummary();
      if (response.data) {
        setSummary({
          syncedCount: response.data.syncedCount ?? 0,
          retryPendingCount: response.data.retryPendingCount ?? 0,
          failedCount: response.data.failedCount ?? 0,
          totalCount: response.data.totalCount ?? 0,
        });
        setEventTypes(response.data.eventTypes ?? []);
      }
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to load wallet sync summary'), 'error');
    }
  }, [showToast]);

  const loadEvents = useCallback(async (opts?: { append?: boolean }) => {
    const append = opts?.append === true;
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    try {
      const response = await apiClient.getCampaignWalletSyncEvents({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        eventType: eventTypeFilter === 'ALL' ? undefined : eventTypeFilter,
        limit: 25,
        cursor: append ? nextCursor : null,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(`${endDate}T23:59:59.999Z`).toISOString() : undefined,
      });
      const data = response.data;
      const items = data?.items || [];
      setEvents((prev) => (append ? [...prev, ...items] : items));
      setHasMore(Boolean(data?.hasMore));
      setNextCursor(data?.nextCursor || null);
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to load wallet sync events'), 'error');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [endDate, eventTypeFilter, nextCursor, showToast, startDate, statusFilter]);

  useEffect(() => {
    loadEvents();
  }, [endDate, eventTypeFilter, loadEvents, startDate, statusFilter]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleRetry = async (eventId: string) => {
    setRetryingId(eventId);
    try {
      await apiClient.retryCampaignWalletSyncEvent(eventId);
      showToast('Retry triggered successfully', 'success');
      await loadEvents();
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Retry failed'), 'error');
    } finally {
      setRetryingId(null);
    }
  };

  const handleBulkRetry = async () => {
    setIsBulkRetrying(true);
    try {
      const statuses = statusFilter === 'ALL' || statusFilter === 'SYNCED' ? ['RETRY_PENDING', 'FAILED'] : [statusFilter];
      const response = await apiClient.retryCampaignWalletSyncEvents(statuses as Array<'RETRY_PENDING' | 'FAILED'>);
      const data = response.data;
      showToast(
        `Bulk retry complete: ${data?.synced ?? 0} synced, ${data?.failed ?? 0} failed, ${data?.skipped ?? 0} skipped out of ${data?.processed ?? 0}`,
        'success',
      );
      await loadSummary();
      await loadEvents();
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Bulk retry failed'), 'error');
    } finally {
      setIsBulkRetrying(false);
    }
  };

  const retryableCount = events.filter(
    (event) => event.status === 'RETRY_PENDING' || event.status === 'FAILED',
  ).length;

  const handleExportCsv = () => {
    if (!events.length) {
      showToast('No events available to export', 'error');
      return;
    }
    const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'id',
      'eventType',
      'status',
      'attempts',
      'lastError',
      'createdAt',
      'updatedAt',
    ];
    const rows = events.map((event) =>
      [
        event.id,
        event.eventType,
        event.status,
        event.attempts,
        event.lastError ?? '',
        event.createdAt,
        event.updatedAt,
      ]
        .map(escapeCsv)
        .join(','),
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const dateSuffix = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `campaign-wallet-sync-${dateSuffix}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleExportAllCsv = async () => {
    try {
      const blob = await apiClient.exportCampaignWalletSyncEventsCsv({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        eventType: eventTypeFilter === 'ALL' ? undefined : eventTypeFilter,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(`${endDate}T23:59:59.999Z`).toISOString() : undefined,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const dateSuffix = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `campaign-wallet-sync-all-${dateSuffix}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to export all filtered events'), 'error');
    }
  };

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
          <p className="text-xs text-gray-400">Total Events</p>
          <p className="text-xl font-semibold text-white">{summary.totalCount}</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
          <p className="text-xs text-gray-400">Synced</p>
          <p className="text-xl font-semibold text-green-400">{summary.syncedCount}</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
          <p className="text-xs text-gray-400">Retry Pending</p>
          <p className="text-xl font-semibold text-yellow-400">{summary.retryPendingCount}</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
          <p className="text-xs text-gray-400">Failed</p>
          <p className="text-xl font-semibold text-red-400">{summary.failedCount}</p>
        </div>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Campaign Wallet Sync</h1>
          <p className="text-gray-400">Track failed sync events and trigger manual retries.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'SYNCED' | 'RETRY_PENDING' | 'FAILED')}
            className="px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm"
          >
            <option value="ALL">All statuses</option>
            <option value="RETRY_PENDING">Retry pending</option>
            <option value="FAILED">Failed</option>
            <option value="SYNCED">Synced</option>
          </select>
          <select
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm"
          >
            <option value="ALL">All event types</option>
            {eventTypes.map((eventType) => (
              <option key={eventType} value={eventType}>
                {eventType}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm"
          />
          <button
            onClick={handleBulkRetry}
            disabled={isBulkRetrying || retryableCount === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${isBulkRetrying ? 'animate-spin' : ''}`} />
            Retry Filtered
          </button>
          <button
            onClick={() => {
              void loadEvents();
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={handleExportAllCsv}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            Export All CSV
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center text-gray-400">Loading events...</div>
      ) : events.length === 0 ? (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center text-gray-400">No wallet sync events yet.</div>
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const canRetry = event.status === 'RETRY_PENDING' || event.status === 'FAILED';
            const statusClass =
              event.status === 'SYNCED'
                ? 'text-green-400 bg-green-500/10 border-green-500/30'
                : event.status === 'RETRY_PENDING'
                  ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
                  : 'text-red-400 bg-red-500/10 border-red-500/30';
            return (
              <div key={event.id} className="bg-gray-800 rounded-xl border border-gray-700 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-white font-semibold">{event.eventType}</h2>
                      <span className={`px-2 py-0.5 text-xs border rounded-full ${statusClass}`}>{event.status}</span>
                    </div>
                    <p className="text-xs text-gray-400">Event ID: {event.id}</p>
                    <p className="text-sm text-gray-300">
                      Attempts: <span className="font-medium">{event.attempts}</span>
                    </p>
                    <p className="text-sm text-gray-300">
                      Updated: {new Date(event.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  {canRetry && (
                    <button
                      onClick={() => handleRetry(event.id)}
                      disabled={retryingId === event.id}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-60"
                    >
                      <RefreshCw className={`w-4 h-4 ${retryingId === event.id ? 'animate-spin' : ''}`} />
                      Retry
                    </button>
                  )}
                </div>

                {event.lastError && (
                  <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    {event.lastError}
                  </div>
                )}

                {event.status === 'SYNCED' && (
                  <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    Synced successfully.
                  </div>
                )}
              </div>
            );
          })}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => loadEvents({ append: true })}
                disabled={isLoadingMore}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingMore ? 'animate-spin' : ''}`} />
                Load More
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
