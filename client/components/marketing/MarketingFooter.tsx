import Link from 'next/link';
import { Instagram, Linkedin, Twitter, Youtube } from 'lucide-react';
import { DiscordIcon } from './BrandIcons';
import { landing } from '@/lib/content/landing';
import { MKT_CONTAINER } from './MarketingSection';

const ICONS = {
  discord: DiscordIcon,
  youtube: Youtube,
  twitter: Twitter,
  linkedin: Linkedin,
  instagram: Instagram,
} as const;

export default function MarketingFooter() {
  const { footer } = landing;

  return (
    /*
     * One row from 1024px, stacked below it. The three groups need about
     * 900px between them: at 768 both the copyright and the link run wrap to
     * a second line, which leaves a separator dangling at the end of the
     * first.
     */
    <footer className="bg-[#EDEDED] py-7 lg:py-[30px]">
      <div
        className={`${MKT_CONTAINER} flex flex-col items-center gap-5 text-center lg:flex-row lg:justify-between lg:gap-11 lg:text-left`}
      >
        <p className="order-3 font-mkt-sans text-[13px] leading-5 text-[#7E8093] lg:order-1">
          {footer.copyright}
        </p>

        <ul className="order-1 flex items-center gap-3 lg:order-2 lg:gap-9">
          {footer.social.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <li key={item.label}>
                <a
                  href={item.href}
                  aria-label={`Follow us on ${item.label}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block text-mkt-violet-deep transition-opacity hover:opacity-70"
                >
                  <Icon className="size-6" />
                </a>
              </li>
            );
          })}
        </ul>

        {/*
         * Rendered as a single separated line rather than a list, matching the
         * design's "Pricing · Examples · ..." run. The separators are decorative
         * so they are hidden from assistive technology.
         */}
        <p className="order-2 font-mkt-sans text-[13px] leading-5 text-[#7E8093] lg:order-3">
          {footer.links.map((link, index) => (
            <span key={link.href}>
              {index > 0 ? <span aria-hidden="true"> · </span> : null}
              <Link href={link.href} className="transition-colors hover:text-mkt-ink">
                {link.label}
              </Link>
            </span>
          ))}
        </p>
      </div>
    </footer>
  );
}
