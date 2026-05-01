'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';
import {
  Inbox,
  Megaphone,
  Eye,
  IndianRupee,
  UserPlus,
  CheckCircle,
  Pencil,
  Calendar,
  CalendarRange,
  Plus,
  ArrowUpDown,
  ListFilter,
  Search,
  X,
  MoreVertical,
  Send,
  Pause,
  CircleDollarSign,
} from 'lucide-react';
import {
  BrandPrimaryButton,
  BrandSecondaryButton,
  BrandStatStrip,
  BrandStatusPill,
  BrandPageHeader,
  BrandIconChip,
} from '@/components/brand';
import Dropdown, { DropdownItem } from '@/components/ui/Dropdown';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/hooks/useAuth';

type CampaignStatus = 'LIVE' | 'IN_PROGRESS' | 'COMPLETED' | 'DRAFT' | 'PAUSED';

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  postedAt: string;
  deadlineToApply: string;
  startDate: string;
  endDate: string;
  payoutRate: number;
  totalBudget: number;
  budgetUsed: number;
  remainingBudget?: number;
  views: number;
  targetViews: number;
  applicantsCount: number;
  shortlistedCount: number;
}

export default function CampaignsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'live' | 'inProgress' | 'drafts' | 'completed'>('live');
  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'latest' | 'budgetHigh'>('latest');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const didDefaultToDraftsTab = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback;

  const loadCampaigns = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.getCampaigns();
      setAllCampaigns(response.data || []);
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to load campaigns'), 'error');
      setAllCampaigns([]);
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const onRefresh = () => {
      void loadCampaigns();
    };
    window.addEventListener('credits-refresh', onRefresh);
    return () => window.removeEventListener('credits-refresh', onRefresh);
  }, [loadCampaigns]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    if (isLoading || allCampaigns.length === 0 || didDefaultToDraftsTab.current) return;
    const onlyDrafts = allCampaigns.every((c) => c.status === 'DRAFT');
    if (onlyDrafts) {
      setActiveTab('drafts');
      didDefaultToDraftsTab.current = true;
    }
  }, [isLoading, allCampaigns]);

  useEffect(() => {
    if (isSearchExpanded) {
      searchInputRef.current?.focus();
    }
  }, [isSearchExpanded]);

  const campaigns = allCampaigns
    .filter((campaign) => {
      const keyword = search.trim().toLowerCase();
      const matchesSearch =
        !keyword ||
        campaign.name.toLowerCase().includes(keyword) ||
        campaign.description.toLowerCase().includes(keyword);
      if (!matchesSearch) return false;
      if (activeTab === 'live') {
        return campaign.status === 'LIVE';
      }
      if (activeTab === 'inProgress') {
        return campaign.status === 'IN_PROGRESS' || campaign.status === 'PAUSED';
      }
      if (activeTab === 'drafts') {
        return campaign.status === 'DRAFT';
      }
      return campaign.status === 'COMPLETED';
    })
    .sort((a, b) => {
      if (sortBy === 'budgetHigh') return b.totalBudget - a.totalBudget;
      return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
    });

  const liveCount = allCampaigns.filter((c) => c.status === 'LIVE').length;
  const inProgressCount = allCampaigns.filter(
    (c) => c.status === 'IN_PROGRESS' || c.status === 'PAUSED',
  ).length;
  const draftsCount = allCampaigns.filter((c) => c.status === 'DRAFT').length;
  const completedCount = allCampaigns.filter((c) => c.status === 'COMPLETED').length;

  const tabs: { id: typeof activeTab; label: string; count: number }[] = [
    { id: 'live', label: 'Live', count: liveCount },
    { id: 'inProgress', label: 'In progress', count: inProgressCount },
    { id: 'drafts', label: 'Drafts', count: draftsCount },
    { id: 'completed', label: 'Completed', count: completedCount },
  ];

  const totalViews = allCampaigns.reduce((acc, campaign) => acc + Number(campaign.views || 0), 0);
  const totalSpent = allCampaigns.reduce((acc, campaign) => acc + Number(campaign.budgetUsed || 0), 0);

  const viewK = totalViews >= 1000 ? `${(totalViews / 1000).toFixed(1)}k` : totalViews.toString();

  const statItems = [
    { value: allCampaigns.length.toString(), label: 'Total Campaigns', Icon: Inbox },
    { value: liveCount.toString().padStart(2, '0'), label: 'Live Campaigns', Icon: Megaphone },
    { value: viewK, label: 'Total Views', Icon: Eye },
    { value: totalSpent.toLocaleString('en-IN'), label: 'Spent So Far', Icon: IndianRupee },
  ];

  return (
    <div className="brand-page-shell brand-page-shell--campaigns">
      <BrandPageHeader
        hideBackButton
        className="mb-3 sm:mb-3 shrink-0"
        left={<h1 className="brand-campaign-page-title">My Campaigns</h1>}
        right={
          <button
            type="button"
            onClick={() => router.push('/brand/campaigns/create?type=REPOST_CPM')}
            className="brand-campaign-cta w-full sm:w-auto min-w-0"
          >
            <Plus className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden />
            <span className="whitespace-nowrap text-[clamp(12px,1.37vh,14px)] leading-[1]">Create a Campaign</span>
          </button>
        }
      />

      <div className="brand-gradient-frame mb-3 shrink-0 p-3 sm:mb-4 sm:p-4">
        <BrandStatStrip items={statItems} layout="inline" />
      </div>

      <div className="brand-gradient-frame p-3 sm:p-4 flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[20px] p-[2px]">
        <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[18px] bg-white/95 shadow-sm">
        <div className="shrink-0 space-y-3 border-b border-[#EFE8E3] p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
            <div
              className="inline-flex max-w-full rounded-[28px] p-[2px] w-fit"
              style={{
                background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)',
              }}
            >
              <div
                className="inline-flex min-w-0 flex-row items-center gap-0.5 overflow-x-auto rounded-[26px] bg-white p-1 sm:gap-1"
                role="tablist"
                aria-label="Campaign status filters"
              >
                {tabs.map((tab) => {
                  const selected = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveTab(tab.id)}
                      className="brand-campaigns-tab"
                    >
                      {tab.label} ({tab.count})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 shrink-0">
              <div className="flex flex-row-reverse items-center justify-start gap-1 sm:min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsSearchExpanded((prev) => !prev);
                    if (!isSearchExpanded) {
                      requestAnimationFrame(() => searchInputRef.current?.focus());
                    }
                  }}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E8E2DB] bg-white hover:bg-orange-50/60"
                  aria-label={isSearchExpanded ? 'Collapse search' : 'Search campaigns'}
                >
                  {isSearchExpanded ? (
                    <X className="h-4 w-4 text-[#E86512]" />
                  ) : (
                    <Search className="h-4 w-4 text-[#E86512]" />
                  )}
                </button>
                <div
                  className={cn(
                    'brand-search-shell overflow-hidden',
                    isSearchExpanded ? 'w-[min(18.75rem,64vw)] opacity-100 px-2.5 py-1.5' : 'w-0 opacity-0 px-0 py-0',
                  )}
                >
                  <input
                    ref={searchInputRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search campaigns"
                    aria-label="Search campaigns"
                    className="w-full min-w-0 bg-transparent border-0 outline-none font-heading text-[clamp(0.8rem,1.1vw,0.92rem)] text-[#212121] placeholder:text-[#9E9E9E]"
                    onBlur={() => {
                      if (!search.trim()) setIsSearchExpanded(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && !search.trim()) {
                        setIsSearchExpanded(false);
                      }
                    }}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSortBy((p) => (p === 'latest' ? 'budgetHigh' : 'latest'));
                }}
                className="brand-text-link"
              >
                <ArrowUpDown className="h-4 w-4 text-[#E86512]" />
                {sortBy === 'latest' ? 'Sort' : 'Budget'}
              </button>
              <button
                type="button"
                className="brand-text-link"
                onClick={() => {
                  setIsSearchExpanded(true);
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }}
                aria-label="Filter campaigns"
              >
                <ListFilter className="h-4 w-4 text-[#E86512]" />
                Filter
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {isLoading ? (
          <div className="text-center py-10 text-sm text-text-secondary">Loading campaigns...</div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-8 sm:py-10">
            <div className="bg-gradient-to-br from-orange-50/90 to-pink-50/90 rounded-xl p-6 sm:p-8 mb-2 border border-dashed border-orange-200/80 max-w-md mx-auto">
              <p className="font-heading text-base sm:text-lg text-[#212121] mb-4">No campaigns to show here.</p>
              <BrandPrimaryButton
                type="button"
                icon={<Plus className="h-5 w-5" aria-hidden />}
                onClick={() => router.push('/brand/campaigns/create?type=REPOST_CPM')}
                className="mx-auto w-full sm:w-auto"
              >
                Create a Campaign
              </BrandPrimaryButton>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 sm:space-y-3 pr-0.5">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} onReload={loadCampaigns} />
            ))}
          </div>
        )}
        </div>
        </div>
      </div>
    </div>
  );
}

function formatPostedAt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hasTime = /T\d{1,2}:/.test(iso) && (d.getHours() !== 0 || d.getMinutes() !== 0);
  if (hasTime) {
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatLineDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getDaysRemaining(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function publicStatus(s: Campaign['status']): 'LIVE' | 'IN_PROGRESS' | 'PAUSED' | 'DRAFT' | 'COMPLETED' {
  if (s === 'LIVE' || s === 'IN_PROGRESS' || s === 'PAUSED' || s === 'DRAFT' || s === 'COMPLETED') {
    return s;
  }
  return 'LIVE';
}

function CampaignCard({ campaign, onReload }: { campaign: Campaign; onReload: () => Promise<void> }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { user } = useAuth();
  const daysRemaining = getDaysRemaining(campaign.deadlineToApply);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishBalance, setPublishBalance] = useState<number | null>(null);
  const [publishBalanceStatus, setPublishBalanceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback;

  const st = publicStatus(campaign.status);
  const showActionsMenu =
    campaign.status === 'LIVE' ||
    campaign.status === 'IN_PROGRESS' ||
    campaign.status === 'PAUSED' ||
    campaign.status === 'DRAFT';
  const urgent =
    daysRemaining >= 0 && daysRemaining <= 7 && daysRemaining < 30 && campaign.status !== 'COMPLETED';
  const requiredAmount = Math.max(Number(campaign.totalBudget) - Number(campaign.budgetUsed), 0);
  const hasSufficientBalance =
    publishBalanceStatus === 'ready' && publishBalance !== null && publishBalance >= requiredAmount;

  const openPublishModal = async () => {
    setIsPublishModalOpen(true);
    if (!user?.id) {
      setPublishBalanceStatus('error');
      return;
    }
    setPublishBalanceStatus('loading');
    try {
      const res = await apiClient.getCreditsBalance(user.id);
      const credits = (res.data as { credits?: number } | undefined)?.credits;
      if (typeof credits === 'number' && !Number.isNaN(credits)) {
        setPublishBalance(credits);
        setPublishBalanceStatus('ready');
      } else {
        setPublishBalanceStatus('error');
      }
    } catch {
      setPublishBalanceStatus('error');
    }
  };

  const handleConfirmPublish = async () => {
    if (!hasSufficientBalance || isPublishing) return;
    setIsPublishing(true);
    try {
      await apiClient.publishCampaign(campaign.id);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('credits-refresh'));
      }
      showToast('Campaign published', 'success');
      setIsPublishModalOpen(false);
      await onReload();
    } catch (e: unknown) {
      showToast(getErrorMessage(e, 'Publish failed. Check wallet.'), 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <>
    <div className="brand-campaign-card-figma shadow-sm">
      <div className="flex flex-col gap-2 sm:gap-2.5">
        <div className="flex flex-col gap-1 sm:gap-2 sm:flex-row sm:items-start sm:justify-between">
          <Link
            href={`/brand/campaigns/${campaign.id}`}
            className="font-heading brand-campaign-title text-[#212121] leading-tight pr-2 hover:opacity-80"
          >
            {campaign.name}
          </Link>
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 justify-end text-right sm:max-w-[50%]">
            <span className="brand-campaign-meta text-[#616161]">Posted on: {formatPostedAt(campaign.postedAt)}</span>
            <BrandStatusPill status={st} />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 sm:flex-wrap">
          <div className="inline-flex items-center gap-1.5 brand-campaign-row font-heading font-medium text-[#212121]">
            <UserPlus className="h-3.5 w-3.5 brand-campaign-metric-stroke" strokeWidth={2} aria-hidden />
            <span>Applicants: {campaign.applicantsCount}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 brand-campaign-row font-heading font-medium text-[#212121]">
            <CheckCircle className="h-3.5 w-3.5 brand-campaign-metric-stroke" strokeWidth={2} aria-hidden />
            <span>Shortlisted: {String(campaign.shortlistedCount).padStart(2, '0')}</span>
          </div>
          <div className="sm:ml-auto flex items-center gap-1.5 sm:gap-2">
            <Link
              href={`/brand/campaigns/${campaign.id}/edit`}
              className="inline-flex items-center gap-1 font-heading brand-campaign-meta font-medium text-[#212121] underline decoration-[#212121] underline-offset-2 hover:opacity-80"
            >
              <Pencil className="h-4 w-4 shrink-0 text-[#E86512]" aria-hidden />
              Edit
            </Link>
            <Link
              href={`/brand/campaigns/${campaign.id}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-[#E8E2DB] hover:bg-orange-50/50"
              aria-label="View campaign"
              title="View"
            >
              <Eye className="h-4 w-4 text-[#E86512]" />
            </Link>
            {showActionsMenu && (
              <Dropdown
                align="right"
                trigger={
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-[#E8E2DB] hover:bg-gray-50"
                    aria-label="More campaign actions"
                  >
                    <MoreVertical className="h-4 w-4 text-[#212121]" />
                  </button>
                }
                className="!min-w-[12rem] !p-0"
              >
                {campaign.status === 'DRAFT' && (
                  <DropdownItem
                    icon={<Send className="h-5 w-5" />}
                    onClick={openPublishModal}
                  >
                    Publish
                  </DropdownItem>
                )}
                {campaign.status !== 'COMPLETED' && campaign.status !== 'DRAFT' && (
                  <>
                    <DropdownItem
                      icon={<Pause className="h-5 w-5" />}
                      onClick={async () => {
                        try {
                          await apiClient.pauseCampaign(campaign.id);
                          showToast('Campaign paused', 'success');
                          await onReload();
                        } catch (e: unknown) {
                          showToast(getErrorMessage(e, 'Failed to pause campaign'), 'error');
                        }
                      }}
                    >
                      Pause
                    </DropdownItem>
                    <DropdownItem
                      icon={<CircleDollarSign className="h-5 w-5" />}
                      onClick={async () => {
                        const amount = window.prompt('Enter top-up amount');
                        const parsed = Number(amount);
                        if (!parsed || parsed <= 0) return;
                        try {
                          await apiClient.topUpCampaign(campaign.id, parsed);
                          if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('credits-refresh'));
                          }
                          showToast('Budget topped up', 'success');
                          await onReload();
                        } catch (e: unknown) {
                          showToast(getErrorMessage(e, 'Top-up failed'), 'error');
                        }
                      }}
                    >
                      Top-up
                    </DropdownItem>
                  </>
                )}
                <DropdownItem
                  icon={<Eye className="h-5 w-5" />}
                  onClick={() => router.push(`/brand/campaigns/${campaign.id}`)}
                >
                  View details
                </DropdownItem>
              </Dropdown>
            )}
          </div>
        </div>

        <div className="brand-campaign-row flex flex-col gap-1.5 text-[#212121] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2.5 sm:gap-y-1">
            <div className="inline-flex min-w-0 items-center gap-1.5">
              <BrandIconChip size="sm">
                <Eye className="h-3 w-3" strokeWidth={1.8} />
              </BrandIconChip>
              <span>
                {campaign.views.toLocaleString('en-IN')} / {campaign.targetViews.toLocaleString('en-IN')} views
              </span>
            </div>
            <div className="inline-flex min-w-0 items-center gap-1.5">
              <BrandIconChip size="sm">
                <Calendar className="h-3 w-3" strokeWidth={1.8} />
              </BrandIconChip>
              <span className={cn(urgent && 'text-red-600')}>
                {formatLineDate(campaign.deadlineToApply)}
                {daysRemaining >= 0
                  ? ` — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} to go!`
                  : ' — past deadline'}
              </span>
            </div>
          </div>
          <div className="mt-0 inline-flex w-full min-w-0 items-center gap-1.5 sm:mt-0 sm:w-auto sm:max-w-[50%] sm:justify-end sm:pl-2 sm:text-right">
            <BrandIconChip size="sm" className="self-center sm:self-center">
              <CalendarRange className="h-3 w-3" strokeWidth={1.8} />
            </BrandIconChip>
            <span className="min-w-0 text-left leading-snug sm:text-right">
              Campaign timeline: {formatLineDate(campaign.startDate)} – {formatLineDate(campaign.endDate)}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2.5">
          {campaign.description ? (
            <p className="line-clamp-2 min-w-0 flex-1 brand-campaign-row text-[#212121]">{campaign.description}</p>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          <div className="flex shrink-0 items-center gap-1.5 brand-campaign-row text-[#212121] sm:pl-2">
            <BrandIconChip size="sm">
              <IndianRupee className="h-3 w-3" strokeWidth={1.8} />
            </BrandIconChip>
            <span className="whitespace-nowrap">
              Budget left: {Math.max(Number(campaign.remainingBudget ?? campaign.totalBudget - campaign.budgetUsed), 0).toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      </div>
    </div>
    <Modal
      isOpen={isPublishModalOpen}
      onClose={() => !isPublishing && setIsPublishModalOpen(false)}
      className="max-w-lg"
    >
      <div className="p-5">
        <h3 className="brand-page-section-title mb-2">Confirm campaign publish</h3>
        <p className="brand-campaign-meta mb-4">
          Budget is deducted only at publish time.
        </p>
        <div className="space-y-2 rounded-2xl border border-[#E8E2DB] bg-[#FCFAF8] p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#616161]">Current balance</span>
            <span className="font-medium text-[#212121]">
              {publishBalanceStatus === 'ready' && publishBalance !== null
                ? `₹${publishBalance.toLocaleString('en-IN')}`
                : publishBalanceStatus === 'loading'
                  ? 'Loading...'
                  : 'Unavailable'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#616161]">Amount to deduct</span>
            <span className="font-medium text-[#212121]">₹{requiredAmount.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#616161]">New balance</span>
            <span className="font-medium text-[#212121]">
              {publishBalanceStatus === 'ready' && publishBalance !== null
                ? `₹${Math.max(publishBalance - requiredAmount, 0).toLocaleString('en-IN')}`
                : '—'}
            </span>
          </div>
        </div>
        {publishBalanceStatus === 'ready' && !hasSufficientBalance ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Insufficient balance to publish this campaign.
          </div>
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          {publishBalanceStatus === 'ready' && !hasSufficientBalance ? (
            <Link href="/brand/wallet">
              <BrandSecondaryButton type="button" size="sm">
                Add funds
              </BrandSecondaryButton>
            </Link>
          ) : null}
          <BrandSecondaryButton
            type="button"
            size="sm"
            onClick={() => setIsPublishModalOpen(false)}
            disabled={isPublishing}
          >
            Cancel
          </BrandSecondaryButton>
          <BrandPrimaryButton
            type="button"
            size="sm"
            onClick={handleConfirmPublish}
            disabled={!hasSufficientBalance || publishBalanceStatus !== 'ready' || isPublishing}
          >
            {isPublishing ? 'Publishing...' : 'Publish'}
          </BrandPrimaryButton>
        </div>
      </div>
    </Modal>
    </>
  );
}
