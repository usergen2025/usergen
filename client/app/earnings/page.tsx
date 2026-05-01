'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { IndianRupee } from 'lucide-react';

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

  return (
    <div className="max-w-[1248px] mx-auto px-3 sm:px-6 md:px-[96px] py-2">
      <h1 className="font-heading text-2xl md:text-3xl font-medium text-black mb-6">Earnings</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl shadow-card p-5">
          <p className="text-sm text-text-secondary">Total Earnings</p>
          <p className="font-heading text-2xl mt-2 text-black flex items-center gap-1">
            <IndianRupee className="w-6 h-6" />
            {summary.totalEarnings.toLocaleString('en-IN')}
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-card p-5">
          <p className="text-sm text-text-secondary">Available Earnings</p>
          <p className="font-heading text-2xl mt-2 text-black">₹{summary.availableEarnings.toLocaleString('en-IN')}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-card p-5">
          <p className="text-sm text-text-secondary">Locked Earnings</p>
          <p className="font-heading text-2xl mt-2 text-black">₹{summary.lockedEarnings.toLocaleString('en-IN')}</p>
          <div className="mt-3">
            <p className="text-xs text-text-secondary mb-2">Withdrawal (currently disabled)</p>
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              value={withdrawAmount}
              onChange={(event) => setWithdrawAmount(event.target.value.replace(/[^0-9]/g, ''))}
              placeholder="Amount"
            />
            <Button variant="primary" size="sm" onClick={handleWithdraw} disabled={isRequesting}>
              Request
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-card p-5">
        <h2 className="font-heading text-xl font-medium text-black mb-4">Earning Entries</h2>
        {isLoading ? (
          <p className="text-text-secondary">Loading earnings...</p>
        ) : summary.entries.length === 0 ? (
          <p className="text-text-secondary">No earning entries yet.</p>
        ) : (
          <div className="space-y-3">
            {summary.entries.map((entry) => (
              <div key={entry.id} className="border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-black">Campaign: {entry.campaignId}</p>
                <p className="text-xs text-text-secondary mt-1">
                  Views delta: {entry.viewsDelta.toLocaleString('en-IN')} | Earnings: ₹
                  {Number(entry.amount || 0).toLocaleString('en-IN')} | Status: {entry.status}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
