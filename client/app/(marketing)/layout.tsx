import type { Metadata } from 'next';
import LoggedOutGate from '@/components/marketing/LoggedOutGate';
import MarketingAuthProvider from '@/components/marketing/MarketingAuthProvider';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingTheme from '@/components/marketing/MarketingTheme';

/**
 * `metadataBase` turns the relative `canonical` and `og:url` values below into
 * absolute ones. Without it Next warns at build time and falls back to
 * localhost, which would ship localhost URLs into production OG tags.
 *
 * TODO(deploy): set NEXT_PUBLIC_SITE_URL in the production environment. The
 * default is only right if the site ends up on this apex domain.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://usergen.ai';

/**
 * Shared across the four public pages. Subpages set a bare title ("Pricing")
 * and the template appends the brand; the landing page overrides `title`
 * outright so it does not read "Home | UserGen.ai".
 *
 * TODO(assets): no `openGraph.images` yet — there is no share card in the
 * design file. Omitted rather than pointed at a placeholder, since a broken
 * image URL renders worse in a link preview than no image at all.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'UserGen.ai',
    template: '%s | UserGen.ai',
  },
  openGraph: {
    siteName: 'UserGen.ai',
    type: 'website',
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketingTheme className="flex min-h-0 flex-1 flex-col">
      <LoggedOutGate>
        <MarketingAuthProvider>
          <MarketingHeader />
          {/* No <main> here: the root layout already provides one. */}
          <div className="flex-1">{children}</div>
          <MarketingFooter />
        </MarketingAuthProvider>
      </LoggedOutGate>
    </MarketingTheme>
  );
}
