'use client';

import { Video } from 'lucide-react';
import { BrandPageHeader } from '@/components/brand';

export default function BrandVideosPage() {
  return (
    <div className="brand-page-shell">
      <BrandPageHeader backHref="/brand/dashboard" title="My videos" className="mb-3 shrink-0 sm:mb-3" />

      <div className="brand-gradient-frame flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4 p-[2px]">
      <div className="rounded-[18px] bg-white/95 p-6 text-center shadow-sm md:p-10">
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-[#E86412] to-[#F12A4C] text-white sm:h-12 sm:w-12">
          <Video className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.8} aria-hidden />
        </div>
        <p className="brand-campaign-meta mx-auto max-w-md text-text-secondary">
          This page is coming soon. You’ll manage brand video assets and submissions here.
        </p>
      </div>
      </div>
    </div>
  );
}
