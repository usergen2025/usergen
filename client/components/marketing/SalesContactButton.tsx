'use client';

import MarketingButton from './MarketingButton';
import { useMarketingAuth } from './MarketingAuthProvider';
import { SALES_EMAIL } from '@/lib/content/landing';

/**
 * The two CTAs that promise a conversation rather than a video — the Custom
 * Project plan's "Book a call with our team" and the agencies page's
 * "Talk to us".
 *
 * With `SALES_EMAIL` set these are mailto links. Without it they open sign-up,
 * because an account is the only lead the backend can currently record; that
 * is a worse match for the label, but it is the closest thing to the promise
 * that does not dead-end. Notably it does *not* pass `startGeneration`, so
 * these do not drop an agency into the video funnel.
 */
export default function SalesContactButton({
  variant = 'dark',
  fullWidth,
  className,
  subject,
  children,
}: {
  variant?: 'primary' | 'dark' | 'light';
  fullWidth?: boolean;
  className?: string;
  subject: string;
  children: React.ReactNode;
}) {
  const { openGetStarted } = useMarketingAuth();

  if (SALES_EMAIL) {
    return (
      <MarketingButton
        variant={variant}
        fullWidth={fullWidth}
        className={className}
        href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}`}
      >
        {children}
      </MarketingButton>
    );
  }

  return (
    <MarketingButton
      variant={variant}
      fullWidth={fullWidth}
      className={className}
      onClick={() => openGetStarted()}
    >
      {children}
    </MarketingButton>
  );
}
