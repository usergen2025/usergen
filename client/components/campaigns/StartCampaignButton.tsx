'use client';

import { useCallback, useEffect, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { BrandPrimaryButton, BrandSecondaryButton } from '@/components/brand';
import Modal from '@/components/ui/Modal';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { startOfDay } from 'date-fns';

interface StartCampaignButtonProps {
  campaignId: string;
  startDate: string;
  actualStartDate?: string | null;
  onStarted?: () => void;
}

export function StartCampaignButton({
  campaignId,
  startDate,
  actualStartDate,
  onStarted,
}: StartCampaignButtonProps) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [fetchingCount, setFetchingCount] = useState(false);

  const scheduledStart = startOfDay(new Date(startDate));
  const canStartEarly =
    !actualStartDate && Date.now() < scheduledStart.getTime();

  const loadPendingCount = useCallback(async () => {
    setFetchingCount(true);
    try {
      const res = await apiClient.getPendingApplicationsCount(campaignId);
      setPendingCount(res.data?.count ?? 0);
    } catch {
      setPendingCount(0);
    } finally {
      setFetchingCount(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (open) {
      void loadPendingCount();
    }
  }, [open, loadPendingCount]);

  const handleStart = async (handlePendingAs: 'REJECT_ALL' | 'KEEP_PENDING') => {
    setLoading(true);
    try {
      const res = await apiClient.startCampaign(campaignId, { handlePendingAs });
      const rejected = res.data?.rejectedCount ?? 0;
      showToast(
        rejected > 0
          ? `Campaign started. ${rejected} pending application(s) were rejected.`
          : 'Campaign started — approved creators can now submit final post links.',
        'success',
      );
      setOpen(false);
      onStarted?.();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to start campaign', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!canStartEarly) {
    return null;
  }

  return (
    <>
      <BrandPrimaryButton
        type="button"
        className="!h-10 !min-h-10 !rounded-full !px-4 !py-0 !shadow-[0_8px_22px_rgba(242,126,53,0.35)]"
        title="Start campaign now"
        aria-label="Start campaign now"
        onClick={() => setOpen(true)}
      >
        <PlayCircle className="mr-1.5 h-4 w-4" aria-hidden />
        Start now
      </BrandPrimaryButton>

      <Modal isOpen={open} onClose={() => !loading && setOpen(false)} className="max-w-md">
        <div className="p-4 sm:p-5">
          <h3 className="brand-page-section-title mb-1.5">Start campaign early?</h3>
          <p className="mb-3 text-xs sm:text-sm text-text-secondary">
            This will close the application window immediately and notify approved creators that
            they can submit their final post links. Originally scheduled for{' '}
            {scheduledStart.toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            .
          </p>

          {fetchingCount ? (
            <p className="mb-3 text-xs text-text-secondary">Checking pending applications…</p>
          ) : pendingCount > 0 ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">
                {pendingCount} application{pendingCount !== 1 ? 's' : ''} still pending review
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Choose whether to reject all pending applications or leave them as-is (they will
                not be able to submit post links unless approved later).
              </p>
            </div>
          ) : (
            <p className="mb-4 text-xs text-text-secondary">No pending applications to review.</p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <BrandSecondaryButton
              type="button"
              size="sm"
              disabled={loading}
              onClick={() => setOpen(false)}
              className="sm:flex-1"
            >
              Cancel
            </BrandSecondaryButton>
            {pendingCount > 0 && (
              <BrandSecondaryButton
                type="button"
                size="sm"
                disabled={loading}
                onClick={() => void handleStart('KEEP_PENDING')}
                className="sm:flex-1"
              >
                Keep pending & start
              </BrandSecondaryButton>
            )}
            <BrandPrimaryButton
              type="button"
              size="sm"
              disabled={loading}
              onClick={() =>
                void handleStart(pendingCount > 0 ? 'REJECT_ALL' : 'KEEP_PENDING')
              }
              className="sm:flex-1"
            >
              {pendingCount > 0 ? 'Reject pending & start' : 'Start campaign'}
            </BrandPrimaryButton>
          </div>
        </div>
      </Modal>
    </>
  );
}
