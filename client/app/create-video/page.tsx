'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api/client';
import { getStepToRouteMap } from '@/lib/config/video-steps';

function CreateVideoPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useAuth();
  const projectId = searchParams?.get('projectId') ?? null;
  const [checking, setChecking] = useState(true);

  // Check if we have a project and redirect based on currentStep
  useEffect(() => {
    const checkProjectAndRedirect = async () => {
      if (isLoading) return;

      if (!isAuthenticated) {
        // AuthGuard shows LoginModal overlay; set redirect for after login
        sessionStorage.setItem('pendingRedirect', '/create-video/style');
        return;
      }

      // If projectId is provided, check project metadata and currentStep and redirect accordingly
      if (projectId) {
        try {
          const response = await apiClient.getVideoProject(projectId);
          if (response.success && response.data) {
            const project = response.data;
            const currentStep = project.currentStep as string | undefined;
            const generationFlow = project.metadata?.generationFlow as string | undefined;
            const aiChatStep = project.metadata?.aiChatStep as string | undefined;

            // If this is an AI Chat project, always route back into the AI Chat experience
            if (generationFlow === 'AI_CHAT') {
              // Prefer workspace when the AI chat step indicates workspace or beyond
              if (aiChatStep === 'workspace') {
                router.replace(`/create-video/workspace?projectId=${projectId}`);
              } else {
                router.replace(`/create-video/ai-chat?projectId=${projectId}`);
              }
              return;
            }

            // Classic projects: fall back to step-based routing
            if (currentStep) {
              const stepToPageMap = getStepToRouteMap();
              const targetPage = stepToPageMap[currentStep];
              if (targetPage) {
                router.replace(`${targetPage}?projectId=${projectId}&step=${currentStep}`);
                return;
              }
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
    <div className="min-h-dvh bg-background flex items-center justify-center">
      <div className="text-center">
        <p className="text-text-primary">Loading...</p>
      </div>
    </div>
  );
}

export default function CreateVideoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <CreateVideoPageContent />
    </Suspense>
  );
}
