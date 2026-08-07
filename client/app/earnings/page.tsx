'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { IndianRupee, Lock, Wallet } from 'lucide-react';
import { BrandPageHeader, BrandStatStrip, type BrandStatItem } from '@/components/brand';
import { cn } from '@/lib/utils/cn';

interface EarningEntry {
  id: string;
  campaignId: string;
  postSubmissionId: string;
  viewsDelta: number;
  amount: number;
  status: 'LOCKED' | 'AVAILABLE' | 'REVERSED';
  earnedAt: string;
  unlockAt: string;
  availableAt: string | null;
}

interface EarningSummary {
  totalEarnings: number;
  availableEarnings: number;
  lockedEarnings: number;
  entries: EarningEntry[];
}

export default function EarningsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isRequesting, setIsRequesting] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [summary, setSummary] = useState<EarningSummary>({
    totalEarnings: 0,
    availableEarnings: 0,
    lockedEarnings: 0,
    entries: [],
  });

  useEffect(() => {
    const loadEarnings = async () => {
      try {
        const response = await apiClient.getCreatorEarnings();
        if (response.data) {
          setSummary(response.data);
        }
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : 'Failed to load earnings', 'error');
      } finally {
        setIsLoading(false);
      }
    };
    void loadEarnings();
  }, [showToast]);

  const handleWithdraw = async () => {
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0) {
      showToast('Enter a valid withdrawal amount', 'error');
      return;
    }
    setIsRequesting(true);
    try {
      await apiClient.requestCreatorWithdrawal(amount);
      showToast('Withdrawal request created', 'success');
      setWithdrawAmount('');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Failed to create withdrawal request', 'error');
    } finally {
      setIsRequesting(false);
    }
  };

  const statItems: BrandStatItem[] = [
    {
      value: `₹${summary.totalEarnings.toLocaleString('en-IN')}`,
      label: 'Total Earnings',
      Icon: IndianRupee,
    },
    {
      value: `₹${summary.availableEarnings.toLocaleString('en-IN')}`,
      label: 'Available',
      Icon: Wallet,
    },
    {
      value: `₹${summary.lockedEarnings.toLocaleString('en-IN')}`,
      label: 'Locked',
      Icon: Lock,
    },
  ];

  const statusPillClass = (status: EarningEntry['status']) => {
    if (status === 'AVAILABLE') return 'brand-status-pill--completed';
    if (status === 'REVERSED') return 'brand-status-pill--failed';
    return 'brand-status-pill--pending';
  };

  return (
    <div className="brand-page-shell brand-page-shell--campaigns">
      <BrandPageHeader
        onBack={() => router.back()}
        className="mb-3 shrink-0 sm:mb-3"
        title="Earnings"
        subtitle="Campaign payouts and withdrawals."
      />

      <div className="brand-gradient-frame mb-3 shrink-0 p-3 sm:mb-4 sm:p-4">
        <BrandStatStrip items={statItems} layout="inline" columns={3} />
      </div>

      <div className="brand-gradient-frame mb-0 flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4">
        <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[18px] bg-white/95 shadow-sm">
          <div className="flex shrink-0 flex-col gap-3 border-b border-[#EFE8E3] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <h2 className="brand-page-section-title">Earning Entries</h2>
            <div className="flex items-center gap-2">
              <input
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Amount"
                inputMode="numeric"
                aria-label="Withdrawal amount"
                className="brand-field-capsule w-full sm:w-[9rem]"
              />
              <button
                type="button"
                onClick={handleWithdraw}
                disabled={isRequesting}
                className="brand-cta-primary brand-cta-primary--sm shrink-0 disabled:opacity-50"
              >
                Request
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {isLoading ? (
              <p className="brand-campaign-meta text-center text-[#616161]">Loading earnings…</p>
            ) : summary.entries.length === 0 ? (
              <div className="py-8 text-center sm:py-10">
                <div className="mx-auto max-w-md rounded-xl border border-dashed border-orange-200/80 bg-gradient-to-br from-orange-50/90 to-pink-50/90 p-6 sm:p-8">
                  <p className="font-heading text-base text-[#212121] sm:text-lg">
                    No earning entries yet.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 pr-0.5 sm:space-y-3">
                {summary.entries.map((entry) => (
                  <div key={entry.id} className="brand-campaign-card-figma shadow-sm">
                    <div className="flex flex-col gap-2 sm:gap-2.5">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                        <span className="brand-campaign-title min-w-0 truncate font-heading leading-tight text-[#212121]">
                          Campaign: {entry.campaignId}
                        </span>
                        <span
                          className={cn(
                            'brand-status-pill brand-status-pill--auto shrink-0',
                            statusPillClass(entry.status),
                          )}
                          translate="no"
                        >
                          {entry.status}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                        <span className="brand-campaign-row font-heading font-medium text-[#212121]">
                          Views delta: {entry.viewsDelta.toLocaleString('en-IN')}
                        </span>
                        <span className="brand-campaign-row inline-flex items-center gap-1.5 font-heading font-medium text-[#212121]">
                          <IndianRupee
                            className="brand-campaign-metric-stroke h-3.5 w-3.5"
                            strokeWidth={2}
                            aria-hidden
                          />
                          {Number(entry.amount || 0).toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
