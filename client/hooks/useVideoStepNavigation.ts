import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { getPreviousRoute, getStepFromRoute } from '@/lib/config/video-steps';

/**
 * Hook for video step navigation
 * Provides helper functions for navigating between video creation steps
 */
export function useVideoStepNavigation(projectId: string | null, currentStep?: string) {
  const router = useRouter();
  const pathname = usePathname(); // Get current route
  const searchParams = useSearchParams(); // Get URL query params

  /**
   * Navigate to the previous step in the flow
   * Uses multiple fallback strategies to determine current step:
   * 1. currentStep from project (if loaded)
   * 2. step from URL query params (if provided)
   * 3. step derived from current route pathname
   * Falls back to router.back() only if step cannot be determined
   */
  const goToPreviousStep = () => {
    if (!projectId) {
      router.back();
      return;
    }

    // Strategy 1: Try to get step from project first (most reliable)
    let step = currentStep;
    
    // Strategy 2: Check URL query params (added when navigating from projects page)
    if (!step) {
      const stepFromUrl = searchParams.get('step');
      if (stepFromUrl) {
        step = stepFromUrl;
        console.log('[useVideoStepNavigation] Step from URL query param:', step);
      }
    }
    
    // Strategy 3: Derive step from current route pathname
    if (!step && pathname) {
      step = getStepFromRoute(pathname);
      console.log('[useVideoStepNavigation] Step derived from route:', {
        pathname,
        derivedStep: step,
      });
    }

    if (step) {
      const previousRoute = getPreviousRoute(step);
      if (previousRoute) {
        console.log('[useVideoStepNavigation] Navigating to previous step:', {
          currentStep: step,
          previousRoute,
          projectId,
        });
        router.push(`${previousRoute}?projectId=${projectId}`);
        return;
      }
    }

    // Fallback to browser back only if we can't determine the step
    console.warn('[useVideoStepNavigation] Could not determine step, falling back to router.back()', {
      projectId,
      currentStep,
      pathname,
      stepFromUrl: searchParams.get('step'),
    });
    router.back();
  };

  return {
    goToPreviousStep,
  };
}

