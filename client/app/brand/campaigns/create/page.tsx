'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BrandPrimaryButton, BrandSecondaryButton, BrandDatePicker } from '@/components/brand';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';
import { ArrowLeft, Info, Paperclip, Send, ChevronDown, Video, Plus, Trash2, ExternalLink } from 'lucide-react';
import { addDays, parse as parseDate, startOfDay } from 'date-fns';
import { PrizePoolEditor } from '@/components/campaigns/PrizePoolEditor';
import {
  PrizePoolConfig,
  tiersForTemplate,
  isTiersValid,
} from '@/lib/campaigns/prize-pool';
import AddSourceVideoModal from '@/components/campaigns/AddSourceVideoModal';

interface PendingSourceVideo {
  id: string;
  url: string;
  title?: string;
  urlType: 'YOUTUBE' | 'DIRECT';
  thumbnailUrl?: string;
}

function detectUrlType(url: string): 'YOUTUBE' | 'DIRECT' | 'INVALID' {
  if (!url || typeof url !== 'string') return 'INVALID';
  const normalizedUrl = url.trim().toLowerCase();
  if (normalizedUrl.includes('youtube.com') || normalizedUrl.includes('youtu.be')) {
    return 'YOUTUBE';
  }
  if (normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')) {
    return 'DIRECT';
  }
  return 'INVALID';
}

function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([^?&]+)/,
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtube\.com\/embed\/([^?&]+)/,
    /youtube\.com\/shorts\/([^?&]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function cmpYmd(a: string, b: string): number {
  const da = parseDate(a, 'yyyy-MM-dd', new Date());
  const db = parseDate(b, 'yyyy-MM-dd', new Date());
  return da.getTime() - db.getTime();
}

export default function CreateCampaignPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const campaignType = searchParams?.get('type') || 'REPOST_CPM';
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    brandAssetsUrl: '',
    industry: '',
    platformTarget: 'INSTAGRAM',
    regionFilter: '',
    deadlineToApply: '',
    startDate: '',
    endDate: '',
    totalBudget: '',
  });
  const [prizePool, setPrizePool] = useState<PrizePoolConfig>({
    templateKey: 'BALANCED',
    tiers: tiersForTemplate('BALANCED'),
    tieBreaker: 'EARLIER_VERIFIED_POST',
    minViewsToQualify: 0,
    gracePeriodHours: 24,
  });
  const [previewN, setPreviewN] = useState(1000);
  const assetFileInputRef = useRef<HTMLInputElement>(null);
  const platformDropdownRef = useRef<HTMLDivElement>(null);
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);
  
  // Source videos state (stored locally until campaign is created)
  const [pendingSourceVideos, setPendingSourceVideos] = useState<PendingSourceVideo[]>([]);
  const [showAddVideoModal, setShowAddVideoModal] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (platformDropdownRef.current && !platformDropdownRef.current.contains(event.target as Node)) {
        setPlatformDropdownOpen(false);
      }
    };
    if (platformDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [platformDropdownOpen]);

  const budgetValue = parseFloat(formData.totalBudget) || 0;
  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback;

  // Add a pending source video (local state only)
  const handleAddPendingVideo = (url: string, title?: string) => {
    const urlType = detectUrlType(url);
    if (urlType === 'INVALID') {
      showToast('Invalid video URL', 'error');
      return;
    }
    
    // Check for duplicates
    if (pendingSourceVideos.some((v) => v.url === url)) {
      showToast('This video URL is already added', 'error');
      return;
    }
    
    // Extract YouTube thumbnail if applicable
    let thumbnailUrl: string | undefined;
    if (urlType === 'YOUTUBE') {
      const videoId = extractYouTubeVideoId(url);
      if (videoId) {
        thumbnailUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      }
    }
    
    const newVideo: PendingSourceVideo = {
      id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url,
      title: title || (urlType === 'YOUTUBE' ? 'YouTube Video' : 'Video'),
      urlType,
      thumbnailUrl,
    };
    
    setPendingSourceVideos((prev) => [...prev, newVideo]);
    setShowAddVideoModal(false);
    showToast('Video added. It will be saved when you create the campaign.', 'success');
  };

  // Remove a pending source video
  const handleRemovePendingVideo = (id: string) => {
    setPendingSourceVideos((prev) => prev.filter((v) => v.id !== id));
    showToast('Video removed', 'success');
  };

  // Save source videos to backend after campaign is created
  const saveSourceVideos = async (campaignId: string) => {
    if (pendingSourceVideos.length === 0) return;
    
    const results = await Promise.allSettled(
      pendingSourceVideos.map((video, index) =>
        apiClient.addCampaignSourceVideo(campaignId, {
          url: video.url,
          title: video.title,
          orderIndex: index,
        })
      )
    );
    
    const failedCount = results.filter((r) => r.status === 'rejected').length;
    if (failedCount > 0) {
      showToast(`${failedCount} video(s) failed to save. You can add them later from the edit page.`, 'error');
    }
  };

  // Validation helper
  const validateForm = () => {
    if (!formData.name.trim()) {
      showToast('Campaign name is required', 'error');
      return false;
    }
    if (formData.name.length > 75) {
      showToast('Campaign name must be 75 characters or less', 'error');
      return false;
    }
    if (!formData.description.trim()) {
      showToast('Campaign description is required', 'error');
      return false;
    }
    if (formData.description.length > 300) {
      showToast('Campaign description must be 300 characters or less', 'error');
      return false;
    }
    if (!formData.deadlineToApply) {
      showToast('Deadline to apply is required', 'error');
      return false;
    }
    if (!formData.startDate) {
      showToast('Campaign start date is required', 'error');
      return false;
    }
    if (!formData.endDate) {
      showToast('Campaign end date is required', 'error');
      return false;
    }
    if (cmpYmd(formData.deadlineToApply, formData.startDate) >= 0) {
      showToast('Campaign start must be at least one day after the apply deadline.', 'error');
      return false;
    }
    if (cmpYmd(formData.startDate, formData.endDate) >= 0) {
      showToast('Campaign end date must be after the start date.', 'error');
      return false;
    }
    if (!formData.totalBudget || parseFloat(formData.totalBudget) <= 0) {
      showToast('Valid total prize pool is required', 'error');
      return false;
    }
    const poolValidation = isTiersValid(prizePool.tiers);
    if (!poolValidation.ok) {
      showToast(poolValidation.error || 'Prize pool configuration is invalid', 'error');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    try {
      const created = await apiClient.createCampaign({
        name: formData.name,
        description: formData.description,
        brandAssetsUrl: formData.brandAssetsUrl || undefined,
        campaignType,
        industry: formData.industry || undefined,
        platformTarget: formData.platformTarget,
        regionFilter: formData.regionFilter || undefined,
        deadlineToApply: formData.deadlineToApply,
        startDate: formData.startDate,
        endDate: formData.endDate,
        totalBudget: parseFloat(formData.totalBudget),
        payoutModel: 'POOL',
        prizePool: {
          templateKey: prizePool.templateKey,
          tiers: prizePool.tiers,
          tieBreaker: prizePool.tieBreaker,
          minViewsToQualify: prizePool.minViewsToQualify,
          gracePeriodHours: prizePool.gracePeriodHours,
        },
        previewN,
      });
      const newId = created.data?.id as string | undefined;
      if (!newId) {
        showToast('Campaign was created but no id was returned.', 'error');
        return;
      }
      
      // Save source videos after campaign is created
      if (pendingSourceVideos.length > 0) {
        await saveSourceVideos(newId);
      }
      
      showToast('Campaign draft created. Publish it from My Campaigns when ready.', 'success');
      router.push('/brand/campaigns');
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to create campaign'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!formData.name.trim()) {
      showToast('Campaign name is required to save draft', 'error');
      return;
    }

    setIsLoading(true);
    const baseDate = new Date().toISOString().slice(0, 10);
    try {
      const res = await apiClient.createCampaign({
        name: formData.name,
        description: formData.description,
        brandAssetsUrl: formData.brandAssetsUrl || undefined,
        campaignType,
        industry: formData.industry || undefined,
        platformTarget: formData.platformTarget,
        regionFilter: formData.regionFilter || undefined,
        deadlineToApply: formData.deadlineToApply || baseDate,
        startDate: formData.startDate || baseDate,
        endDate: formData.endDate || addDays(parseDate(formData.startDate || baseDate, 'yyyy-MM-dd', new Date()), 30).toISOString().slice(0, 10),
        totalBudget: parseFloat(formData.totalBudget) || 1,
        payoutModel: 'POOL',
        prizePool: {
          templateKey: prizePool.templateKey,
          tiers: prizePool.tiers,
          tieBreaker: prizePool.tieBreaker,
          minViewsToQualify: prizePool.minViewsToQualify,
          gracePeriodHours: prizePool.gracePeriodHours,
        },
        previewN,
      });
      
      const newId = res.data?.id as string | undefined;
      
      // Save source videos after draft is created
      if (newId && pendingSourceVideos.length > 0) {
        await saveSourceVideos(newId);
      }
      
      if (newId) {
        showToast('Draft saved. You can find it under Drafts in My Campaigns.', 'success');
      } else {
        showToast('Draft saved successfully', 'success');
      }
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Failed to save draft'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const maxBudgetForSlider = Math.max(500_000, Math.ceil(budgetValue || 0));
  const sliderPercent =
    maxBudgetForSlider > 0
      ? Math.min(100, Math.max(0, Math.round((budgetValue / maxBudgetForSlider) * 100)))
      : 0;

  const todayStart = startOfDay(new Date());
  const deadlineMin = todayStart;
  const deadlineMax = formData.startDate
    ? parseDate(formData.startDate, 'yyyy-MM-dd', new Date())
    : undefined;
  const startMin = formData.deadlineToApply
    ? addDays(parseDate(formData.deadlineToApply, 'yyyy-MM-dd', new Date()), 1)
    : todayStart;
  const endMin = formData.startDate
    ? addDays(parseDate(formData.startDate, 'yyyy-MM-dd', new Date()), 1)
    : todayStart;

  return (
    <div className="brand-page-shell flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 sm:mb-5 gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/brand/campaigns" className="rounded-lg p-1.5 transition-colors hover:bg-gray-100">
            <ArrowLeft className="h-4 w-4 text-[#212121]" />
          </Link>
          <h1 className="brand-campaign-page-title">Create a Campaign</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <BrandSecondaryButton
            type="button"
            onClick={handleSaveDraft}
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            Save as draft
          </BrandSecondaryButton>
          <BrandPrimaryButton
            type="button"
            onClick={handleSubmit}
            disabled={isLoading}
            className="w-full sm:w-auto"
            icon={<Send className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden />}
          >
            Create draft
          </BrandPrimaryButton>
        </div>
      </div>

      {/* Form */}
      <div className="brand-gradient-frame flex min-h-0 flex-1 rounded-[20px] p-3 sm:p-4 p-[2px]">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-white/95 p-3 shadow-sm sm:p-4 md:p-5">
          <form onSubmit={handleSubmit} className="min-h-0 w-full flex-1 space-y-4 overflow-y-auto pr-1 sm:space-y-5">
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
              <p className="text-xs sm:text-sm text-[#9A460C]">
                Campaign Type: <span className="font-medium">{campaignType === 'REPOST_CPM' ? 'Repost / CPM Campaign' : campaignType}</span>
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="font-heading brand-campaign-row font-medium text-[#212121]">
                      Name of the Campaign
                    </label>
                    <span className="text-xs text-text-secondary">{formData.name.length} / 75 characters</span>
                  </div>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value.slice(0, 75) })}
                    placeholder="Enter campaign name"
                    maxLength={75}
                    required
                    variant="brandCapsule"
                  />
                </div>

                <div>
                  <label className="font-heading brand-campaign-row font-medium text-[#212121] mb-2 block">Campaign Industry</label>
                  <Input
                    value={formData.industry}
                    onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                    placeholder="Fashion, FMCG, SaaS..."
                    variant="brandCapsule"
                  />
                </div>

                <div>
                  <label className="font-heading brand-campaign-row font-medium text-[#212121] mb-2 block">Platform Target</label>
                  <div ref={platformDropdownRef} className="relative">
                    <button
                      type="button"
                      className="brand-field-shell w-full"
                      onClick={() => setPlatformDropdownOpen((prev) => !prev)}
                    >
                      <span className="brand-field-shell__input text-left">
                        {formData.platformTarget === 'INSTAGRAM' ? 'Instagram' : 'YouTube Shorts'}
                      </span>
                      <span className="brand-field-shell__suffix pointer-events-none">
                        <ChevronDown className={cn('h-4 w-4 transition-transform', platformDropdownOpen && 'rotate-180')} />
                      </span>
                    </button>
                    {platformDropdownOpen ? (
                      <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-[#DED4CB] bg-white shadow-[0_10px_24px_-10px_rgba(15,8,43,0.28)]">
                        <button
                          type="button"
                          className="w-full px-3 py-2.5 text-left font-heading text-[clamp(12px,1.37vh,14px)] text-[#212121] hover:bg-gray-50"
                          onClick={() => {
                            setFormData({ ...formData, platformTarget: 'INSTAGRAM' });
                            setPlatformDropdownOpen(false);
                          }}
                        >
                          Instagram
                        </button>
                        <button
                          type="button"
                          className="w-full px-3 py-2.5 text-left font-heading text-[clamp(12px,1.37vh,14px)] text-[#212121] hover:bg-gray-50"
                          onClick={() => {
                            setFormData({ ...formData, platformTarget: 'YOUTUBE' });
                            setPlatformDropdownOpen(false);
                          }}
                        >
                          YouTube Shorts
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-heading brand-campaign-row font-medium text-[#212121]">
                    Description of the Campaign
                  </label>
                  <span className="text-xs text-text-secondary">{formData.description.length} / 300 characters</span>
                </div>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value.slice(0, 300) })}
                  placeholder="Give a brief of the campaign and the expected creator output."
                  maxLength={300}
                  rows={8}
                  required
                  variant="brandCapsule"
                  className="lg:h-[calc(3*42px+7rem)] lg:min-h-[calc(3*42px+7rem)]"
                />
              </div>
            </div>

            <div>
              <label className="font-heading brand-campaign-row font-medium text-[#212121] mb-2 block">
                Attach URL with Brand Assets
              </label>
              <p className="text-xs text-text-secondary mb-2">
                Please upload your assets/guidelines to Google Drive and make them publicly accessible.
              </p>
              <Input
                value={formData.brandAssetsUrl}
                onChange={(e) => setFormData({ ...formData, brandAssetsUrl: e.target.value })}
                placeholder="<google drive link>"
                type="url"
                icon={<Paperclip className="h-4 w-4 text-[#9E9E9E]" />}
                iconPosition="right"
                variant="brandCapsule"
                onIconClick={() => assetFileInputRef.current?.click()}
              />
              <input
                ref={assetFileInputRef}
                type="file"
                accept="image/*,video/*,.pdf,.zip"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    const uploadRes = await apiClient.uploadCampaignBrandAsset(file);
                    const uploadUrl = uploadRes.data?.url;
                    if (uploadUrl) {
                      setFormData((prev) => ({ ...prev, brandAssetsUrl: uploadUrl }));
                      showToast('Asset uploaded and link attached.', 'success');
                    } else {
                      showToast('Upload completed but URL was unavailable. Please paste the link manually.', 'error');
                    }
                  } catch (err: unknown) {
                    showToast(
                      err instanceof Error && err.message
                        ? err.message
                        : 'Could not upload asset. Check the file size (max 50MB) or try again.',
                      'error',
                    );
                  } finally {
                    event.target.value = '';
                  }
                }}
              />
            </div>

            {/* Source Videos for Clipping Section */}
            <div className="rounded-2xl border border-[#E8E2DB] bg-white p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Video className="w-5 h-5 text-[#E86512]" />
                  <h3 className="font-heading font-semibold text-[#212121]">Source Videos for Clipping</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddVideoModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#E86512] bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Video
                </button>
              </div>
              <p className="text-xs text-text-secondary mb-3">
                Add YouTube or video URLs that creators can use to generate clips with AI.
              </p>
              
              {pendingSourceVideos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <Video className="w-10 h-10 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">No source videos added yet</p>
                  <button
                    type="button"
                    onClick={() => setShowAddVideoModal(true)}
                    className="mt-2 text-sm text-[#E86512] hover:underline"
                  >
                    Add your first video
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingSourceVideos.map((video, index) => (
                    <div
                      key={video.id}
                      className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100"
                    >
                      {/* Thumbnail */}
                      {video.thumbnailUrl ? (
                        <img
                          src={video.thumbnailUrl}
                          alt={video.title || 'Video thumbnail'}
                          className="w-16 h-12 object-cover rounded-lg flex-shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-12 bg-gray-200 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Video className="w-6 h-6 text-gray-400" />
                        </div>
                      )}
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-500">#{index + 1}</span>
                          <span className={cn(
                            'px-2 py-0.5 text-xs font-medium rounded-full',
                            video.urlType === 'YOUTUBE' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                          )}>
                            {video.urlType === 'YOUTUBE' ? 'YouTube' : 'Direct URL'}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-[#212121] truncate mt-1">
                          {video.title || 'Untitled Video'}
                        </p>
                        <a
                          href={video.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#E86512] hover:underline truncate block"
                        >
                          {video.url}
                        </a>
                      </div>
                      
                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <a
                          href={video.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-gray-400 hover:text-[#E86512] hover:bg-orange-50 rounded-lg transition-colors"
                          title="Open video"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleRemovePendingVideo(video.id)}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove video"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {pendingSourceVideos.length > 0 && (
                <p className="text-xs text-text-secondary mt-3">
                  {pendingSourceVideos.length} video{pendingSourceVideos.length !== 1 ? 's' : ''} will be saved when you create the campaign.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-4">
                <div>
                  <label className="font-heading brand-campaign-row mb-2 block font-medium text-[#212121]">
                    Deadline to Apply
                  </label>
                  <BrandDatePicker
                    value={formData.deadlineToApply}
                    onChange={(next) => setFormData({ ...formData, deadlineToApply: next })}
                    minDate={deadlineMin}
                    maxDate={deadlineMax}
                    placeholder="Choose deadline"
                  />
                </div>

                <div>
                  <label className="font-heading brand-campaign-row mb-2 block font-medium text-[#212121]">
                    Campaign Start Date
                  </label>
                  <BrandDatePicker
                    value={formData.startDate}
                    onChange={(next) => setFormData({ ...formData, startDate: next })}
                    minDate={startMin}
                    placeholder="Choose start date"
                  />
                </div>
                <div>
                  <label className="font-heading brand-campaign-row mb-2 block font-medium text-[#212121]">
                    Campaign End Date
                  </label>
                  <BrandDatePicker
                    value={formData.endDate}
                    onChange={(next) => setFormData({ ...formData, endDate: next })}
                    minDate={endMin}
                    placeholder="Choose end date"
                  />
                </div>

              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="font-heading brand-campaign-row font-medium text-[#212121]">
                      Total Prize Pool of the Campaign
                    </label>
                    <div className="relative group">
                      <Info className="w-4 h-4 text-gray-400 cursor-help" />
                      <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                        The full pool will be distributed across approved creators based on the
                        prize pool template you choose. Only refunded if zero creators qualify.
                      </div>
                    </div>
                  </div>
                  <div className="brand-field-shell">
                    <span className="brand-field-shell__prefix">₹</span>
                    <input
                      value={formData.totalBudget}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9.]/g, '');
                        setFormData({ ...formData, totalBudget: value });
                      }}
                      placeholder="50,000"
                      type="text"
                      required
                      className="brand-field-shell__input"
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderPercent}
                    onChange={(e) => {
                      const nextValue = Number(e.target.value);
                      if (!Number.isFinite(nextValue)) return;
                      const nextBudget = Math.round((nextValue / 100) * maxBudgetForSlider);
                      setFormData((prev) => ({ ...prev, totalBudget: String(Math.max(nextBudget, 0)) }));
                    }}
                    className="mt-2 w-full accent-[#E86512]"
                  />
                </div>
                <div>
                  <label className="font-heading brand-campaign-row font-medium text-[#212121] mb-2 block">
                    Region Filter (optional)
                  </label>
                  <Input
                    value={formData.regionFilter}
                    onChange={(e) => setFormData({ ...formData, regionFilter: e.target.value })}
                    placeholder="India, Mumbai, South India..."
                    variant="brandCapsule"
                  />
                </div>

              </div>
            </div>

            <div className="rounded-2xl border border-[#E8E2DB] bg-white p-3 sm:p-4">
              <PrizePoolEditor
                value={prizePool}
                onChange={setPrizePool}
                totalBudget={budgetValue}
                previewN={previewN}
                onPreviewNChange={setPreviewN}
              />
            </div>

          </form>
        </div>
      </div>
      
      {/* Add Source Video Modal */}
      <AddSourceVideoModal
        isOpen={showAddVideoModal}
        onClose={() => setShowAddVideoModal(false)}
        onAdd={handleAddPendingVideo}
      />
    </div>
  );
}
