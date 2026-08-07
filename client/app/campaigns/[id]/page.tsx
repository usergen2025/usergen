'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, IndianRupee, Video, CalendarRange, RefreshCw, Link2, ExternalLink, Scissors, FolderOpen } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { BrandPrimaryButton, BrandSecondaryButton, BrandIconChip, BrandStatusPill } from '@/components/brand';
import { CampaignWatermarkedPreviewModal } from '@/components/campaigns/CampaignWatermarkedPreviewModal';
import { CampaignApplyModal } from '@/components/campaigns/CampaignApplyModal';
import { LeaderboardCard } from '@/components/campaigns/LeaderboardCard';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { parseDraftMediaAssetId } from '@/lib/campaign-media';
import { cn } from '@/lib/utils/cn';
import CreatorSourceVideoCard from '@/components/campaigns/CreatorSourceVideoCard';
import SsembleClipGeneratorModal from '@/components/campaigns/SsembleClipGeneratorModal';
import SsembleClipsViewerModal from '@/components/campaigns/SsembleClipsViewerModal';

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function formatCampaignDate(
  dateString: string,
  type: 'deadline' | 'start' | 'end',
  wasManual = false,
) {
  const date = new Date(dateString);
  const dateOnly = date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
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
}

export default function CreatorCampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params?.id[0] : '';

  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<any>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [submitLinkModalOpen, setSubmitLinkModalOpen] = useState(false);
  const [postUrl, setPostUrl] = useState('');
  const [submittingLink, setSubmittingLink] = useState(false);
  
  // Source videos and clip generation state
  const [sourceVideos, setSourceVideos] = useState<any[]>([]);
  const [clipRequests, setClipRequests] = useState<any[]>([]);
  const [loadingSourceVideos, setLoadingSourceVideos] = useState(false);
  const [selectedVideoForClips, setSelectedVideoForClips] = useState<any>(null);
  const [clipGeneratorOpen, setClipGeneratorOpen] = useState(false);
  const [selectedClipRequest, setSelectedClipRequest] = useState<any>(null);
  const [clipViewerOpen, setClipViewerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await apiClient.getCreatorCampaignDetail(id);
      setPayload(res.data ?? null);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load', 'error');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  const loadSourceVideos = useCallback(async () => {
    if (!id) return;
    setLoadingSourceVideos(true);
    try {
      const [videosRes, requestsRes] = await Promise.all([
        apiClient.getCampaignSourceVideos(id),
        apiClient.getMyClipRequests(id),
      ]);
      setSourceVideos(videosRes.data || []);
      setClipRequests(requestsRes.data || []);
    } catch (e) {
      console.error('Failed to load source videos:', e);
    } finally {
      setLoadingSourceVideos(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (payload?.campaign) {
      loadSourceVideos();
    }
  }, [payload?.campaign, loadSourceVideos]);

  const handleGenerateClips = async (data: any) => {
    if (!id) return;
    try {
      await apiClient.generateSsembleClips(id, data);
      showToast('Clip generation started! This may take 5-30 minutes.', 'success');
      await loadSourceVideos();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to generate clips', 'error');
      throw e;
    }
  };

  const handleViewClips = (video: any) => {
    const videoRequests = clipRequests.filter((r) => r.sourceVideoId === video.id);
    if (videoRequests.length > 0) {
      setSelectedClipRequest(videoRequests[0]);
      setClipViewerOpen(true);
    }
  };

  const getActiveRequestsForVideo = (videoId: string) => {
    return clipRequests.some(
      (r) => r.sourceVideoId === videoId && ['QUEUED', 'PROCESSING'].includes(r.status)
    );
  };

  const campaign = payload?.campaign;
  const application = payload?.application;
  const posts = (payload?.postSubmissions || []) as any[];

  const draftAssetId = useMemo(
    () => parseDraftMediaAssetId(application?.draftMediaUrl, application?.draftMediaAssetId),
    [application],
  );

  const canReplaceDraft =
    application &&
    application.status === 'APPLIED' &&
    !application.reviewedAt;

  const handleReplaceWithAsset = async (newAssetId: string) => {
    if (!id) return;
    setReplaceBusy(true);
    try {
      await apiClient.replacePendingApplicationDraft(id, newAssetId);
      showToast('Draft updated', 'success');
      await load();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Replace failed', 'error');
    } finally {
      setReplaceBusy(false);
    }
  };

  const handleSubmitPostLink = async () => {
    if (!id || !postUrl.trim()) return;
    setSubmittingLink(true);
    try {
      await apiClient.submitFinalPostLink(id, {
        postUrl: postUrl.trim(),
        platform: campaign?.platformTarget?.toUpperCase() === 'YOUTUBE' ? 'YOUTUBE' : 'INSTAGRAM',
      });
      showToast('Post link submitted successfully!', 'success');
      setPostUrl('');
      setSubmitLinkModalOpen(false);
      await load();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to submit post link', 'error');
    } finally {
      setSubmittingLink(false);
    }
  };

  const now = new Date();
  const effectiveStart = campaign?.actualStartDate
    ? new Date(campaign.actualStartDate)
    : campaign?.startDate
      ? new Date(campaign.startDate)
      : null;
  const effectiveEnd = campaign?.actualEndDate
    ? new Date(campaign.actualEndDate)
    : campaign?.endDate
      ? new Date(campaign.endDate)
      : null;
  const hasStarted = effectiveStart ? effectiveStart <= now : false;
  const hasEnded = effectiveEnd ? effectiveEnd < now : false;
  const latestPostSubmission = posts[0];
  const isFinalPostVerified = latestPostSubmission?.status === 'VERIFIED';
  const hasPendingFinalPost = latestPostSubmission?.status === 'PENDING_REVIEW';
  const canSubmitFinalPost = application?.status === 'APPROVED' && hasStarted && !hasEnded && !isFinalPostVerified && !hasPendingFinalPost;

  if (!id) {
    return null;
  }

  if (loading && !payload) {
    return (
      <div className="brand-page-shell pb-8 text-center text-text-secondary">Loading…</div>
    );
  }

  if (!campaign) {
    return (
      <div className="brand-page-shell pb-8 text-center">
        <p className="mb-4 text-text-secondary">Campaign not found.</p>
        <Link href="/campaigns" className="text-[#E86512] underline">
          Back to campaigns
        </Link>
      </div>
    );
  }

  return (
    <div className="brand-page-shell pb-4 sm:pb-6">
      {/* Page Header */}
      <div className="mb-5 space-y-3 sm:mb-6">
        {/* Row 1: Back + Title */}
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/campaigns"
            className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/50"
          >
            <ArrowLeft className="h-4 w-4 text-[#212121]" />
          </Link>
          <h1 className="brand-campaign-page-title min-w-0 flex-1 truncate text-[#212121]">{campaign.name}</h1>
        </div>

        {/* Row 2: Status indicator */}
        <div className="flex flex-wrap items-center gap-2">
          <BrandStatusPill status={hasStarted ? (hasEnded ? 'COMPLETED' : 'IN_PROGRESS') : 'LIVE'} />
          {campaign.platformTarget && (
            <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-[#212121]">{campaign.platformTarget}</span>
          )}
        </div>

        {/* Row 3: Campaign dates/times */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1.5 brand-campaign-row text-[#212121]">
              <BrandIconChip size="sm">
                <IndianRupee className="h-3 w-3" strokeWidth={1.8} />
              </BrandIconChip>
              <span>
                {campaign.payoutModel === 'POOL'
                  ? `Prize pool ₹${Number(campaign.totalBudget || 0).toLocaleString('en-IN')}`
                  : `₹${Number(campaign.payoutRate || 0).toLocaleString()} / 1k views`}
              </span>
            </div>
            <div className="inline-flex items-center gap-1.5 brand-campaign-row text-[#212121]">
              <BrandIconChip size="sm">
                <Calendar className="h-3 w-3" strokeWidth={1.8} />
              </BrandIconChip>
              <span>
                {campaign.actualStartDate
                  ? `Started: ${formatCampaignDate(campaign.actualStartDate, 'start', true)}`
                  : `Apply by ${formatCampaignDate(campaign.deadlineToApply, 'deadline')}`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 brand-campaign-row text-[#212121]">
            <BrandIconChip size="sm">
              <CalendarRange className="h-3 w-3" strokeWidth={1.8} />
            </BrandIconChip>
            <span>
              {formatCampaignDate(campaign.actualStartDate || campaign.startDate, 'start', !!campaign.actualStartDate)}
              {' – '}
              {formatCampaignDate(campaign.actualEndDate || campaign.endDate, 'end', !!campaign.actualEndDate)}
            </span>
          </div>
        </div>

        {/* Row 4: Description */}
        <p className="brand-campaign-meta line-clamp-3 leading-relaxed text-text-secondary">
          {campaign.description}
        </p>
      </div>

      {/* Countdown Timer Card */}
      {!hasEnded && (
        <div className="brand-gradient-frame mb-5 rounded-[20px] p-2.5 sm:p-3 shadow-card sm:mb-6">
          <div className="rounded-[17px] bg-white/95 p-5 sm:p-6">
            <div className="flex flex-col items-center gap-2">
              <span className="text-sm font-heading font-medium text-[#616161]">
                {hasStarted ? 'Campaign ends in' : 'Deadline to apply'}
              </span>
              <CountdownTimer
                targetDate={hasStarted ? (campaign.actualEndDate || campaign.endDate) : campaign.deadlineToApply}
                variant="default"
                size="lg"
                showSeparators={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* Campaign Info Card - Tags & Assets */}
      {(campaign.industry || campaign.regionFilter || campaign.brandAssetsUrl) && (
        <div className="brand-gradient-frame mb-5 rounded-[20px] p-2.5 sm:p-3 shadow-card sm:mb-6">
          <div className="rounded-[18px] bg-white/95 p-4 sm:p-5">
            <div className="flex flex-wrap gap-2 text-sm">
              {campaign.industry && (
                <span className="rounded-full bg-orange-50 px-3 py-1 text-[#212121]">Industry: {campaign.industry}</span>
              )}
              {campaign.regionFilter && (
                <span className="rounded-full bg-orange-50 px-3 py-1 text-[#212121]">{campaign.regionFilter}</span>
              )}
              {campaign.brandAssetsUrl && (
                <a
                  href={campaign.brandAssetsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-[#E8E2DB] px-3 py-1 text-[#E86512] hover:bg-orange-50"
                >
                  <ExternalLink className="h-3 w-3" />
                  Brand assets
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Source Videos for Clipping */}
      {sourceVideos.length > 0 && (
        <div className="brand-gradient-frame mb-5 rounded-[20px] p-2.5 sm:p-3 shadow-card sm:mb-6">
          <div className="rounded-[18px] bg-white/95 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Scissors className="h-5 w-5 text-[#E86512]" />
                <h2 className="brand-page-section-title">Source Videos</h2>
              </div>
              {clipRequests.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (clipRequests.length > 0) {
                      setSelectedClipRequest(clipRequests[0]);
                      setClipViewerOpen(true);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 text-sm text-[#E86512] hover:text-[#D15B10] font-medium"
                >
                  <FolderOpen className="h-4 w-4" />
                  View all clips ({clipRequests.reduce((acc, r) => acc + (r.clips?.length || 0), 0)})
                </button>
              )}
            </div>
            <p className="text-sm text-[#616161] mb-4">
              Use AI to generate engaging short clips from these source videos.
            </p>
            {loadingSourceVideos ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-[#E86512] border-t-transparent" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sourceVideos.map((video) => (
                  <CreatorSourceVideoCard
                    key={video.id}
                    video={video}
                    onGenerateClips={(v) => {
                      setSelectedVideoForClips(v);
                      setClipGeneratorOpen(true);
                    }}
                    onViewClips={handleViewClips}
                    hasActiveRequest={getActiveRequestsForVideo(video.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Application Status Card */}
      {application ? (
        <div className="brand-gradient-frame mb-5 rounded-[20px] p-2.5 sm:p-3 shadow-card sm:mb-6">
          <div className="rounded-[18px] bg-white/95 p-4 sm:p-6">
            <h2 className="brand-page-section-title mb-3">Your application</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-[#616161]">Status:</span>
              <span className={cn(
                'inline-flex items-center rounded-full px-3 py-1 font-medium',
                application.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' :
                application.status === 'REJECTED' ? 'bg-red-50 text-red-600' :
                application.status === 'SHORTLISTED' ? 'bg-blue-50 text-blue-600' :
                'bg-amber-50 text-amber-700'
              )}>
                {application.status}
              </span>
            </div>
            {application.reviewComment && (
              <p className="mt-3 rounded-lg bg-[#FFFBF8] p-3 text-sm text-[#616161]">
                <span className="font-medium text-[#212121]">Note:</span> {application.reviewComment}
              </p>
            )}
            {draftAssetId && (
              <div className="mt-4 flex flex-wrap gap-2">
                <BrandSecondaryButton type="button" size="sm" onClick={() => setPreviewAssetId(draftAssetId)}>
                  <Video className="mr-1 h-4 w-4" />
                  Preview submitted draft
                </BrandSecondaryButton>
              </div>
            )}

            {canReplaceDraft && (
              <div className="mt-6 border-t border-[#EFE8E3] pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="mb-1 font-heading text-sm font-semibold text-[#212121]">Replace draft</h3>
                    <p className="text-xs text-[#616161]">
                      Your application is pending review. You can update your draft video.
                    </p>
                  </div>
                  <BrandSecondaryButton
                    type="button"
                    size="sm"
                    disabled={replaceBusy}
                    onClick={() => setReplaceModalOpen(true)}
                  >
                    <RefreshCw className="mr-1 h-4 w-4" />
                    Replace video
                  </BrandSecondaryButton>
                </div>
              </div>
            )}

            {/* Submit Final Post Link Section */}
            {application.status === 'APPROVED' && (
              <div className="mt-6 border-t border-[#EFE8E3] pt-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="mb-1 font-heading text-sm font-semibold text-[#212121]">Submit final post link</h3>
                    <p className="text-xs text-[#616161]">
                      {!hasStarted
                        ? 'You can submit your post link once the campaign starts.'
                        : hasEnded
                          ? 'The campaign has ended.'
                          : isFinalPostVerified
                            ? 'Your post has been verified!'
                            : hasPendingFinalPost
                              ? 'Your post link is under review.'
                              : 'Post your video and submit the link here.'}
                    </p>
                  </div>
                  {canSubmitFinalPost && (
                    <BrandPrimaryButton
                      type="button"
                      size="sm"
                      onClick={() => setSubmitLinkModalOpen(true)}
                    >
                      <Link2 className="mr-1 h-4 w-4" />
                      Submit post link
                    </BrandPrimaryButton>
                  )}
                  {!hasStarted && application.status === 'APPROVED' && (
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      Available after campaign starts
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="brand-gradient-frame mb-5 rounded-[20px] p-2.5 sm:p-3 sm:mb-6">
          <div className="rounded-[18px] bg-[#FFFBF8] p-6 text-center">
            <p className="text-sm text-[#616161]">You haven&apos;t applied to this campaign yet.</p>
            <BrandPrimaryButton type="button" size="sm" className="mt-4" onClick={() => router.push('/campaigns')}>
              Go to Live campaigns
            </BrandPrimaryButton>
          </div>
        </div>
      )}

      {/* Prize pool & live leaderboard for POOL campaigns */}
      {campaign.payoutModel === 'POOL' && (
        <div className="mb-5 sm:mb-6">
          <LeaderboardCard
            campaignId={id}
            highlightCreatorId={application?.creatorId}
            showSnapshot
            showRefreshButton={false}
          />
        </div>
      )}

      {/* Post Submissions Card */}
      {posts.length > 0 && (
        <div className="brand-gradient-frame rounded-[20px] p-2.5 sm:p-3 shadow-card">
          <div className="rounded-[18px] bg-white/95 p-4 sm:p-6">
            <h2 className="brand-page-section-title mb-3">Final post submissions</h2>
            <ul className="space-y-2.5">
              {posts.map((p: any) => (
                <li key={p.id} className="flex flex-col gap-1 rounded-xl border border-[#F0E5DC] bg-[#FFFBF8] p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <a href={p.postUrl} target="_blank" rel="noreferrer" className="truncate text-[#E86512] underline">
                    {p.postUrl}
                  </a>
                  <span className={cn(
                    'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
                    p.status === 'VERIFIED' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-[#616161]'
                  )}>
                    {p.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <CampaignWatermarkedPreviewModal
        isOpen={Boolean(previewAssetId)}
        onClose={() => setPreviewAssetId(null)}
        assetId={previewAssetId}
        title="Your draft (watermarked preview)"
      />

      <CampaignApplyModal
        isOpen={replaceModalOpen}
        onClose={() => setReplaceModalOpen(false)}
        campaignId={id}
        campaignName={campaign?.name}
        mode="replace"
        onComplete={async (assetId) => {
          await handleReplaceWithAsset(assetId);
        }}
      />

      {/* Submit Post Link Modal */}
      <Modal
        isOpen={submitLinkModalOpen}
        onClose={() => {
          setSubmitLinkModalOpen(false);
          setPostUrl('');
        }}
        title="Submit final post link"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#616161]">
            Enter the URL of your published {campaign?.platformTarget?.toLowerCase() || 'Instagram'} post.
            Make sure the post is public and matches your submitted draft.
          </p>
          <div>
            <label htmlFor="post-url" className="mb-1.5 block text-sm font-medium text-[#212121]">
              Post URL
            </label>
            <Input
              id="post-url"
              type="url"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder={campaign?.platformTarget?.toUpperCase() === 'YOUTUBE'
                ? 'https://youtube.com/watch?v=...'
                : 'https://instagram.com/reel/...'}
              className="w-full"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <BrandSecondaryButton
              type="button"
              size="sm"
              onClick={() => {
                setSubmitLinkModalOpen(false);
                setPostUrl('');
              }}
            >
              Cancel
            </BrandSecondaryButton>
            <BrandPrimaryButton
              type="button"
              size="sm"
              disabled={!postUrl.trim() || submittingLink}
              onClick={handleSubmitPostLink}
            >
              {submittingLink ? 'Submitting...' : 'Submit link'}
            </BrandPrimaryButton>
          </div>
        </div>
      </Modal>

      {/* Ssemble Clip Generator Modal */}
      <SsembleClipGeneratorModal
        isOpen={clipGeneratorOpen}
        onClose={() => {
          setClipGeneratorOpen(false);
          setSelectedVideoForClips(null);
        }}
        sourceVideo={selectedVideoForClips}
        campaignId={id}
        onGenerate={handleGenerateClips}
      />

      {/* Ssemble Clips Viewer Modal */}
      <SsembleClipsViewerModal
        isOpen={clipViewerOpen}
        onClose={() => {
          setClipViewerOpen(false);
          setSelectedClipRequest(null);
        }}
        request={selectedClipRequest}
      />
    </div>
  );
}
