'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Input from '@/components/ui/Input';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import Modal from '@/components/ui/Modal';
import {
  BrandPrimaryButton,
  BrandSecondaryButton,
  BrandPageHeader,
  BrandIconChip,
  BrandStatusPill,
} from '@/components/brand';
import { ProjectLibraryPickerModal } from '@/components/campaigns/ProjectLibraryPickerModal';
import {
  Calendar,
  IndianRupee,
  Search,
  Link2,
  Video,
  X,
  Upload,
  FolderOpen,
  Eye,
  ArrowUpDown,
  ListFilter,
  CalendarRange,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface Campaign {
  id: string;
  name: string;
  description: string;
  campaignType?: string;
  payoutRate: number;
  deadlineToApply: string;
  startDate: string;
  endDate: string;
  totalBudget: number;
  budgetUsed: number;
  remainingBudget?: number;
  platformTarget?: string;
  industry?: string;
  regionFilter?: string;
  brandAssetsUrl?: string;
  views?: number;
  targetViews?: number;
  status?: string;
}

interface CampaignStateRow {
  campaign: Campaign;
  application: {
    id: string;
    status: 'APPLIED' | 'APPROVED' | 'REJECTED' | 'SUBMITTED' | 'WITHDRAWN';
    draftMediaUrl?: string;
    draftMediaAssetId?: string;
    platform?: 'INSTAGRAM' | 'YOUTUBE';
    termsAccepted?: boolean;
    reviewedAt?: string | null;
  };
  postSubmissions: Array<{
    id: string;
    postUrl: string;
    platform: 'INSTAGRAM' | 'YOUTUBE';
    status: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
    createdAt: string;
  }>;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatLineDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getDaysRemaining(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Upload-tab label: local pick name, or processed upload title (not project-library rows). */
function uploadDraftSelectionLabel(
  uploadFileName: string | null,
  draftAssetId: string,
  projectId: string,
  projectTitle: string,
): string | null {
  if (uploadFileName) return uploadFileName;
  if (draftAssetId && !projectId && projectTitle) return projectTitle;
  return null;
}

function publicCampaignStatus(
  s: string | undefined,
): 'LIVE' | 'IN_PROGRESS' | 'PAUSED' | 'DRAFT' | 'COMPLETED' {
  if (s === 'LIVE' || s === 'IN_PROGRESS' || s === 'PAUSED' || s === 'DRAFT' || s === 'COMPLETED') {
    return s;
  }
  return 'LIVE';
}

function CreatorLiveCampaignCard({
  campaign,
  onApply,
}: {
  campaign: Campaign;
  onApply: (c: Campaign) => void;
}) {
  const budgetLeft = Math.max(
    Number(campaign.remainingBudget ?? campaign.totalBudget - campaign.budgetUsed),
    0,
  );
  const daysRemaining = getDaysRemaining(campaign.deadlineToApply);
  const urgent = daysRemaining >= 0 && daysRemaining <= 7;
  const views = Number(campaign.views ?? 0);
  const targetViews = Number(campaign.targetViews ?? 0);
  const st = publicCampaignStatus(campaign.status);

  return (
    <div className="brand-campaign-card-figma shadow-sm">
      <div className="flex flex-col gap-2 sm:gap-2.5">
        <div className="flex flex-col gap-1 sm:gap-2 sm:flex-row sm:items-start sm:justify-between">
          <Link
            href={`/campaigns/${campaign.id}`}
            className="brand-campaign-title font-heading leading-tight text-[#212121] hover:opacity-80 pr-2"
          >
            {campaign.name}
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2 text-right sm:max-w-[50%] sm:gap-2.5">
            {campaign.platformTarget ? (
              <span className="brand-campaign-meta text-[#616161]">{campaign.platformTarget}</span>
            ) : null}
            <BrandStatusPill status={st} />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <div className="inline-flex items-center gap-1.5 brand-campaign-row font-heading font-medium text-[#212121]">
            <IndianRupee className="h-3.5 w-3.5 brand-campaign-metric-stroke" strokeWidth={2} aria-hidden />
            <span>
              CPM ₹{campaign.payoutRate.toLocaleString('en-IN')} / 1k views
            </span>
          </div>
          <div className="inline-flex items-center gap-1.5 brand-campaign-row font-heading font-medium text-[#212121]">
            <Calendar className="h-3.5 w-3.5 brand-campaign-metric-stroke" strokeWidth={2} aria-hidden />
            <span>Apply by {formatDate(campaign.deadlineToApply)}</span>
          </div>
          <div className="flex items-center gap-1.5 sm:ml-auto">
            <Link
              href={`/campaigns/${campaign.id}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-[#E8E2DB] hover:bg-orange-50/50"
              aria-label="View campaign details"
              title="Details"
            >
              <Eye className="h-4 w-4 text-[#E86512]" />
            </Link>
            <BrandPrimaryButton type="button" size="sm" className="min-w-0" onClick={() => onApply(campaign)}>
              Apply with video
            </BrandPrimaryButton>
          </div>
        </div>

        <div className="brand-campaign-row flex flex-col gap-1.5 text-[#212121] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2.5 sm:gap-y-1">
            <div className="inline-flex min-w-0 items-center gap-1.5">
              <BrandIconChip size="sm">
                <Eye className="h-3 w-3" strokeWidth={1.8} />
              </BrandIconChip>
              <span>
                {views.toLocaleString('en-IN')} / {targetViews.toLocaleString('en-IN')} views
              </span>
            </div>
            <div className="inline-flex min-w-0 items-center gap-1.5">
              <BrandIconChip size="sm">
                <Calendar className="h-3 w-3" strokeWidth={1.8} />
              </BrandIconChip>
              <span className={cn(urgent && daysRemaining >= 0 && 'text-red-600')}>
                {formatLineDate(campaign.deadlineToApply)}
                {daysRemaining >= 0
                  ? ` — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} to apply`
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
            <span className="whitespace-nowrap">Budget left: ₹{budgetLeft.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreatorStateCampaignCard({
  row,
  listTab,
  onAttachFinalPost,
}: {
  row: CampaignStateRow;
  listTab: 'APPLIED' | 'APPROVED' | 'REJECTED';
  onAttachFinalPost: (r: CampaignStateRow) => void;
}) {
  const campaign = row.campaign;
  const latestPostSubmission = row.postSubmissions[0];
  const now = new Date();
  const campaignStart = new Date(campaign.startDate);
  const campaignEnd = new Date(campaign.endDate);
  const hasStarted = campaignStart <= now;
  const hasEnded = campaignEnd < now;
  const isFinalPostVerified = latestPostSubmission?.status === 'VERIFIED';
  const hasPendingFinalPost = latestPostSubmission?.status === 'PENDING_REVIEW';
  const canSubmitFinalPost = !isFinalPostVerified && !hasPendingFinalPost && !hasEnded;
  const isRejected = listTab === 'REJECTED';
  const daysRemaining = getDaysRemaining(campaign.deadlineToApply);
  const urgent = daysRemaining >= 0 && daysRemaining <= 7;
  const views = Number(campaign.views ?? 0);
  const targetViews = Number(campaign.targetViews ?? 0);
  const budgetLeft = Math.max(
    Number(campaign.remainingBudget ?? campaign.totalBudget - campaign.budgetUsed),
    0,
  );

  const statusLabel = isRejected ? 'Rejected' : row.application.status;

  return (
    <div className="brand-campaign-card-figma shadow-sm">
      <div className="flex flex-col gap-2 sm:gap-2.5">
        <div className="flex flex-col gap-1 sm:gap-2 sm:flex-row sm:items-start sm:justify-between">
          <Link
            href={`/campaigns/${campaign.id}`}
            className="brand-campaign-title font-heading leading-tight text-[#212121] hover:opacity-80 pr-2"
          >
            {campaign.name}
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-2.5">
            {campaign.platformTarget ? (
              <span className="brand-campaign-meta text-[#616161]">{campaign.platformTarget}</span>
            ) : null}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-heading text-[10px] font-semibold uppercase tracking-wide',
                isRejected
                  ? 'bg-red-50 text-red-700'
                  : row.application.status === 'APPROVED'
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-sky-50 text-sky-800',
              )}
            >
              <Eye className="h-3 w-3 opacity-80" aria-hidden />
              {statusLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <div className="inline-flex items-center gap-1.5 brand-campaign-row font-heading font-medium text-[#212121]">
            <Video className="h-3.5 w-3.5 brand-campaign-metric-stroke" strokeWidth={2} aria-hidden />
            <span>
              Draft:{' '}
              {row.application.draftMediaUrl || row.application.draftMediaAssetId ? 'Submitted' : '—'}
            </span>
          </div>
          {latestPostSubmission ? (
            <span className="brand-campaign-row text-sm font-medium text-[#212121]">
              Final post: {latestPostSubmission.status.replace('_', ' ')}
            </span>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            <Link
              href={`/campaigns/${campaign.id}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-[#E8E2DB] hover:bg-orange-50/50"
              aria-label="View campaign details"
              title="Details"
            >
              <Eye className="h-4 w-4 text-[#E86512]" />
            </Link>
            {listTab === 'APPROVED' ? (
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                {isFinalPostVerified ? (
                  <Link href="/earnings">
                    <BrandPrimaryButton type="button" size="sm" className="w-full sm:w-auto">
                      View earnings
                    </BrandPrimaryButton>
                  </Link>
                ) : (
                  <BrandPrimaryButton
                    type="button"
                    size="sm"
                    className="min-w-0"
                    disabled={!hasStarted || !canSubmitFinalPost}
                    onClick={() => {
                      if (!hasStarted || !canSubmitFinalPost) return;
                      onAttachFinalPost(row);
                    }}
                  >
                    {!hasStarted
                      ? 'After campaign starts'
                      : hasPendingFinalPost
                        ? 'Final post under review'
                        : hasEnded
                          ? 'Campaign ended'
                          : 'Submit final post link'}
                  </BrandPrimaryButton>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="brand-campaign-row flex flex-col gap-1.5 text-[#212121] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2.5 sm:gap-y-1">
            <div className="inline-flex min-w-0 items-center gap-1.5">
              <BrandIconChip size="sm">
                <Eye className="h-3 w-3" strokeWidth={1.8} />
              </BrandIconChip>
              <span>
                {views.toLocaleString('en-IN')} / {targetViews.toLocaleString('en-IN')} views
              </span>
            </div>
            <div className="inline-flex min-w-0 items-center gap-1.5">
              <BrandIconChip size="sm">
                <Calendar className="h-3 w-3" strokeWidth={1.8} />
              </BrandIconChip>
              <span className={cn(urgent && daysRemaining >= 0 && 'text-red-600')}>
                {formatLineDate(campaign.deadlineToApply)}
                {daysRemaining >= 0
                  ? ` — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} to apply`
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
            <span className="whitespace-nowrap">Budget left: ₹{budgetLeft.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CreatorCampaignsPage() {
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [sortBy, setSortBy] = useState<'deadline' | 'title'>('deadline');
  const [activeTab, setActiveTab] = useState<'LIVE' | 'APPLIED' | 'APPROVED' | 'REJECTED'>('LIVE');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignStates, setCampaignStates] = useState<CampaignStateRow[]>([]);
  const [applyModalCampaign, setApplyModalCampaign] = useState<Campaign | null>(null);
  const [attachModalCampaign, setAttachModalCampaign] = useState<CampaignStateRow | null>(null);
  const [isSubmittingApply, setIsSubmittingApply] = useState(false);
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [applyForm, setApplyForm] = useState({
    draftAssetId: '' as string,
    draftMediaUrl: '',
    sourceType: 'PROJECT_LIBRARY' as 'PROJECT_LIBRARY' | 'UPLOAD' | 'EXTERNAL_URL',
    projectId: '',
    projectTitle: '',
    termsAccepted: false,
  });
  const [isProjectLibraryOpen, setIsProjectLibraryOpen] = useState(false);
  const draftFileInputRef = useRef<HTMLInputElement>(null);
  const [attachLink, setAttachLink] = useState('');
  const [attachPlatform, setAttachPlatform] = useState<'INSTAGRAM' | 'YOUTUBE'>('INSTAGRAM');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [urlIngestBusy, setUrlIngestBusy] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setIsLoading(true);
    try {
      const [liveRes, statesRes] = await Promise.all([
        apiClient.getCreatorCampaigns(),
        apiClient.getCreatorCampaignStates(),
      ]);
      setCampaigns((liveRes.data || []) as Campaign[]);
      setCampaignStates((statesRes.data || []) as CampaignStateRow[]);
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Failed to load campaigns', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    if (!isSearchExpanded) return;
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [isSearchExpanded]);

  const stateByCampaignId = useMemo(() => {
    return campaignStates.reduce<Record<string, CampaignStateRow>>((acc, row) => {
      acc[row.campaign.id] = row;
      return acc;
    }, {});
  }, [campaignStates]);

  const liveAvailableCount = useMemo(
    () => campaigns.filter((c) => !stateByCampaignId[c.id]).length,
    [campaigns, stateByCampaignId],
  );
  const appliedCount = useMemo(
    () =>
      campaignStates.filter(
        (row) => row.application.status === 'APPLIED' || row.application.status === 'SUBMITTED',
      ).length,
    [campaignStates],
  );
  const approvedCount = useMemo(
    () => campaignStates.filter((row) => row.application.status === 'APPROVED').length,
    [campaignStates],
  );
  const rejectedCount = useMemo(
    () => campaignStates.filter((row) => row.application.status === 'REJECTED').length,
    [campaignStates],
  );

  const filteredLive = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      const matches =
        !keyword ||
        campaign.name.toLowerCase().includes(keyword) ||
        campaign.description.toLowerCase().includes(keyword);
      if (!matches) return false;
      return !stateByCampaignId[campaign.id];
    });
  }, [campaigns, search, stateByCampaignId]);

  const filteredStates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return campaignStates.filter((row) => {
      const campaign = row.campaign;
      return (
        !keyword ||
        campaign.name.toLowerCase().includes(keyword) ||
        campaign.description.toLowerCase().includes(keyword)
      );
    });
  }, [campaignStates, search]);

  const appliedRows = filteredStates.filter(
    (row) => row.application.status === 'APPLIED' || row.application.status === 'SUBMITTED',
  );
  const approvedRows = filteredStates.filter((row) => row.application.status === 'APPROVED');
  const rejectedRows = filteredStates.filter((row) => row.application.status === 'REJECTED');

  const sortedLive = useMemo(() => {
    const arr = [...filteredLive];
    arr.sort((a, b) =>
      sortBy === 'title'
        ? a.name.localeCompare(b.name)
        : new Date(a.deadlineToApply).getTime() - new Date(b.deadlineToApply).getTime(),
    );
    return arr;
  }, [filteredLive, sortBy]);

  const sortStateRows = (rows: CampaignStateRow[]) => {
    const arr = [...rows];
    arr.sort((a, b) =>
      sortBy === 'title'
        ? a.campaign.name.localeCompare(b.campaign.name)
        : new Date(a.campaign.deadlineToApply).getTime() - new Date(b.campaign.deadlineToApply).getTime(),
    );
    return arr;
  };

  const sortedAppliedRows = useMemo(() => sortStateRows(appliedRows), [appliedRows, sortBy]);
  const sortedApprovedRows = useMemo(() => sortStateRows(approvedRows), [approvedRows, sortBy]);
  const sortedRejectedRows = useMemo(() => sortStateRows(rejectedRows), [rejectedRows, sortBy]);

  const tabs: { id: typeof activeTab; label: string; count: number }[] = [
    { id: 'LIVE', label: 'Live', count: liveAvailableCount },
    { id: 'APPLIED', label: 'Applied', count: appliedCount },
    { id: 'APPROVED', label: 'Approved', count: approvedCount },
    { id: 'REJECTED', label: 'Rejected', count: rejectedCount },
  ];

  const resetApplyForm = () => {
    setUploadFileName(null);
    setApplyForm({
      draftAssetId: '',
      draftMediaUrl: '',
      sourceType: 'PROJECT_LIBRARY',
      projectId: '',
      projectTitle: '',
      termsAccepted: false,
    });
  };

  const listRows =
    activeTab === 'LIVE'
      ? sortedLive
      : activeTab === 'APPLIED'
        ? sortedAppliedRows
        : activeTab === 'APPROVED'
          ? sortedApprovedRows
          : sortedRejectedRows;

  const emptyCopy =
    activeTab === 'LIVE'
      ? 'No open campaigns to apply to right now.'
      : `No ${activeTab.toLowerCase()} campaigns match your search.`;

  return (
    <div className="brand-page-shell brand-page-shell--campaigns">
      <BrandPageHeader
        hideBackButton
        className="mb-3 shrink-0 sm:mb-3"
        left={
          <div>
            <h1 className="brand-campaign-page-title">Campaigns</h1>
            <p className="brand-campaign-meta mt-1">Explore, apply, and submit post links from one place.</p>
          </div>
        }
      />

      <div className="brand-gradient-frame mb-0 flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4 p-[2px]">
        <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[18px] bg-white/95 shadow-sm">
          <div className="shrink-0 space-y-3 border-b border-[#EFE8E3] p-3 sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
              <div
                className="inline-flex w-fit max-w-full rounded-[28px] p-[2px]"
                style={{
                  background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)',
                }}
              >
                <div
                  className="inline-flex min-w-0 flex-row items-center gap-0.5 overflow-x-auto rounded-[26px] bg-white p-1 sm:gap-1"
                  role="tablist"
                  aria-label="Campaign filters"
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
                        className="brand-campaigns-tab whitespace-nowrap"
                      >
                        {tab.label} ({tab.count})
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
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
                      isSearchExpanded ? 'w-[min(18.75rem,64vw)] px-2.5 py-1.5 opacity-100' : 'w-0 px-0 py-0 opacity-0',
                    )}
                  >
                    <input
                      ref={searchInputRef}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search campaigns"
                      aria-label="Search campaigns"
                      className="w-full min-w-0 border-0 bg-transparent font-heading text-[clamp(0.8rem,1.1vw,0.92rem)] text-[#212121] outline-none placeholder:text-[#9E9E9E]"
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
                  onClick={() => setSortBy((p) => (p === 'deadline' ? 'title' : 'deadline'))}
                  className="brand-text-link"
                >
                  <ArrowUpDown className="h-4 w-4 text-[#E86512]" />
                  {sortBy === 'deadline' ? 'Sort' : 'A–Z'}
                </button>
                <button
                  type="button"
                  className="brand-text-link"
                  onClick={() => {
                    setIsSearchExpanded(true);
                    requestAnimationFrame(() => searchInputRef.current?.focus());
                  }}
                  aria-label="Focus search filter"
                >
                  <ListFilter className="h-4 w-4 text-[#E86512]" />
                  Filter
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {isLoading ? (
              <div className="py-10 text-center text-sm text-text-secondary">Loading campaigns...</div>
            ) : listRows.length === 0 ? (
              <div className="py-8 text-center sm:py-10">
                <div className="mx-auto mb-2 max-w-md rounded-xl border border-dashed border-orange-200/80 bg-gradient-to-br from-orange-50/90 to-pink-50/90 p-6 sm:p-8">
                  <p className="font-heading text-base text-[#212121] sm:text-lg">{emptyCopy}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 sm:space-y-3 pr-0.5">
                {activeTab === 'LIVE'
                  ? (listRows as Campaign[]).map((campaign) => (
                      <CreatorLiveCampaignCard
                        key={campaign.id}
                        campaign={campaign}
                        onApply={setApplyModalCampaign}
                      />
                    ))
                  : (listRows as CampaignStateRow[]).map((row) => (
                      <CreatorStateCampaignCard
                        key={row.application.id}
                        row={row}
                        listTab={activeTab}
                        onAttachFinalPost={setAttachModalCampaign}
                      />
                    ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={Boolean(applyModalCampaign)}
        onClose={() => {
          setApplyModalCampaign(null);
          resetApplyForm();
        }}
        className="max-w-3xl"
      >
        <div className="p-5">
          <h3 className="brand-page-section-title mb-3">Apply to campaign</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <div
                className="inline-flex w-full max-w-full rounded-[28px] p-[2px]"
                style={{
                  background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)',
                }}
              >
                <div
                  className="inline-flex w-full min-w-0 flex-row items-center gap-0.5 overflow-x-auto rounded-[26px] bg-white p-1 sm:gap-1"
                  role="tablist"
                  aria-label="Draft video source"
                >
                  {(
                    [
                      { id: 'PROJECT_LIBRARY' as const, label: 'From projects', Icon: FolderOpen },
                      { id: 'UPLOAD' as const, label: 'Upload video', Icon: Upload },
                      { id: 'EXTERNAL_URL' as const, label: 'Video URL', Icon: Link2 },
                    ] as const
                  ).map((option) => {
                    const Icon = option.Icon;
                    const selected = applyForm.sourceType === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        className="brand-campaigns-tab inline-flex min-h-[2.25rem] flex-1 basis-0 items-center justify-center gap-1.5 text-center"
                        onClick={() => {
                          setApplyForm((prev) => ({
                            ...prev,
                            sourceType: option.id,
                            draftAssetId: prev.sourceType === option.id ? prev.draftAssetId : '',
                            draftMediaUrl: prev.sourceType === option.id ? prev.draftMediaUrl : '',
                            projectId: prev.sourceType === option.id ? prev.projectId : '',
                            projectTitle: prev.sourceType === option.id ? prev.projectTitle : '',
                          }));
                          if (option.id !== applyForm.sourceType) setUploadFileName(null);
                        }}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="whitespace-nowrap">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {applyForm.sourceType === 'PROJECT_LIBRARY' ? (
              <div className="md:col-span-2 rounded-2xl border border-[#E8E2DB] bg-[#F9F7F4] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-[#616161]">
                    {applyForm.projectId && !applyForm.draftAssetId
                      ? `Selected: ${applyForm.projectTitle || 'Project video'} — will be processed on apply`
                      : applyForm.draftAssetId
                        ? `Ready: ${applyForm.projectTitle || 'Project video'} (processed)`
                        : 'Pick a completed project — we will watermark a preview for the brand.'}
                  </p>
                  <BrandSecondaryButton
                    type="button"
                    size="sm"
                    onClick={() => setIsProjectLibraryOpen(true)}
                    disabled={!applyModalCampaign}
                  >
                    {applyForm.projectId || applyForm.draftAssetId ? 'Change video' : 'Browse videos'}
                  </BrandSecondaryButton>
                </div>
              </div>
            ) : null}
            {applyForm.sourceType === 'UPLOAD' ? (
              <div className="md:col-span-2 space-y-3 rounded-2xl border border-[#E8E2DB] bg-[#F9F7F4] p-3">
                <input
                  ref={draftFileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file || !applyModalCampaign) return;
                    setUploadFileName(file.name);
                    setApplyForm((prev) => ({
                      ...prev,
                      draftAssetId: '',
                      draftMediaUrl: '',
                      projectId: '',
                      projectTitle: file.name,
                    }));
                    setUploadBusy(true);
                    let clearedInput = false;
                    try {
                      const response = await apiClient.uploadCreatorDraftAsset(file, {
                        campaignId: applyModalCampaign.id,
                      });
                      const assetId = response.data?.assetId;
                      if (assetId) {
                        setApplyForm((prev) => ({
                          ...prev,
                          draftAssetId: assetId,
                          draftMediaUrl: '',
                          projectId: '',
                          projectTitle: file.name,
                        }));
                        showToast('Video processed', 'success');
                        event.target.value = '';
                        clearedInput = true;
                      } else {
                        showToast(response.error || 'Upload did not return an asset id', 'error');
                      }
                    } catch (error: unknown) {
                      showToast(error instanceof Error ? error.message : 'Upload failed', 'error');
                    } finally {
                      setUploadBusy(false);
                      if (!clearedInput) event.target.value = '';
                    }
                  }}
                />
                {(() => {
                  const uploadLabel = uploadDraftSelectionLabel(
                    uploadFileName,
                    applyForm.draftAssetId,
                    applyForm.projectId,
                    applyForm.projectTitle,
                  );
                  return uploadLabel ? (
                    <p className="text-sm text-[#616161]">
                      Selected:{' '}
                      <span className="break-all font-medium text-[#212121]">{uploadLabel}</span>
                      {uploadBusy ? (
                        <span className="ml-2 font-heading font-medium text-[#E86512]">Uploading…</span>
                      ) : null}
                    </p>
                  ) : (
                    <p className="text-sm text-[#616161]">Choose a video file from your device.</p>
                  );
                })()}
                <BrandSecondaryButton
                  type="button"
                  size="sm"
                  disabled={uploadBusy}
                  onClick={() => draftFileInputRef.current?.click()}
                >
                  {uploadBusy ? 'Uploading…' : applyForm.draftAssetId ? 'Replace video' : 'Upload draft video'}
                </BrandSecondaryButton>
                {applyForm.draftAssetId ? (
                  <p className="text-xs text-emerald-700">Video ready — you can submit the application.</p>
                ) : uploadFileName && !uploadBusy ? (
                  <p className="text-xs text-red-700">Upload could not be processed. Please replace the video and try again.</p>
                ) : null}
              </div>
            ) : null}
            {applyForm.sourceType === 'EXTERNAL_URL' ? (
              <div className="md:col-span-2 space-y-2">
                <Input
                  variant="brandCapsule"
                  placeholder="Direct link to a video file (mp4, mov…)"
                  value={applyForm.draftMediaUrl}
                  onChange={(e) => setApplyForm((p) => ({ ...p, draftMediaUrl: e.target.value }))}
                />
                <BrandSecondaryButton
                  type="button"
                  size="sm"
                  disabled={urlIngestBusy || !applyForm.draftMediaUrl.trim()}
                  onClick={async () => {
                    if (!applyModalCampaign?.id) return;
                    setUrlIngestBusy(true);
                    try {
                      const res = await apiClient.ingestCreatorDraftFromUrl(applyForm.draftMediaUrl.trim(), {
                        campaignId: applyModalCampaign.id,
                      });
                      const aid = res.data?.assetId;
                      if (aid) {
                        setUploadFileName(null);
                        setApplyForm((p) => ({
                          ...p,
                          draftAssetId: aid,
                          projectId: '',
                          projectTitle: 'Video URL',
                        }));
                        showToast('URL imported', 'success');
                      } else {
                        showToast(res.error || 'Import did not return an asset id', 'error');
                      }
                    } catch (e: unknown) {
                      showToast(e instanceof Error ? e.message : 'Import failed', 'error');
                    } finally {
                      setUrlIngestBusy(false);
                    }
                  }}
                >
                  {urlIngestBusy ? 'Validating…' : 'Validate & import URL'}
                </BrandSecondaryButton>
              </div>
            ) : null}
            <label className="md:col-span-2 flex items-start gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={applyForm.termsAccepted}
                onChange={(e) => setApplyForm((p) => ({ ...p, termsAccepted: e.target.checked }))}
                className="mt-1 accent-[#E86512]"
              />
              I agree to keep the approved post live for 90 days and understand earnings remain locked for 14 days before withdrawal availability.
            </label>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <BrandSecondaryButton
              size="sm"
              onClick={() => {
                setApplyModalCampaign(null);
                resetApplyForm();
              }}
              disabled={isSubmittingApply}
            >
              Discard
            </BrandSecondaryButton>
            <BrandPrimaryButton
              size="sm"
              disabled={isSubmittingApply || uploadBusy || urlIngestBusy}
              onClick={async () => {
                if (!applyModalCampaign) return;
                if (uploadBusy || urlIngestBusy) {
                  showToast('Wait for the video to finish processing', 'error');
                  return;
                }
                if (!applyForm.draftAssetId && !applyForm.projectId) {
                  showToast('Add a video using one of the methods above', 'error');
                  return;
                }
                if (!applyForm.termsAccepted) {
                  showToast('Please accept terms before applying', 'error');
                  return;
                }
                setIsSubmittingApply(true);
                try {
                  let finalAssetId = applyForm.draftAssetId;
                  if (!finalAssetId && applyForm.projectId && applyForm.sourceType === 'PROJECT_LIBRARY') {
                    const res = await apiClient.ingestCreatorDraftFromProject(applyForm.projectId, {
                      campaignId: applyModalCampaign.id,
                    });
                    finalAssetId = res.data?.assetId || '';
                    if (!finalAssetId) {
                      showToast(res.error || 'Could not process project video', 'error');
                      return;
                    }
                  }
                  await apiClient.applyToCampaign(applyModalCampaign.id, {
                    draftAssetId: finalAssetId,
                    platform: 'INSTAGRAM',
                    termsAccepted: true,
                    sourceType: applyForm.sourceType,
                    projectId: applyForm.projectId || undefined,
                  });
                  setApplyModalCampaign(null);
                  resetApplyForm();
                  await loadCampaigns();
                  showToast('Applied successfully', 'success');
                } catch (error: unknown) {
                  showToast(error instanceof Error ? error.message : 'Failed to apply', 'error');
                } finally {
                  setIsSubmittingApply(false);
                }
              }}
            >
              {isSubmittingApply ? 'Processing…' : uploadBusy ? 'Uploading…' : urlIngestBusy ? 'Validating…' : 'Apply'}
            </BrandPrimaryButton>
          </div>
        </div>
      </Modal>

      {applyModalCampaign ? (
        <ProjectLibraryPickerModal
          isOpen={isProjectLibraryOpen}
          onClose={() => setIsProjectLibraryOpen(false)}
          campaignId={applyModalCampaign.id}
          deferProcessing
          onProjectSelected={(projectId, meta) => {
            setApplyForm((p) => ({
              ...p,
              draftAssetId: '',
              projectId,
              projectTitle: meta.title,
              sourceType: 'PROJECT_LIBRARY',
            }));
            setIsProjectLibraryOpen(false);
          }}
          onAssetReady={(assetId, meta) => {
            setApplyForm((p) => ({
              ...p,
              draftAssetId: assetId,
              projectId: meta.projectId,
              projectTitle: meta.title,
              sourceType: 'PROJECT_LIBRARY',
            }));
            showToast('Project video imported', 'success');
          }}
        />
      ) : null}

      <Modal isOpen={Boolean(attachModalCampaign)} onClose={() => setAttachModalCampaign(null)} className="max-w-lg">
        <div className="p-5">
          <h3 className="brand-page-section-title mb-2">Submit final post link</h3>
          <p className="brand-campaign-meta mb-3">
            Submit your published social link. Brand/admin will verify before earnings accrue.
          </p>
          <Input
            variant="brandCapsule"
            placeholder="https://instagram.com/reel/... or https://youtube.com/shorts/..."
            value={attachLink}
            onChange={(e) => setAttachLink(e.target.value)}
            icon={<Link2 className="h-4 w-4 text-[#9E9E9E]" />}
            iconPosition="left"
          />
          <select
            className="brand-field-capsule mt-3"
            value={attachPlatform}
            onChange={(e) => setAttachPlatform(e.target.value as 'INSTAGRAM' | 'YOUTUBE')}
          >
            <option value="INSTAGRAM">Instagram</option>
            <option value="YOUTUBE">YouTube Shorts</option>
          </select>
          <div className="mt-4 flex items-center justify-end gap-2">
            <BrandSecondaryButton size="sm" onClick={() => setAttachModalCampaign(null)} disabled={isSubmittingPost}>
              Discard
            </BrandSecondaryButton>
            <BrandPrimaryButton
              size="sm"
              disabled={isSubmittingPost}
              onClick={async () => {
                if (!attachModalCampaign) return;
                if (!attachLink.trim()) {
                  showToast('Post link is required', 'error');
                  return;
                }
                setIsSubmittingPost(true);
                try {
                  await apiClient.submitFinalPostLink(attachModalCampaign.campaign.id, {
                    postUrl: attachLink.trim(),
                    platform: attachPlatform,
                  });
                  setAttachModalCampaign(null);
                  setAttachLink('');
                  await loadCampaigns();
                  showToast('Final post submitted for review', 'success');
                } catch (error: unknown) {
                  showToast(error instanceof Error ? error.message : 'Failed to submit final post', 'error');
                } finally {
                  setIsSubmittingPost(false);
                }
              }}
            >
              Submit
            </BrandPrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
