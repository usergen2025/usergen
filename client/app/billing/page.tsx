'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CreditCard,
  FileText,
  IndianRupee,
  Megaphone,
  Plus,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import BuyCreditsPanel from '@/components/billing/BuyCreditsPanel';
import {
  BrandIconChip,
  BrandPageHeader,
  BrandPrimaryButton,
  BrandSecondaryButton,
  BrandStatStrip,
  BrandStatusPill,
} from '@/components/brand';
import { cn } from '@/lib/utils/cn';

function SkeletonPulse({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-[#F0E5DC]', className)} />;
}

interface BrandCampaignRow {
  id: string;
  name: string;
  status: string;
  totalBudget: number;
  budgetUsed: number;
  views: number;
}

function BrandBillingView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [campaigns, setCampaigns] = useState<BrandCampaignRow[]>([]);
  const [stats, setStats] = useState<{
    totalCampaigns?: number;
    spentSoFar?: number;
    walletBalance?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBuy, setShowBuy] = useState(searchParams?.get('action') === 'add');

  useEffect(() => {
    setShowBuy(searchParams?.get('action') === 'add');
  }, [searchParams]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?redirect=/billing');
    }
  }, [isAuthenticated, authLoading, router]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, sRes] = await Promise.all([apiClient.getCampaigns(), apiClient.getBrandDashboardStats()]);
      const list = cRes.data;
      setCampaigns(Array.isArray(list) ? (list as BrandCampaignRow[]) : []);
      if (sRes.data) {
        setStats(sRes.data);
      }
    } catch (e) {
      console.error('Failed to load brand billing:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadData();
  }, [isAuthenticated, loadData]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const onRefresh = () => {
      void loadData();
    };
    window.addEventListener('credits-refresh', onRefresh);
    return () => window.removeEventListener('credits-refresh', onRefresh);
  }, [isAuthenticated, loadData]);

  if (authLoading) {
    return (
      <div className="min-h-dvh">
        <div className="brand-page-shell">
          <div className="h-8 w-40 bg-gray-200 rounded animate-pulse mb-8" />
          <div className="h-32 bg-white rounded-2xl shadow-sm animate-pulse mb-6" />
          <div className="h-64 bg-white rounded-2xl shadow-sm animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="brand-page-shell brand-page-shell--campaigns">
      <BrandPageHeader
        title="Billing"
        className="mb-3 sm:mb-3 shrink-0"
        backHref="/brand/dashboard"
      />
      <p className="brand-campaign-meta mb-3 text-text-secondary sm:mb-4">
        Campaign wallet and spend by campaign. Video creation credits for creators are separate from this view.
      </p>

        {loading ? (
          <div className="space-y-4">
            <div className="h-32 bg-white rounded-2xl shadow-sm animate-pulse" />
            <div className="h-64 bg-white rounded-2xl shadow-sm animate-pulse" />
          </div>
        ) : (
          <>
            <div className="brand-gradient-frame mb-3 shrink-0 p-3 sm:mb-4 sm:p-4">
              <BrandStatStrip
                columns={3}
                layout="inline"
                items={[
                  {
                    value:
                      stats?.walletBalance !== undefined
                        ? `₹${stats.walletBalance.toLocaleString('en-IN')}`
                        : '—',
                    label: 'Wallet balance (ledger)',
                    Icon: IndianRupee,
                  },
                  {
                    value: String(stats?.totalCampaigns ?? campaigns.length),
                    label: 'Campaigns',
                    Icon: Megaphone,
                  },
                  {
                    value:
                      stats?.spentSoFar !== undefined
                        ? `₹${stats.spentSoFar.toLocaleString('en-IN')}`
                        : '—',
                    label: 'Total campaign spend',
                    Icon: Wallet,
                  },
                ]}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <BrandPrimaryButton type="button" onClick={() => setShowBuy(true)}>
                  Add funds
                </BrandPrimaryButton>
                <BrandSecondaryButton type="button" onClick={() => router.push('/brand/wallet')}>
                  Open wallet
                </BrandSecondaryButton>
              </div>
            </div>

            <BuyCreditsPanel
              audience="BRAND"
              open={showBuy}
              successRedirectTo="/brand/dashboard"
              onClose={() => {
                setShowBuy(false);
                router.replace('/billing');
              }}
            />

            <div className="brand-gradient-frame flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4 p-[2px]">
              <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[18px] bg-white/95 shadow-sm">
              <div className="shrink-0 border-b border-[#EFE8E3] p-3 sm:p-4">
                <h2 className="brand-page-section-title text-[#212121]">Spending by campaign</h2>
                <p className="brand-campaign-meta mt-1 text-text-secondary">
                  Reserved and spent budget tracked per campaign in the campaign service.
                </p>
              </div>
              {campaigns.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left">
                    <thead className="bg-[#FAF7F3] text-[#616161]">
                      <tr>
                        <th className="px-4 py-3 font-heading text-[clamp(12px,1.2vh,13px)] font-medium">Campaign</th>
                        <th className="px-4 py-3 font-heading text-[clamp(12px,1.2vh,13px)] font-medium">Status</th>
                        <th className="px-4 py-3 font-heading text-[clamp(12px,1.2vh,13px)] font-medium text-right">Views</th>
                        <th className="px-4 py-3 font-heading text-[clamp(12px,1.2vh,13px)] font-medium text-right">Spent / budget</th>
                        <th className="px-4 py-3 font-heading text-[clamp(12px,1.2vh,13px)] font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1ECE7]">
                      {campaigns.map((c) => (
                        <tr key={c.id} className="hover:bg-[#FCFAF8]">
                          <td className="px-4 py-3.5 font-heading text-[clamp(12px,1.25vh,14px)] font-medium text-[#212121]">{c.name}</td>
                          <td className="px-4 py-3.5">
                            <BrandStatusPill status={String(c.status).toUpperCase() as 'LIVE' | 'IN_PROGRESS' | 'PAUSED' | 'DRAFT' | 'COMPLETED'} />
                          </td>
                          <td className="px-4 py-3.5 text-right font-heading text-[clamp(12px,1.25vh,14px)] text-[#212121]">
                            {Number(c.views).toLocaleString('en-IN')}
                          </td>
                          <td className="px-4 py-3.5 text-right font-heading text-[clamp(12px,1.25vh,14px)] text-[#212121]">
                            ₹{Number(c.budgetUsed).toLocaleString('en-IN')}
                            <span className="text-[#757575]"> / ₹{Number(c.totalBudget).toLocaleString('en-IN')}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <Link
                              href={`/brand/campaigns/${c.id}`}
                              className="font-heading text-[clamp(12px,1.2vh,13px)] font-medium text-[#E86512] hover:underline"
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-6 py-12 text-center">
                  <Megaphone className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-700 mb-2">No campaigns yet</h3>
                  <p className="text-gray-500 mb-4">Create a campaign to see spend here.</p>
                  <BrandPrimaryButton type="button" onClick={() => router.push('/brand/campaigns')}>
                    Go to My Campaigns
                  </BrandPrimaryButton>
                </div>
              )}
              </div>
            </div>
          </>
        )}
    </div>
  );
}

interface Purchase {
  id: string;
  status?: string;
  creditsToGrant?: number;
  baseAmountPaise?: number;
  feeAmountPaise?: number;
  gstAmountPaise?: number;
  totalChargePaise?: number;
  createdAt?: string;
  invoices?: Array<{
    id: string;
    invoiceNumber?: string;
    providerInvoiceNumber?: string;
  }>;
}

/** Maps a purchase status onto the shared `.brand-status-pill` variants. */
function purchasePillClass(status: string) {
  if (status === 'FULFILLED') return 'brand-status-pill--completed';
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') {
    return 'brand-status-pill--failed';
  }
  if (status === 'AWAITING_PAYMENT') return 'brand-status-pill--pending';
  return 'brand-status-pill--draft';
}

const rupees = (paise: number) =>
  (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function formatPurchaseDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

function BillingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, user, isLoading: authLoading, isBrand: isBrandFn } = useAuth();

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showBuy, setShowBuy] = useState(searchParams?.get('action') === 'add');

  useEffect(() => {
    setShowBuy(searchParams?.get('action') === 'add');
  }, [searchParams]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?redirect=/billing');
    }
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    let cancelled = false;
    const load = async () => {
      const res = await apiClient
        .listBillingPurchases(user.id)
        .catch(() => ({ success: false, data: [] as Purchase[] }));
      if (cancelled) return;
      setPurchases(Array.isArray(res.data) ? res.data : []);
      setIsLoading(false);
    };

    setIsLoading(true);
    void load();

    const onRefresh = () => void load();
    window.addEventListener('credits-refresh', onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('credits-refresh', onRefresh);
    };
  }, [isAuthenticated, user?.id]);

  if (isBrandFn()) {
    return <BrandBillingView />;
  }

  const fulfilled = purchases.filter((p) => String(p.status || '').toUpperCase() === 'FULFILLED');
  const totalPaidPaise = fulfilled.reduce((sum, p) => sum + (p.totalChargePaise || 0), 0);
  const totalCredits = fulfilled.reduce((sum, p) => sum + (p.creditsToGrant || 0), 0);
  const showSkeleton = isLoading || authLoading;

  return (
    <div className="brand-page-shell brand-page-shell--campaigns">
      <BrandPageHeader
        onBack={() => router.back()}
        className="mb-3 shrink-0 sm:mb-3"
        title="Billing"
        subtitle="Your payments and credit purchases"
        right={
          <button
            type="button"
            onClick={() => setShowBuy((v) => !v)}
            className="brand-campaign-cta brand-campaign-cta--compact min-w-0"
            aria-label="Add credits"
          >
            <Plus className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden />
            <span className="brand-campaign-cta__label whitespace-nowrap text-[clamp(12px,1.37vh,14px)] leading-[1]">
              Add Credits
            </span>
          </button>
        }
      />

      <BuyCreditsPanel
        audience="CREATOR"
        open={showBuy}
        successRedirectTo="/billing"
        onClose={() => {
          setShowBuy(false);
          router.replace('/billing');
        }}
      />

      <div className="brand-gradient-frame mb-0 flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4">
        <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[18px] bg-white/95 shadow-sm">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[#EFE8E3] p-3 sm:p-4">
            <h2 className="brand-page-section-title">Purchases</h2>
            {fulfilled.length > 0 && (
              <p className="brand-campaign-meta text-[#616161]">
                ₹{rupees(totalPaidPaise)} paid · {totalCredits.toLocaleString('en-IN')} credits
              </p>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {showSkeleton ? (
              <div className="space-y-2.5 sm:space-y-3">
                {[1, 2, 3].map((i) => (
                  <SkeletonPulse key={i} className="h-[5.25rem] rounded-[20px]" />
                ))}
              </div>
            ) : purchases.length > 0 ? (
              <div className="space-y-2.5 pr-0.5 sm:space-y-3">
                {purchases.map((p) => {
                  const inv = p.invoices?.[0];
                  const invoiceId = inv?.id;
                  const invoiceLabel = inv?.providerInvoiceNumber || inv?.invoiceNumber || null;
                  const status = String(p.status || '').toUpperCase();

                  return (
                    <div key={p.id} className="brand-campaign-card-figma shadow-sm">
                      <div className="flex flex-col gap-2 sm:gap-2.5">
                        <div className="flex flex-row items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <BrandIconChip size="sm">
                              <CreditCard className="text-white" strokeWidth={1.8} />
                            </BrandIconChip>
                            <span className="brand-campaign-title min-w-0 truncate font-heading leading-tight text-[#212121]">
                              +{(p.creditsToGrant || 0).toLocaleString('en-IN')} credits
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-2.5">
                            {/* Full timestamp is too wide for the mobile title row — it moves to the meta row below */}
                            <span className="brand-campaign-meta hidden text-[#616161] sm:inline">
                              {formatPurchaseDate(p.createdAt)}
                            </span>
                            <span
                              className={cn(
                                'brand-status-pill brand-status-pill--auto',
                                purchasePillClass(status),
                              )}
                              translate="no"
                            >
                              {status.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="brand-campaign-meta text-[#616161] sm:hidden">
                            {formatPurchaseDate(p.createdAt)}
                          </span>
                          <div className="brand-campaign-row inline-flex items-center gap-1.5 font-heading font-medium text-[#212121]">
                            <IndianRupee
                              className="brand-campaign-metric-stroke h-3.5 w-3.5"
                              strokeWidth={2}
                              aria-hidden
                            />
                            <span>Paid: ₹{rupees(p.totalChargePaise || 0)}</span>
                          </div>
                          <span className="brand-campaign-meta text-[#616161]">
                            Base ₹{rupees(p.baseAmountPaise || 0)} · Fee ₹
                            {rupees(p.feeAmountPaise || 0)} · GST ₹{rupees(p.gstAmountPaise || 0)}
                          </span>
                          {invoiceId && status === 'FULFILLED' ? (
                            <Link
                              href={`/billing/invoice/${invoiceId}`}
                              className="brand-campaign-meta inline-flex items-center gap-1 font-heading font-medium text-[#212121] underline decoration-[#212121] underline-offset-2 hover:opacity-80 sm:ml-auto"
                            >
                              <FileText className="h-4 w-4 shrink-0 text-[#E86512]" aria-hidden />
                              Invoice{invoiceLabel ? ` · ${invoiceLabel}` : ''}
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center sm:py-10">
                <div className="mx-auto mb-2 max-w-md rounded-xl border border-dashed border-orange-200/80 bg-gradient-to-br from-orange-50/90 to-pink-50/90 p-6 sm:p-8">
                  <p className="mb-4 font-heading text-base text-[#212121] sm:text-lg">
                    No purchases to show here.
                  </p>
                  <BrandPrimaryButton
                    type="button"
                    icon={<Plus className="h-5 w-5" aria-hidden />}
                    onClick={() => setShowBuy(true)}
                    className="mx-auto w-full sm:w-auto"
                  >
                    Add Credits
                  </BrandPrimaryButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="brand-page-shell brand-page-shell--campaigns">
          <div className="mb-3 flex shrink-0 items-center gap-2">
            <SkeletonPulse className="h-7 w-7 rounded-lg" />
            <SkeletonPulse className="h-7 w-28" />
          </div>
          <div className="brand-gradient-frame flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-[18px] bg-white/95 p-3 shadow-sm sm:p-4">
              {[1, 2, 3].map((i) => (
                <SkeletonPulse key={i} className="h-[5.25rem] shrink-0 rounded-[20px]" />
              ))}
            </div>
          </div>
        </div>
      }
    >
      <BillingContent />
    </Suspense>
  );
}
