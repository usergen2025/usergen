'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Input from '@/components/ui/Input';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { ArrowLeft } from 'lucide-react';
import { BrandPrimaryButton, BrandSecondaryButton } from '@/components/brand';

function getCampaignId(params: ReturnType<typeof useParams>) {
  const value = params?.id;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

export default function CampaignSubmissionPage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const campaignId = useMemo(() => getCampaignId(params), [params]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [platform, setPlatform] = useState<'INSTAGRAM' | 'YOUTUBE'>('INSTAGRAM');
  const [contentUrl, setContentUrl] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!contentUrl.trim()) {
      showToast('Submission URL is required', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      await apiClient.submitFinalPostLink(campaignId, {
        postUrl: contentUrl.trim(),
        platform,
      });
      showToast('Final post link submitted for verification', 'success');
      router.push('/campaigns');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Failed to submit URL', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="brand-page-shell pb-2">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/campaigns" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-black" />
        </Link>
        <h1 className="font-heading text-2xl md:text-3xl font-medium text-black">Submit Campaign URL</h1>
      </div>

      <form onSubmit={handleSubmit} className="brand-surface-card rounded-[18px] p-6 md:p-8 space-y-6 border-0">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Platform</label>
          <div className="flex gap-2">
            <BrandSecondaryButton
              type="button"
              size="sm"
              className={platform === 'INSTAGRAM' ? '!bg-gradient-to-r !from-[#E86412] !to-[#F12A4C] !text-white !border-transparent' : ''}
              onClick={() => setPlatform('INSTAGRAM')}
            >
              Instagram
            </BrandSecondaryButton>
            <BrandSecondaryButton
              type="button"
              size="sm"
              className={platform === 'YOUTUBE' ? '!bg-gradient-to-r !from-[#E86412] !to-[#F12A4C] !text-white !border-transparent' : ''}
              onClick={() => setPlatform('YOUTUBE')}
            >
              YouTube Shorts
            </BrandSecondaryButton>
          </div>
        </div>

        <Input
          label="Reel/Short URL"
          value={contentUrl}
          onChange={(event) => setContentUrl(event.target.value)}
          placeholder="https://instagram.com/reel/... or https://youtube.com/shorts/..."
          required
          variant="brandCapsule"
        />

        <div className="flex items-center gap-3">
          <BrandPrimaryButton type="submit" size="sm" disabled={isSubmitting}>
            Submit for Approval
          </BrandPrimaryButton>
          <Link href="/campaigns">
            <BrandSecondaryButton type="button" size="sm">
              Cancel
            </BrandSecondaryButton>
          </Link>
        </div>
      </form>
    </div>
  );
}
