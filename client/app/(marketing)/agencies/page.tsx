import type { Metadata } from 'next';
import PageIntro from '@/components/marketing/PageIntro';
import CostComparison from '@/components/marketing/sections/CostComparison';
import HowItWorks from '@/components/marketing/sections/HowItWorks';
import Pricing from '@/components/marketing/sections/Pricing';
import BottomCta from '@/components/marketing/sections/BottomCta';
import { subPages } from '@/lib/content/landing';

const intro = subPages.agencies;

export const metadata: Metadata = {
  title: intro.metaTitle,
  description: intro.metaDescription,
  alternates: { canonical: '/agencies' },
};

/**
 * Agencies care about margin and turnaround before anything else, so the cost
 * table leads and the production flow follows. The Custom Project plan at the
 * end of `Pricing` is the one they are actually being pointed at.
 */
export default function AgenciesPage() {
  return (
    <>
      <PageIntro intro={intro} cta="Talk to us" ctaKind="contact" />
      <CostComparison />
      <HowItWorks />
      <Pricing />
      <BottomCta />
    </>
  );
}
