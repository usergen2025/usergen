'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { IndianRupee, RefreshCw, Wallet } from 'lucide-react';
import { BrandPageHeader, BrandPrimaryButton, BrandSecondaryButton } from '@/components/brand';

export default function BrandWalletPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadBalance = useCallback(async () => {
    if (!isAuthenticated || !user?.id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiClient.getCreditsBalance(user.id);
      const c = (res.data as { credits?: number } | undefined)?.credits;
      if (typeof c === 'number' && !Number.isNaN(c)) {
        setWalletBalance(c);
      } else {
        setWalletBalance(null);
      }
    } catch (e) {
      console.error('Error loading wallet balance:', e);
      setWalletBalance(null);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    const onRefresh = () => {
      void loadBalance();
    };
    window.addEventListener('credits-refresh', onRefresh);
    return () => window.removeEventListener('credits-refresh', onRefresh);
  }, [loadBalance]);

  return (
    <div className="brand-page-shell">
      <BrandPageHeader backHref="/brand/dashboard" title="My wallet" className="mb-3 shrink-0 sm:mb-3" />

      <div className="brand-gradient-frame flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4 p-[2px]">
      <div className="rounded-[18px] bg-white/95 p-4 shadow-sm sm:p-5">
        <div className="flex items-center gap-2 sm:gap-2.5 mb-4">
          <Wallet className="h-4 w-4 text-[#E86512]" aria-hidden />
          <h2 className="brand-page-section-title">Wallet balance</h2>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-pink-50 rounded-[14px] p-4 sm:p-5 mb-4 border border-[#F0E5DC]">
          <p className="text-xs text-text-secondary mb-1.5">Current balance (ledger)</p>
          <p className="flex items-center gap-1.5 font-heading text-[clamp(0.875rem,1.2vh,1.125rem)] font-medium text-[#212121] sm:text-[1.25rem]">
            <IndianRupee className="h-4 w-4 shrink-0" aria-hidden />
            {isLoading ? (
              <span className="inline-block w-20 h-7 bg-white/50 rounded animate-pulse" />
            ) : walletBalance === null ? (
              '—'
            ) : (
              walletBalance.toLocaleString('en-IN')
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <BrandSecondaryButton
            type="button"
            className="inline-flex items-center gap-2"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('credits-refresh'));
              }
              void loadBalance();
            }}
          >
            <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
            Refresh balance
          </BrandSecondaryButton>
          <BrandPrimaryButton type="button" onClick={() => router.push('/billing')}>
            View billing
          </BrandPrimaryButton>
        </div>
        <p className="text-xs text-text-secondary mt-2">Opens campaign billing and ledger details.</p>

        <div className="mt-6 sm:mt-7">
          <h3 className="brand-page-section-title mb-2">Transaction history</h3>
          <div className="text-center py-5 text-xs sm:text-sm text-text-secondary border-2 border-dashed border-[#E0E0E0] rounded-[14px]">
            No transactions to show in this view yet. Campaign debits are recorded in the payment service.
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
