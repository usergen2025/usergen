'use client';

import { useState, useEffect, useMemo, useTransition, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Play, Pause, Clock, CheckCircle, XCircle, Loader2, Edit, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { getStepToRouteMap } from '@/lib/config/video-steps';

interface VideoProject {
  id: string;
  title?: string;
  description?: string;
  videoType: string;
  style?: string;
  avatarId?: string;
  status: string;
  currentStep: string;
  progress: number;
  progressStage?: string;
  videoUrl?: string;
  videoPublicUrl?: string;
  videoGcsUrl?: string;
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  metadata?: {
    generationFlow?: string;
    aiChatStep?: string;
    [key: string]: any;
  };
}

export default function ProjectsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [activePreviewProjectId, setActivePreviewProjectId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'draft' | 'in-progress' | 'completed'>('all');
  const [isFilterPending, startFilterTransition] = useTransition();
  const [projectPendingDelete, setProjectPendingDelete] = useState<VideoProject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?redirect=/projects');
      return;
    }
  }, [isAuthenticated, authLoading, router]);

  const loadProjects = useCallback(async (opts?: { reset?: boolean; status?: 'all' | 'draft' | 'in-progress' | 'completed' }) => {
    const reset = opts?.reset ?? false;
    const status = opts?.status ?? filter;
    const cursor = reset ? null : nextCursor;
    if (!reset && (!hasMore || !cursor)) return;

    try {
      if (reset) {
        setLoading(true);
        setActivePreviewProjectId(null);
      } else {
        setLoadingMore(true);
      }

      const response = await apiClient.getVideoProjectsPaginated({
        limit: 20,
        cursor,
        status,
      });
      if (response.success && response.data) {
        const legacyArray = Array.isArray(response.data) ? response.data : null;
        const items = legacyArray || response.data.items || [];
        setProjects((prev) => (reset ? items : [...prev, ...items]));
        setNextCursor(legacyArray ? null : response.data.nextCursor ?? null);
        setHasMore(legacyArray ? false : Boolean(response.data.hasMore));
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to load projects', 'error');
    } finally {
      if (reset) {
        setLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, [filter, nextCursor, hasMore, showToast]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadProjects({ reset: true, status: filter });
  }, [isAuthenticated, filter, loadProjects]);

  useEffect(() => {
    if (loading || !hasMore) return;
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) {
          void loadProjects({ reset: false, status: filter });
        }
      },
      { rootMargin: '320px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, hasMore, loadingMore, loadProjects, filter]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        setActivePreviewProjectId(null);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />;
      case 'IN_PROGRESS':
        return <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />;
      case 'FAILED':
        return <XCircle className="w-4 h-4 text-red-600 shrink-0" />;
      case 'DRAFT':
        return <Clock className="w-4 h-4 text-gray-600 shrink-0" />;
      default:
        return <Clock className="w-4 h-4 text-gray-600 shrink-0" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'Completed';
      case 'IN_PROGRESS':
        return 'In Progress';
      case 'FAILED':
        return 'Failed';
      case 'DRAFT':
        return 'Draft';
      default:
        return status;
    }
  };

  // Helper function to get full video URL - prioritizes GCS URLs
  const getVideoUrl = (project: { videoPublicUrl?: string; videoGcsUrl?: string; videoUrl?: string }): string | undefined => {
    // Priority 1: Use videoPublicUrl (GCS URL if available, backend URL otherwise)
    if (project.videoPublicUrl && project.videoPublicUrl.startsWith('http')) {
      return project.videoPublicUrl;
    }
    
    // Priority 2: Direct GCS URL
    if (project.videoGcsUrl && project.videoGcsUrl.startsWith('http')) {
      return project.videoGcsUrl;
    }
    
    // Priority 3: Fallback to videoUrl
    if (!project.videoUrl) return undefined;
    
    // If already a full URL (starts with http), return as-is
    if (project.videoUrl.startsWith('http')) {
      return project.videoUrl;
    }
    
    // Otherwise, construct full URL using video-processing-service
    // Static files are served at /uploads/* (not /api/uploads/*)
    // Use NEXT_PUBLIC_WS_URL which is already set to the base domain (e.g., https://api.dev.usergen.ai)
    const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
    return `${VIDEO_SERVICE_BASE_URL}${project.videoUrl}`;
  };

  const getPreviewVideoUrl = (project: VideoProject): string | undefined => {
    const preview = project.metadata?.previewVideoUrl;
    if (typeof preview === 'string' && preview.length > 0) {
      if (preview.startsWith('http')) return preview;
      const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
      return `${VIDEO_SERVICE_BASE_URL}${preview}`;
    }
    return getVideoUrl(project);
  };

  const getStepText = (step: string) => {
    const stepMap: Record<string, string> = {
      STYLE_SELECTION: 'Style Selection',
      VIDEO_TYPE: 'Video Type',
      AVATAR_SELECTION: 'Avatar Selection',
      SCRIPT: 'Script',
      VOICE: 'Voice',
      B_ROLL: 'B-Roll',
      CAPTIONS: 'Captions',
      RENDERING: 'Rendering',
      COMPLETED: 'Completed',
    };
    return stepMap[step] || step;
  };

  const handleContinue = (project: VideoProject) => {
    // Check if this is an AI chat flow project
    if (project.metadata?.generationFlow === 'AI_CHAT') {
      // Route to AI chat page
      router.push(`/create-video/ai-chat?projectId=${project.id}`);
      return;
    }
    
    // Old flow - use existing step mapping
    const stepToRouteMap = getStepToRouteMap();
    
    // Get route from step config, fallback to /create-video if step not found
    const route = stepToRouteMap[project.currentStep] || '/create-video';
    
    // Include step in URL query params for additional reliability
    // This helps the navigation hook determine the step even if pathname hasn't updated
    router.push(`${route}?projectId=${project.id}&step=${project.currentStep}`);
  };

  const handleViewWorkspace = (projectId: string) => {
    router.push(`/create-video/workspace?projectId=${projectId}`);
  };

  const handleDelete = async (projectId: string) => {
    try {
      setIsDeleting(true);
      await apiClient.deleteVideoProject(projectId);
      showToast('Project deleted successfully', 'success');
      setProjectPendingDelete(null);
      loadProjects();
    } catch (error: any) {
      showToast(error.message || 'Failed to delete project', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredProjects = useMemo(() => projects, [projects]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-6xl mx-auto px-4 pt-8 md:pt-12">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-row items-center gap-4">
              <button
                onClick={() => router.back()}
                className="flex items-center justify-center w-6 h-6 cursor-pointer hover:opacity-80 transition-opacity"
                aria-label="Back"
              >
                <ArrowLeft className="w-full h-full text-[#212121]" strokeWidth={1.5} />
              </button>
              <h1 className="font-heading text-2xl font-medium text-[#212121]">My Projects</h1>
            </div>
            <Link href="/create-video/ai-chat" className="shrink-0">
              <Button variant="primary" size="sm" className="!px-4 !py-2 text-sm shadow-button">
                <Plus className="w-4 h-4 mr-1.5" />
                New Project
              </Button>
            </Link>
          </div>

          {/* Filters */}
          <div className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-white/85 p-1.5 shadow-sm ring-1 ring-[#F0E6DF]">
            {(['all', 'draft', 'in-progress', 'completed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  if (f === filter) return;
                  startFilterTransition(() => setFilter(f));
                }}
                className={cn(
                  'px-3 py-1.5 text-xs sm:text-sm rounded-full transition-all duration-150 will-change-transform',
                  filter === f
                    ? 'gradient-primary text-white shadow-sm'
                    : 'text-[#574977] hover:bg-[#F8EFE9]'
                )}
              >
                {f.charAt(0).toUpperCase() + f.slice(1).replace('-', ' ')}
              </button>
            ))}
          </div>

          {/* Projects Grid */}
          {filteredProjects.length === 0 ? (
            <Card className="p-8 sm:p-12 text-center bg-white/95">
              <p className={cn(typography.body.medium, "text-text-secondary mb-4")}>
                {filter === 'all'
                  ? 'No projects yet. Create your first video project!'
                  : `No ${filter} projects found.`}
              </p>
              <Link href="/create-video/ai-chat">
                <Button variant="primary">
                  <Plus className="w-4 h-4 mr-2" />
                  Create New Project
                </Button>
              </Link>
            </Card>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {filteredProjects.map((project, index) => {
                const isCompleted = project.status === 'COMPLETED' && Boolean(getVideoUrl(project));
                const isPreviewing = activePreviewProjectId === project.id;
                const previewUrl = getPreviewVideoUrl(project);
                return (
                <Card
                  key={project.id}
                  className="project-card-enter w-full max-w-[260px] mx-auto p-3 sm:p-3.5 rounded-2xl bg-white/95 border border-[#F0E6DF] shadow-sm hover:shadow-card hover:-translate-y-0.5 transition-all duration-200"
                  style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
                >
                  {/* Thumbnail — 9:16 to match generated vertical video */}
                  {isCompleted ? (
                    <div className="mb-2.5 mx-auto w-full aspect-[9/16] rounded-xl overflow-hidden bg-gray-200 relative group">
                      {isPreviewing && previewUrl ? (
                        <video
                          src={previewUrl}
                          className="w-full h-full object-cover"
                          controls
                          autoPlay
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <>
                          {project.thumbnailUrl ? (
                            <img
                              src={project.thumbnailUrl}
                              alt={project.title || 'Project thumbnail'}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Play className="w-8 h-8 text-gray-400" />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => setActivePreviewProjectId(project.id)}
                            className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors"
                            aria-label="Play preview"
                          >
                            <span className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-2 rounded-full bg-background/90">
                              <Play className="w-5 h-5 text-primary" fill="currentColor" />
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                  ) : project.thumbnailUrl ? (
                    <div className="mb-2.5 mx-auto w-full aspect-[9/16] rounded-xl overflow-hidden bg-gray-200">
                      <img
                        src={project.thumbnailUrl}
                        alt={project.title || 'Project thumbnail'}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div className="mb-2.5 mx-auto w-full aspect-[9/16] rounded-xl bg-gray-200 flex items-center justify-center">
                      <Play className="w-8 h-8 text-gray-400" />
                    </div>
                  )}

                  {/* Project Info */}
                  <div className="mb-2.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-heading text-sm sm:text-base font-medium leading-snug line-clamp-1 text-[#212121]">
                        {project.title || `Project ${project.id.slice(0, 8)}`}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#F9F4EF] text-[#574977] whitespace-nowrap">
                        {getStatusIcon(project.status)}
                        {getStatusText(project.status)}
                      </span>
                    </div>
                    <p className={cn(typography.body.small, "text-text-secondary mb-1 line-clamp-1 text-xs")}>
                      {project.description || 'No description'}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-secondary">
                      {project.status === 'IN_PROGRESS' && (
                        <span>Step: {getStepText(project.currentStep)}</span>
                      )}
                    </div>
                    {project.progress > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-text-secondary">Progress</span>
                          <span className="text-text-secondary">{project.progress}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full transition-all"
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    {isCompleted ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setActivePreviewProjectId((prev) =>
                              prev === project.id ? null : project.id
                            )
                          }
                          className="!px-2.5 !py-2 !text-xs sm:!text-sm min-h-0"
                        >
                          {isPreviewing ? (
                            <>
                              <Pause className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                              Pause
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                              Play
                            </>
                          )}
                        </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleViewWorkspace(project.id)}
                        className="flex-1 !px-3 !py-2 !text-xs sm:!text-sm min-h-0"
                      >
                        View
                      </Button>
                      </>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleContinue(project)}
                        className="flex-1 !px-3 !py-2 !text-xs sm:!text-sm min-h-0"
                      >
                        <Edit className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                        Continue
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => setProjectPendingDelete(project)}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-full border border-[#E7D9CF] text-[#8B6C5C] hover:text-[#E03A3A] hover:border-[#E03A3A] hover:bg-[#FFF4F4] transition-colors"
                      aria-label="Delete project"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Timestamp */}
                  <p className={cn(typography.body.small, "text-text-muted mt-2 text-center text-[11px]")}>
                    {project.status === 'COMPLETED' && project.completedAt
                      ? `Completed ${new Date(project.completedAt).toLocaleDateString()}`
                      : `Updated ${new Date(project.updatedAt).toLocaleDateString()}`}
                  </p>
                </Card>
              )})}
            </div>
          )}

          {(loadingMore || hasMore) && (
            <div ref={loadMoreRef} className="h-12 flex items-center justify-center mt-6">
              {loadingMore && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
            </div>
          )}

          {isFilterPending && (
            <div className="text-xs text-[#7A6A60] mt-3">Updating filter...</div>
          )}
        </div>
      </div>
      <ConfirmModal
        isOpen={Boolean(projectPendingDelete)}
        onClose={() => !isDeleting && setProjectPendingDelete(null)}
        onConfirm={() => {
          if (!projectPendingDelete) return;
          return handleDelete(projectPendingDelete.id);
        }}
        title="Delete project?"
        description={`This will permanently remove "${projectPendingDelete?.title || `Project ${projectPendingDelete?.id?.slice(0, 8)}`}" and its generated assets.`}
        confirmLabel="Delete project"
        cancelLabel="Keep project"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}

