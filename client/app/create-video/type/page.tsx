'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/layout/ProgressBar';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { VideoType } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';

function VideoTypePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useAuth();
  const { showToast } = useToast();
  const projectIdFromUrl = searchParams.get('projectId');
  const [projectId, setProjectId] = useState<string | null>(projectIdFromUrl);
  const [selectedType, setSelectedType] = useState<VideoType | null>(null);

  // Reset state when projectId changes
  useEffect(() => {
    if (projectIdFromUrl && projectIdFromUrl !== projectId) {
      setSelectedType(null);
      setProjectId(projectIdFromUrl);
    }
  }, [projectIdFromUrl, projectId]);

  // Load project ONLY if projectId is in URL (editing existing project)
  useEffect(() => {
    const loadProject = async () => {
      if (!isAuthenticated || isLoading) return;
      // Only load if projectId is explicitly in URL (coming from projects page)
      if (!projectIdFromUrl) {
        // No projectId in URL - this is a new flow, reset state
        setSelectedType(null);
        setProjectId(null);
        return;
      }
      
      // Load project data if projectId exists in URL
      try {
        const response = await apiClient.getVideoProject(projectIdFromUrl);
        if (response.success && response.data) {
          const project = response.data;
          if (project.videoType) {
            const frontendType = project.videoType === 'WITH_AVATAR' ? 'with-avatar' : 'without-avatar';
            setSelectedType(frontendType);
          }
        }
      } catch (error: any) {
        console.error('Failed to load project:', error);
      }
    };

    loadProject();
  }, [isAuthenticated, isLoading, projectIdFromUrl]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      sessionStorage.setItem('pendingRedirect', `/create-video/type${projectId ? `?projectId=${projectId}` : ''}`);
      router.push(`/login?redirect=/create-video/type${projectId ? `&projectId=${projectId}` : ''}`);
    }
  }, [isAuthenticated, isLoading, router, projectId]);

  const handleTypeChange = async (type: VideoType) => {
    setSelectedType(type);
    const currentProjectId = projectIdFromUrl || projectId;
    if (currentProjectId) {
      try {
        await apiClient.updateVideoProject(currentProjectId, {
          videoType: type === 'with-avatar' ? 'WITH_AVATAR' : 'WITHOUT_AVATAR',
        });
      } catch (error: any) {
        console.error('Failed to save video type:', error);
      }
    }
  };

  const handleNext = async () => {
    if (!selectedType) return;

    const currentProjectId = projectIdFromUrl || projectId;

    // If no projectId exists, create a new project now
    if (!currentProjectId) {
      try {
        const createResponse = await apiClient.createVideoProject({
          videoType: selectedType === 'with-avatar' ? 'WITH_AVATAR' : 'WITHOUT_AVATAR',
          currentStep: selectedType === 'with-avatar' ? 'AVATAR_SELECTION' : 'SCRIPT',
        });
        
        if (createResponse.success && createResponse.data) {
          const newProjectId = createResponse.data.id;
          setProjectId(newProjectId);
          // Update URL with new projectId
          const nextUrl = selectedType === 'with-avatar'
            ? `/create-video/avatar?projectId=${newProjectId}`
            : `/create-video/script?projectId=${newProjectId}`;
          router.replace(nextUrl);
          return;
        } else {
          showToast('Failed to create project. Please try again.', 'error');
          return;
        }
      } catch (error: any) {
        console.error('Failed to create project:', error);
        showToast('Failed to create project. Please try again.', 'error');
        return;
      }
    }

    // Update existing project
    if (currentProjectId) {
      try {
        await apiClient.updateVideoProject(currentProjectId, {
          videoType: selectedType === 'with-avatar' ? 'WITH_AVATAR' : 'WITHOUT_AVATAR',
          currentStep: selectedType === 'with-avatar' ? 'AVATAR_SELECTION' : 'SCRIPT',
        });
      } catch (error: any) {
        // Show the actual error message
        const errorMessage = error.message || 'Failed to save progress';
        showToast(errorMessage, 'error');
        console.error('Failed to save video project:', error);
        
        // If 401, redirect to login
        if (error.response?.status === 401 || errorMessage.includes('Unauthorized') || errorMessage.includes('User ID')) {
          sessionStorage.setItem('pendingRedirect', `/create-video/type?projectId=${currentProjectId}`);
          router.push(`/login?redirect=/create-video/type&projectId=${currentProjectId}`);
          return;
        }
        // Don't prevent navigation on other errors - user can still proceed
      }
    }

    const nextUrl = selectedType === 'with-avatar'
      ? `/create-video/avatar${currentProjectId ? `?projectId=${currentProjectId}` : ''}`
      : `/create-video/script${currentProjectId ? `?projectId=${currentProjectId}` : ''}`;
    router.push(nextUrl);
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className={typography.body.large}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => router.back()}
            className="mb-6 flex items-center gap-2 text-text-primary hover:text-text-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back</span>
          </button>

          <h1 className={cn(typography.heading.h2, "mb-4")}>Video Type</h1>
          <p className={cn(typography.body.large, "mb-8")}>
            What type of video do you want to create?
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <Card
              selected={selectedType === 'with-avatar'}
              onClick={() => handleTypeChange('with-avatar')}
              className="p-6 cursor-pointer"
            >
              <h3 className={cn(typography.heading.h5, "mb-2")}>With avatar</h3>
              <p className={typography.body.small}>
                Create or choose from an AI Avatar to deliver your message.
              </p>
            </Card>

            <Card
              selected={selectedType === 'without-avatar'}
              onClick={() => handleTypeChange('without-avatar')}
              className="p-6 cursor-pointer"
            >
              <h3 className={cn(typography.heading.h5, "mb-2")}>Without avatar</h3>
              <p className={typography.body.small}>
                Create videos with text, voiceover and video clips only.
              </p>
            </Card>
          </div>
        </div>
      </div>

      <ProgressBar
        progress={40}
        message="Let's go, your journey begins here..."
        onNext={handleNext}
        disabled={!selectedType}
      />
    </div>
  );
}

export default function VideoTypePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <VideoTypePageContent />
    </Suspense>
  );
}

