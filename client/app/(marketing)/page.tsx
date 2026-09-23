import type { Metadata } from 'next';
import Hero from '@/components/marketing/sections/Hero';
import OutputReel from '@/components/marketing/sections/OutputReel';
import AvatarShowcase from '@/components/marketing/sections/AvatarShowcase';
import HowItWorks from '@/components/marketing/sections/HowItWorks';
import VideoTranslation from '@/components/marketing/sections/VideoTranslation';
import CostComparison from '@/components/marketing/sections/CostComparison';
import Pricing from '@/components/marketing/sections/Pricing';
import Faq from '@/components/marketing/sections/Faq';
import BottomCta from '@/components/marketing/sections/BottomCta';

/**
 * The landing page, for signed-out visitors only — `proxy.ts` sends anyone
 * with a session to their dashboard, so there is no logged-in variant to
 * render here.
 *
 * A server component. Only the pieces that need state are client components
 * (the header's menu, the hero widget, the FAQ accordion), which keeps the
 * copy and structure in the initial HTML for crawlers.
 */
export const metadata: Metadata = {
  // `absolute` so the layout's "%s | UserGen.ai" template does not apply.
  title: { absolute: 'UserGen.ai — AI video ads for Indian businesses, from ₹350' },
  description:
    'Paste a product link or describe your ad and get a fully edited video in minutes. Indian AI presenters, 10+ languages, ₹350 per video.',
  alternates: { canonical: '/' },
};

export default function LandingPage() {
  return (
    <>
      <Hero />
      <OutputReel />
      <AvatarShowcase />
      <HowItWorks />
      <VideoTranslation />
      <CostComparison />
      <Pricing />
      <Faq />
      <BottomCta />
    </>
  );
}
