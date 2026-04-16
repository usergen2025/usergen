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
   * 1. step derived from current route pathname (MOST RELIABLE - always accurate)
   * 2. step from URL query params (if provided)
   * 3. currentStep from project (LEAST RELIABLE - may be stale)
   * Falls back to router.back() only if step cannot be determined
   */
  const goToPreviousStep = () => {
    if (!projectId) {
      router.back();
      return;
    }

    // Strategy 1: Derive step from current route pathname (MOST RELIABLE)
    // Pathname is always accurate and available immediately, regardless of database state
    let step = pathname ? getStepFromRoute(pathname) : undefined;
    
    if (step) {
      console.log('[useVideoStepNavigation] Step derived from route (most reliable):', {
        pathname,
        derivedStep: step,
      });
    }
    
    // Strategy 2: Check URL query params (added when navigating from projects page)
    if (!step) {
      const stepFromUrl = searchParams?.get('step');
      if (stepFromUrl) {
        step = stepFromUrl;
        console.log('[useVideoStepNavigation] Step from URL query param:', step);
      }
    }
    
    // Strategy 3: Use currentStep from project (LEAST RELIABLE - may be stale)
    // Only use as last resort since it may not reflect the actual current page
    if (!step) {
      step = currentStep;
      if (step) {
        console.log('[useVideoStepNavigation] Step from project (fallback):', step);
      }
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
      stepFromUrl: searchParams?.get('step'),
    });
    router.back();
  };

  return {
    goToPreviousStep,
  };
}

