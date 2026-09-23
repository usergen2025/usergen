'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import LoginModal from '@/components/auth/LoginModal';
import GetStartedModal from '@/components/auth/GetStartedModal';
import BrandSignupModal from '@/components/auth/BrandSignupModal';
import CreatorSignupModal from '@/components/auth/CreatorSignupModal';
import { clearIntent } from '@/lib/marketing/generation-intent';
import { removeStorage, writeStorage } from '@/lib/utils/safeStorage';

/**
 * Owns the sign-up / log-in modal flow for the marketing pages.
 *
 * The landing page has eight places that start this flow — the header, the
 * hero, both section CTAs, three pricing cards and the closing CTA. `Header`
 * carries this same four-state machine inline, and repeating it per section
 * would mean eight copies of the modal set mounted on one page, each able to
 * open while another is already open.
 *
 * Mounted once by the marketing layout instead, with the sections calling
 * `useMarketingAuth()`. Deliberately the same modals the rest of the app
 * uses: this phase changes where the flow is triggered from, not what it does
 * once triggered.
 */
type Step = 'closed' | 'get-started' | 'login' | 'creator-signup' | 'brand-signup';

/** Where a completed sign-up should land, when it is not the default. */
const GENERATION_FUNNEL = '/create-video/ai-chat';

type MarketingAuthValue = {
  /**
   * Opens the role picker.
   *
   * `startGeneration` marks this as one of the "generate my ad" CTAs, which
   * should drop the visitor into the generation funnel rather than on their
   * dashboard. Pass false for CTAs that only mean "make an account".
   */
  openGetStarted: (options?: { startGeneration?: boolean }) => void;
  openLogin: () => void;
  close: () => void;
};

const MarketingAuthContext = createContext<MarketingAuthValue | null>(null);

export function useMarketingAuth(): MarketingAuthValue {
  const context = useContext(MarketingAuthContext);
  if (!context) {
    throw new Error('useMarketingAuth must be used inside MarketingAuthProvider');
  }
  return context;
}

/**
 * For components shared with the signed-in app, where there is no sign-up
 * flow to open and therefore no provider — the hero widget on `/home` is the
 * only case today. Returns null instead of throwing so those components can
 * be rendered on both sides without a second copy.
 */
export function useOptionalMarketingAuth(): MarketingAuthValue | null {
  return useContext(MarketingAuthContext);
}

export default function MarketingAuthProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<Step>('closed');
  const [redirectUrl, setRedirectUrl] = useState<string | undefined>(undefined);

  const value = useMemo<MarketingAuthValue>(
    () => ({
      openGetStarted: (options) => {
        const startGeneration = options?.startGeneration ?? false;
        /*
         * `CreatorSignupModal` branches on this flag, not on the redirect: a
         * `/create-video` target without it lands on `/create-video/style`,
         * the older wizard. Setting both is what the header's "Create a
         * Video" button already does.
         */
        if (startGeneration) {
          writeStorage('fromCreateVideo', 'true', 'session');
        }
        setRedirectUrl(startGeneration ? GENERATION_FUNNEL : undefined);
        setStep('get-started');
      },
      openLogin: () => {
        setRedirectUrl(undefined);
        setStep('login');
      },
      close: () => setStep('closed'),
    }),
    []
  );

  const close = useCallback(() => setStep('closed'), []);

  /*
   * Brands never enter the generation funnel, so anything the hero collected
   * is meaningless to them. Dropped here rather than left to expire, so it
   * cannot seed a funnel they open later in the same session.
   */
  const selectBrand = useCallback(() => {
    clearIntent();
    removeStorage('fromCreateVideo', 'session');
    setRedirectUrl(undefined);
    setStep('brand-signup');
  }, []);

  return (
    <MarketingAuthContext.Provider value={value}>
      {children}

      <GetStartedModal
        isOpen={step === 'get-started'}
        onClose={close}
        onSelectCreator={() => setStep('creator-signup')}
        onSelectBrand={selectBrand}
        onShowLogin={() => setStep('login')}
      />
      <CreatorSignupModal
        isOpen={step === 'creator-signup'}
        onClose={close}
        onShowLogin={() => setStep('login')}
        redirectUrl={redirectUrl}
      />
      {/* No redirect for brands — the modal's own default is their dashboard. */}
      <BrandSignupModal
        isOpen={step === 'brand-signup'}
        onClose={close}
        onShowLogin={() => setStep('login')}
      />
      {/*
       * An existing account arriving through a "generate" CTA should also
       * land in the funnel. The modal already resolves a `/create-video`
       * target to the ai-chat flow for non-brands.
       */}
      <LoginModal
        isOpen={step === 'login'}
        onClose={close}
        onShowGetStarted={() => setStep('get-started')}
        redirectUrl={redirectUrl}
      />
    </MarketingAuthContext.Provider>
  );
}
