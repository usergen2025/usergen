'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api/client';
import { Inbox, Megaphone, Eye, IndianRupee, TrendingUp, Plus, ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { BrandStatStrip, BrandPrimaryButton, BrandSecondaryButton } from '@/components/brand';
import Dropdown, { DropdownItem } from '@/components/ui/Dropdown';

export default function BrandDashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [dateRange, setDateRange] = useState('7d');
  const [liveWalletBalance, setLiveWalletBalance] = useState<number | null>(null);
  const dateRangeLabel =
    dateRange === '7d' ? 'Last 7 days' : dateRange === '30d' ? 'Last 30 days' : 'Last 90 days';
  const [stats, setStats] = useState({
    totalCampaigns: 0,
    liveCampaigns: 0,
    totalViews: 0,
    spentSoFar: 0,
    walletBalance: 0,
  });

  useEffect(() => {
    let active = true;
    apiClient
      .getBrandDashboardStats({ dateRange })
      .then((response) => {
        if (active && response.data) {
          setStats(response.data);
        }
      })
      .catch((error) => {
        console.error('Error calculating stats:', error);
      });
    return () => {
      active = false;
    };
  }, [dateRange]);

  useEffect(() => {
    const onRefresh = () => {
      void apiClient.getBrandDashboardStats({ dateRange }).then((response) => {
        if (response.data) {
          setStats(response.data);
        }
      });
      if (user?.id) {
        void apiClient.getCreditsBalance(user.id).then((response) => {
          const credits = (response.data as { credits?: number } | undefined)?.credits;
          if (typeof credits === 'number' && !Number.isNaN(credits)) {
            setLiveWalletBalance(credits);
          }
        });
      }
    };
    window.addEventListener('credits-refresh', onRefresh);
    return () => window.removeEventListener('credits-refresh', onRefresh);
  }, [dateRange, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    apiClient
      .getCreditsBalance(user.id)
      .then((response) => {
        const credits = (response.data as { credits?: number } | undefined)?.credits;
        if (typeof credits === 'number' && !Number.isNaN(credits)) {
          setLiveWalletBalance(credits);
        }
      })
      .catch(() => {
        setLiveWalletBalance(null);
      });
  }, [user?.id]);

  const brandName = ((user as { brandName?: string; name?: string } | null)?.brandName) || user?.name || 'Brand';

  const viewK =
    stats.totalViews >= 1000 ? `${(stats.totalViews / 1000).toFixed(1)}k` : String(stats.totalViews);

  const statItems = [
    { value: stats.totalCampaigns.toString(), label: 'Total Campaigns', Icon: Inbox },
    { value: String(stats.liveCampaigns).padStart(2, '0'), label: 'Live Campaigns', Icon: Megaphone },
    { value: viewK, label: 'Total Views', Icon: Eye },
    { value: stats.spentSoFar.toLocaleString('en-IN'), label: 'Spent So Far', Icon: IndianRupee },
  ];

  return (
    <div className="brand-page-shell">
      <section className="mb-4 flex flex-col gap-4 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#E86412] to-[#F12A4C] font-heading text-sm font-medium text-white sm:h-12 sm:w-12 sm:text-base">
            {brandName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-[#212121] font-heading text-[clamp(14px,2.34vh,24px)] font-medium leading-[1.2]">Hello {brandName},</p>
            <p className="brand-campaign-meta text-[#212121]">Welcome back!</p>
          </div>
        </div>
      </section>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-3 shrink-0 gap-3 sm:mb-4">
        <h2 className="brand-page-section-title">Dashboard stats</h2>
        <Dropdown
          align="right"
          className="!min-w-[12rem]"
          trigger={
            <button
              type="button"
              className="brand-field-shell w-[12rem] max-w-full"
              aria-label="Date range for dashboard stats"
            >
              <span className="brand-field-shell__input text-left">{dateRangeLabel}</span>
              <span className="brand-field-shell__suffix pointer-events-none">
                <ChevronDown className="h-4 w-4 text-[#9E9E9E]" />
              </span>
            </button>
          }
        >
          <DropdownItem onClick={() => setDateRange('7d')}>Last 7 days</DropdownItem>
          <DropdownItem onClick={() => setDateRange('30d')}>Last 30 days</DropdownItem>
          <DropdownItem onClick={() => setDateRange('90d')}>Last 90 days</DropdownItem>
        </Dropdown>
      </div>

      <div className="brand-gradient-frame mb-3 shrink-0 p-3 sm:mb-4 sm:p-4">
        <BrandStatStrip items={statItems} layout="inline" />
      </div>

      <div className="mb-3 flex justify-center sm:mb-5">
        <BrandPrimaryButton
          type="button"
          icon={<Plus className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />}
          onClick={() => router.push('/brand/campaigns/create?type=REPOST_CPM')}
          className="w-full sm:w-auto"
        >
          Create a Campaign
        </BrandPrimaryButton>
      </div>

      <div className="brand-gradient-frame mb-3 flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[20px] p-3 sm:mb-5 sm:p-4 p-[2px]">
        <div className="rounded-[18px] bg-white/95 p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IndianRupee className="h-4 w-4 shrink-0 text-[#E86512]" />
              <h3 className="brand-page-section-title">My wallet</h3>
            </div>
            <BrandSecondaryButton
              type="button"
              size="sm"
              onClick={() => router.push('/brand/wallet')}
              className="!min-h-9"
            >
              Add funds
            </BrandSecondaryButton>
          </div>
          <div className="font-heading text-[clamp(0.875rem,1.2vh,1rem)] font-medium leading-snug text-[#212121]">
            Current balance: ₹{Number(liveWalletBalance ?? stats.walletBalance ?? 0).toLocaleString('en-IN')}
          </div>
        </div>
      </div>

      <div className="brand-gradient-frame flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4 p-[2px]">
        <div className="rounded-[18px] bg-white/95 p-4 shadow-sm sm:p-5">
          <h3 className="brand-page-section-title mb-3">Campaign performance</h3>
          <div className="flex h-40 sm:h-48 items-center justify-center rounded-xl bg-gray-50">
            <div className="text-center">
              <TrendingUp className="mx-auto mb-1.5 h-7 w-7 text-gray-400 sm:h-8 sm:w-8" />
              <p className="brand-campaign-meta text-text-secondary">Chart will be displayed here</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
