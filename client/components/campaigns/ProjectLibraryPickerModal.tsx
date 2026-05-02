'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { BrandPrimaryButton, BrandSecondaryButton } from '@/components/brand';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { cn } from '@/lib/utils/cn';
import { Play, Pause } from 'lucide-react';

const SKELETON_INITIAL = 8;
const SKELETON_MORE = 4;

interface VideoProjectRow {
  id: string;
  title?: string;
  projectName?: string;
  status?: string;
  thumbnailUrl?: string;
  metadata?: { previewVideoUrl?: string; [k: string]: unknown };
  videoPublicUrl?: string;
  videoGcsUrl?: string;
  finalVideoUrl?: string;
  renderedVideoUrl?: string;
  videoUrl?: string;
}

function ProjectCardSkeleton({ index }: { index: number }) {
  return (
    <div
      className="project-skeleton-shimmer w-full max-w-[212px] mx-auto overflow-hidden rounded-2xl border border-[#F0E6DF] p-2.5 shadow-sm sm:p-3"
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <div className="mx-auto mb-2.5 aspect-[9/16] w-full rounded-xl bg-white/50" />
      <div className="mb-2 space-y-2">
        <div className="h-4 w-[80%] rounded-md bg-white/55" />
        <div className="h-3 w-full rounded-md bg-white/50" />
      </div>
    </div>
  );
}

function resolvePreviewUrl(project: VideoProjectRow): string | undefined {
  const preview = project.metadata?.previewVideoUrl;
  if (typeof preview === 'string' && preview.length) {
    if (preview.startsWith('http')) return preview;
    const base = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
    return `${base}${preview.startsWith('/') ? '' : '/'}${preview}`;
  }
  const direct =
    project.videoPublicUrl ||
    project.videoGcsUrl ||
    project.finalVideoUrl ||
    project.renderedVideoUrl ||
    project.videoUrl;
  if (!direct) return undefined;
  if (direct.startsWith('http')) return direct;
  const base = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
  return `${base}${direct.startsWith('/') ? '' : '/'}${direct}`;
}

export interface ProjectLibraryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  /** If true, skip processing - just return projectId and title for deferred processing */
  deferProcessing?: boolean;
  /** Called after backend copies & watermarks the project video (or immediately if deferProcessing is true) */
  onAssetReady: (assetId: string, meta: { projectId: string; title: string }) => void;
  /** Called when user selects a project (only when deferProcessing is true) */
  onProjectSelected?: (projectId: string, meta: { title: string }) => void;
}

export function ProjectLibraryPickerModal({
  isOpen,
  onClose,
  campaignId,
  deferProcessing,
  onAssetReady,
  onProjectSelected,
}: ProjectLibraryPickerModalProps) {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<VideoProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const previewRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const nextCursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const loadingGuardRef = useRef(false);

  const fetchFirstPage = useCallback(async () => {
    setLoading(true);
    setProjects([]);
    setSelectedId(null);
    setPlayingId(null);
    try {
      const response = await apiClient.getVideoProjectsPaginated({
        limit: 20,
        cursor: null,
        status: 'completed',
      });
      if (response.success && response.data) {
        const legacyArray = Array.isArray(response.data) ? response.data : null;
        const items = (legacyArray || response.data.items || []) as VideoProjectRow[];
        setProjects(items);
        const nc = legacyArray ? null : response.data.nextCursor ?? null;
        const hm = legacyArray ? false : Boolean(response.data.hasMore);
        setNextCursor(nc);
        setHasMore(hm);
        nextCursorRef.current = nc;
        hasMoreRef.current = hm;
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load projects', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const fetchNextPage = useCallback(async () => {
    if (loadingGuardRef.current) return;
    const cursor = nextCursorRef.current;
    if (!hasMoreRef.current || !cursor) return;
    loadingGuardRef.current = true;
    setLoadingMore(true);
    try {
      const response = await apiClient.getVideoProjectsPaginated({
        limit: 20,
        cursor,
        status: 'completed',
      });
      if (response.success && response.data) {
        const legacyArray = Array.isArray(response.data) ? response.data : null;
        const items = (legacyArray || response.data.items || []) as VideoProjectRow[];
        setProjects((prev) => [...prev, ...items]);
        const nc = legacyArray ? null : response.data.nextCursor ?? null;
        const hm = legacyArray ? false : Boolean(response.data.hasMore);
        setNextCursor(nc);
        setHasMore(hm);
        nextCursorRef.current = nc;
        hasMoreRef.current = hm;
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load more', 'error');
    } finally {
      loadingGuardRef.current = false;
      setLoadingMore(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchFirstPage();
  }, [isOpen, fetchFirstPage]);

  useEffect(() => {
    if (!isOpen || loading || !hasMore) return;
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingGuardRef.current) {
          void fetchNextPage();
        }
      },
      { rootMargin: '320px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isOpen, loading, hasMore, fetchNextPage]);

  const togglePreviewPlay = (projectId: string) => {
    const videoEl = previewRefs.current[projectId];
    if (!videoEl) return;
    if (playingId === projectId) {
      videoEl.pause();
      setPlayingId(null);
      return;
    }
    if (playingId && playingId !== projectId) {
      previewRefs.current[playingId]?.pause();
    }
    void videoEl.play().then(() => setPlayingId(projectId)).catch(() => setPlayingId(null));
  };

  const selectedProject = selectedId ? projects.find((p) => p.id === selectedId) : null;
  const selectedTitle =
    selectedProject?.title || selectedProject?.projectName || (selectedId ? `Project ${selectedId.slice(-6)}` : '');

  const handleConfirm = async () => {
    if (!selectedId || !campaignId) return;

    if (deferProcessing && onProjectSelected) {
      onProjectSelected(selectedId, { title: selectedTitle });
      onClose();
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.ingestCreatorDraftFromProject(selectedId, { campaignId });
      const assetId = res.data?.assetId;
      if (!assetId) {
        showToast(res.error || 'Could not create draft asset', 'error');
        return;
      }
      onAssetReady(assetId, { projectId: selectedId, title: selectedTitle });
      onClose();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Import failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-5xl overflow-hidden">
      {/*
        Leave vertical room for Modal chrome (close row). Fixed h-[min(90vh,...)] overflowed max-h-[90vh] and clipped the footer.
      */}
      <div className="flex max-h-[min(calc(90vh-5.5rem),780px)] min-h-0 flex-col p-4 sm:p-5">
        <h3 className="brand-page-section-title shrink-0">Choose a completed video</h3>
        <p className="brand-campaign-meta mb-4 shrink-0">
          Select a project card, preview with play/pause, then confirm. Only one preview plays at a time.
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading && projects.length === 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: SKELETON_INITIAL }).map((_, i) => (
                <ProjectCardSkeleton key={`sk-${i}`} index={i} />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <p className="text-sm text-[#616161]">No completed projects yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {projects.map((project) => {
                  const prevUrl = resolvePreviewUrl(project);
                  const isSelected = selectedId === project.id;
                  const isPlaying = playingId === project.id;
                  return (
                    <div
                      key={project.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        'w-full cursor-pointer rounded-2xl border p-2.5 text-left shadow-sm transition-all duration-200 sm:p-3',
                        isSelected
                          ? 'border-[#E86512] bg-orange-50/60 shadow-card'
                          : 'border-[#F0E6DF] bg-white hover:-translate-y-0.5 hover:shadow-card',
                      )}
                      onClick={() => {
                        setSelectedId(project.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedId(project.id);
                        }
                      }}
                    >
                      <div className="relative mx-auto mb-2.5 aspect-[9/16] w-full overflow-hidden rounded-xl bg-black">
                        {prevUrl ? (
                          <>
                            <video
                              ref={(el) => {
                                previewRefs.current[project.id] = el;
                              }}
                              src={prevUrl}
                              className="h-full w-full object-cover"
                              preload="metadata"
                              muted
                              playsInline
                              loop
                              controls={false}
                              onPlay={() => setPlayingId(project.id)}
                              onPause={() => setPlayingId((id) => (id === project.id ? null : id))}
                            />
                            <button
                              type="button"
                              className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity hover:opacity-100"
                              aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePreviewPlay(project.id);
                              }}
                            >
                              <span className="rounded-full bg-white/90 p-2 text-[#212121] shadow">
                                {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                              </span>
                            </button>
                          </>
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-white/60">No preview</div>
                        )}
                      </div>
                      <p className="line-clamp-2 px-1 pb-1 font-heading text-sm font-medium leading-snug text-[#212121]">
                        {project.title || project.projectName || `Project ${project.id}`}
                      </p>
                    </div>
                  );
                })}
              </div>
              {loadingMore ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: SKELETON_MORE }).map((_, i) => (
                    <ProjectCardSkeleton key={`more-sk-${i}`} index={i} />
                  ))}
                </div>
              ) : null}
              <div ref={loadMoreRef} className="h-4 w-full shrink-0" aria-hidden />
            </>
          )}
        </div>

        {!selectedId ? (
          <p className="mt-4 shrink-0 text-sm text-[#616161]">Tap a video to select it.</p>
        ) : (
          <div className="mt-4 flex shrink-0 flex-col gap-3 border-t border-[#EFE8E3] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 text-sm text-[#616161]">
              Selected: <span className="font-medium text-[#212121]">{selectedTitle}</span>
            </p>
            <div className="flex justify-end gap-2">
              <BrandSecondaryButton type="button" size="sm" onClick={onClose} disabled={submitting}>
                Cancel
              </BrandSecondaryButton>
              <BrandPrimaryButton
                type="button"
                size="sm"
                disabled={submitting}
                onClick={() => void handleConfirm()}
              >
                {submitting ? 'Processing…' : 'Use selected video'}
              </BrandPrimaryButton>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
