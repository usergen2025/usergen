'use client';

import { useState, useEffect, useMemo, useTransition, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Play, Pause, Clock, CheckCircle, XCircle, Edit, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { BrandPageHeader } from '@/components/brand';
import { getStepToRouteMap } from '@/lib/config/video-steps';
import { getPreviewPlaybackUrl, isPreviewReady } from '@/lib/video-urls';

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

const SKELETON_INITIAL_COUNT = 8;
const SKELETON_MORE_COUNT = 4;

function ProjectCardSkeleton({ index }: { index: number }) {
  return (
    <div
      className="w-full max-w-[212px] mx-auto p-2.5 sm:p-3 rounded-2xl border border-[#F0E6DF] shadow-sm overflow-hidden project-skeleton-shimmer"
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <div className="mb-2.5 mx-auto w-full aspect-[9/16] rounded-xl bg-white/50" />
      <div className="mb-2.5 space-y-2">
        <div className="h-4 rounded-md w-[80%] bg-white/55" />
        <div className="h-3 rounded-md w-full bg-white/50" />
        <div className="h-3 rounded-md w-2/3 bg-white/50" />
      </div>
      <div className="flex gap-1.5 mt-2">
        <div className="h-8 flex-1 rounded-lg bg-white/55" />
        <div className="h-8 w-8 rounded-full bg-white/50 shrink-0" />
      </div>
      <div className="mt-2 h-3 w-1/2 mx-auto rounded bg-white/50" />
    </div>
  );
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
  const previewVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [playingPreviewProjectId, setPlayingPreviewProjectId] = useState<string | null>(null);
  const filterRef = useRef(filter);
  const nextCursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const loadingMoreGuardRef = useRef(false);
  const fetchNextPageRef = useRef<() => Promise<void>>(async () => {});

  filterRef.current = filter;

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?redirect=/projects');
      return;
    }
  }, [isAuthenticated, authLoading, router]);

  const maybeFetchMoreIfSentinelVisible = useCallback(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMoreRef.current || loadingMoreGuardRef.current) return;
    const rect = el.getBoundingClientRect();
    const rootMargin = 320;
    if (rect.top < window.innerHeight + rootMargin) {
      void fetchNextPageRef.current();
    }
  }, []);

  const fetchFirstPage = useCallback(
    async (status: 'all' | 'draft' | 'in-progress' | 'completed') => {
      setLoading(true);
      setProjects([]);
      setActivePreviewProjectId(null);
      try {
        const response = await apiClient.getVideoProjectsPaginated({
          limit: 20,
          cursor: null,
          status,
        });
        if (response.success && response.data) {
          const legacyArray = Array.isArray(response.data) ? response.data : null;
          const items = legacyArray || response.data.items || [];
          setProjects(items);
          const nc = legacyArray ? null : response.data.nextCursor ?? null;
          const hm = legacyArray ? false : Boolean(response.data.hasMore);
          setNextCursor(nc);
          setHasMore(hm);
          nextCursorRef.current = nc;
          hasMoreRef.current = hm;
        }
      } catch (error: any) {
        showToast(error.message || 'Failed to load projects', 'error');
      } finally {
        setLoading(false);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => maybeFetchMoreIfSentinelVisible());
        });
      }
    },
    [showToast, maybeFetchMoreIfSentinelVisible]
  );

  const fetchNextPage = useCallback(async () => {
    if (loadingMoreGuardRef.current) return;
    const cursor = nextCursorRef.current;
    if (!hasMoreRef.current || !cursor) return;
    loadingMoreGuardRef.current = true;
    setLoadingMore(true);
    try {
      const response = await apiClient.getVideoProjectsPaginated({
        limit: 20,
        cursor,
        status: filterRef.current,
      });
      if (response.success && response.data) {
        const legacyArray = Array.isArray(response.data) ? response.data : null;
        const items = legacyArray || response.data.items || [];
        setProjects((prev) => [...prev, ...items]);
        const nc = legacyArray ? null : response.data.nextCursor ?? null;
        const hm = legacyArray ? false : Boolean(response.data.hasMore);
        setNextCursor(nc);
        setHasMore(hm);
        nextCursorRef.current = nc;
        hasMoreRef.current = hm;
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to load projects', 'error');
    } finally {
      loadingMoreGuardRef.current = false;
      setLoadingMore(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => maybeFetchMoreIfSentinelVisible());
      });
    }
  }, [showToast, maybeFetchMoreIfSentinelVisible]);

  useEffect(() => {
    fetchNextPageRef.current = fetchNextPage;
  }, [fetchNextPage]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void fetchFirstPage(filter);
  }, [isAuthenticated, filter, fetchFirstPage]);

  useEffect(() => {
    if (!isAuthenticated || loading || !hasMore) return;
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMoreGuardRef.current) {
          void fetchNextPageRef.current();
        }
      },
      { rootMargin: '320px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isAuthenticated, loading, hasMore, loadingMore, filter]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        setActivePreviewProjectId(null);
        setPlayingPreviewProjectId(null);
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
        return <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse shrink-0" aria-hidden />;
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
    if (!isPreviewReady(project)) {
      return undefined;
    }
    const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
    return getPreviewPlaybackUrl(project, VIDEO_SERVICE_BASE_URL) || undefined;
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

  const handleTogglePreview = (projectId: string) => {
    const videoEl = previewVideoRefs.current[projectId];
    const isActive = activePreviewProjectId === projectId;
    const isPlaying = playingPreviewProjectId === projectId;

    if (!isActive) {
      // Ensure only one preview can play at a time.
      if (playingPreviewProjectId && playingPreviewProjectId !== projectId) {
        const current = previewVideoRefs.current[playingPreviewProjectId];
        current?.pause();
      }
      setActivePreviewProjectId(projectId);
      setPlayingPreviewProjectId(null);
      return;
    }

    if (!videoEl) {
      return;
    }

    if (isPlaying) {
      videoEl.pause();
      setPlayingPreviewProjectId(null);
      return;
    }

    // Ensure only one preview can play at a time.
    if (playingPreviewProjectId && playingPreviewProjectId !== projectId) {
      const current = previewVideoRefs.current[playingPreviewProjectId];
      current?.pause();
    }

    void videoEl.play().catch(() => {
      setPlayingPreviewProjectId(null);
    });
  };

  const handleDelete = async (projectId: string) => {
    try {
      setIsDeleting(true);
      await apiClient.deleteVideoProject(projectId);
      showToast('Project deleted successfully', 'success');
      setProjectPendingDelete(null);
      await fetchFirstPage(filterRef.current);
    } catch (error: any) {
      showToast(error.message || 'Failed to delete project', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredProjects = useMemo(() => projects, [projects]);

  if (authLoading) {
    return (
      <div className="min-h-dvh pb-16">
        <div className="brand-page-shell">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="h-8 w-40 rounded-lg project-skeleton-shimmer" />
            <div className="h-9 w-32 rounded-full project-skeleton-shimmer" />
          </div>
          <div className="mb-6 inline-flex items-center gap-1 rounded-full bg-white/85 p-1 shadow-sm ring-1 ring-[#F0E6DF]">
            <div className="h-6 w-12 rounded-full project-skeleton-shimmer" />
            <div className="h-6 w-12 rounded-full project-skeleton-shimmer" />
            <div className="h-6 w-16 rounded-full project-skeleton-shimmer" />
            <div className="h-6 w-16 rounded-full project-skeleton-shimmer" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {Array.from({ length: SKELETON_INITIAL_COUNT }).map((_, i) => (
              <ProjectCardSkeleton key={`auth-sk-${i}`} index={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-dvh pb-16">
      <div className="brand-page-shell">
        <div className="max-w-[1248px] mx-auto">
          {loading && filteredProjects.length === 0 ? (
            <>
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="h-8 w-40 rounded-lg project-skeleton-shimmer" />
                <div className="h-9 w-32 rounded-full project-skeleton-shimmer" />
              </div>
              <div className="mb-6 inline-flex items-center gap-1 rounded-full bg-white/85 p-1 shadow-sm ring-1 ring-[#F0E6DF]">
                <div className="h-6 w-12 rounded-full project-skeleton-shimmer" />
                <div className="h-6 w-12 rounded-full project-skeleton-shimmer" />
                <div className="h-6 w-16 rounded-full project-skeleton-shimmer" />
                <div className="h-6 w-16 rounded-full project-skeleton-shimmer" />
              </div>
            </>
          ) : (
            <>
              <BrandPageHeader
                onBack={() => router.back()}
                className="mb-4 shrink-0"
                title="My Projects"
                subtitle="Every video you've started, in one place."
                right={
                  <Link href="/create-video/ai-chat" className="shrink-0">
                    <button type="button" className="brand-campaign-cta w-full min-w-0 sm:w-auto">
                      <Plus className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden />
                      <span className="whitespace-nowrap text-[clamp(12px,1.37vh,14px)] leading-[1]">
                        New Project
                      </span>
                    </button>
                  </Link>
                }
              />

              {/* Filters */}
              <div className="mb-6 inline-flex items-center gap-1 rounded-full bg-white/85 p-1 shadow-sm ring-1 ring-[#F0E6DF]">
                {(['all', 'draft', 'in-progress', 'completed'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      if (f === filter) return;
                      startFilterTransition(() => setFilter(f));
                    }}
                    className={cn(
                      'px-2.5 py-1 text-[11px] sm:text-xs rounded-full transition-all duration-150 will-change-transform',
                      filter === f
                        ? 'gradient-primary text-white shadow-sm'
                        : 'text-[#574977] hover:bg-[#F8EFE9]'
                    )}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1).replace('-', ' ')}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Projects Grid */}
          {loading && filteredProjects.length === 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {Array.from({ length: SKELETON_INITIAL_COUNT }).map((_, i) => (
                <ProjectCardSkeleton key={`init-sk-${i}`} index={i} />
              ))}
            </div>
          ) : filteredProjects.length === 0 ? (
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {filteredProjects.map((project, index) => {
                const isCompleted = project.status === 'COMPLETED' && Boolean(getVideoUrl(project));
                const isPreviewing = activePreviewProjectId === project.id;
                const previewUrl = getPreviewVideoUrl(project);
                const isPreviewPlaying = playingPreviewProjectId === project.id;
                return (
                <Card
                  key={project.id}
                  className="project-card-enter w-full max-w-[212px] mx-auto p-2.5 sm:p-3 rounded-2xl bg-white/95 border border-[#F0E6DF] shadow-sm hover:shadow-card hover:-translate-y-0.5 transition-all duration-200"
                  style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
                >
                  {/* Thumbnail — 9:16 to match generated vertical video */}
                  {isCompleted ? (
                    <div className="mb-2.5 mx-auto w-full aspect-[9/16] rounded-xl overflow-hidden bg-gray-200 relative group">
                      {previewUrl && (isPreviewing || !project.thumbnailUrl) ? (
                        <video
                          src={previewUrl}
                          ref={(el) => {
                            previewVideoRefs.current[project.id] = el;
                          }}
                          className="w-full h-full object-cover"
                          autoPlay={isPreviewing}
                          playsInline
                          controlsList="nodownload noremoteplayback"
                          disablePictureInPicture
                          preload="metadata"
                          onPlay={() => {
                            // If another preview is currently playing, pause it.
                            if (playingPreviewProjectId && playingPreviewProjectId !== project.id) {
                              const current = previewVideoRefs.current[playingPreviewProjectId];
                              current?.pause();
                            }
                            setPlayingPreviewProjectId(project.id);
                          }}
                          onPause={() => {
                            setPlayingPreviewProjectId(null);
                          }}
                          onEnded={() => {
                            setPlayingPreviewProjectId(null);
                            setActivePreviewProjectId(null);
                          }}
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
                        </>
                      )}
                      {previewUrl && (
                        <button
                          type="button"
                          onClick={() => handleTogglePreview(project.id)}
                          className={cn(
                            "absolute inset-0 flex items-center justify-center transition-colors",
                            isPreviewPlaying ? "bg-black/10 hover:bg-black/20" : "bg-black/0 hover:bg-black/20"
                          )}
                          aria-label={isPreviewPlaying ? 'Pause preview' : 'Play preview'}
                        >
                          <span className={cn(
                            "p-2 rounded-full bg-background/90 transition-opacity",
                            isPreviewPlaying
                              ? "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                              : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          )}>
                            {isPreviewPlaying ? (
                              <Pause className="w-5 h-5 text-primary" fill="currentColor" />
                            ) : (
                              <Play className="w-5 h-5 text-primary" fill="currentColor" />
                            )}
                          </span>
                        </button>
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
                      className="inline-flex items-center justify-center h-8 w-8 max-sm:h-10 max-sm:w-10 rounded-full border border-[#E7D9CF] text-[#8B6C5C] hover:text-[#E03A3A] hover:border-[#E03A3A] hover:bg-[#FFF4F4] transition-colors"
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

          {hasMore && (
            <div ref={loadMoreRef} className="mt-6 min-h-[120px]">
              {loadingMore && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {Array.from({ length: SKELETON_MORE_COUNT }).map((_, i) => (
                    <ProjectCardSkeleton key={`append-sk-${i}`} index={i} />
                  ))}
                </div>
              )}
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

