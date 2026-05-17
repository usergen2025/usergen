'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { ArrowLeft, Check, ChevronDown, Info, Paperclip } from 'lucide-react';
import { BrandDatePicker, BrandPrimaryButton } from '@/components/brand';
import { addDays, parse as parseDate, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils/cn';
import { PrizePoolEditor } from '@/components/campaigns/PrizePoolEditor';
import { PrizePoolConfig, tiersForTemplate, isTiersValid, normalizePoolTiers } from '@/lib/campaigns/prize-pool';

function paramSegment(params: ReturnType<typeof useParams> | null, key: string): string {
  const value = params?.[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

export default function EditCampaignPage() {
  const params = useParams();
  const campaignId = paramSegment(params, 'id');
  const router = useRouter();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [campaignStatus, setCampaignStatus] = useState<string>('');
  const [campaignType, setCampaignType] = useState<string>('REPOST_CPM');
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);
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
  const [payoutModel, setPayoutModel] = useState<'CPM' | 'POOL'>('POOL');
  const [prizePool, setPrizePool] = useState<PrizePoolConfig>({
    templateKey: 'BALANCED',
    tiers: tiersForTemplate('BALANCED'),
    tieBreaker: 'EARLIER_VERIFIED_POST',
    minViewsToQualify: 0,
    gracePeriodHours: 24,
  });
  const [previewN, setPreviewN] = useState(1000);
  const isDraft = campaignStatus === 'DRAFT';
  const budgetValue = parseFloat(formData.totalBudget) || 0;
  const maxBudgetForSlider = Math.max(500_000, Math.ceil(budgetValue || 0));
  const sliderPercent =
    maxBudgetForSlider > 0
      ? Math.min(100, Math.max(0, Math.round((budgetValue / maxBudgetForSlider) * 100)))
      : 0;

  useEffect(() => {
    const loadCampaign = async () => {
      try {
        const response = await apiClient.getCampaign(campaignId);
        const campaign = response.data;
        if (!campaign) {
          showToast('Campaign not found', 'error');
          router.push('/brand/campaigns');
          return;
        }
        setFormData({
          name: campaign.name || '',
          description: campaign.description || '',
          brandAssetsUrl: campaign.brandAssetsUrl || '',
          industry: campaign.industry || '',
          platformTarget: campaign.platformTarget || 'INSTAGRAM',
          regionFilter: campaign.regionFilter || '',
          deadlineToApply: campaign.deadlineToApply?.slice(0, 10) || '',
          startDate: campaign.startDate?.slice(0, 10) || '',
          endDate: campaign.endDate?.slice(0, 10) || '',
          totalBudget: campaign.totalBudget ? String(campaign.totalBudget) : '',
        });
        setCampaignStatus(campaign.status || '');
        setCampaignType(campaign.campaignType || 'REPOST_CPM');
        setPayoutModel((campaign.payoutModel as 'CPM' | 'POOL') || 'POOL');
        if (campaign.prizePoolJson) {
          const tiers = normalizePoolTiers({
            tiers: campaign.prizePoolJson.tiers,
            bands: campaign.prizePoolJson.bands,
            templateKey: campaign.prizePoolJson.templateKey,
          });
          setPrizePool({
            templateKey: campaign.prizePoolJson.templateKey || 'BALANCED',
            tiers,
            tieBreaker: campaign.prizePoolJson.tieBreaker || 'EARLIER_VERIFIED_POST',
            minViewsToQualify: campaign.prizePoolJson.minViewsToQualify ?? 0,
            gracePeriodHours: campaign.prizePoolJson.gracePeriodHours ?? 24,
          });
        }
        if (campaign.previewN) {
          setPreviewN(Number(campaign.previewN));
        }
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : 'Failed to load campaign', 'error');
      } finally {
        setIsLoading(false);
      }
    };
    if (campaignId) {
      void loadCampaign();
    }
  }, [campaignId, router, showToast]);

  const handleSave = async () => {
    if (!formData.name.trim()) {
      showToast('Campaign name is required', 'error');
      return;
    }
    if (!formData.description.trim()) {
      showToast('Campaign description is required', 'error');
      return;
    }
    setIsSaving(true);
    try {
      if (isDraft) {
        if (!formData.deadlineToApply || !formData.startDate) {
          showToast('Deadline and start date are required for draft updates', 'error');
          setIsSaving(false);
          return;
        }
        if (!formData.totalBudget || Number(formData.totalBudget) <= 0) {
          showToast('Valid total budget is required', 'error');
          setIsSaving(false);
          return;
        }
        if (payoutModel === 'POOL') {
          const validation = isTiersValid(prizePool.tiers);
          if (!validation.ok) {
            showToast(validation.error || 'Prize pool configuration is invalid', 'error');
            setIsSaving(false);
            return;
          }
        }
        if (!formData.endDate) {
          showToast('Campaign end date is required', 'error');
          setIsSaving(false);
          return;
        }
        await apiClient.updateCampaign(campaignId, {
          name: formData.name,
          description: formData.description,
          brandAssetsUrl: formData.brandAssetsUrl || undefined,
          deadlineToApply: formData.deadlineToApply,
          startDate: formData.startDate,
          endDate: formData.endDate,
          totalBudget: Number(formData.totalBudget),
          payoutModel,
          ...(payoutModel === 'POOL'
            ? {
                prizePool: {
                  templateKey: prizePool.templateKey,
                  tiers: prizePool.tiers,
                  tieBreaker: prizePool.tieBreaker,
                  minViewsToQualify: prizePool.minViewsToQualify,
                  gracePeriodHours: prizePool.gracePeriodHours,
                },
                previewN,
              }
            : {}),
        });
      } else {
        await apiClient.updateCampaign(campaignId, {
          name: formData.name,
          description: formData.description,
          brandAssetsUrl: formData.brandAssetsUrl || undefined,
        });
      }
      showToast('Campaign updated successfully', 'success');
      router.back();
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Failed to update campaign', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="brand-page-shell flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-5">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-white/50 transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4 text-[#212121]" />
          </button>
          <h1 className="brand-campaign-page-title">Edit campaign</h1>
        </div>
        <BrandPrimaryButton
          type="button"
          onClick={handleSave}
          disabled={isLoading || isSaving}
          icon={<Check className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden />}
          className="brand-campaign-cta w-full sm:w-auto"
        >
          Save changes
        </BrandPrimaryButton>
      </div>

      <div className="brand-gradient-frame flex min-h-0 flex-1 rounded-[20px] p-3 sm:p-4 p-[2px]">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-white/95 p-3 shadow-sm sm:p-4 md:p-5">
        <div className="min-h-0 w-full flex-1 space-y-4 overflow-y-auto pr-1 sm:space-y-5">
        {isDraft ? (
          <div className="space-y-4 sm:space-y-5">
            <div className="rounded-xl border border-orange-100 bg-orange-50 p-3">
              <p className="text-xs sm:text-sm text-[#9A460C]">
                Campaign Type: <span className="font-medium">{campaignType === 'REPOST_CPM' ? 'Repost / CPM Campaign' : campaignType}</span>
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
              <div className="space-y-4">
                <div>
                  <label className="font-heading brand-campaign-row font-medium text-[#212121] mb-2 block">Name of the Campaign</label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value.slice(0, 75) }))}
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
                    onChange={(e) => setFormData((prev) => ({ ...prev, industry: e.target.value }))}
                    placeholder="Fashion, FMCG, SaaS..."
                    variant="brandCapsule"
                  />
                </div>

                <div>
                  <label className="font-heading brand-campaign-row font-medium text-[#212121] mb-2 block">Platform Target</label>
                  <div className="relative">
                    <button
                      type="button"
                      className="brand-field-shell w-full"
                      onClick={() => setPlatformDropdownOpen((prev) => !prev)}
                      disabled={isLoading}
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
                            setFormData((prev) => ({ ...prev, platformTarget: 'INSTAGRAM' }));
                            setPlatformDropdownOpen(false);
                          }}
                        >
                          Instagram
                        </button>
                        <button
                          type="button"
                          className="w-full px-3 py-2.5 text-left font-heading text-[clamp(12px,1.37vh,14px)] text-[#212121] hover:bg-gray-50"
                          onClick={() => {
                            setFormData((prev) => ({ ...prev, platformTarget: 'YOUTUBE' }));
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
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value.slice(0, 300) }))}
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
                onChange={(e) => setFormData((prev) => ({ ...prev, brandAssetsUrl: e.target.value }))}
                placeholder="<google drive link>"
                type="url"
                icon={<Paperclip className="h-4 w-4 text-[#9E9E9E]" />}
                iconPosition="right"
                variant="brandCapsule"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-4">
                <div>
                  <label className="font-heading brand-campaign-row mb-2 block font-medium text-[#212121]">
                    Deadline to Apply
                  </label>
                  <BrandDatePicker
                    value={formData.deadlineToApply}
                    onChange={(next) => setFormData((prev) => ({ ...prev, deadlineToApply: next }))}
                    minDate={startOfDay(new Date())}
                    placeholder="Choose deadline"
                  />
                </div>
                <div>
                  <label className="font-heading brand-campaign-row mb-2 block font-medium text-[#212121]">
                    Campaign Start Date
                  </label>
                  <BrandDatePicker
                    value={formData.startDate}
                    onChange={(next) => setFormData((prev) => ({ ...prev, startDate: next }))}
                    minDate={
                      formData.deadlineToApply
                        ? parseDate(formData.deadlineToApply, 'yyyy-MM-dd', new Date())
                        : startOfDay(new Date())
                    }
                    placeholder="Choose start date"
                  />
                </div>
                <div>
                  <label className="font-heading brand-campaign-row mb-2 block font-medium text-[#212121]">
                    Campaign End Date
                  </label>
                  <BrandDatePicker
                    value={formData.endDate}
                    onChange={(next) => setFormData((prev) => ({ ...prev, endDate: next }))}
                    minDate={
                      formData.startDate
                        ? addDays(parseDate(formData.startDate, 'yyyy-MM-dd', new Date()), 1)
                        : startOfDay(new Date())
                    }
                    placeholder="Choose end date"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="font-heading brand-campaign-row font-medium text-[#212121]">
                      Total Budget of the Campaign
                    </label>
                    <div className="relative group">
                      <Info className="w-4 h-4 text-gray-400 cursor-help" />
                      <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                        The full budget is distributed across approved creators based on the prize
                        pool you configure. Locked once the campaign is published.
                      </div>
                    </div>
                  </div>
                  <div className="brand-field-shell">
                    <span className="brand-field-shell__prefix">₹</span>
                    <input
                      value={formData.totalBudget}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9.]/g, '');
                        setFormData((prev) => ({ ...prev, totalBudget: value }));
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
                    onChange={(e) => setFormData((prev) => ({ ...prev, regionFilter: e.target.value }))}
                    placeholder="India, Mumbai, South India..."
                    variant="brandCapsule"
                  />
                </div>

              </div>
            </div>
            {payoutModel === 'POOL' && (
              <div className="rounded-2xl border border-[#E8E2DB] bg-white p-3 sm:p-4">
                <PrizePoolEditor
                  value={prizePool}
                  onChange={setPrizePool}
                  totalBudget={budgetValue}
                  previewN={previewN}
                  onPreviewNChange={setPreviewN}
                  disabled={!isDraft}
                  showValidation
                />
                {!isDraft && (
                  <p className="mt-2 text-xs text-text-secondary">
                    Prize pool is locked once the campaign is published. Reach out to support to
                    request changes.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-[#E8E2DB] bg-[#FCFAF8] p-3 text-sm text-[#616161]">
              This campaign is no longer in draft. Only core copy fields can be edited.
            </div>
            <Input
              label="Campaign name"
              value={formData.name}
              onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Campaign name"
              disabled={isLoading}
              variant="brandCapsule"
            />
            <Textarea
              label="Campaign description"
              value={formData.description}
              onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Campaign description"
              disabled={isLoading}
              rows={5}
              variant="brandCapsule"
            />
            <Input
              label="Brand assets URL"
              value={formData.brandAssetsUrl}
              onChange={(event) => setFormData((prev) => ({ ...prev, brandAssetsUrl: event.target.value }))}
              placeholder="https://drive.google.com/..."
              disabled={isLoading}
              variant="brandCapsule"
            />
          </div>
        )}
        </div>
      </div>
      </div>
    </div>
  );
}
