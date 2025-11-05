'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api/client';

function CreateVideoPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useAuth();
  const projectId = searchParams.get('projectId');
  const [checking, setChecking] = useState(true);

  // Check if we have a project and redirect based on currentStep
  useEffect(() => {
    const checkProjectAndRedirect = async () => {
      if (isLoading) return;

      if (!isAuthenticated) {
        // Not authenticated, redirect to login with return URL
        sessionStorage.setItem('pendingRedirect', '/create-video/style');
        router.replace('/login?redirect=/create-video/style');
        return;
      }

      // If projectId is provided, check currentStep and redirect accordingly
      if (projectId) {
        try {
          const response = await apiClient.getVideoProject(projectId);
          if (response.success && response.data?.currentStep) {
            const currentStep = response.data.currentStep;
            
            // Map currentStep to corresponding page
            const stepToPageMap: Record<string, string> = {
              'STYLE_SELECTION': '/create-video/style',
              'VIDEO_TYPE': '/create-video/type',
              'AVATAR_SELECTION': '/create-video/avatar',
              'SCRIPT': '/create-video/script',
              'VOICE': '/create-video/voice',
              'BROLL_IMAGES': '/create-video/broll-images',
              'BROLL_VIDEOS': '/create-video/broll-videos',
              'PREVIEW': '/create-video/preview',
              'RENDERING': '/create-video/rendering',
            };

            const targetPage = stepToPageMap[currentStep];
            if (targetPage) {
              router.replace(`${targetPage}?projectId=${projectId}`);
              return;
            }
          }
        } catch (error) {
          console.error('Failed to load project:', error);
          // If project load fails, just go to style page
        }
      }

      // Default: redirect to style page
      router.replace('/create-video/style');
      setChecking(false);
    };

    checkProjectAndRedirect();
  }, [isAuthenticated, isLoading, router, projectId]);

  // Show loading state while redirecting
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <p className="text-text-primary">Loading...</p>
      </div>
    </div>
  );
}

export default function CreateVideoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <CreateVideoPageContent />
    </Suspense>
  );
}
