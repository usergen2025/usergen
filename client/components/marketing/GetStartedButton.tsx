'use client';

import MarketingButton from './MarketingButton';
import { useMarketingAuth } from './MarketingAuthProvider';

/**
 * Every "generate" CTA on the page.
 *
 * A thin client wrapper so the sections around it can stay server components:
 * only the button needs the modal flow, not the copy and layout it sits in.
 */
export default function GetStartedButton({
  variant = 'primary',
  fullWidth,
  className,
  startGeneration = true,
  children,
}: {
  variant?: 'primary' | 'dark' | 'light';
  fullWidth?: boolean;
  className?: string;
  /**
   * These CTAs all promise a video, so signing up from one should open the
   * generation funnel rather than a dashboard. Set false where the label
   * promises something else — "Book a call" is not "generate my ad".
   */
  startGeneration?: boolean;
  children: React.ReactNode;
}) {
  const { openGetStarted } = useMarketingAuth();

  return (
    <MarketingButton
      variant={variant}
      fullWidth={fullWidth}
      className={className}
      onClick={() => openGetStarted({ startGeneration })}
    >
      {children}
    </MarketingButton>
  );
}
