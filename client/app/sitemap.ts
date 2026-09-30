import type { MetadataRoute } from 'next';

const ROUTES = ['/', '/pricing', '/examples', '/agencies'];

export default function sitemap(): MetadataRoute.Sitemap {
  if (process.env.NEXT_PUBLIC_ENABLE_SEO !== 'true') return [];

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://usergen.ai').replace(/\/$/, '');
  return ROUTES.map((path) => ({
    url: path === '/' ? `${siteUrl}/` : `${siteUrl}${path}`,
    changeFrequency: 'weekly',
    priority: path === '/' ? 1 : 0.7,
  }));
}
