import { useRouter } from 'next/navigation';
import { getPreviousRoute } from '@/lib/config/video-steps';

/**
 * Hook for video step navigation
 * Provides helper functions for navigating between video creation steps
 */
export function useVideoStepNavigation(projectId: string | null, currentStep?: string) {
  const router = useRouter();

  /**
   * Navigate to the previous step in the flow
   * Falls back to router.back() if step config is not available
   */
  const goToPreviousStep = () => {
    if (!projectId) {
      router.back();
      return;
    }

    if (currentStep) {
      const previousRoute = getPreviousRoute(currentStep);
      if (previousRoute) {
        router.push(`${previousRoute}?projectId=${projectId}`);
        return;
      }
    }

    // Fallback to browser back
    router.back();
  };

  return {
    goToPreviousStep,
  };
}

