import type { Metadata } from 'next';
import PageIntro from '@/components/marketing/PageIntro';
import CostComparison from '@/components/marketing/sections/CostComparison';
import Faq from '@/components/marketing/sections/Faq';
import Pricing from '@/components/marketing/sections/Pricing';
import BottomCta from '@/components/marketing/sections/BottomCta';
import { subPages } from '@/lib/content/landing';

const intro = subPages.pricing;

export const metadata: Metadata = {
  title: intro.metaTitle,
  description: intro.metaDescription,
  alternates: { canonical: '/pricing' },
};

/**
 * The plans, then the agency comparison that justifies them, then the
 * questions people ask before paying. All three are the landing page's own
 * sections — see `PageIntro` for why this page does not invent its own.
 */
export default function PricingPage() {
  return (
    <>
      <PageIntro intro={intro} />
      <Pricing heading={false} />
      <CostComparison />
      <Faq />
      <BottomCta />
    </>
  );
}
