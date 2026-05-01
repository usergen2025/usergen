'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Input from '@/components/ui/Input';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import Modal from '@/components/ui/Modal';
import { BrandPrimaryButton, BrandSecondaryButton } from '@/components/brand';
import { Calendar, IndianRupee, Search, Link2, Video, X, Upload, FolderOpen } from 'lucide-react';
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
}

interface CampaignStateRow {
  campaign: Campaign;
  application: {
    id: string;
    status: 'APPLIED' | 'APPROVED' | 'REJECTED' | 'SUBMITTED' | 'WITHDRAWN';
    draftMediaUrl?: string;
    platform?: 'INSTAGRAM' | 'YOUTUBE';
    termsAccepted?: boolean;
  };
  postSubmissions: Array<{
    id: string;
    postUrl: string;
    platform: 'INSTAGRAM' | 'YOUTUBE';
    status: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
    createdAt: string;
  }>;
}

interface VideoProjectRow {
  id: string;
  status?: string;
  title?: string;
  projectName?: string;
  videoPublicUrl?: string;
  videoGcsUrl?: string;
  finalVideoUrl?: string;
  renderedVideoUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
}

interface LibraryProject {
  id: string;
  title: string;
  mediaUrl: string;
  thumbnailUrl?: string;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function resolveProjectVideoUrl(project: VideoProjectRow): string | undefined {
  const directUrl =
    project.videoPublicUrl ||
    project.videoGcsUrl ||
    project.finalVideoUrl ||
    project.renderedVideoUrl ||
    project.videoUrl;
  if (!directUrl) return undefined;
  if (directUrl.startsWith('http')) return directUrl;
  const baseUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
  return `${baseUrl}${directUrl}`;
}

export default function CreatorCampaignsPage() {
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'LIVE' | 'APPLIED' | 'APPROVED'>('LIVE');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignStates, setCampaignStates] = useState<CampaignStateRow[]>([]);
  const [applyModalCampaign, setApplyModalCampaign] = useState<Campaign | null>(null);
  const [attachModalCampaign, setAttachModalCampaign] = useState<CampaignStateRow | null>(null);
  const [isSubmittingApply, setIsSubmittingApply] = useState(false);
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [applyForm, setApplyForm] = useState({
    draftMediaUrl: '',
    sourceType: 'PROJECT_LIBRARY' as 'PROJECT_LIBRARY' | 'UPLOAD' | 'EXTERNAL_URL',
    projectId: '',
    termsAccepted: false,
  });
  const [projectLibrary, setProjectLibrary] = useState<LibraryProject[]>([]);
  const [isProjectLibraryOpen, setIsProjectLibraryOpen] = useState(false);
  const draftFileInputRef = useRef<HTMLInputElement>(null);
  const [attachLink, setAttachLink] = useState('');
  const [attachPlatform, setAttachPlatform] = useState<'INSTAGRAM' | 'YOUTUBE'>('INSTAGRAM');

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

  useEffect(() => {
    apiClient
      .getVideoProjects()
      .then((response) => {
        const rows = ((response.data || []) as VideoProjectRow[])
          .filter((project) => project.status === 'COMPLETED')
          .map((project): LibraryProject | null => {
            const mediaUrl = resolveProjectVideoUrl(project);
            if (!mediaUrl) return null;
            const row: LibraryProject = {
              id: String(project.id),
              title: String(project.title || project.projectName || `Project ${project.id}`),
              mediaUrl,
            };
            if (project.thumbnailUrl) row.thumbnailUrl = project.thumbnailUrl;
            return row;
          })
          .filter((row): row is LibraryProject => row !== null);
        setProjectLibrary(rows);
      })
      .catch(() => setProjectLibrary([]));
  }, []);

  const stateByCampaignId = useMemo(() => {
    return campaignStates.reduce<Record<string, CampaignStateRow>>((acc, row) => {
      acc[row.campaign.id] = row;
      return acc;
    }, {});
  }, [campaignStates]);

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

  return (
    <div className="brand-page-shell py-3 sm:py-4">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="brand-campaign-page-title">Campaigns</h1>
          <p className="brand-campaign-meta mt-1">Explore, apply, and submit post links from one place.</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex w-fit max-w-full rounded-[28px] p-[2px]" style={{ background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }}>
          <div className="inline-flex gap-1 overflow-x-auto rounded-[26px] bg-white p-1">
            {[
              { id: 'LIVE', label: `Live Campaigns (${filteredLive.length})` },
              { id: 'APPLIED', label: `Applied (${appliedRows.length})` },
              { id: 'APPROVED', label: `Approved (${approvedRows.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="brand-campaigns-tab"
                aria-pressed={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id as 'LIVE' | 'APPLIED' | 'APPROVED')}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-row-reverse items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setIsSearchExpanded((prev) => !prev);
              if (isSearchExpanded && !search.trim()) setSearch('');
            }}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E8E2DB] bg-white hover:bg-orange-50/60"
            aria-label={isSearchExpanded ? 'Collapse search' : 'Search campaigns'}
          >
            {isSearchExpanded ? <X className="h-4 w-4 text-[#E86512]" /> : <Search className="h-4 w-4 text-[#E86512]" />}
          </button>
          <div
            className={cn(
              'brand-search-shell overflow-hidden',
              isSearchExpanded ? 'w-[min(20rem,70vw)] px-2.5 py-1.5 opacity-100' : 'w-0 px-0 py-0 opacity-0',
            )}
          >
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by campaign title"
              aria-label="Search by campaign title"
              className="w-full min-w-0 border-0 bg-transparent font-heading text-[clamp(0.8rem,1.1vw,0.92rem)] text-[#212121] outline-none placeholder:text-[#9E9E9E]"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="rounded-2xl bg-white p-8 text-center text-text-secondary shadow-card">Loading campaigns...</div>
        ) : (activeTab === 'LIVE' ? filteredLive : activeTab === 'APPLIED' ? appliedRows : approvedRows).length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center text-text-secondary shadow-card">
            No campaigns found for this tab.
          </div>
        ) : activeTab === 'LIVE' ? (
          filteredLive.map((campaign) => {
            const budgetLeft = Math.max(
              Number(campaign.remainingBudget ?? campaign.totalBudget - campaign.budgetUsed),
              0,
            );
            return (
              <div key={campaign.id} className="brand-surface-card brand-surface-card--compact p-5 md:p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex-1">
                    <h2 className="brand-page-section-title">{campaign.name}</h2>
                    <p className="brand-campaign-meta mt-2">{campaign.description}</p>
                    <div className="mt-4 flex flex-wrap gap-3 text-sm">
                      <span className="inline-flex items-center gap-1 text-black">
                        <IndianRupee className="h-4 w-4 text-[#E86512]" />
                        CPM: ₹{campaign.payoutRate.toLocaleString()} / 1000 views
                      </span>
                      <span className="inline-flex items-center gap-1 text-black">
                        <Calendar className="h-4 w-4 text-[#E86512]" />
                        Deadline: {formatDate(campaign.deadlineToApply)}
                      </span>
                      <span className="text-black">Budget left: ₹{budgetLeft.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="w-full md:w-auto">
                    <BrandPrimaryButton type="button" size="sm" onClick={() => setApplyModalCampaign(campaign)}>
                      Apply with video
                    </BrandPrimaryButton>
                  </div>
                </div>
              </div>
            );
          })
        ) : (activeTab === 'APPLIED' ? appliedRows : approvedRows).map((row) => {
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
          return (
            <div key={row.application.id} className="brand-surface-card brand-surface-card--compact p-5 md:p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex-1">
                  <h2 className="brand-page-section-title">{campaign.name}</h2>
                  <p className="brand-campaign-meta mt-2">{campaign.description}</p>
                  <div className="mt-4 flex flex-wrap gap-3 text-sm">
                    <span className="inline-flex items-center gap-1 text-black">
                      <Video className="h-4 w-4 text-[#E86512]" />
                      Draft: {row.application.draftMediaUrl ? 'Submitted' : 'Missing'}
                    </span>
                    <span className="text-black">Application status: {row.application.status}</span>
                    {latestPostSubmission ? (
                      <span className="text-black">Final post: {latestPostSubmission.status}</span>
                    ) : null}
                  </div>
                </div>
                {activeTab === 'APPROVED' ? (
                  <div className="flex w-full flex-col gap-2 md:w-auto">
                    {isFinalPostVerified ? (
                      <Link href="/earnings">
                        <BrandPrimaryButton type="button" size="sm" className="w-full">
                          View earnings
                        </BrandPrimaryButton>
                      </Link>
                    ) : (
                      <BrandPrimaryButton
                        type="button"
                        size="sm"
                        disabled={!hasStarted || !canSubmitFinalPost}
                        onClick={() => {
                          if (!hasStarted || !canSubmitFinalPost) return;
                          setAttachModalCampaign(row);
                        }}
                      >
                        {!hasStarted
                          ? 'Available after campaign starts'
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
          );
        })}
      </div>

      <Modal isOpen={Boolean(applyModalCampaign)} onClose={() => setApplyModalCampaign(null)} className="max-w-3xl">
        <div className="p-5">
          <h3 className="brand-page-section-title mb-3">Apply to campaign</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                { id: 'PROJECT_LIBRARY', label: 'Choose from projects', Icon: FolderOpen },
                { id: 'UPLOAD', label: 'Upload local video', Icon: Upload },
                { id: 'EXTERNAL_URL', label: 'Share video URL', Icon: Link2 },
              ].map((option) => {
                const Icon = option.Icon;
                const selected = applyForm.sourceType === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm',
                      selected ? 'border-[#E86512] bg-orange-50/70 text-[#212121]' : 'border-[#E8E2DB] bg-white text-[#616161]',
                    )}
                    onClick={() =>
                      setApplyForm((prev) => ({
                        ...prev,
                        sourceType: option.id as 'PROJECT_LIBRARY' | 'UPLOAD' | 'EXTERNAL_URL',
                      }))
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {option.label}
                  </button>
                );
              })}
            </div>
            {applyForm.sourceType === 'PROJECT_LIBRARY' ? (
              <div className="md:col-span-2 rounded-2xl border border-[#E8E2DB] bg-[#F9F7F4] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-[#616161]">
                    {applyForm.projectId
                      ? `Selected: ${projectLibrary.find((project) => project.id === applyForm.projectId)?.title || 'Project'}`
                      : 'No project selected yet'}
                  </p>
                  <BrandSecondaryButton type="button" size="sm" onClick={() => setIsProjectLibraryOpen(true)}>
                    Browse completed videos
                  </BrandSecondaryButton>
                </div>
              </div>
            ) : null}
            {applyForm.sourceType === 'UPLOAD' ? (
              <div className="md:col-span-2">
                <input
                  ref={draftFileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      const response = await apiClient.uploadCreatorDraftAsset(file);
                      const url = response.data?.url;
                      if (url) {
                        setApplyForm((prev) => ({ ...prev, draftMediaUrl: url }));
                        showToast('Video uploaded', 'success');
                      }
                    } catch (error: unknown) {
                      showToast(error instanceof Error ? error.message : 'Upload failed', 'error');
                    } finally {
                      event.target.value = '';
                    }
                  }}
                />
                <BrandSecondaryButton type="button" size="sm" onClick={() => draftFileInputRef.current?.click()}>
                  Upload draft video
                </BrandSecondaryButton>
              </div>
            ) : null}
            {applyForm.sourceType === 'EXTERNAL_URL' ? (
              <Input
                variant="brandCapsule"
                placeholder="Draft video URL (Drive/YouTube/Instagram)"
                value={applyForm.draftMediaUrl}
                onChange={(e) => setApplyForm((p) => ({ ...p, draftMediaUrl: e.target.value }))}
                className="md:col-span-2"
              />
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
            <BrandSecondaryButton size="sm" onClick={() => setApplyModalCampaign(null)} disabled={isSubmittingApply}>
              Discard
            </BrandSecondaryButton>
            <BrandPrimaryButton
              size="sm"
              disabled={isSubmittingApply}
              onClick={async () => {
                if (!applyModalCampaign) return;
                if (applyForm.sourceType === 'PROJECT_LIBRARY' && (!applyForm.projectId || !applyForm.draftMediaUrl.trim())) {
                  showToast('Please choose a completed project video', 'error');
                  return;
                }
                if (applyForm.sourceType === 'UPLOAD' && !applyForm.draftMediaUrl.trim()) {
                  showToast('Please upload your video before applying', 'error');
                  return;
                }
                if (applyForm.sourceType === 'EXTERNAL_URL' && !applyForm.draftMediaUrl.trim()) {
                  showToast('Draft media URL is required', 'error');
                  return;
                }
                if (!applyForm.termsAccepted) {
                  showToast('Please accept terms before applying', 'error');
                  return;
                }
                setIsSubmittingApply(true);
                try {
                  await apiClient.applyToCampaign(applyModalCampaign.id, {
                    draftMediaUrl: applyForm.draftMediaUrl.trim(),
                    platform: 'INSTAGRAM',
                    termsAccepted: true,
                    sourceType: applyForm.sourceType,
                    projectId: applyForm.projectId || undefined,
                  });
                  setApplyModalCampaign(null);
                  setApplyForm({
                    draftMediaUrl: '',
                    sourceType: 'PROJECT_LIBRARY',
                    projectId: '',
                    termsAccepted: false,
                  });
                  await loadCampaigns();
                  showToast('Applied successfully', 'success');
                } catch (error: unknown) {
                  showToast(error instanceof Error ? error.message : 'Failed to apply', 'error');
                } finally {
                  setIsSubmittingApply(false);
                }
              }}
            >
              Apply
            </BrandPrimaryButton>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isProjectLibraryOpen} onClose={() => setIsProjectLibraryOpen(false)} className="max-w-5xl">
        <div className="p-5">
          <h3 className="brand-page-section-title mb-2">Project Library</h3>
          <p className="brand-campaign-meta mb-4">Choose from completed projects with rendered video previews.</p>
          {projectLibrary.length === 0 ? (
            <p className="text-sm text-[#616161]">No completed videos are available yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {projectLibrary.map((project) => {
                const isSelected = applyForm.projectId === project.id;
                return (
                  <button
                    key={project.id}
                    type="button"
                    className={cn(
                      'w-full p-2.5 sm:p-3 rounded-2xl border text-left shadow-sm transition-all duration-200',
                      isSelected
                        ? 'border-[#E86512] bg-orange-50/60 shadow-card'
                        : 'border-[#F0E6DF] bg-white hover:shadow-card hover:-translate-y-0.5',
                    )}
                    onClick={() => {
                      setApplyForm((prev) => ({
                        ...prev,
                        projectId: project.id,
                        draftMediaUrl: project.mediaUrl,
                        sourceType: 'PROJECT_LIBRARY',
                      }));
                      setIsProjectLibraryOpen(false);
                    }}
                  >
                    <div className="mx-auto mb-2.5 w-full aspect-[9/16] overflow-hidden rounded-xl bg-black">
                      <video
                        src={project.mediaUrl}
                        poster={project.thumbnailUrl}
                        className="h-full w-full object-cover"
                        preload="metadata"
                        muted
                        controls
                        playsInline
                      />
                    </div>
                    <div className="px-1 pb-1">
                      <p className="line-clamp-1 font-heading text-sm font-medium leading-snug text-[#212121]">
                        {project.title}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

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
