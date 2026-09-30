import { landing, baseValue } from '@/lib/content/landing';

/**
 * Schema.org graph for the public site. Rendered only when SEO is explicitly
 * enabled, so a dev or preview build does not publish production structured data.
 */
export default function MarketingJsonLd() {
  if (process.env.NEXT_PUBLIC_ENABLE_SEO !== 'true') return null;

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://usergen.ai').replace(/\/$/, '');
  const logoUrl = `${siteUrl}/marketing/logo-mark.png`;

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'UserGen',
        url: `${siteUrl}/`,
        logo: {
          '@type': 'ImageObject',
          '@id': `${siteUrl}/#logo`,
          url: logoUrl,
          contentUrl: logoUrl,
          caption: 'UserGen',
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: 'UserGen',
        publisher: { '@id': `${siteUrl}/#organization` },
      },
      {
        '@type': 'WebPage',
        '@id': `${siteUrl}/#webpage`,
        url: `${siteUrl}/`,
        name: 'UserGen - AI Video Generation Platform',
        description:
          'Create AI-generated videos using AI avatars, product visuals, B-roll, AI voices, captions and background music with UserGen.',
        isPartOf: { '@id': `${siteUrl}/#website` },
        about: { '@id': `${siteUrl}/#software` },
        mainEntity: { '@id': `${siteUrl}/#software` },
        hasPart: { '@id': `${siteUrl}/#faq` },
      },
      {
        '@type': ['SoftwareApplication', 'WebApplication'],
        '@id': `${siteUrl}/#software`,
        name: 'UserGen',
        url: `${siteUrl}/`,
        description:
          'UserGen is an AI video generation platform that helps creators and businesses create videos using AI avatars, product visuals, B-roll, AI voices, captions and background music.',
        applicationCategory: 'MultimediaApplication',
        applicationSubCategory: 'AI Video Generation',
        operatingSystem: 'Web Browser',
        browserRequirements: 'Requires a modern web browser with JavaScript enabled.',
        publisher: { '@id': `${siteUrl}/#organization` },
        featureList: [
          'AI video generation',
          'AI avatar videos',
          'Product-only videos',
          'B-roll videos',
          'Avatar with product videos',
          'Mixed-format video creation',
          'AI voiceovers',
          'Automatic captions',
          'Background music',
          'Social media video creation',
          'UGC-style video creation',
          'AI-powered marketing video creation',
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${siteUrl}/#faq`,
        url: `${siteUrl}/#faq`,
        isPartOf: { '@id': `${siteUrl}/#webpage` },
        mainEntity: landing.faq.items.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: baseValue(item.answer),
          },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
