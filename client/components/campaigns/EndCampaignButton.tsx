'use client';

import { useState } from 'react';
import { Square } from 'lucide-react';
import { BrandPrimaryButton, BrandSecondaryButton } from '@/components/brand';
import Modal from '@/components/ui/Modal';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';

interface EndCampaignButtonProps {
  campaignId: string;
  status: string;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  startDate: string;
  payoutModel?: 'CPM' | 'POOL';
  onEnded?: () => void;
}

export function EndCampaignButton({
  campaignId,
  status,
  actualStartDate,
  actualEndDate,
  startDate,
  payoutModel,
  onEnded,
}: EndCampaignButtonProps) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skipGracePeriod, setSkipGracePeriod] = useState(true);

  const hasStarted =
    status === 'IN_PROGRESS' ||
    Boolean(actualStartDate) ||
    Date.now() >= new Date(startDate).getTime();

  const canEnd =
    !actualEndDate &&
    status !== 'COMPLETED' &&
    status !== 'DRAFT' &&
    status !== 'PAUSED' &&
    hasStarted;

  const handleEnd = async () => {
    setLoading(true);
    try {
      await apiClient.endCampaign(campaignId, {
        skipGracePeriod: payoutModel === 'POOL' ? skipGracePeriod : true,
      });
      showToast(
        skipGracePeriod && payoutModel === 'POOL'
          ? 'Campaign ended — finalization has been triggered.'
          : 'Campaign ended. Finalization will run after the grace period.',
        'success',
      );
      setOpen(false);
      onEnded?.();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to end campaign', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!canEnd) {
    return null;
  }

  return (
    <>
      <BrandSecondaryButton
        type="button"
        className="!h-10 !min-h-10 !rounded-full !border-red-200 !px-4 !py-0 !text-red-700 hover:!bg-red-50"
        title="End campaign now"
        aria-label="End campaign now"
        onClick={() => setOpen(true)}
      >
        <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        End now
      </BrandSecondaryButton>

      <Modal isOpen={open} onClose={() => !loading && setOpen(false)} className="max-w-md">
        <div className="p-4 sm:p-5">
          <h3 className="brand-page-section-title mb-1.5">End campaign now?</h3>
          <p className="mb-3 text-xs sm:text-sm text-text-secondary">
            This will stop new post submissions and begin the campaign wrap-up process
            {payoutModel === 'POOL' ? ', including prize pool distribution' : ''}. This action
            cannot be undone.
          </p>

          {payoutModel === 'POOL' && (
            <label className="mb-4 flex cursor-pointer items-start gap-2 rounded-xl border border-[#E8E2DB] bg-white p-3">
              <input
                type="checkbox"
                checked={skipGracePeriod}
                onChange={(e) => setSkipGracePeriod(e.target.checked)}
                className="mt-0.5 accent-[#E86512]"
              />
              <span className="text-xs sm:text-sm text-[#212121]">
                Finalize immediately (skip grace period and run payout now)
              </span>
            </label>
          )}

          <div className="flex gap-2">
            <BrandSecondaryButton
              type="button"
              size="sm"
              disabled={loading}
              onClick={() => setOpen(false)}
              className="flex-1"
            >
              Cancel
            </BrandSecondaryButton>
            <BrandPrimaryButton
              type="button"
              size="sm"
              disabled={loading}
              onClick={() => void handleEnd()}
              className="flex-1 !bg-red-600 hover:!bg-red-700"
            >
              {loading ? 'Ending…' : 'End campaign'}
            </BrandPrimaryButton>
          </div>
        </div>
      </Modal>
    </>
  );
}
