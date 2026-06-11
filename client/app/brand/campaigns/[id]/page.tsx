'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  BrandStatusPill,
  BrandIconChip,
  BrandPrimaryButton,
  BrandSecondaryButton,
} from '@/components/brand';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';
import {
  ArrowLeft,
  Calendar,
  Eye,
  IndianRupee,
  Search,
  CalendarRange,
  Pause,
  Play,
  Pencil,
  X,
  Check,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { CampaignWatermarkedPreviewModal } from '@/components/campaigns/CampaignWatermarkedPreviewModal';
import { parseDraftMediaAssetId } from '@/lib/campaign-media';
import { LeaderboardCard } from '@/components/campaigns/LeaderboardCard';
import { ScrapeHistoryTable } from '@/components/campaigns/ScrapeHistoryTable';
import { StartCampaignButton } from '@/components/campaigns/StartCampaignButton';
import { EndCampaignButton } from '@/components/campaigns/EndCampaignButton';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { useAuth } from '@/hooks/useAuth';

interface Applicant {
  id: string;
  creatorId: string;
  name: string;
  /** Resolved campaign-media asset for watermarked preview */
  draftAssetId?: string;
  appliedAt: string;
  status: 'PENDING' | 'SHORTLISTED' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'SUBMITTED';
  views?: number;
  earnings?: number;
  creatorHistory?: {
    approvedCount: number;
    totalSubmissions: number;
    totalViews: number;
    totalEarnings: number;
  };
}

interface CampaignDetails {
  id: string;
  name: string;
  status: string;
  postedAt: string;
  deadlineToApply: string;
  startDate: string;
  endDate: string;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  description: string;
  views: number;
  targetViews: number;
  budgetUsed: number;
  totalBudget: number;
  payoutModel?: 'CPM' | 'POOL';
  finalizationStatus?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | null;
  finalizedAt?: string | null;
  finalizationError?: string | null;
  gracePeriodHours?: number;
  manualScrapeCooldownSec?: number;
  lastManualScrapeAt?: string | null;
}

interface ApplicationRow {
  id: string;
  creatorId: string;
  draftMediaUrl?: string;
  draftMediaAssetId?: string;
  platform?: 'INSTAGRAM' | 'YOUTUBE';
  createdAt: string;
  status: 'APPLIED' | 'APPROVED' | 'REJECTED' | 'SUBMITTED' | 'WITHDRAWN';
}

interface PostSubmission {
  id: string;
  campaignId: string;
  creatorId: string;
  postUrl: string;
  platform: 'INSTAGRAM' | 'YOUTUBE';
  status: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  reviewComment?: string;
  createdAt: string;
}

function paramSegment(
  params: ReturnType<typeof useParams> | null,
  key: string
): string {
  const v = params?.[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0] ?? '';
  return '';
}

type PublicStatus = 'LIVE' | 'IN_PROGRESS' | 'PAUSED' | 'DRAFT' | 'COMPLETED';

function toPublicStatus(raw: string): PublicStatus {
  const u = String(raw).toUpperCase().replace(/\s+/g, '_');
  if (u === 'LIVE' || u === 'IN_PROGRESS' || u === 'PAUSED' || u === 'DRAFT' || u === 'COMPLETED') {
    return u;
  }
  return 'IN_PROGRESS';
}

export default function CampaignDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const { user } = useAuth();
  const isPrivileged = user?.role === 'ADMIN' || user?.role === 'OWNER';
  const campaignId = paramSegment(params, 'id');
  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback;
  
  const [campaign, setCampaign] = useState<CampaignDetails | null>(null);
  const [allApplicants, setAllApplicants] = useState<Applicant[]>([]);
  const [postSubmissions, setPostSubmissions] = useState<PostSubmission[]>([]);
  // Manual views update state - commented out since Apify scraper handles this automatically
  // const [viewInputs, setViewInputs] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showShortlistConfirm, setShowShortlistConfirm] = useState(false);
  const [selectedApplicant, setSelectedApplicant] = useState<Applicant | null>(null);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [applicantSearch, setApplicantSearch] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [activeReviewTab, setActiveReviewTab] = useState<'applicants' | 'shortlisted' | 'rejected'>(
    'applicants',
  );
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);

  const pendingApplicants = useMemo(
    () => allApplicants.filter((a) => a.status === 'PENDING'),
    [allApplicants],
  );
  const shortlistedApplicants = useMemo(
    () => allApplicants.filter((a) => a.status === 'APPROVED' || a.status === 'SHORTLISTED'),
    [allApplicants],
  );
  const rejectedApplicants = useMemo(
    () => allApplicants.filter((a) => a.status === 'REJECTED'),
    [allApplicants],
  );

  const loadCampaign = useCallback(async () => {
    try {
      const response = await apiClient.getCampaign(campaignId);
      if (response.data) {
        setCampaign(response.data);
        setIsLoading(false);
        return;
      }
      showToast('Campaign not found', 'error');
      router.push('/brand/campaigns');
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to load campaign'), 'error');
      setIsLoading(false);
    }
  }, [campaignId, router, showToast]);

  const loadApplicants = useCallback(async () => {
    try {
      const response = await apiClient.getCampaignApplications(campaignId);
      const allRows = (response.data || []) as ApplicationRow[];
      const mapped = allRows.map((application) => ({
        id: application.id,
        creatorId: application.creatorId,
        name: `Creator ${application.creatorId.slice(-6)}`,
        draftAssetId:
          parseDraftMediaAssetId(application.draftMediaUrl, application.draftMediaAssetId) || undefined,
        appliedAt: application.createdAt,
        status: (
          application.status === 'APPLIED' || application.status === 'SUBMITTED'
            ? 'PENDING'
            : application.status
        ) as Applicant['status'],
      }));
      setAllApplicants(mapped);
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to load applicants'), 'error');
    }
  }, [campaignId, showToast]);

  const loadPostSubmissions = useCallback(async () => {
    try {
      const response = await apiClient.getCampaignPostSubmissions(campaignId);
      setPostSubmissions((response.data || []) as PostSubmission[]);
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to load final post submissions'), 'error');
    }
  }, [campaignId, showToast]);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    apiClient
      .getCampaign(campaignId)
      .then((response) => {
        if (!active) return;
        if (response.data) {
          setCampaign(response.data as CampaignDetails);
          setIsLoading(false);
          return;
        }
        showToast('Campaign not found', 'error');
        router.push('/brand/campaigns');
      })
      .catch((error: unknown) => {
        if (!active) return;
        showToast(getErrorMessage(error, 'Failed to load campaign'), 'error');
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [campaignId, router, showToast]);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    apiClient
      .getCampaignApplications(campaignId)
      .then((response) => {
        if (!active) return;
        const allRows = (response.data || []) as ApplicationRow[];
        const mapped = allRows.map((application) => ({
          id: application.id,
          creatorId: application.creatorId,
          name: `Creator ${application.creatorId.slice(-6)}`,
          draftAssetId:
            parseDraftMediaAssetId(application.draftMediaUrl, application.draftMediaAssetId) || undefined,
          appliedAt: application.createdAt,
          status: (
            application.status === 'APPLIED' || application.status === 'SUBMITTED'
              ? 'PENDING'
              : application.status
          ) as Applicant['status'],
        }));
        setAllApplicants(mapped);
      })
      .catch((error: unknown) => {
        if (!active) return;
        showToast(getErrorMessage(error, 'Failed to load applicants'), 'error');
      });
    return () => {
      active = false;
    };
  }, [campaignId, showToast]);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    const run = async () => {
      try {
        const response = await apiClient.getCampaignPostSubmissions(campaignId);
        if (active) {
          setPostSubmissions((response.data || []) as PostSubmission[]);
        }
      } catch (error: unknown) {
        showToast(getErrorMessage(error, 'Failed to load final post submissions'), 'error');
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [campaignId, showToast]);

  useEffect(() => {
    if (isSearchExpanded) {
      searchInputRef.current?.focus();
    }
  }, [isSearchExpanded]);

  const handleShortlist = async (applicant: Applicant) => {
    setSelectedApplicant(applicant);
    setShowShortlistConfirm(true);
  };

  const handleReject = (applicant: Applicant) => {
    setSelectedApplicant(applicant);
    setRejectComment('');
    setShowRejectConfirm(true);
  };

  const confirmShortlist = async () => {
    if (!selectedApplicant) return;
    
    try {
      await apiClient.shortlistApplicant(campaignId, selectedApplicant.id);
      await loadApplicants();
      showToast('Applicant shortlisted successfully', 'success');
      setShowShortlistConfirm(false);
      setSelectedApplicant(null);
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to shortlist applicant'), 'error');
    }
  };

  const confirmReject = async () => {
    if (!selectedApplicant) return;
    try {
      await apiClient.reviewApplication(selectedApplicant.id, {
        status: 'REJECTED',
        comment: rejectComment || undefined,
      });
      await loadApplicants();
      showToast('Applicant rejected', 'success');
      setShowRejectConfirm(false);
      setSelectedApplicant(null);
      setRejectComment('');
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to reject applicant'), 'error');
    }
  };

  const formatDate = (dateString: string, showTime = true) => {
    const date = new Date(dateString);
    const options: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    };
    if (showTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.hour12 = true;
    }
    return date.toLocaleString('en-IN', options);
  };

  const formatCampaignDate = (
    dateString: string,
    type: 'deadline' | 'start' | 'end' | 'posted',
    wasManual = false,
  ) => {
    const date = new Date(dateString);
    const dateOnly = date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    if (type === 'posted') {
      return date.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });
    }
    if (wasManual) {
      return date.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });
    }
    if (type === 'deadline' || type === 'end') {
      return `${dateOnly}, 11:59 PM`;
    }
    return `${dateOnly}, 12:00 AM`;
  };

  const getDaysRemaining = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  if (isLoading || !campaign) {
    return (
      <div className="brand-page-shell py-8">
        <p className="text-center text-text-secondary">Loading campaign details...</p>
      </div>
    );
  }

  const daysRemaining = getDaysRemaining(campaign.deadlineToApply);
  const graceHours = campaign.gracePeriodHours ?? 24;
  const effectiveEndDate = campaign.actualEndDate ?? campaign.endDate;
  const effectiveStartDate = campaign.actualStartDate ?? campaign.startDate;
  const finalizeEligibleAt =
    new Date(effectiveEndDate).getTime() + graceHours * 60 * 60 * 1000;
  const canFinalizeNow = Date.now() >= finalizeEligibleAt;
  const budgetProgress =
    campaign.totalBudget > 0 ? (campaign.budgetUsed / campaign.totalBudget) * 100 : 0;
  const now = new Date();
  const hasStarted = new Date(effectiveStartDate) <= now;
  const hasEnded = new Date(effectiveEndDate) < now;

  const tabApplicants =
    activeReviewTab === 'applicants'
      ? pendingApplicants
      : activeReviewTab === 'shortlisted'
        ? shortlistedApplicants
        : rejectedApplicants;

  const filteredApplicants = tabApplicants.filter((applicant) => {
    const keyword = applicantSearch.trim().toLowerCase();
    if (!keyword) return true;
    return (
      applicant.name.toLowerCase().includes(keyword) ||
      applicant.creatorId.toLowerCase().includes(keyword)
    );
  });

  const displayApplicants = filteredApplicants;

  const tabTitle =
    activeReviewTab === 'applicants'
      ? 'Applicants'
      : activeReviewTab === 'shortlisted'
        ? 'Shortlisted'
        : 'Rejected';

  const emptyCopy =
    activeReviewTab === 'applicants'
      ? 'applicants'
      : activeReviewTab === 'shortlisted'
        ? 'shortlisted creators'
        : 'rejected applicants';

  return (
    <div className="brand-page-shell">
      {/* Header */}
      <div className="mb-3 space-y-3 sm:mb-5">
        {/* Row 1: Back + Title | Action Buttons */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <Link
              href="/brand/campaigns"
              className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/50"
            >
              <ArrowLeft className="h-4 w-4 text-[#212121]" />
            </Link>
            <h1 className="brand-campaign-page-title min-w-0 flex-1 truncate text-[#212121]">{campaign.name}</h1>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
          {campaign.status === 'LIVE' && (
            <StartCampaignButton
              campaignId={campaignId}
              startDate={campaign.startDate}
              actualStartDate={campaign.actualStartDate}
              onStarted={() => void loadCampaign()}
            />
          )}
          <EndCampaignButton
            campaignId={campaignId}
            status={campaign.status}
            actualStartDate={campaign.actualStartDate}
            actualEndDate={campaign.actualEndDate}
            startDate={campaign.startDate}
            payoutModel={campaign.payoutModel}
            onEnded={() => void loadCampaign()}
          />
          <BrandPrimaryButton
            type="button"
            className="!h-10 !min-h-10 !w-10 !rounded-full !px-0 !py-0 !shadow-[0_8px_22px_rgba(242,126,53,0.35)]"
            title={toPublicStatus(campaign.status) === 'PAUSED' ? 'Resume campaign' : 'Pause campaign'}
            aria-label={toPublicStatus(campaign.status) === 'PAUSED' ? 'Resume campaign' : 'Pause campaign'}
            onClick={async () => {
              try {
                if (toPublicStatus(campaign.status) === 'PAUSED') {
                  await apiClient.resumeCampaign(campaignId);
                  showToast('Campaign resumed successfully', 'success');
                } else {
                  await apiClient.pauseCampaign(campaignId);
                  showToast('Campaign paused successfully', 'success');
                }
                await loadCampaign();
              } catch (error: unknown) {
                showToast(getErrorMessage(error, 'Failed to update campaign status'), 'error');
              }
            }}
          >
            {toPublicStatus(campaign.status) === 'PAUSED' ? (
              <Play className="h-4 w-4" aria-hidden />
            ) : (
              <Pause className="h-4 w-4" aria-hidden />
            )}
          </BrandPrimaryButton>
          <Link
            href={`/brand/campaigns/${campaignId}/edit`}
            className="brand-cta-secondary inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full !border-2 !min-h-10 !min-w-10 !px-0 !py-0 !shadow-sm"
            title="Edit campaign"
            aria-label="Edit campaign"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        </div>

        {/* Row 2: Status + Posted Date */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <BrandStatusPill status={toPublicStatus(campaign.status)} />
          <span className="brand-campaign-meta text-text-secondary">Posted: {formatCampaignDate(campaign.postedAt, 'posted')}</span>
        </div>

        {/* Row 3: Views | Budget */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex min-w-0 items-center gap-1.5 brand-campaign-row text-[#212121]">
            <BrandIconChip size="sm">
              <Eye className="h-3 w-3" strokeWidth={1.8} />
            </BrandIconChip>
            <span>{campaign.views.toLocaleString('en-IN')} views</span>
          </div>
          <div className="inline-flex min-w-0 items-center gap-1.5 brand-campaign-row text-[#212121]">
            <BrandIconChip size="sm">
              <IndianRupee className="h-3 w-3" strokeWidth={1.8} />
            </BrandIconChip>
            <span>₹{campaign.totalBudget.toLocaleString('en-IN')} budget</span>
          </div>
        </div>

        {/* Row 4: Deadline | Timeline */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex min-w-0 items-center gap-1.5 brand-campaign-row text-[#212121]">
            <BrandIconChip size="sm">
              <Calendar className="h-3 w-3" strokeWidth={1.8} />
            </BrandIconChip>
            <span className={cn(daysRemaining < 0 && 'text-red-600')}>
              {campaign.actualStartDate
                ? formatCampaignDate(campaign.actualStartDate, 'deadline', true)
                : formatCampaignDate(campaign.deadlineToApply, 'deadline')}
              {!campaign.actualStartDate && daysRemaining >= 0 && ` · ${daysRemaining}d left`}
              {campaign.actualStartDate && ' (manually started)'}
            </span>
          </div>
          <div className="inline-flex min-w-0 items-center gap-1.5 brand-campaign-row text-[#212121]">
            <BrandIconChip size="sm">
              <CalendarRange className="h-3 w-3" strokeWidth={1.8} />
            </BrandIconChip>
            <span className="min-w-0 truncate">
              {formatCampaignDate(
                campaign.actualStartDate || campaign.startDate,
                'start',
                !!campaign.actualStartDate
              )}{' '}
              –{' '}
              {formatCampaignDate(
                campaign.actualEndDate || campaign.endDate,
                'end',
                !!campaign.actualEndDate
              )}
            </span>
          </div>
        </div>

        {/* Row 4: Description */}
        <p className="brand-campaign-meta line-clamp-3 leading-relaxed text-text-secondary">{campaign.description}</p>
      </div>

      {/* Countdown Timer Card */}
      {!hasEnded && campaign.status !== 'COMPLETED' && (
        <div className="mb-3 brand-gradient-frame rounded-[20px] p-2.5 sm:p-3 shadow-card sm:mb-5">
          <div className="rounded-[17px] bg-white/95 p-5 sm:p-6">
            <div className="flex flex-col items-center gap-2">
              <span className="text-sm font-heading font-medium text-[#616161]">
                {campaign.status === 'LIVE' && !hasStarted
                  ? 'Deadline to apply'
                  : 'Campaign ends in'}
              </span>
              <CountdownTimer
                targetDate={
                  campaign.status === 'LIVE' && !hasStarted
                    ? campaign.deadlineToApply
                    : effectiveEndDate
                }
                variant="default"
                size="lg"
                showSeparators={false}
              />
            </div>
          </div>
        </div>
      )}

      <div className="brand-gradient-frame mb-3 flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4 p-[2px]">
      <div className="rounded-[18px] bg-white/95 p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex w-fit max-w-full rounded-[28px] p-[2px]" style={{ background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }}>
            <div className="inline-flex items-center gap-1 overflow-x-auto rounded-[26px] bg-white p-1" role="tablist" aria-label="Applicant review tabs">
              <button
                type="button"
                className="brand-campaigns-tab"
                role="tab"
                aria-selected={activeReviewTab === 'applicants'}
                onClick={() => setActiveReviewTab('applicants')}
              >
                Applicants ({pendingApplicants.length})
              </button>
              <button
                type="button"
                className="brand-campaigns-tab"
                role="tab"
                aria-selected={activeReviewTab === 'shortlisted'}
                onClick={() => setActiveReviewTab('shortlisted')}
              >
                Shortlisted ({shortlistedApplicants.length})
              </button>
              <button
                type="button"
                className="brand-campaigns-tab"
                role="tab"
                aria-selected={activeReviewTab === 'rejected'}
                onClick={() => setActiveReviewTab('rejected')}
              >
                Rejected ({rejectedApplicants.length})
              </button>
            </div>
          </div>
          <div className="flex flex-row-reverse flex-wrap items-center justify-end gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                setIsSearchExpanded((prev) => !prev);
                if (!isSearchExpanded) {
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }
              }}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E8E2DB] bg-white hover:bg-orange-50/60"
              aria-label={isSearchExpanded ? 'Collapse search' : 'Search creators'}
            >
              {isSearchExpanded ? (
                <X className="h-4 w-4 text-[#E86512]" />
              ) : (
                <Search className="h-4 w-4 text-[#E86512]" />
              )}
            </button>
            <div
              className={cn(
                'brand-search-shell overflow-hidden transition-[width,opacity,padding] duration-200 ease-out',
                isSearchExpanded ? 'w-[min(18.75rem,64vw)] px-2.5 py-1.5 opacity-100' : 'w-0 px-0 py-0 opacity-0',
              )}
            >
              <input
                ref={searchInputRef}
                value={applicantSearch}
                onChange={(event) => setApplicantSearch(event.target.value)}
                placeholder="Search creators"
                aria-label="Search creators"
                className="w-full min-w-0 border-0 bg-transparent font-heading text-[clamp(0.8rem,1.1vw,0.92rem)] text-[#212121] outline-none placeholder:text-[#9E9E9E]"
                onBlur={() => {
                  if (!applicantSearch.trim()) setIsSearchExpanded(false);
                }}
              />
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="brand-page-section-title text-[#212121]">{tabTitle}</h2>
          <div />
        </div>

        {displayApplicants.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-secondary">
            No {emptyCopy} found for current filter.
          </div>
        ) : (
          <div className="space-y-2">
            {displayApplicants.map((applicant) => (
              <ApplicantCard
                key={applicant.id}
                applicant={applicant}
                allowReviewActions={activeReviewTab === 'applicants'}
                onShortlist={handleShortlist}
                onReject={handleReject}
                onPreviewDraft={(assetId) => setPreviewAssetId(assetId)}
              />
            ))}
          </div>
        )}
      </div>
      </div>

      {campaign.payoutModel === 'POOL' && (
        <div className="mb-3 space-y-3">
          <LeaderboardCard
            campaignId={campaignId}
            showSnapshot
            refreshToken={leaderboardRefreshKey}
            isPrivileged={isPrivileged}
            cooldownSec={campaign.manualScrapeCooldownSec || 60}
            lastManualScrapeAt={campaign.lastManualScrapeAt}
            onRefreshComplete={() => setLeaderboardRefreshKey((k) => k + 1)}
            showRefreshButton
          />
          {isPrivileged && <ScrapeHistoryTable campaignId={campaignId} />}
        </div>
      )}

      {campaign.payoutModel === 'POOL' &&
        (campaign.status === 'COMPLETED' ||
          Boolean(campaign.actualEndDate) ||
          new Date(campaign.endDate).getTime() < Date.now()) && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#E8E2DB] bg-white p-3">
            <div>
              <p className="font-heading text-sm font-medium text-[#212121]">Finalization</p>
              <p className="text-xs text-text-secondary">
                Status: {campaign.finalizationStatus || 'PENDING'}
                {campaign.finalizedAt
                  ? ` · finalized ${new Date(campaign.finalizedAt).toLocaleDateString('en-IN')}`
                  : ''}
                {campaign.finalizationError ? ` · ${campaign.finalizationError}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isPrivileged &&
                (campaign.finalizationStatus === 'RUNNING' ||
                  campaign.finalizationStatus === 'FAILED') && (
                  <BrandSecondaryButton
                    type="button"
                    size="sm"
                    onClick={async () => {
                      try {
                        await apiClient.resetCampaignFinalization(campaignId);
                        await loadCampaign();
                        showToast('Finalization status reset to PENDING', 'success');
                      } catch (error: unknown) {
                        showToast(getErrorMessage(error, 'Failed to reset finalization'), 'error');
                      }
                    }}
                  >
                    Reset finalization
                  </BrandSecondaryButton>
                )}
              <BrandPrimaryButton
                type="button"
                size="sm"
                disabled={
                  campaign.finalizationStatus === 'COMPLETED' ||
                  campaign.finalizationStatus === 'RUNNING'
                }
                title={
                  !canFinalizeNow
                    ? `Available after ${new Date(finalizeEligibleAt).toLocaleString('en-IN')} (end + ${graceHours}h grace)`
                    : undefined
                }
                onClick={async () => {
                  const force = canFinalizeNow
                    ? true
                    : window.confirm(
                        `Grace period ends ${new Date(finalizeEligibleAt).toLocaleString('en-IN')}. Finalize anyway? This is irreversible.`,
                      );
                  if (!force) return;
                  try {
                    await apiClient.finalizeCampaign(campaignId, { force: true });
                    await loadCampaign();
                    showToast('Finalization triggered', 'success');
                  } catch (error: unknown) {
                    showToast(getErrorMessage(error, 'Failed to finalize campaign'), 'error');
                  }
                }}
              >
                {campaign.finalizationStatus === 'COMPLETED' ? 'Finalized' : 'Finalize now'}
              </BrandPrimaryButton>
            </div>
          </div>
        )}

      <div className="brand-gradient-frame flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4 p-[2px]">
      <div className="rounded-[18px] bg-white/95 p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="brand-page-section-title text-[#212121]">Final post submissions</h2>
          <span className="text-xs text-text-secondary">{postSubmissions.length} total</span>
        </div>
        {postSubmissions.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-secondary">No final post links submitted yet.</div>
        ) : (
          <div className="space-y-2">
            {postSubmissions.map((submission) => (
              <div key={submission.id} className="rounded-lg border border-[#E8E2DB] bg-white p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <a
                      href={submission.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm text-blue-600 hover:underline"
                    >
                      {submission.postUrl}
                    </a>
                    <p className="mt-1 text-xs text-text-secondary">
                      {submission.platform} · {new Date(submission.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-1 text-xs">
                      Status: <span className="font-medium">{submission.status}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {submission.status === 'PENDING_REVIEW' ? (
                      <>
                        <BrandPrimaryButton
                          type="button"
                          size="sm"
                          onClick={async () => {
                            try {
                              await apiClient.reviewPostSubmission(submission.id, { status: 'VERIFIED' });
                              await loadPostSubmissions();
                              showToast('Final post verified', 'success');
                            } catch (error: unknown) {
                              showToast(getErrorMessage(error, 'Failed to verify post'), 'error');
                            }
                          }}
                        >
                          Verify
                        </BrandPrimaryButton>
                        <BrandSecondaryButton
                          type="button"
                          size="sm"
                          onClick={async () => {
                            try {
                              await apiClient.reviewPostSubmission(submission.id, { status: 'REJECTED' });
                              await loadPostSubmissions();
                              showToast('Final post rejected', 'success');
                            } catch (error: unknown) {
                              showToast(getErrorMessage(error, 'Failed to reject post'), 'error');
                            }
                          }}
                        >
                          Reject
                        </BrandSecondaryButton>
                      </>
                    ) : null}
                  </div>
                </div>
                {submission.status === 'VERIFIED' ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    {/* Manual views update UI - commented out since Apify scraper handles this automatically
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        value={viewInputs[submission.id] || ''}
                        onChange={(event) =>
                          setViewInputs((prev) => ({ ...prev, [submission.id]: event.target.value.replace(/[^0-9]/g, '') }))
                        }
                        placeholder="Current views"
                        className="brand-field-capsule w-full sm:w-40"
                      />
                      <BrandPrimaryButton
                        type="button"
                        size="sm"
                        onClick={async () => {
                          const currentViews = Number(viewInputs[submission.id] || 0);
                          if (!Number.isFinite(currentViews) || currentViews < 0) {
                            showToast('Enter a valid view count', 'error');
                            return;
                          }
                          try {
                            if (campaign.payoutModel === 'POOL') {
                              await apiClient.updatePostViews(submission.id, { currentViews });
                            } else {
                              await apiClient.verifyPostViews(submission.id, { currentViews });
                            }
                            await loadCampaign();
                            await loadPostSubmissions();
                            showToast('Views updated', 'success');
                          } catch (error: unknown) {
                            showToast(getErrorMessage(error, 'Failed to update views'), 'error');
                          }
                        }}
                      >
                        Update views
                      </BrandPrimaryButton>
                    </div>
                    */}
                    {campaign.payoutModel === 'POOL' && (
                      <BrandSecondaryButton
                        type="button"
                        size="sm"
                        onClick={async () => {
                          const reason = window.prompt('Reason for disqualifying this post (visible in audit):');
                          if (!reason || !reason.trim()) return;
                          try {
                            await apiClient.disqualifyPostSubmission(submission.id, { reason: reason.trim() });
                            await loadPostSubmissions();
                            showToast('Post disqualified from prize pool', 'success');
                          } catch (error: unknown) {
                            showToast(getErrorMessage(error, 'Failed to disqualify post'), 'error');
                          }
                        }}
                      >
                        Disqualify
                      </BrandSecondaryButton>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      {/* Shortlist Confirmation Modal */}
      <Modal
        isOpen={showShortlistConfirm}
        onClose={() => {
          setShowShortlistConfirm(false);
          setSelectedApplicant(null);
        }}
        className="max-w-md"
      >
        <div className="p-4 sm:p-5">
          <h3 className="brand-page-section-title mb-1.5">Are you sure you want to shortlist {selectedApplicant?.name}?</h3>
          <p className="mb-4 text-xs sm:text-sm text-text-secondary">
            This action can&apos;t be undone.
          </p>
            <div className="flex gap-2">
            <BrandSecondaryButton
              type="button"
              size="sm"
              onClick={() => {
                setShowShortlistConfirm(false);
                setSelectedApplicant(null);
              }}
              className="flex-1"
            >
              Go back
            </BrandSecondaryButton>
            <BrandPrimaryButton type="button" size="sm" onClick={confirmShortlist} className="flex-1">
              Shortlist
            </BrandPrimaryButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showRejectConfirm}
        onClose={() => {
          setShowRejectConfirm(false);
          setSelectedApplicant(null);
          setRejectComment('');
        }}
        className="max-w-md"
      >
        <div className="p-4 sm:p-5">
          <h3 className="brand-page-section-title mb-1.5">Reject {selectedApplicant?.name}?</h3>
          <p className="text-xs sm:text-sm text-text-secondary mb-3">
            You can add an optional reason that will be attached to the review.
          </p>
          <Textarea
            value={rejectComment}
            onChange={(event) => setRejectComment(event.target.value)}
            rows={3}
            placeholder="Optional rejection comment"
            className="mb-3 text-sm"
          />
          <div className="flex gap-2">
            <BrandSecondaryButton type="button" size="sm" onClick={() => setShowRejectConfirm(false)} className="flex-1">
              Cancel
            </BrandSecondaryButton>
            <BrandPrimaryButton type="button" size="sm" onClick={confirmReject} className="flex-1">
              Reject
            </BrandPrimaryButton>
          </div>
        </div>
      </Modal>

      <CampaignWatermarkedPreviewModal
        isOpen={Boolean(previewAssetId)}
        onClose={() => setPreviewAssetId(null)}
        assetId={previewAssetId}
        title="Applicant draft preview"
      />
    </div>
  );
}

function ApplicantCard({
  applicant,
  allowReviewActions,
  onShortlist,
  onReject,
  onPreviewDraft,
}: {
  applicant: Applicant;
  allowReviewActions?: boolean;
  onShortlist: (applicant: Applicant) => void;
  onReject: (applicant: Applicant) => void;
  onPreviewDraft: (assetId: string) => void;
}) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });
  };

  return (
    <div className="rounded-lg border border-gray-200/90 bg-white/60 p-2.5 transition-shadow hover:shadow-sm sm:p-3.5">
      <div className="flex flex-col gap-2 sm:gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E86412] to-[#F12A4C] font-heading text-xs font-medium text-white sm:h-9 sm:w-9 sm:text-sm">
            {applicant.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h3 className="font-heading text-[clamp(0.875rem,1.2vh,1rem)] font-semibold leading-tight text-[#212121]">
                {applicant.name}
              </h3>
              <span className="text-[0.7rem] text-text-secondary sm:text-xs">· {formatDate(applicant.appliedAt)}</span>
            </div>
            <div className="mb-1 truncate text-xs text-text-secondary sm:text-sm">
              Creator ID: <span className="font-mono text-[0.7rem]">{applicant.creatorId}</span>
            </div>
            {applicant.views !== undefined && applicant.earnings !== undefined && (
              <div className="flex flex-wrap gap-2 text-xs sm:gap-3 sm:text-sm">
                <span className="inline-flex items-center gap-0.5">
                  <Eye className="h-3 w-3 text-[#E86512]" />
                  {applicant.views.toLocaleString()} views
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <IndianRupee className="h-3 w-3 text-[#E86512]" />
                  {applicant.earnings.toLocaleString('en-IN')}
                </span>
              </div>
            )}
            {applicant.creatorHistory && (
              <p className="mt-1 text-[0.7rem] leading-snug text-text-secondary">
                {applicant.creatorHistory.approvedCount} approved / {applicant.creatorHistory.totalSubmissions} submissions ·{' '}
                {applicant.creatorHistory.totalViews.toLocaleString()} views · {applicant.creatorHistory.totalEarnings.toLocaleString('en-IN')} earned
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {applicant.draftAssetId ? (
            <BrandSecondaryButton
              type="button"
              size="sm"
              onClick={() => onPreviewDraft(applicant.draftAssetId!)}
            >
              <Eye className="mr-1 h-3.5 w-3.5" />
              Preview draft
            </BrandSecondaryButton>
          ) : (
            <span className="text-xs text-text-secondary">No draft attached</span>
          )}
          {allowReviewActions && applicant.status === 'PENDING' && (
            <>
              <Tooltip content="Approve" position="top">
                <button
                  type="button"
                  onClick={() => onShortlist(applicant)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white transition-colors hover:bg-green-600"
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </Tooltip>
              <Tooltip content="Reject" position="top">
                <button
                  type="button"
                  onClick={() => onReject(applicant)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailStatTile({
  label,
  value,
  icon,
  progress,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  progress?: number;
}) {
  const pct = progress !== undefined && !Number.isNaN(progress) ? Math.min(progress, 100) : null;
  return (
    <div className="relative flex min-h-[52px] min-w-0 items-center overflow-hidden rounded-lg border border-[#F0E5DC] bg-white p-2.5 shadow-[0_1px_2px_rgba(20,20,20,0.05)] sm:min-h-[56px] sm:p-3">
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        <BrandIconChip size="sm">{icon}</BrandIconChip>
        <p className="m-0 max-w-full min-w-0 break-words text-[clamp(12px,1.1vw,0.875rem)] font-medium leading-[1.3] text-[#212121]">
          {value}
        </p>
        <span className="min-w-0 text-left text-[clamp(12px,1.1vw,0.875rem)] font-medium leading-[1.3] text-[#212121]">
          {label}
        </span>
      </div>
      {pct !== null ? (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-1.5 overflow-hidden bg-[#EDE7E1]">
          <div
            className="h-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

