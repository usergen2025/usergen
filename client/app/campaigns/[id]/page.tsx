'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, IndianRupee, Video, CalendarRange, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { BrandPrimaryButton, BrandSecondaryButton, BrandIconChip } from '@/components/brand';
import { CampaignWatermarkedPreviewModal } from '@/components/campaigns/CampaignWatermarkedPreviewModal';
import { CampaignApplyModal } from '@/components/campaigns/CampaignApplyModal';
import { LeaderboardCard, PrizePoolSummary } from '@/components/campaigns/LeaderboardCard';
import { parseDraftMediaAssetId } from '@/lib/campaign-media';
import { cn } from '@/lib/utils/cn';

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

  useEffect(() => {
    void load();
  }, [load]);

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

  if (!id) {
    return null;
  }

  if (loading && !payload) {
    return (
      <div className="brand-page-shell py-8 text-center text-text-secondary">Loading…</div>
    );
  }

  if (!campaign) {
    return (
      <div className="brand-page-shell py-8 text-center">
        <p className="mb-4 text-text-secondary">Campaign not found.</p>
        <Link href="/campaigns" className="text-[#E86512] underline">
          Back to campaigns
        </Link>
      </div>
    );
  }

  return (
    <div className="brand-page-shell py-4 sm:py-6">
      {/* Page Header */}
      <div className="mb-5 flex flex-wrap items-center gap-3 sm:mb-6">
        <button
          type="button"
          onClick={() => router.push('/campaigns')}
          className="brand-cta-secondary inline-flex items-center gap-1.5 !h-9 !min-h-9 !rounded-full !px-3.5 !py-1.5 text-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Campaigns
        </button>
        <h1 className="brand-campaign-page-title flex-1 truncate">{campaign.name}</h1>
      </div>

      {/* Campaign Info Card */}
      <div className="brand-gradient-frame mb-5 rounded-[20px] shadow-card sm:mb-6 p-3 sm:mb-4 sm:p-4">
        <div className="rounded-[17px] bg-white/95 p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
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
              <span>Apply by {formatDate(campaign.deadlineToApply)}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 brand-campaign-row text-[#212121]">
              <BrandIconChip size="sm">
                <CalendarRange className="h-3 w-3" strokeWidth={1.8} />
              </BrandIconChip>
              <span>{formatDate(campaign.startDate)} – {formatDate(campaign.endDate)}</span>
            </div>
          </div>

          <p className="brand-campaign-meta line-clamp-4 max-w-4xl leading-relaxed text-text-secondary">
            {campaign.description}
          </p>

          {(campaign.industry || campaign.platformTarget || campaign.regionFilter || campaign.brandAssetsUrl) && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {campaign.industry && (
                <span className="rounded-full bg-orange-50 px-3 py-1 text-[#212121]">Industry: {campaign.industry}</span>
              )}
              {campaign.platformTarget && (
                <span className="rounded-full bg-orange-50 px-3 py-1 text-[#212121]">{campaign.platformTarget}</span>
              )}
              {campaign.regionFilter && (
                <span className="rounded-full bg-orange-50 px-3 py-1 text-[#212121]">{campaign.regionFilter}</span>
              )}
              {campaign.brandAssetsUrl && (
                <a
                  href={campaign.brandAssetsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-[#E8E2DB] px-3 py-1 text-[#E86512] hover:bg-orange-50"
                >
                  Brand assets / drive
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Application Status Card */}
      {application ? (
        <div className="brand-gradient-frame mb-5 rounded-[20px] p-[2px] shadow-card sm:mb-6">
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
          </div>
        </div>
      ) : (
        <div className="brand-gradient-frame mb-5 rounded-[20px] p-[2px] sm:mb-6">
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
        <div className="brand-gradient-frame mb-5 rounded-[20px] p-[2px] shadow-card sm:mb-6">
          <div className="rounded-[18px] bg-white/95 p-4 sm:p-6 space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Earnings shown are projected based on current views. Final payouts are computed when
              the campaign ends (plus the brand&apos;s grace period). Creators without a verified
              post at finalization are dropped, and the pool is redistributed.
            </div>
            <PrizePoolSummary campaignId={id} />
            <LeaderboardCard
              campaignId={id}
              highlightCreatorId={application?.creatorId}
              showSnapshot
            />
          </div>
        </div>
      )}

      {/* Post Submissions Card */}
      {posts.length > 0 && (
        <div className="brand-gradient-frame rounded-[20px] p-[2px] shadow-card">
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
    </div>
  );
}
