'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { getRenderingRollbackRoute, getStepRoute } from '@/lib/config/video-steps';

function RenderingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const projectId = searchParams?.get('projectId') ?? null;
  
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string>('pending');
  const [stageLabel, setStageLabel] = useState<string>('Starting rendering...');
  const [renderingStarted, setRenderingStarted] = useState(false);

  const funFacts = [
    "Adding a smile in your script makes your avatar more engaging.",
    "Shorter videos tend to perform better on social media.",
    "Good lighting can make your avatar look more professional.",
  ];

  const stageLabels: Record<string, string> = {
    'pending': 'Starting rendering...',
    'stitching_audio': 'Preparing audio files...',
    'stitching_broll': 'Preparing B-roll videos...',
    'avatar_generating': 'Creating avatar video...',
    'stitching': 'Stitching everything together...',
    'overlaying': 'Overlaying avatar on video...',
    'completed': 'Video rendering completed!',
    'failed': 'Video rendering failed',
  };

  // Start rendering when component mounts
  useEffect(() => {
    if (authLoading) return;
    
    if (!isAuthenticated) {
      sessionStorage.setItem('pendingRedirect', '/create-video/rendering');
      return;
    }

    if (!projectId) {
      showToast('Project ID missing. Please try again.', 'error');
      router.push('/create-video/voice');
      return;
    }

    // Start rendering if not already started
    if (!renderingStarted) {
      startRendering();
    }
  }, [projectId, isAuthenticated, authLoading, renderingStarted]);

  // Poll rendering status every 2 seconds
  useEffect(() => {
    if (!projectId || !renderingStarted) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await apiClient.getRenderingStatus(projectId);
        
        if (response.success && response.data) {
          const { renderingStatus, renderingProgress, status, videoUrl, errorMessage } = response.data;
          
          setProgress(renderingProgress || 0);
          setStage(renderingStatus || 'pending');
          setStageLabel(stageLabels[renderingStatus || 'pending'] || 'Processing...');

          // If rendering failed, redirect to appropriate step - check multiple sources
          if (status === 'FAILED' || renderingStatus === 'failed') {
            clearInterval(pollInterval);
            showToast(errorMessage || 'Video rendering failed. Please try again.', 'error');
            
            // Determine redirect page using step configuration
            // Default to step before RENDERING (BROLL_VIDEOS)
            let redirectPath = getRenderingRollbackRoute();
            
            // Refine based on project state or metadata
            const currentStep = response.data.currentStep;
            const metadata = response.data.metadata;
            const bRollVideos = response.data.bRollVideoTasks;
            const bRollImages = response.data.bRollImages;
            
            // Check currentStep first
            if (currentStep === 'BROLL_VIDEOS' || currentStep === 'B_ROLL') {
              redirectPath = `/create-video/broll-videos?projectId=${projectId}`;
            } else if (currentStep === 'BROLL_IMAGES') {
              redirectPath = `/create-video/broll-images?projectId=${projectId}`;
            } else if (metadata?.rollbackStep) {
              // Check metadata for rollback step (if enum update failed)
              const rollbackRoute = getStepRoute(metadata.rollbackStep);
              if (rollbackRoute) {
                redirectPath = `${rollbackRoute}?projectId=${projectId}`;
              }
            } else if (bRollVideos && Array.isArray(bRollVideos) && bRollVideos.length > 0) {
              // Check project state as fallback
              redirectPath = `/create-video/broll-videos?projectId=${projectId}`;
            } else if (bRollImages && Array.isArray(bRollImages) && bRollImages.length > 0) {
              redirectPath = `/create-video/broll-images?projectId=${projectId}`;
            } else {
              // Use default from step config
              redirectPath = `${getRenderingRollbackRoute()}?projectId=${projectId}`;
            }
            
            setTimeout(() => {
              router.push(redirectPath);
            }, 2000);
            return;
          }

          // If rendering completed, navigate to preview
          if (status === 'COMPLETED' || renderingStatus === 'completed') {
            clearInterval(pollInterval);
            setProgress(100);
            setStage('completed');
            setStageLabel('Video rendering completed!');
            setTimeout(() => {
              router.push(`/create-video/preview?projectId=${projectId}`);
            }, 1500);
            return;
          }
        }
      } catch (error: any) {
        console.error('Failed to poll rendering status:', error);
        // Don't stop polling on transient errors
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [projectId, renderingStarted]);

  const startRendering = async () => {
    if (!projectId) return;

    try {
      setRenderingStarted(true);
      setProgress(0);
      setStage('pending');
      setStageLabel('Starting rendering...');

      const response = await apiClient.startVideoRendering(projectId);
      
      if (!response.success) {
        throw new Error(response.message || 'Failed to start rendering');
      }

      console.log('Rendering started successfully');
    } catch (error: any) {
      console.error('Failed to start rendering:', error);
      showToast(error.response?.data?.message || error.message || 'Failed to start rendering. Please try again.', 'error');
      
      // Redirect to previous step (BROLL_VIDEOS) using step configuration
      const rollbackRoute = getRenderingRollbackRoute();
      setTimeout(() => {
        router.push(`${rollbackRoute}?projectId=${projectId}`);
      }, 2000);
    }
  };

  // Simplified stages - only show what happens during rendering
  const stages = [
    { id: 'stitching_audio', label: 'Preparing audio', active: stage === 'stitching_audio' },
    { id: 'stitching_broll', label: 'Preparing videos', active: stage === 'stitching_broll' },
    { id: 'avatar_generating', label: 'Creating avatar', active: stage === 'avatar_generating' },
    { id: 'stitching', label: 'Stitching together', active: stage === 'stitching' || stage === 'overlaying' },
  ];

  // Show loading state if auth is still loading
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className={cn(typography.body.base, "text-text-secondary")}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-2xl w-full text-center space-y-8">
        {/* Fun Facts */}
        <div>
          <h2 className={cn(typography.heading.h4, "mb-4")}>Fun facts</h2>
          <p className={cn(typography.body.base, "text-text-secondary")}>
            {funFacts[Math.floor(Math.random() * funFacts.length)]}
          </p>
        </div>

        {/* Rendering Progress */}
        <div>
          <h2 className={cn(typography.heading.h3, "mb-6")}>Rendering</h2>
          <div className="w-full bg-primary-light rounded-full h-2 mb-4">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          
          {/* Stage label */}
          <div className="mb-4">
            <p className={cn(typography.body.base, "text-text-secondary")}>
              {stageLabel}
            </p>
          </div>
          
          {/* Stage indicators */}
          <div className="flex justify-between text-sm">
            {stages.map((s) => (
              <div
                key={s.id}
                className={cn(
                  'flex-1 px-2',
                  s.active ? 'text-primary font-medium' : 'text-text-muted'
                )}
              >
                {s.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RenderingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <RenderingPageContent />
    </Suspense>
  );
}
