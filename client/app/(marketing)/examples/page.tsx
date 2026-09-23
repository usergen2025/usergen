import type { Metadata } from 'next';
import PageIntro from '@/components/marketing/PageIntro';
import OutputReel from '@/components/marketing/sections/OutputReel';
import AvatarShowcase from '@/components/marketing/sections/AvatarShowcase';
import VideoTranslation from '@/components/marketing/sections/VideoTranslation';
import BottomCta from '@/components/marketing/sections/BottomCta';
import { subPages } from '@/lib/content/landing';

const intro = subPages.examples;

export const metadata: Metadata = {
  title: intro.metaTitle,
  description: intro.metaDescription,
  alternates: { canonical: '/examples' },
};

/**
 * The three things there is output to show: finished ads, the avatar range,
 * and a translated cut.
 *
 * TODO(assets): the reel tiles are stills of finished ads, not the ads
 * themselves — a page called Examples should play them. It needs the rendered
 * clips before it is really doing its job.
 */
export default function ExamplesPage() {
  return (
    <>
      <PageIntro intro={intro} />
      <OutputReel />
      <AvatarShowcase />
      <VideoTranslation />
      <BottomCta />
    </>
  );
}
