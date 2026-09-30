import type { MetadataRoute } from 'next';

/**
 * Crawling is off unless SEO is explicitly enabled. A production `next build`
 * of a staging deploy would otherwise be indexable, because NODE_ENV is
 * `production` for every build.
 */
export default function robots(): MetadataRoute.Robots {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_SEO === 'true';
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://usergen.ai').replace(/\/$/, '');

  if (!enabled) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/home', '/create-video', '/projects', '/admin', '/api'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
