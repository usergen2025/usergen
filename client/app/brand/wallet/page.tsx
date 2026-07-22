'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { IndianRupee, RefreshCw, Wallet } from 'lucide-react';
import { BrandPageHeader, BrandPrimaryButton, BrandSecondaryButton } from '@/components/brand';
import BuyCreditsPanel from '@/components/billing/BuyCreditsPanel';

function BrandWalletContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAuthenticated } = useAuth();
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showBuy, setShowBuy] = useState(searchParams?.get('action') === 'add');
  const [purchases, setPurchases] = useState<any[]>([]);

  useEffect(() => {
    setShowBuy(searchParams?.get('action') === 'add');
  }, [searchParams]);

  const loadBalance = useCallback(async () => {
    if (!isAuthenticated || !user?.id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [res, purchasesRes] = await Promise.all([
        apiClient.getCreditsBalance(user.id),
        apiClient.listBillingPurchases(user.id).catch(() => ({ success: false, data: [] as any[] })),
      ]);
      const c = (res.data as { credits?: number } | undefined)?.credits;
      if (typeof c === 'number' && !Number.isNaN(c)) {
        setWalletBalance(c);
      } else {
        setWalletBalance(null);
      }
      setPurchases(Array.isArray(purchasesRes.data) ? purchasesRes.data : []);
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
          <BrandPrimaryButton type="button" onClick={() => setShowBuy(true)}>
            Add funds
          </BrandPrimaryButton>
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
          <BrandSecondaryButton type="button" onClick={() => router.push('/billing')}>
            View billing
          </BrandSecondaryButton>
        </div>

        {showBuy && (
          <div className="mt-4">
            <BuyCreditsPanel
              audience="BRAND"
              embedded
              successRedirectTo="/brand/dashboard"
              onClose={() => {
                setShowBuy(false);
                router.replace('/brand/wallet');
                void loadBalance();
              }}
            />
          </div>
        )}

        <div className="mt-6 sm:mt-7">
          <h3 className="brand-page-section-title mb-2">Purchase history</h3>
          {purchases.length === 0 ? (
            <div className="text-center py-5 text-xs sm:text-sm text-text-secondary border-2 border-dashed border-[#E0E0E0] rounded-[14px]">
              No top-ups yet. Add funds to credit your campaign wallet.
            </div>
          ) : (
            <ul className="divide-y divide-[#F1ECE7] rounded-[14px] border border-[#EFE8E3]">
              {purchases.slice(0, 20).map((p) => {
                const inv = p.invoices?.[0];
                const invoiceId = inv?.id as string | undefined;
                const fulfilled = String(p.status || '').toUpperCase() === 'FULFILLED';
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium text-[#212121]">{p.status}</p>
                      <p className="text-xs text-text-secondary">
                        {new Date(p.createdAt).toLocaleString('en-IN')}
                      </p>
                      {invoiceId && fulfilled ? (
                        <a
                          href={`/billing/invoice/${invoiceId}`}
                          className="mt-1 inline-block text-xs font-medium text-[#E86412] hover:underline"
                        >
                          View invoice
                        </a>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-[#212121]">
                        ₹{((p.totalChargePaise || 0) / 100).toLocaleString('en-IN')}
                      </p>
                      <p className="text-xs text-text-secondary">
                        +{(p.creditsToGrant || 0).toLocaleString('en-IN')} credits
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

export default function BrandWalletPage() {
  return (
    <Suspense
      fallback={
        <div className="brand-page-shell">
          <div className="h-40 animate-pulse rounded-[20px] bg-white/80" />
        </div>
      }
    >
      <BrandWalletContent />
    </Suspense>
  );
}
