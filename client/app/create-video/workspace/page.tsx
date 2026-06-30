'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, ChevronLeft, ChevronRight, Music, Type, ChevronUp, Play, Pause, Loader2, User, Check, Clapperboard, SlidersHorizontal, Upload, RefreshCw, Search, X, Languages } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import {
  getFinalVideoUrl,
  getPreviewPlaybackUrl,
  hasFinalVideo,
  hasPreviewGenerationError,
  isFinalReady,
  isPreviewReady,
} from '@/lib/video-urls';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { useDownloadFinalVideo } from '@/hooks/useDownloadFinalVideo';
import { useWebSocket, JobStatusUpdate } from '@/hooks/useWebSocket';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import { cn } from '@/lib/utils/cn';
import { DraggableResizableAvatar } from '@/components/create-video/DraggableResizableAvatar';
import { DraggableResizableCaption } from '@/components/create-video/DraggableResizableCaption';
import BRollSelectionModal, { BRollSelection } from '@/components/create-video/BRollSelectionModal';
import { GradientTabBar } from '@/components/ui/GradientTabBar';
import { isSingleClipVideoStyle, isRawAvatarClipEditingPhase, isProjectActivelyRendering, isVideoTranslationEligible } from '@/lib/workspace/singleClipStyle';
import { longestWord } from '@/lib/workspace/captionBounds';
import { getVideoJobQueueType, isAlternateAvatarScene, isAlternateBrollScene } from '@/lib/video/alternateScene';
import { VideoTranslationsPanel } from '@/components/create-video/VideoTranslationsPanel';

interface Scene {
  scene_number?: number;
  sceneNumber?: number;
  type?: string;
  voiceover?: string;
  broll?: string;
  prompt?: string;
  text?: string;
  broll_image_prompt?: string;
  broll_prompt?: string;
  broll_visual_description?: string;
  stock_search_term?: string;
}

interface BrollImage {
  sceneNumber: number;
  imageUrl: string;
  localPath?: string;
  localUrl?: string;
  gcsUrl?: string;      // GCS public URL
  publicUrl?: string;   // Preferred public URL (GCS if available, fallback to backend)
  prompt?: string;
}

interface WordTimestamp {
  word?: string;
  text?: string;
  start?: number;
  startTime?: number;
  end?: number;
  endTime?: number;
}

interface AudioFile {
  sceneNumber: number;
  filePath?: string;
  localUrl: string;
  voiceover?: string;
  duration?: number;
  gcsUrl?: string;      // GCS public URL
  publicUrl?: string;   // Preferred public URL (GCS if available, fallback to backend)
  wordTimestamps?: WordTimestamp[];
}

type MusicSearchItem = {
  id: string;
  source: 'magnific' | 'heygen';
  externalId: number;
  title: string;
  artistName?: string;
  genres?: string[];
  moods?: string[];
  coverUrl?: string | null;
  previewUrl?: string | null;
  audioUrl?: string | null; // HeyGen audio URL
  seconds?: number;
  time?: string;
  isPremium?: boolean;
  // HeyGen-specific fields
  heygenTrackId?: string;
  score?: number;
  description?: string;
  duration?: number;
  durationSeconds?: number;
};

type BackgroundMusicConfig = {
  enabled: boolean;
  source?: 'magnific' | 'upload' | 'heygen';
  externalId?: number;
  title?: string;
  artist?: string;
  durationSeconds?: number;
  /** Magnific preview URL for in-browser playback only (not used at export). */
  previewUrl?: string;
  publicUrl?: string;
  gcsUrl?: string;
  searchSeed?: { query?: string; genres?: string[]; moods?: string[] };
  mixVolume?: number;
  voiceDuckTo?: number;
  fadeInMs?: number;
  // HeyGen-specific fields
  heygenTrackId?: string;
  heygenTrackName?: string;
  heygenTrackDuration?: number;
  heygenTrackScore?: number;
  fadeOutMs?: number;
};

function captionTextForVideoPreview(
  mode: 'word-by-word' | 'full-sentence',
  sceneText: string,
  currentTime: number,
  wordTimestamps: WordTimestamp[] | undefined,
  sceneDuration?: number
): string {
  if (mode === 'full-sentence') return sceneText;
  if (!wordTimestamps?.length) return sceneText;
  const words = wordTimestamps
    .map((w) => ({
      t: (w.word ?? w.text ?? '').trim(),
      start: w.start ?? w.startTime ?? 0,
      end: w.end ?? w.endTime ?? w.start ?? w.startTime ?? 0,
    }))
    .filter((w) => w.t);
  if (!words.length) return sceneText;
  const dur =
    sceneDuration && sceneDuration > 0
      ? sceneDuration
      : Math.max(words[words.length - 1].end, currentTime);
  if (currentTime < words[0].start) return '';
  for (let i = 0; i < words.length; i++) {
    const nextStart = i + 1 < words.length ? words[i + 1].start : dur;
    if (currentTime >= words[i].start && currentTime < nextStart) return words[i].t;
  }
  return words[words.length - 1].t;
}

function firstCaptionWord(
  sceneText: string,
  wordTimestamps: WordTimestamp[] | undefined,
): string {
  const timed = (wordTimestamps || [])
    .map((w) => (w.word ?? w.text ?? '').trim())
    .find((w) => w.length > 0);
  if (timed) return timed;
  const fromText = sceneText.trim().split(/\s+/).find((w) => w.length > 0);
  return fromText || sceneText;
}

/** Maps payment wallet GET /credits/project/:id/breakdown to export modal rows (see pricing.service getProjectCostBreakdown). */
function buildExportBreakdownRows(breakdown: Record<string, unknown> | null | undefined): {
  rows: { label: string; credits: number; detail?: string }[];
  /** Sum of recorded snapshots only (generations already logged). */
  recordedCost: number;
  /** Total including pending final render when applicable — matches estimated charge at export. */
  estimatedTotalCredits: number;
  hasRows: boolean;
} {
  if (!breakdown || typeof breakdown !== 'object') {
    return { rows: [], recordedCost: 0, estimatedTotalCredits: 0, hasRows: false };
  }
  const recordedCost =
    typeof breakdown.totalCost === 'number' ? breakdown.totalCost : 0;
  const finalRenderFee =
    typeof breakdown.finalRenderFee === 'number' ? breakdown.finalRenderFee : 0;
  const finalRenderAlreadyRecorded = Boolean(breakdown.finalRenderAlreadyRecorded);
  let estimatedTotalCredits =
    typeof breakdown.estimatedTotalCredits === 'number'
      ? breakdown.estimatedTotalCredits
      : recordedCost +
        (!finalRenderAlreadyRecorded && finalRenderFee > 0 ? finalRenderFee : 0);

  const appendPendingFinalRender = (
    rows: { label: string; credits: number; detail?: string }[],
  ) => {
    if (!finalRenderAlreadyRecorded && finalRenderFee > 0) {
      rows.push({
        label: 'Final render',
        credits: finalRenderFee,
        detail: 'after successful export',
      });
    }
    return rows;
  };

  const byOp = breakdown.byOperationType as
    | Record<string, { count?: number; totalCost?: number }>
    | undefined;
  if (byOp && typeof byOp === 'object' && Object.keys(byOp).length > 0) {
    const rows = Object.entries(byOp)
      .map(([type, info]) => ({
        label: type.replace(/_/g, ' '),
        credits: typeof info?.totalCost === 'number' ? info.totalCost : 0,
        detail:
          typeof info?.count === 'number' && info.count > 1
            ? `${info.count} operations`
            : undefined,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    appendPendingFinalRender(rows);
    const sumRows = rows.reduce((acc, r) => acc + r.credits, 0);
    if (typeof breakdown.estimatedTotalCredits !== 'number') {
      estimatedTotalCredits = sumRows;
    }
    return {
      rows,
      recordedCost,
      estimatedTotalCredits,
      hasRows: rows.length > 0,
    };
  }
  const snapshots = breakdown.snapshots as
    | Array<{ operationType?: string; sceneNumber?: number | null; creditCost?: number }>
    | undefined;
  if (Array.isArray(snapshots) && snapshots.length > 0) {
    const rows = snapshots.map((s) => ({
      label: `${(s.operationType ?? 'operation').replace(/_/g, ' ')}${
        s.sceneNumber != null ? ` · Scene ${s.sceneNumber}` : ''
      }`,
      credits: typeof s.creditCost === 'number' ? s.creditCost : 0,
    }));
    appendPendingFinalRender(rows);
    const sumRows = rows.reduce((acc, r) => acc + r.credits, 0);
    if (typeof breakdown.estimatedTotalCredits !== 'number') {
      estimatedTotalCredits = sumRows;
    }
    return {
      rows,
      recordedCost,
      estimatedTotalCredits,
      hasRows: rows.length > 0,
    };
  }

  const pendingOnly = appendPendingFinalRender([]);
  if (pendingOnly.length > 0) {
    return {
      rows: pendingOnly,
      recordedCost,
      estimatedTotalCredits:
        typeof breakdown.estimatedTotalCredits === 'number'
          ? breakdown.estimatedTotalCredits
          : finalRenderFee,
      hasRows: true,
    };
  }

  return { rows: [], recordedCost, estimatedTotalCredits, hasRows: false };
}

/** Coerce API/WebSocket scene indices to number so Set/Map keys stay consistent. */
function normalizeSceneNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

// Workspace mode type for better state management
type WorkspaceMode = 'images' | 'converting' | 'videos' | 'rendering' | 'completed';

interface BrollVideo {
  sceneNumber: number;
  jobId?: string;
  taskId?: string;
  videoUrl?: string;
  localPath?: string;
  localUrl?: string;
  gcsUrl?: string;
  publicUrl?: string;
  duration?: number;
  prompt?: string;
}

const VOICE_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_VOICE_SERVICE_URL || 'http://localhost:9002/api';
const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004';
const VIDEO_SERVICE_ORIGIN = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';

/** Matches Tailwind `lg` — left/right rails fixed from this width; drawers below. */
const WORKSPACE_SIDEBAR_BREAKPOINT_PX = 1024;

function WorkspacePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const projectIdFromUrl = searchParams?.get('projectId') ?? null;

  const [projectId, setProjectId] = useState<string | null>(projectIdFromUrl);
  const [project, setProject] = useState<any>(null);
  const {
    download: downloadFinalVideo,
    isDownloading: isDownloadingFinal,
  } = useDownloadFinalVideo(
    projectId,
    project?.title ? `${String(project.title).replace(/[^\w\s-]/g, '').trim() || 'video'}.mp4` : undefined,
  );
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [brollImages, setBrollImages] = useState<BrollImage[]>([]);
  const [brollVideos, setBrollVideos] = useState<BrollVideo[]>([]);
  const [avatarVideos, setAvatarVideos] = useState<BrollVideo[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [backgroundMusicEnabled, setBackgroundMusicEnabled] = useState(false);
  const [musicTab, setMusicTab] = useState<'library' | 'upload'>('library');
  const [musicLibraryItems, setMusicLibraryItems] = useState<MusicSearchItem[]>([]);
  const [musicSearchInput, setMusicSearchInput] = useState('');
  const [musicSearchExpanded, setMusicSearchExpanded] = useState(false);
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicRelaxLevel, setMusicRelaxLevel] = useState(0);
  const [musicSelected, setMusicSelected] = useState<BackgroundMusicConfig | null>(null);
  const [musicUploading, setMusicUploading] = useState(false);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [musicPreviewPlayingId, setMusicPreviewPlayingId] = useState<number | null>(null);
  const [musicPreviewLoading, setMusicPreviewLoading] = useState<number | null>(null);
  const [musicSearchSeed, setMusicSearchSeed] = useState<{ query?: string; genres?: string[]; moods?: string[] } | null>(null);
  const musicPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicSearchInputRef = useRef<HTMLInputElement>(null);
  const musicHydratedRef = useRef(false);
  const musicSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const musicCacheKeyRef = useRef<string>('');
  const musicPreviewUrlCache = useRef<Record<number, string>>({});
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [musicExpanded, setMusicExpanded] = useState(true);
  const [captionsExpanded, setCaptionsExpanded] = useState(true);
  
  // Caption settings state
  const [captionDisplayMode, setCaptionDisplayMode] = useState<'word-by-word' | 'full-sentence'>('word-by-word');
  const [captionApplyToAll, setCaptionApplyToAll] = useState(true);
  const [captionGlobalPosition, setCaptionGlobalPosition] = useState({ x: 0.5, y: 0.9, scale: 0.1, widthScale: 0.8 });
  const [captionPerScenePositions, setCaptionPerScenePositions] = useState<Record<number, { x: number; y: number; scale: number; widthScale: number }>>({});
  const [captionStyle, setCaptionStyle] = useState({
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 'bold' as 'normal' | 'bold',
    fontStyle: 'normal' as 'normal' | 'italic',
    textDecoration: 'none' as 'none' | 'underline',
    textColor: '#FFFFFF',
    backgroundColor: '#000000',
    borderColor: 'transparent',
    borderWidth: 0,
  });
  const [captionStylePreset, setCaptionStylePreset] = useState<'light' | 'dark' | 'transparent' | 'custom'>('dark');
  const captionSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const captionHydratedRef = useRef(false);
  
  // Avatar overlay state (AVATAR_CUTOUT style only)
  const [avatarOverlayEnabled, setAvatarOverlayEnabled] = useState(true);
  const [avatarOverlayExpanded, setAvatarOverlayExpanded] = useState(true);
  const [avatarApplyToAll, setAvatarApplyToAll] = useState(true);
  const [avatarGlobalPosition, setAvatarGlobalPosition] = useState({ x: 0.5, y: 0.85, scale: 0.4 });
  const [avatarPerScenePositions, setAvatarPerScenePositions] = useState<Record<number, { x: number; y: number; scale: number }>>({});
  const [avatarPreviewAspectRatio, setAvatarPreviewAspectRatio] = useState(9 / 16);
  const [avatarImageUrl, setAvatarImageUrl] = useState<string | null>(null);
  const avatarSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewDimensions, setPreviewDimensions] = useState({ width: 0, height: 0 });
  const [mobileDrawerFrame, setMobileDrawerFrame] = useState({ top: 170, height: 420 });
  const [viewportWidth, setViewportWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : WORKSPACE_SIDEBAR_BREAKPOINT_PX
  );
  
  // Workspace mode: 'images' | 'converting' | 'videos'
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('images');
  const [generatingVideos, setGeneratingVideos] = useState<Set<number>>(new Set());
  const [regeneratingImageScenes, setRegeneratingImageScenes] = useState<Set<number>>(new Set());
  const [regeneratingVideoScenes, setRegeneratingVideoScenes] = useState<Set<number>>(new Set());
  const [failedGenerations, setFailedGenerations] = useState<Set<number>>(new Set());
  const [playingVideo, setPlayingVideo] = useState<number | null>(null);
  // Use ref instead of state to avoid infinite re-renders when setting video elements
  const videoElementsRef = useRef<Record<number, HTMLVideoElement>>({});
  const [previewPlaybackTime, setPreviewPlaybackTime] = useState(0);

  // Rendering state
  const [renderingProgress, setRenderingProgress] = useState(0);
  const [renderingStage, setRenderingStage] = useState<string>('pending');
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [previewPlaybackUrl, setPreviewPlaybackUrl] = useState<string | null>(null);
  const [translationPlaybackOverride, setTranslationPlaybackOverride] = useState<string | null>(null);
  const [selectedTranslationVariantId, setSelectedTranslationVariantId] = useState<'original' | string>('original');
  const [isDownloadingTranslation, setIsDownloadingTranslation] = useState(false);
  const [showTranslateModal, setShowTranslateModal] = useState(false);

  const handleCompletedDownload = useCallback(async () => {
    if (selectedTranslationVariantId !== 'original') {
      try {
        setIsDownloadingTranslation(true);
        showToast('Preparing download…', 'info');
        const blob = await apiClient.downloadVideoTranslation(projectId!, selectedTranslationVariantId);
        const variant = ((project as any)?.videoTranslations as Array<{ id: string; language?: string }> | undefined)?.find(
          (v) => v.id === selectedTranslationVariantId,
        );
        const langSuffix = variant?.language
          ? String(variant.language).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40)
          : 'translation';
        const base = project?.title
          ? String(project.title).replace(/[^\w\s-]/g, '').trim() || 'video'
          : `project-${projectId}`;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${base}-${langSuffix}.mp4`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
        showToast('Download started', 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Download failed';
        showToast(message, 'error');
      } finally {
        setIsDownloadingTranslation(false);
      }
      return;
    }
    await downloadFinalVideo();
  }, [selectedTranslationVariantId, downloadFinalVideo, project, projectId, showToast]);
  const [previewPreparing, setPreviewPreparing] = useState(false);
  const [previewGenerationError, setPreviewGenerationError] = useState<string | null>(null);
  const previewPollingRef = useRef<NodeJS.Timeout | null>(null);
  const previewPollStoppedRef = useRef(false);
  const previewPollFingerprintRef = useRef<string | null>(null);
  const { subscribeToQueueType } = useWebSocketContext();
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [exportCostBreakdown, setExportCostBreakdown] = useState<any>(null);
  const [exportConfirmLoading, setExportConfirmLoading] = useState(false);
  const exportBreakdownDisplay = useMemo(
    () => buildExportBreakdownRows(exportCostBreakdown),
    [exportCostBreakdown],
  );
  const renderingPollingRef = useRef<NodeJS.Timeout | null>(null);
  
  // B-roll selection modal state
  const [brollModalOpen, setBrollModalOpen] = useState(false);
  const [brollModalSceneNumber, setBrollModalSceneNumber] = useState<number>(1);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  
  // Derived state for backward compatibility
  const isVideoMode = workspaceMode === 'videos';
  const isConverting = workspaceMode === 'converting';
  const isRendering = workspaceMode === 'rendering';
  const isCompleted = workspaceMode === 'completed';
  const isTabletViewport = viewportWidth >= 560 && viewportWidth < WORKSPACE_SIDEBAR_BREAKPOINT_PX;
  
  // WebSocket job tracking
  const videoJobIdsRef = useRef<Map<number, Set<string>>>(new Map());
  const jobToSceneRef = useRef<Map<string, number>>(new Map());
  const imageRegenJobToSceneRef = useRef<Map<string, number>>(new Map());
  const videoRegenJobToSceneRef = useRef<Map<string, number>>(new Map());
  const processedJobIdsRef = useRef<Set<string>>(new Set());
  const processedImageJobIdsRef = useRef<Set<string>>(new Set());
  const unsubscribeFromJobRef = useRef<((jobId: string) => void) | null>(null);
  const subscribeToJobRef = useRef<((jobId: string, queueType: string) => void) | null>(null);

  // Calculate dynamic scene count based on available data
  const sceneCount = useMemo(() => {
    const scriptScenes = scenes.length;
    const imageScenes = brollImages.length;
    const audioScenes = audioFiles.length;
    // Return the maximum count to ensure we show all available scenes
    return Math.max(scriptScenes, imageScenes, audioScenes, 0);
  }, [scenes, brollImages, audioFiles]);

  // Get audio URL for scene - prioritize GCS URLs, fallback to local
  const getAudioUrl = (audioFile: AudioFile): string | null => {
    if (!audioFile) return null;

    // Priority 1: Use publicUrl (GCS URL if available)
    if (audioFile.publicUrl && audioFile.publicUrl.startsWith('http')) {
      return audioFile.publicUrl;
    }
    
    // Priority 2: Direct GCS URL
    if (audioFile.gcsUrl && audioFile.gcsUrl.startsWith('http')) {
      return audioFile.gcsUrl;
    }

    // Priority 3: Fallback to localUrl with backend base
    if (audioFile.localUrl) {
      // If already a full URL, return as-is
      if (audioFile.localUrl.startsWith('http')) {
        return audioFile.localUrl;
      }
      
      const url = audioFile.localUrl.startsWith('/uploads') 
        ? audioFile.localUrl 
        : `/uploads${audioFile.localUrl}`;
      const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
      return `${WS_URL}${url}`;
    }
    
    return null;
  };

  // Load audio duration
  const loadAudioDuration = (sceneNumber: number, audioFile: AudioFile) => {
    const audioSrc = getAudioUrl(audioFile);
    if (!audioSrc) {
      console.warn(`No valid audio URL for scene ${sceneNumber}`);
      return;
    }

    const audio = new Audio(audioSrc);
    audio.addEventListener('loadedmetadata', () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDurations(prev => ({ ...prev, [sceneNumber]: audio.duration }));
      }
    });
    audio.addEventListener('error', (e) => {
      console.error(`Failed to load audio for scene ${sceneNumber}:`, e);
    });
  };

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate scene time range
  const getSceneTimeRange = (sceneIndex: number): string => {
    const scene = scenes[sceneIndex];
    if (!scene) return '00:00/00:00';

    const sceneNumber = scene.scene_number || scene.sceneNumber || (sceneIndex + 1);
    const audioFile = audioFiles.find(af => af.sceneNumber === sceneNumber);
    
    // Use stored duration first, then loaded duration
    const sceneDuration = audioFile?.duration || durations[sceneNumber] || 0;

    if (!sceneDuration) {
      return '00:00/00:00';
    }

    // Calculate start time (sum of all previous scene durations)
    let startTime = 0;
    for (let i = 0; i < sceneIndex; i++) {
      const prevScene = scenes[i];
      const prevSceneNumber = prevScene?.scene_number || prevScene?.sceneNumber || (i + 1);
      const prevAudioFile = audioFiles.find(af => af.sceneNumber === prevSceneNumber);
      const prevDuration = prevAudioFile?.duration || durations[prevSceneNumber] || 0;
      startTime += prevDuration;
    }

    const endTime = startTime + sceneDuration;
    return `${formatTime(startTime)}/${formatTime(endTime)}`;
  };

  // Get image URL for scene - prioritize GCS URLs, fallback to local
  // For ALTERNATE avatar scenes, return the avatar preview URL instead of b-roll image
  const getImageUrl = (sceneNumber: number): string | null => {
    // Check if this is an ALTERNATE avatar scene - these don't have b-roll images
    const scene = scenes.find(s => (s.scene_number || s.sceneNumber) === sceneNumber);
    const isAvatarScene = project?.style === 'ALTERNATE' && isAlternateAvatarScene(scene, sceneNumber);
    
    if (isAvatarScene) {
      // Return avatar preview URL for avatar scenes (check multiple fallback locations)
      const avatarUrl = project?.metadata?.avatarPublicImageUrl ||
                        project?.metadata?.avatarPreviewUrl ||
                        project?.metadata?.avatarImageUrl ||
                        project?.metadata?.avatarLocalUrl ||
                        project?.metadata?.avatarGcsUrl ||
                        project?.avatarUrl;
      
      if (avatarUrl && typeof avatarUrl === 'string') {
        if (avatarUrl.startsWith('http')) {
          return avatarUrl;
        }
        const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
        return `${VIDEO_SERVICE_BASE_URL}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`;
      }
      return null;
    }
    
    // For b-roll scenes, look in brollImages
    const image = brollImages.find(img => img.sceneNumber === sceneNumber);
    if (!image) return null;

    // Priority 1: Use publicUrl (GCS URL if available, backend URL otherwise)
    if (image.publicUrl && image.publicUrl.startsWith('http')) {
      return image.publicUrl;
    }
    
    // Priority 2: Direct GCS URL
    if (image.gcsUrl && image.gcsUrl.startsWith('http')) {
      return image.gcsUrl;
    }

    // Priority 3: Fallback to localUrl with backend base
    if (image.localUrl) {
      const url = image.localUrl.startsWith('/uploads') 
        ? image.localUrl 
        : `/uploads${image.localUrl}`;
      // Use NEXT_PUBLIC_WS_URL which is already set to the base domain (e.g., https://api.dev.usergen.ai)
      const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
      return `${VIDEO_SERVICE_BASE_URL}${url}`;
    }
    
    // Relative upload path without localUrl row (legacy / minimal payloads)
    if (image.imageUrl?.startsWith('/uploads')) {
      const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
      return `${VIDEO_SERVICE_BASE_URL}${image.imageUrl}`;
    }

    // Last resort: original provider URL
    return image.imageUrl || null;
  };

  // Get video URL for scene - prioritize GCS URLs, fallback to local
  // For ALTERNATE avatar scenes, look in avatarVideos instead of brollVideos
  const getVideoUrl = (sceneNumber: number): string | null => {
    // Check if this is an ALTERNATE avatar scene
    const scene = scenes.find(s => (s.scene_number || s.sceneNumber) === sceneNumber);
    const isAvatarScene = project?.style === 'ALTERNATE' && isAlternateAvatarScene(scene, sceneNumber);
    
    // For ALTERNATE avatar scenes, look in avatarVideos
    const video = isAvatarScene
      ? avatarVideos.find(vid => vid.sceneNumber === sceneNumber)
      : brollVideos.find(vid => vid.sceneNumber === sceneNumber);
    
    if (!video) return null;

    // Priority 1: Use publicUrl (GCS URL if available, backend URL otherwise)
    if (video.publicUrl && video.publicUrl.startsWith('http')) {
      return video.publicUrl;
    }
    
    // Priority 2: Direct GCS URL
    if (video.gcsUrl && video.gcsUrl.startsWith('http')) {
      return video.gcsUrl;
    }

    // Priority 3: Fallback to localUrl with backend base
    if (video.localUrl) {
      const url = video.localUrl.startsWith('/uploads') 
        ? video.localUrl 
        : `/uploads${video.localUrl}`;
      // Use NEXT_PUBLIC_WS_URL which is already set to the base domain (e.g., https://api.dev.usergen.ai)
      const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
      return `${VIDEO_SERVICE_BASE_URL}${url}`;
    }
    
    if (video.videoUrl?.startsWith('/uploads')) {
      const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
      return `${VIDEO_SERVICE_BASE_URL}${video.videoUrl}`;
    }

    // Last resort: original provider URL
    return video.videoUrl || null;
  };

  // Get scene text/voiceover
  const getSceneText = (scene: Scene): string => {
    return scene.voiceover || scene.text || '';
  };

  // Load project data
  useEffect(() => {
    const loadProject = async () => {
      if (!isAuthenticated || authLoading) return;
      if (!projectId) return;

      try {
        setLoading(true);
        const response = await apiClient.getVideoProject(projectId);

        if (response.success && response.data) {
          const projectData = response.data;

          const hasFinalVideoUrl = Boolean(
            projectData.videoPublicUrl || projectData.videoGcsUrl || projectData.videoUrl
          );
          const isCompletedProject = projectData.status === 'COMPLETED';

          // Allow completed projects with a final video even when generationFlow is classic.
          if (projectData.metadata?.generationFlow !== 'AI_CHAT' && !(isCompletedProject && hasFinalVideoUrl)) {
            // Show a local message instead of redirecting into the classic flow
            showToast('This project was created with the classic flow and is not available in the AI workspace.', 'info');
            setProject(null);
            setLoading(false);
            return;
          }

          setProject(projectData);

          const projectMeta = (projectData.metadata || {}) as Record<string, unknown>;
          const isFinalExportDone = Boolean(projectMeta.finalExportedAt);
          const singleClipStyle = isSingleClipVideoStyle(projectData.style);
          const rawClipEditing = isRawAvatarClipEditingPhase(projectData);

          if (rawClipEditing) {
            const rawUrl =
              (typeof projectMeta.rawAvatarClipUrl === 'string'
                ? projectMeta.rawAvatarClipUrl
                : projectData.videoUrl) || projectData.videoUrl;
            setFinalVideoUrl(
              rawUrl.startsWith('http')
                ? rawUrl
                : `${VIDEO_SERVICE_BASE_URL}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`,
            );
            setWorkspaceMode('videos');
          }

          const brandPackagingStatus = (projectData.metadata as Record<string, unknown> | undefined)
            ?.brandPackaging as { status?: string } | undefined;
          if (brandPackagingStatus?.status === 'failed') {
            showToast('Brand assets failed to prepare. Retrying in background…', 'warning');
            void apiClient.startBrandPackaging(projectId).catch(() => {});
          }

          if (projectData.captionsEnabled !== undefined || projectData.captionSettings) {
            const caps = (projectData.captionSettings || {}) as Record<string, unknown>;
            const enabledFromSettings = typeof caps.enabled === 'boolean' ? caps.enabled : false;
            setCaptionsEnabled(Boolean(projectData.captionsEnabled ?? enabledFromSettings));
            if (caps.displayMode === 'full-sentence' || caps.displayMode === 'word-by-word') {
              setCaptionDisplayMode(caps.displayMode);
            }
            // TODO(per-scene-layout): re-enable per-scene when export supports perScenePositions
            // if (caps.applyToAll === false) setCaptionApplyToAll(false);
            const gp = caps.globalPosition as Record<string, unknown> | undefined;
            if (gp && typeof gp.x === 'number') {
              setCaptionGlobalPosition({
                x: gp.x,
                y: typeof gp.y === 'number' ? gp.y : 0.9,
                scale: typeof gp.scale === 'number' ? gp.scale : 0.1,
                widthScale: typeof gp.widthScale === 'number' ? gp.widthScale : 0.8,
              });
            }
            const psp = caps.perScenePositions as Record<number, { x: number; y: number; scale: number; widthScale: number }> | undefined;
            if (psp && typeof psp === 'object') {
              setCaptionPerScenePositions(psp);
            }
            const st = (caps.style && typeof caps.style === 'object' ? caps.style : caps) as Record<string, unknown>;
            if (st.fontFamily || st.textColor || st.backgroundColor) {
              const bg = String(st.backgroundColor ?? '').toLowerCase();
              setCaptionStyle({
                fontFamily: (st.fontFamily as string) || 'Inter',
                fontSize: typeof st.fontSize === 'number' ? st.fontSize : 16,
                fontWeight: st.fontWeight === 'normal' ? 'normal' : 'bold',
                fontStyle: st.fontStyle === 'italic' ? 'italic' : 'normal',
                textDecoration: st.textDecoration === 'underline' ? 'underline' : 'none',
                textColor: (st.textColor as string) || '#FFFFFF',
                backgroundColor: (st.backgroundColor as string) || '#000000',
                borderColor: (st.borderColor as string) || 'transparent',
                borderWidth: typeof st.borderWidth === 'number' ? st.borderWidth : 0,
              });
              if (bg === 'transparent') setCaptionStylePreset('transparent');
              else if (st.textColor === '#000000' && st.backgroundColor === '#FFFFFF') setCaptionStylePreset('light');
              else if (st.textColor === '#FFFFFF' && st.backgroundColor === '#000000') setCaptionStylePreset('dark');
              else setCaptionStylePreset('custom');
            }
          }
          const bgm = (projectData.backgroundMusic || {}) as BackgroundMusicConfig;
          if (bgm && typeof bgm === 'object') {
            setBackgroundMusicEnabled(Boolean(bgm.enabled));
            // Support both HeyGen (heygenTrackId) and Magnific (externalId) tracks
            setMusicSelected(bgm.publicUrl || bgm.externalId || bgm.heygenTrackId ? bgm : null);
            setMusicSearchSeed(bgm.searchSeed || null);
          }
          captionHydratedRef.current = true;
          musicHydratedRef.current = true;

          // Parse script to get scenes
          if (projectData.script) {
            const script = typeof projectData.script === 'string'
              ? JSON.parse(projectData.script)
              : projectData.script;
            const scriptScenes = script.scenes || script.scene_plan || [];
            setScenes(scriptScenes);
          }
          
          // Load avatar overlay settings from project metadata (AVATAR_CUTOUT only)
          if (projectData.style === 'AVATAR_CUTOUT' && projectData.metadata?.avatarOverlay) {
            const overlay = projectData.metadata.avatarOverlay;
            setAvatarOverlayEnabled(overlay.enabled ?? true);
            setAvatarApplyToAll(overlay.applyToAll ?? true);
            setAvatarGlobalPosition(overlay.globalPosition ?? { x: 0.5, y: 0.85, scale: 0.4 });
            setAvatarPerScenePositions(overlay.perScenePositions ?? {});
            if (typeof overlay.aspectRatio === 'number' && overlay.aspectRatio > 0) {
              setAvatarPreviewAspectRatio(overlay.aspectRatio);
            }
          }
          
          // Load avatar image URL for AVATAR_CUTOUT style
          if (projectData.style === 'AVATAR_CUTOUT') {
            console.log('[Workspace] Loading avatar image for AVATAR_CUTOUT style');
            console.log('[Workspace] Project metadata:', projectData.metadata);
            
            // Try multiple sources for avatar image URL:
            // 1. avatarPublicImageUrl (cached public URL from GCS)
            // 2. avatarImageUrl or avatarLocalUrl in metadata
            // 3. Avatar's originalImageUrl from avatar data
            const avatarUrl = projectData.metadata?.avatarPublicImageUrl ||
                              projectData.metadata?.avatarPreviewUrl ||
                              projectData.metadata?.avatarImageUrl ||
                              projectData.metadata?.avatarLocalUrl ||
                              projectData.metadata?.avatarGcsUrl;
            
            console.log('[Workspace] Avatar URL candidates:', {
              avatarPublicImageUrl: projectData.metadata?.avatarPublicImageUrl,
              avatarPreviewUrl: projectData.metadata?.avatarPreviewUrl,
              avatarImageUrl: projectData.metadata?.avatarImageUrl,
              avatarLocalUrl: projectData.metadata?.avatarLocalUrl,
              avatarGcsUrl: projectData.metadata?.avatarGcsUrl,
              selectedUrl: avatarUrl
            });
            
            if (avatarUrl) {
              const finalUrl = avatarUrl.startsWith('http') ? avatarUrl : `${VIDEO_SERVICE_BASE_URL}${avatarUrl}`;
              console.log('[Workspace] Setting avatar image URL:', finalUrl);
              setAvatarImageUrl(finalUrl);
            } else if (projectData.avatarId) {
              // Fallback: try to get avatar image from avatar data
              console.log('[Workspace] No avatar URL in metadata, fetching from avatar service for avatarId:', projectData.avatarId);
              try {
                const avatarResponse = await apiClient.getAvatar(projectData.avatarId);
                console.log('[Workspace] Avatar response:', avatarResponse);
                if (avatarResponse.success && avatarResponse.data?.originalImageUrl) {
                  console.log('[Workspace] Using avatar originalImageUrl:', avatarResponse.data.originalImageUrl);
                  setAvatarImageUrl(avatarResponse.data.originalImageUrl);
                }
              } catch (error) {
                console.warn('[Workspace] Could not load avatar image:', error);
              }
            } else {
              console.warn('[Workspace] No avatar URL found and no avatarId available');
            }
          }

          // Load broll images
          if (projectData.bRollImages) {
            const images = Array.isArray(projectData.bRollImages)
              ? projectData.bRollImages
              : [];
            setBrollImages(images);
          }

          // Load broll videos
          if (projectData.bRollVideoTasks) {
            const videos = Array.isArray(projectData.bRollVideoTasks)
              ? projectData.bRollVideoTasks
              : [];
            setBrollVideos(videos);
            
            // Check startMode query param (from ai-chat navigation)
            const startModeParam = searchParams?.get('startMode');
            
            if (!isFinalExportDone && startModeParam === 'videos' && (videos.length > 0 || singleClipStyle)) {
              setWorkspaceMode('videos');
            } else if (!isFinalExportDone && startModeParam === 'images') {
              // Explicitly requested images mode (mixed content case)
              setWorkspaceMode('images');
            } else if (!isFinalExportDone && videos.length > 0) {
              // Default: if videos exist, set to videos mode
              setWorkspaceMode('videos');
            }
          }

          // Single-clip: ensure videos editing mode when raw clip exists (no b-roll rows)
          if (rawClipEditing) {
            setWorkspaceMode('videos');
          }

          // Load avatar videos (for ALTERNATE style avatar scenes)
          if (projectData.avatarVideos) {
            const avVideos = Array.isArray(projectData.avatarVideos)
              ? projectData.avatarVideos
              : [];
            setAvatarVideos(avVideos);
          }

          // Check if project is already completed or rendering
          if (projectData.status === 'COMPLETED' && hasFinalVideo(projectData)) {
            applyProjectVideoUrls(projectData);
            // Single-clip styles can be COMPLETED while still in the editing
            // stage (their clip + the editable captions/music page). Only jump
            // to the completed screen once the user has actually exported
            // (marked by metadata.finalExportedAt); otherwise stay on the
            // videos editing page.
            const singleClipNotExported =
              isRawAvatarClipEditingPhase(projectData) ||
              (isSingleClipVideoStyle(projectData.style) && !isFinalExportDone);
            if (singleClipNotExported) {
              setWorkspaceMode('videos');
            } else {
              setWorkspaceMode('completed');
            }
            setRenderingProgress(100);
            setRenderingStage('completed');
          } else if (isProjectActivelyRendering(projectData)) {
            // Active final render in progress — resume polling UI
            setWorkspaceMode('rendering');
            setRenderingProgress(projectData.renderingProgress || 0);
            setRenderingStage(projectData.renderingStatus || 'pending');
          } else if (rawClipEditing) {
            // Raw avatar clip finished; stay on videos editing page (not rendering/completed)
            setWorkspaceMode('videos');
            setRenderingProgress(100);
            setRenderingStage('completed');
          }

          // Load audio files
          if (projectData.audioFiles) {
            const audioFilesData = Array.isArray(projectData.audioFiles)
              ? projectData.audioFiles
              : Object.values(projectData.audioFiles);
            setAudioFiles(audioFilesData);

            // Load durations for all audio files
            audioFilesData.forEach((audioFile: AudioFile) => {
              // If duration is already stored, use it
              if (audioFile.duration) {
                setDurations(prev => ({ ...prev, [audioFile.sceneNumber]: audioFile.duration! }));
              } else {
                // Otherwise load from audio metadata using the audioFile object
                loadAudioDuration(audioFile.sceneNumber, audioFile);
              }
            });
          }

          // Update project step
          try {
            await apiClient.updateVideoProject(projectId, {
              metadata: {
                ...projectData.metadata,
                generationFlow: 'AI_CHAT',
                aiChatStep: 'workspace',
              },
            });
          } catch (error) {
            console.error('Failed to update project step:', error);
          }
        }
      } catch (error: any) {
        console.error('Failed to load project:', error);
        showToast('Failed to load project', 'error');
        if (error.response?.status === 401) {
          // AuthExpiryProvider handles 401 via auth:session-expired
        }
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [projectId, isAuthenticated, authLoading, router, showToast]);

  const musicHeaders = useCallback(() => {
    const t = typeof window !== 'undefined'
      ? localStorage.getItem('authToken') || sessionStorage.getItem('authToken')
      : null;
    const headers: Record<string, string> = {};
    if (t) headers.Authorization = `Bearer ${t}`;
    return headers;
  }, []);

  const fetchMusicLibrary = useCallback(async (opts?: { query?: string; useSeed?: boolean }) => {
    setMusicLoading(true);
    setMusicError(null);
    try {
      const params = new URLSearchParams();
      const q = (opts?.query || '').trim();
      if (q) {
        params.set('q', q);
      } else if (opts?.useSeed !== false && musicSearchSeed) {
        if (musicSearchSeed.query) params.set('q', musicSearchSeed.query);
        if (musicSearchSeed.genres?.length) params.set('genre', musicSearchSeed.genres.join(','));
        if (musicSearchSeed.moods?.length) params.set('mood', musicSearchSeed.moods.join(','));
      }
      params.set('limit', '20');
      params.set('offset', '0');
      params.set('includePremium', 'false');
      const cacheKey = `musicLibrary:${projectId || 'none'}:${params.toString()}`;
      musicCacheKeyRef.current = cacheKey;
      if (typeof window !== 'undefined') {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.results) {
            setMusicLibraryItems(parsed.results as MusicSearchItem[]);
            setMusicRelaxLevel(Number(parsed.relaxLevel || 0));
            setMusicLoading(false);
            return;
          }
        }
      }
      const res = await fetch(`/api/music/search?${params.toString()}`, { headers: musicHeaders() });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || json?.error || 'Music search failed');
      setMusicLibraryItems((json.data?.results || []) as MusicSearchItem[]);
      setMusicRelaxLevel(Number(json.data?.relaxLevel || 0));
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({ results: json.data?.results || [], relaxLevel: Number(json.data?.relaxLevel || 0) }),
        );
      }
    } catch (e: any) {
      setMusicError(e?.message || 'Failed to load music library');
      setMusicLibraryItems([]);
    } finally {
      setMusicLoading(false);
    }
  }, [musicSearchSeed, musicHeaders, projectId]);

  /**
   * Play music preview with multiple fallbacks:
   * 1. Use cached URL if available
   * 2. Try previewUrl from search results
   * 3. Fetch preview-info endpoint for the actual URL
   * 4. Use proxied stream endpoint as final fallback (bypasses CORS)
   */
  const handleMusicPreview = useCallback(async (item: MusicSearchItem, isCurrentlyPlaying: boolean) => {
    if (isCurrentlyPlaying) {
      if (musicPreviewAudioRef.current) {
        musicPreviewAudioRef.current.pause();
        musicPreviewAudioRef.current.src = '';
        musicPreviewAudioRef.current = null;
      }
      setMusicPreviewPlayingId(null);
      return;
    }

    if (musicPreviewAudioRef.current) {
      musicPreviewAudioRef.current.pause();
      musicPreviewAudioRef.current.src = '';
      musicPreviewAudioRef.current = null;
    }

    const externalId = item.externalId;
    setMusicPreviewLoading(externalId);

    const tryPlayUrl = (url: string): Promise<boolean> => {
      return new Promise((resolve) => {
        const audio = new Audio(url);
        musicPreviewAudioRef.current = audio;
        setMusicPreviewPlayingId(externalId);

        audio.oncanplaythrough = () => {
          setMusicPreviewLoading(null);
          audio.play().catch(() => {
            setMusicPreviewPlayingId(null);
            resolve(false);
          });
        };

        audio.onended = () => {
          setMusicPreviewPlayingId(null);
          if (musicPreviewAudioRef.current === audio) musicPreviewAudioRef.current = null;
        };

        audio.onerror = () => {
          setMusicPreviewPlayingId(null);
          if (musicPreviewAudioRef.current === audio) musicPreviewAudioRef.current = null;
          resolve(false);
        };

        audio.onplay = () => resolve(true);
        audio.load();

        setTimeout(() => {
          if (musicPreviewPlayingId !== externalId) resolve(false);
        }, 10000);
      });
    };

    try {
      if (musicPreviewUrlCache.current[externalId]) {
        const cached = musicPreviewUrlCache.current[externalId];
        const success = await tryPlayUrl(cached);
        if (success) return;
      }

      // Try previewUrl first (works for both HeyGen and Magnific)
      if (item.previewUrl) {
        const success = await tryPlayUrl(item.previewUrl);
        if (success) {
          musicPreviewUrlCache.current[externalId] = item.previewUrl;
          return;
        }
      }

      // HeyGen: try audioUrl if previewUrl failed
      if (item.audioUrl) {
        const success = await tryPlayUrl(item.audioUrl);
        if (success) {
          musicPreviewUrlCache.current[externalId] = item.audioUrl;
          return;
        }
      }

      // For HeyGen tracks, we can't use the Magnific proxy endpoints
      if (item.source === 'heygen') {
        showToast('Could not play preview for this track', 'error');
        return;
      }

      // Magnific fallbacks: try preview-info endpoint
      const infoRes = await fetch(`/api/music/${externalId}/preview-info`, { headers: musicHeaders() });
      if (infoRes.ok) {
        const infoJson = await infoRes.json();
        const fetchedUrl = infoJson?.data?.previewUrl || infoJson?.data?.fileUrl;
        if (fetchedUrl) {
          const success = await tryPlayUrl(fetchedUrl);
          if (success) {
            musicPreviewUrlCache.current[externalId] = fetchedUrl;
            return;
          }
        }
      }

      const proxyUrl = `/api/music/${externalId}/preview`;
      const success = await tryPlayUrl(proxyUrl);
      if (success) {
        musicPreviewUrlCache.current[externalId] = proxyUrl;
        return;
      }

      showToast('Could not play preview for this track', 'error');
    } catch (err) {
      console.error('[Music Preview] Error:', err);
      showToast('Could not play preview', 'error');
    } finally {
      setMusicPreviewLoading(null);
    }
  }, [musicHeaders, musicPreviewPlayingId, showToast]);

  const persistBackgroundMusic = useCallback(async (patch?: Partial<BackgroundMusicConfig>) => {
    if (!projectId || !musicHydratedRef.current) return;
    const payload: BackgroundMusicConfig = {
      enabled: backgroundMusicEnabled,
      searchSeed: musicSearchSeed || undefined,
      mixVolume: 0.05,
      voiceDuckTo: 1.0,
      fadeInMs: 500,
      fadeOutMs: 1500,
      ...(musicSelected || {}),
      ...(patch || {}),
    };
    if (musicSaveTimeoutRef.current) clearTimeout(musicSaveTimeoutRef.current);
    musicSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await apiClient.updateVideoProject(projectId, { backgroundMusic: payload });
      } catch (err) {
        console.error('[Workspace] Failed to persist background music:', err);
      }
    }, 350);
  }, [projectId, backgroundMusicEnabled, musicSearchSeed, musicSelected]);

  useEffect(() => {
    if (!musicHydratedRef.current) return;
    persistBackgroundMusic();
  }, [backgroundMusicEnabled, persistBackgroundMusic]);

  useEffect(() => {
    if (
      backgroundMusicEnabled &&
      musicExpanded &&
      musicTab === 'library' &&
      musicLibraryItems.length === 0 &&
      !musicLoading &&
      !musicError
    ) {
      fetchMusicLibrary({ useSeed: true });
    }
  }, [backgroundMusicEnabled, musicExpanded, musicTab, musicLibraryItems.length, musicLoading, musicError, fetchMusicLibrary]);

  useEffect(() => {
    if (!isAuthenticated || !projectId) return;
    const tick = () => {
      apiClient.postVideoPresence(projectId).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      clearInterval(id);
      apiClient.postVideoPresence(null).catch(() => {});
    };
  }, [isAuthenticated, projectId]);

  // Handle back navigation
  const handleBack = () => {
    const meta = (project?.metadata || {}) as Record<string, unknown>;
    const exportFinalized = Boolean(meta.finalExportedAt);
    const nonSingleClipFinal =
      project?.status === 'COMPLETED' &&
      hasFinalVideo(project || {}) &&
      !isSingleClipVideoStyle(project?.style);

    if (exportFinalized || nonSingleClipFinal || workspaceMode === 'completed') {
      router.push('/projects');
      return;
    }

    if (projectId) {
      router.push(`/create-video/ai-chat?projectId=${projectId}`);
    } else {
      router.push('/create-video/ai-chat');
    }
  };

  const applyProjectVideoUrls = useCallback((projectData: {
    videoPublicUrl?: string;
    videoGcsUrl?: string;
    videoUrl?: string;
    metadata?: Record<string, unknown> | null;
  }) => {
    const final = getFinalVideoUrl(projectData, VIDEO_SERVICE_ORIGIN);
    setFinalVideoUrl(final);

    const previewErr = projectData.metadata?.previewGenerationError;
    setPreviewGenerationError(
      typeof previewErr === 'string' ? previewErr : null,
    );

    if (isPreviewReady(projectData)) {
      setPreviewPlaybackUrl(getPreviewPlaybackUrl(projectData, VIDEO_SERVICE_ORIGIN));
      setPreviewPreparing(false);
      return;
    }

    if (hasPreviewGenerationError(projectData)) {
      setPreviewPlaybackUrl(null);
      setPreviewPreparing(false);
      return;
    }

    if (hasFinalVideo(projectData)) {
      setPreviewPlaybackUrl(null);
      setPreviewPreparing(true);
    }
  }, []);

  const handleRetryPreview = useCallback(async () => {
    if (!projectId) return;
    setPreviewGenerationError(null);
    setPreviewPreparing(true);
    setPreviewPlaybackUrl(null);
    try {
      await apiClient.regenerateVideoPreview(projectId);
      showToast('Preview regeneration started', 'info');
    } catch {
      showToast('Could not start preview regeneration', 'error');
    }
  }, [projectId, showToast]);

  const stopPreviewPolling = useCallback(() => {
    previewPollStoppedRef.current = true;
    if (previewPollingRef.current) {
      clearInterval(previewPollingRef.current);
      previewPollingRef.current = null;
    }
  }, []);

  const refreshProjectForPreview = useCallback(async (options?: { force?: boolean }) => {
    if (!projectId) return;
    if (!options?.force && previewPollStoppedRef.current) return;
    try {
      const response = await apiClient.getVideoProject(projectId);
      if (!response.success || !response.data) return;

      const data = response.data;
      const fingerprint = [
        data.metadata?.previewVideoUrl,
        data.metadata?.previewFormatVersion,
        data.metadata?.previewGenerationError,
      ].join('|');

      if (fingerprint !== previewPollFingerprintRef.current) {
        previewPollFingerprintRef.current = fingerprint;
        setProject(data);
      }
      applyProjectVideoUrls(data);

      if (isPreviewReady(data) || hasPreviewGenerationError(data)) {
        stopPreviewPolling();
      }
    } catch (error) {
      console.warn('[Workspace] Preview refresh failed:', error);
    }
  }, [projectId, applyProjectVideoUrls, stopPreviewPolling]);

  // WebSocket: preview derivatives complete (user room — no per-job subscription)
  useEffect(() => {
    if (!projectId) return;

    return subscribeToQueueType('preview-derivatives', (update: JobStatusUpdate) => {
      if (update.metadata?.projectId !== projectId) return;

      if (update.state === 'completed') {
        stopPreviewPolling();
        const previewUrl = update.result?.previewVideoUrl;
        if (typeof previewUrl === 'string' && previewUrl.length > 0) {
          const playback =
            previewUrl.startsWith('http')
              ? previewUrl
              : getPreviewPlaybackUrl(
                  {
                    metadata: {
                      previewVideoUrl: previewUrl,
                      previewFormatVersion: update.result?.previewFormatVersion,
                    },
                  },
                  VIDEO_SERVICE_ORIGIN,
                );
          if (playback) {
            setPreviewPlaybackUrl(playback);
            setPreviewPreparing(false);
            setPreviewGenerationError(null);
          }
        }
        void refreshProjectForPreview({ force: true });
        return;
      }

      if (update.state === 'failed') {
        stopPreviewPolling();
        setPreviewGenerationError(update.error || 'Preview generation failed');
        setPreviewPreparing(false);
      }
    });
  }, [
    projectId,
    subscribeToQueueType,
    stopPreviewPolling,
    refreshProjectForPreview,
  ]);

  // Slow fallback poll until watermarked preview is ready (avoid hammering API)
  useEffect(() => {
    if (workspaceMode !== 'completed' || !projectId) {
      previewPollStoppedRef.current = false;
      stopPreviewPolling();
      return;
    }

    if (previewPollStoppedRef.current) {
      return;
    }

    if (previewPlaybackUrl) {
      stopPreviewPolling();
      return;
    }

    const pollPreview = async () => {
      if (previewPollStoppedRef.current) return;
      await refreshProjectForPreview();
    };

    void pollPreview();
    previewPollingRef.current = setInterval(pollPreview, 12_000);

    return () => {
      if (previewPollingRef.current) {
        clearInterval(previewPollingRef.current);
        previewPollingRef.current = null;
      }
    };
  }, [workspaceMode, projectId, previewPlaybackUrl, refreshProjectForPreview, stopPreviewPolling]);

  // Track preview container dimensions for overlay positioning (ResizeObserver catches initial layout)
  useEffect(() => {
    if (loading) return;

    let ro: ResizeObserver | null = null;
    let rafId: number | null = null;

    const updateDimensions = () => {
      const el = previewContainerRef.current;
      if (!el) return;
      setViewportWidth(window.innerWidth);
      const rect = el.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) {
        setPreviewDimensions({ width: w, height: h });
      }
      setMobileDrawerFrame({
        top: Math.max(96, rect.top),
        height: Math.max(260, Math.round(rect.height)),
      });
    };

    const attach = () => {
      const el = previewContainerRef.current;
      if (!el) {
        rafId = requestAnimationFrame(attach);
        return;
      }
      updateDimensions();
      ro = new ResizeObserver(() => updateDimensions());
      ro.observe(el);
      window.addEventListener('resize', updateDimensions);
    };

    attach();

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, [loading, workspaceMode, selectedSceneIndex, sceneCount, captionsEnabled]);

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      if (window.innerWidth >= WORKSPACE_SIDEBAR_BREAKPOINT_PX) {
        setLeftDrawerOpen(false);
        setRightDrawerOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Handle scene navigation
  const handlePreviousScene = () => {
    if (selectedSceneIndex > 0) {
      setSelectedSceneIndex(selectedSceneIndex - 1);
    }
  };

  const handleNextScene = () => {
    if (selectedSceneIndex < sceneCount - 1) {
      setSelectedSceneIndex(selectedSceneIndex + 1);
    }
  };

  // Handle image upload - opens B-roll selection modal for current scene
  const handleUpload = () => {
    handleOpenBrollModal(currentSceneNumber);
  };
  const handleSceneUpload = (sceneNumber: number) => {
    setSelectedSceneIndex(Math.max(0, sceneNumber - 1));
    handleOpenBrollModal(sceneNumber);
  };

  // Save avatar overlay settings to project metadata (debounced)
  const saveAvatarOverlaySettings = useCallback(async (settings: {
    enabled: boolean;
    applyToAll: boolean;
    globalPosition: { x: number; y: number; scale: number };
    perScenePositions?: Record<number, { x: number; y: number; scale: number }>;
    aspectRatio?: number;
  }) => {
    if (!projectId || !project) return;
    
    // Clear any existing timeout
    if (avatarSaveTimeoutRef.current) {
      clearTimeout(avatarSaveTimeoutRef.current);
    }
    
    // Debounce save by 300ms
    avatarSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await apiClient.updateVideoProject(projectId, {
          metadata: {
            ...project.metadata,
            avatarOverlay: {
              ...settings,
              aspectRatio: settings.aspectRatio ?? avatarPreviewAspectRatio,
            },
          }
        });
        console.log('[Workspace] Avatar overlay settings saved');
      } catch (error) {
        console.error('[Workspace] Failed to save avatar overlay settings:', error);
      }
    }, 300);
  }, [projectId, project, avatarPreviewAspectRatio]);

  const buildCaptionSettingsPayload = useCallback(() => ({
    enabled: captionsEnabled,
    displayMode: captionDisplayMode,
    applyToAll: true,
    globalPosition: captionGlobalPosition,
    perScenePositions: captionPerScenePositions,
    previewContainerHeight: previewDimensions.height > 0 ? previewDimensions.height : undefined,
    previewContainerWidth: previewDimensions.width > 0 ? previewDimensions.width : undefined,
    style: {
      fontFamily: captionStyle.fontFamily,
      fontSize: captionStyle.fontSize,
      fontWeight: captionStyle.fontWeight,
      fontStyle: captionStyle.fontStyle,
      textColor: captionStyle.textColor,
      backgroundColor: captionStyle.backgroundColor,
      borderColor: captionStyle.borderColor,
      borderWidth: captionStyle.borderWidth,
    },
  }), [
    captionsEnabled,
    captionDisplayMode,
    captionApplyToAll,
    captionGlobalPosition,
    captionPerScenePositions,
    previewDimensions.height,
    previewDimensions.width,
    captionStyle,
  ]);

  useEffect(() => {
    if (!projectId || !captionHydratedRef.current) return;
    if (captionSaveTimeoutRef.current) clearTimeout(captionSaveTimeoutRef.current);
    captionSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await apiClient.updateVideoProject(projectId, {
          captionsEnabled,
          captionSettings: buildCaptionSettingsPayload(),
        });
      } catch (error) {
        console.error('[Workspace] Failed to persist caption settings:', error);
      }
    }, 350);
    return () => {
      if (captionSaveTimeoutRef.current) clearTimeout(captionSaveTimeoutRef.current);
    };
  }, [
    projectId,
    captionsEnabled,
    captionDisplayMode,
    captionApplyToAll,
    captionGlobalPosition,
    captionPerScenePositions,
    captionStyle,
    buildCaptionSettingsPayload,
  ]);

  // Handle avatar overlay toggle
  const handleAvatarOverlayToggle = useCallback(() => {
    const newEnabled = !avatarOverlayEnabled;
    setAvatarOverlayEnabled(newEnabled);
    saveAvatarOverlaySettings({
      enabled: newEnabled,
      applyToAll: avatarApplyToAll,
      globalPosition: avatarGlobalPosition,
      perScenePositions: avatarPerScenePositions
    });
  }, [avatarOverlayEnabled, avatarApplyToAll, avatarGlobalPosition, avatarPerScenePositions, saveAvatarOverlaySettings]);

  // Handle "Apply to all scenes" toggle
  const handleApplyToAllToggle = useCallback(() => {
    const newApplyToAll = !avatarApplyToAll;
    setAvatarApplyToAll(newApplyToAll);
    
    if (!newApplyToAll) {
      // Switching to per-scene mode: initialize all scenes with current global position
      const currentSceneNumber = scenes[selectedSceneIndex]?.scene_number || 
                                  scenes[selectedSceneIndex]?.sceneNumber || 
                                  (selectedSceneIndex + 1);
      const newPerScenePositions: Record<number, { x: number; y: number; scale: number }> = {};
      scenes.forEach((scene, idx) => {
        const sceneNum = scene.scene_number || scene.sceneNumber || (idx + 1);
        newPerScenePositions[sceneNum] = { ...avatarGlobalPosition };
      });
      setAvatarPerScenePositions(newPerScenePositions);
      
      saveAvatarOverlaySettings({
        enabled: avatarOverlayEnabled,
        applyToAll: false,
        globalPosition: avatarGlobalPosition,
        perScenePositions: newPerScenePositions
      });
    } else {
      // Switching to global mode: use current scene's position as the new global
      const currentSceneNumber = scenes[selectedSceneIndex]?.scene_number || 
                                  scenes[selectedSceneIndex]?.sceneNumber || 
                                  (selectedSceneIndex + 1);
      const currentPosition = avatarPerScenePositions[currentSceneNumber] || avatarGlobalPosition;
      setAvatarGlobalPosition(currentPosition);
      
      saveAvatarOverlaySettings({
        enabled: avatarOverlayEnabled,
        applyToAll: true,
        globalPosition: currentPosition,
        perScenePositions: avatarPerScenePositions
      });
    }
  }, [avatarApplyToAll, avatarOverlayEnabled, avatarGlobalPosition, avatarPerScenePositions, scenes, selectedSceneIndex, saveAvatarOverlaySettings]);

  const LAYOUT_SCENE1_TOAST =
    'Layout is configured on Scene 1 and applies to your whole video. Switch to Scene 1 to change position or size.';

  const handleAvatarAspectRatioChange = useCallback((aspectRatio: number) => {
    setAvatarPreviewAspectRatio(aspectRatio);
    if (!projectId || !project) return;
    saveAvatarOverlaySettings({
      enabled: avatarOverlayEnabled,
      applyToAll: avatarApplyToAll,
      globalPosition: avatarGlobalPosition,
      perScenePositions: avatarPerScenePositions,
      aspectRatio,
    });
  }, [
    projectId,
    project,
    avatarOverlayEnabled,
    avatarApplyToAll,
    avatarGlobalPosition,
    avatarPerScenePositions,
    saveAvatarOverlaySettings,
  ]);

  // Handle avatar position change (from drag or resize)
  const handleAvatarPositionChange = useCallback((newPosition: { x: number; y: number; scale: number }) => {
    if (selectedSceneIndex !== 0) {
      showToast(LAYOUT_SCENE1_TOAST, 'info');
      return;
    }
    setAvatarGlobalPosition(newPosition);
    saveAvatarOverlaySettings({
      enabled: avatarOverlayEnabled,
      applyToAll: true,
      globalPosition: newPosition,
      perScenePositions: avatarPerScenePositions,
    });
  }, [avatarOverlayEnabled, avatarGlobalPosition, avatarPerScenePositions, selectedSceneIndex, saveAvatarOverlaySettings, showToast]);

  // Get current avatar position for the selected scene
  const getCurrentAvatarPosition = useCallback(() => avatarGlobalPosition, [avatarGlobalPosition]);

  // Handle caption position change
  const handleCaptionPositionChange = useCallback((newPosition: { x: number; y: number; scale: number; widthScale: number }) => {
    if (selectedSceneIndex !== 0) {
      showToast(LAYOUT_SCENE1_TOAST, 'info');
      return;
    }
    setCaptionGlobalPosition(newPosition);
  }, [selectedSceneIndex, showToast]);

  // Handle caption style change
  const handleCaptionStyleChange = useCallback((newStyle: typeof captionStyle) => {
    setCaptionStyle(newStyle);
    setCaptionStylePreset('custom');
  }, []);

  // Get current caption position for the selected scene
  const getCurrentCaptionPosition = useCallback(() => captionGlobalPosition, [captionGlobalPosition]);

  // Apply caption style preset
  const applyCaptionPreset = useCallback((preset: 'light' | 'dark' | 'transparent') => {
    setCaptionStylePreset(preset);
    if (preset === 'light') {
      setCaptionStyle({
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: 'bold',
        fontStyle: 'normal',
        textDecoration: 'none',
        textColor: '#000000',
        backgroundColor: '#FFFFFF',
        borderColor: 'transparent',
        borderWidth: 0,
      });
    } else if (preset === 'transparent') {
      setCaptionStyle({
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: 'bold',
        fontStyle: 'normal',
        textDecoration: 'none',
        textColor: '#FFFFFF',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidth: 0,
      });
    } else {
      setCaptionStyle({
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: 'bold',
        fontStyle: 'normal',
        textDecoration: 'none',
        textColor: '#FFFFFF',
        backgroundColor: '#000000',
        borderColor: 'transparent',
        borderWidth: 0,
      });
    }
  }, []);

  const mapServerImageToBroll = useCallback((raw: any, sceneNumber: number): BrollImage => {
    return {
      sceneNumber,
      imageUrl: raw.imageUrl || raw.image_url || '',
      localPath: raw.localPath || raw.local_path,
      localUrl: raw.localUrl || raw.local_url,
      gcsUrl: raw.gcsUrl || raw.gcs_url,
      publicUrl: raw.publicUrl || raw.public_url,
      prompt: raw.prompt,
    };
  }, []);

  const updateTabInUrl = useCallback(
    (mode: 'images' | 'videos') => {
      if (!projectId) return;
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.set('projectId', projectId);
      params.set('startMode', mode);
      router.replace(`/create-video/workspace?${params.toString()}`, { scroll: false });
    },
    [projectId, searchParams, router],
  );

  const handleSwitchToVideos = useCallback(() => {
    setWorkspaceMode('videos');
    updateTabInUrl('videos');
  }, [updateTabInUrl]);

  const handleBackToImages = useCallback(() => {
    setWorkspaceMode('images');
    setFailedGenerations(new Set());
    updateTabInUrl('images');
  }, [updateTabInUrl]);

  // Handle image regeneration
  const handleRegenerate = async (sceneIndexOverride?: number) => {
    if (!projectId) return;

    const sceneIndex = sceneIndexOverride !== undefined ? sceneIndexOverride : selectedSceneIndex;
    const currentScene = scenes[sceneIndex];
    if (!currentScene) return;

    const sceneNumber = currentScene.scene_number || currentScene.sceneNumber || (sceneIndex + 1);
    
    // For ALTERNATE style, only b-roll-type scenes need b-roll image prompts
    let prompt = currentScene.broll_image_prompt || currentScene.broll_prompt || currentScene.broll_visual_description || '';
    
    if (!prompt && project?.style === 'ALTERNATE' && isAlternateBrollScene(currentScene, sceneNumber)) {
      prompt = currentScene.broll_visual_description || `Scene ${sceneNumber} full-screen b-roll for ALTERNATE style`;
    }

    if (!prompt) {
      showToast('No prompt found for this scene', 'warning');
      return;
    }

    // Determine default model based on video style (processor uses model-4 when project has reference assets)
    const getDefaultModel = (style?: string) => {
      if (style === 'PRODUCT_ONLY' || style === 'AVATAR_PRODUCT') {
        return 'model-4'; // nano-banana-pro for product-focused styles
      }
      return 'model-1'; // FAL imagen4 for other styles; backend overrides to model-4 when refs present
    };

    try {
      showToast('Regenerating image...', 'info');
      const defaultModel = getDefaultModel(project?.style);
      const response = await apiClient.regenerateImage(
        projectId,
        sceneNumber,
        prompt,
        defaultModel,
        undefined,
        undefined,
        undefined,
        project?.style,
        true,
      );
      if (!response.success || !response.data) {
        showToast(response.message || 'Could not start image regeneration', 'error');
        return;
      }
      const { jobId, existing, image } = response.data;
      if (existing && image) {
        setBrollImages((prev) => {
          const next = mapServerImageToBroll(image, sceneNumber);
          const exists = prev.some((img) => img.sceneNumber === sceneNumber);
          if (exists) {
            return prev.map((img) => (img.sceneNumber === sceneNumber ? next : img));
          }
          return [...prev, next];
        });
        showToast('Image is already available for this scene', 'info');
        return;
      }
      if (jobId) {
        imageRegenJobToSceneRef.current.set(jobId, sceneNumber);
        setRegeneratingImageScenes((prev) => new Set(prev).add(sceneNumber));
        subscribeToJobRef.current?.(jobId, 'image-generation');
        showToast('Image regeneration started', 'success');
      }
    } catch (error: any) {
      console.error('Failed to regenerate image:', error);
      showToast('Failed to regenerate image', 'error');
    }
  };

  const handleRegenerateVideo = async (sceneIndexOverride?: number) => {
    if (!projectId) return;

    const sceneIndex = sceneIndexOverride !== undefined ? sceneIndexOverride : selectedSceneIndex;
    const currentScene = scenes[sceneIndex];
    if (!currentScene) return;

    const sceneNumber = currentScene.scene_number || currentScene.sceneNumber || (sceneIndex + 1);
    const isAvatarScene = project?.style === 'ALTERNATE' && isAlternateAvatarScene(currentScene, sceneNumber);
    const image = brollImages.find((img) => img.sceneNumber === sceneNumber);

    // ALTERNATE avatar scenes are generated from the project avatar image + scene
    // audio (HeyGen Avatar IV), so they don't have/need a b-roll source image.
    if (!isAvatarScene && !image?.imageUrl) {
      showToast('Source image not found. Cannot regenerate video without source image.', 'warning');
      return;
    }

    const activeJobs = videoJobIdsRef.current.get(sceneNumber);
    if (activeJobs && activeJobs.size > 0) {
      showToast('Video generation already in progress for this scene', 'warning');
      return;
    }

    try {
      if (isAvatarScene) {
        setAvatarVideos((prev) => prev.filter((vid) => vid.sceneNumber !== sceneNumber));
      } else {
        setBrollVideos((prev) => prev.filter((vid) => vid.sceneNumber !== sceneNumber));
      }
      setRegeneratingVideoScenes((prev) => new Set(prev).add(sceneNumber));
      setGeneratingVideos((prev) => new Set(prev).add(sceneNumber));
      showToast('Regenerating video...', 'info');

      const response = await apiClient.regenerateVideo(projectId, sceneNumber, 'video-model-1', true);

      if (response.success && response.data?.existing && response.data?.video) {
        const existingVideo = response.data.video;
        setBrollVideos((prev) => {
          const exists = prev.some((vid) => vid.sceneNumber === sceneNumber);
          if (exists) {
            return prev.map((vid) => (vid.sceneNumber === sceneNumber ? { ...existingVideo, sceneNumber } : vid));
          }
          return [...prev, { ...existingVideo, sceneNumber }];
        });
        setRegeneratingVideoScenes((prev) => {
          const next = new Set(prev);
          next.delete(sceneNumber);
          return next;
        });
        setGeneratingVideos((prev) => {
          const next = new Set(prev);
          next.delete(sceneNumber);
          return next;
        });
        showToast('Video already exists for this scene', 'info');
        return;
      }

      if (response.success && response.data?.jobId) {
        const jobId = response.data.jobId;
        const queueType = getVideoJobQueueType(response.data?.type);
        videoRegenJobToSceneRef.current.set(jobId, sceneNumber);
        if (!videoJobIdsRef.current.has(sceneNumber)) {
          videoJobIdsRef.current.set(sceneNumber, new Set());
        }
        videoJobIdsRef.current.get(sceneNumber)!.add(jobId);
        jobToSceneRef.current.set(jobId, sceneNumber);
        subscribeToJobRef.current?.(jobId, queueType);
        showToast('Video regeneration started', 'success');
        return;
      }

      throw new Error(response.message || 'Could not start video regeneration');
    } catch (error: any) {
      console.error('Failed to regenerate video:', error);
      setRegeneratingVideoScenes((prev) => {
        const next = new Set(prev);
        next.delete(sceneNumber);
        return next;
      });
      setGeneratingVideos((prev) => {
        const next = new Set(prev);
        next.delete(sceneNumber);
        return next;
      });
      showToast(error?.message || 'Failed to regenerate video', 'error');
    }
  };

  const handleSceneRegenerate = async (sceneIndex: number) => {
    setSelectedSceneIndex(sceneIndex);
    if (workspaceMode === 'videos') {
      await handleRegenerateVideo(sceneIndex);
    } else {
      await handleRegenerate(sceneIndex);
    }
  };

  // Handle convert to videos (uses batch API)
  const handleConvertToVideos = async () => {
    if (!projectId) return;

    const scenesNeedingVideos = scenes.filter((scene, index) => {
      const sceneNumber = scene.scene_number || scene.sceneNumber || (index + 1);
      if (project?.style === 'ALTERNATE' && isAlternateAvatarScene(scene, sceneNumber)) {
        const avatarVideos = ((project as any)?.avatarVideos as any[]) || [];
        const hasAvatar = avatarVideos.some(
          (v: any) => v.sceneNumber === sceneNumber && (v.localUrl || v.localPath),
        );
        return !hasAvatar;
      }
      const hasImage = brollImages.some(img => img.sceneNumber === sceneNumber);
      const hasVideo = brollVideos.some(vid => vid.sceneNumber === sceneNumber);
      return hasImage && !hasVideo;
    });

    if (scenesNeedingVideos.length === 0) {
      showToast('All scenes already have videos', 'info');
      handleSwitchToVideos();
      return;
    }

    try {
      setWorkspaceMode('converting');
      setFailedGenerations(new Set());
      showToast('Video generation started for all scenes', 'info');

      const response = await apiClient.convertToVideos(projectId, { forceRegenerate: false });

      if (!response.success || !response.data?.jobs?.length) {
        const sceneNumbers = scenesNeedingVideos.map((s, i) => s.scene_number ?? s.sceneNumber ?? i + 1);
        const fallbackPromises = sceneNumbers.map(async (sceneNumber) => {
          try {
            const r = await apiClient.regenerateVideo(projectId, sceneNumber, 'video-model-1', false);
            if (r.success && r.data?.existing && r.data?.video) {
              setBrollVideos(prev => {
                const exists = prev.some(v => v.sceneNumber === sceneNumber);
                if (exists) return prev.map(v => v.sceneNumber === sceneNumber ? r.data!.video : v);
                return [...prev, r.data!.video];
              });
              return;
            }
            if (r.success && r.data?.jobId) {
              const jobId = r.data.jobId;
              const queueType = getVideoJobQueueType(r.data?.type);
              if (!videoJobIdsRef.current.has(sceneNumber)) {
                videoJobIdsRef.current.set(sceneNumber, new Set());
              }
              videoJobIdsRef.current.get(sceneNumber)!.add(jobId);
              jobToSceneRef.current.set(jobId, sceneNumber);
              setGeneratingVideos(prev => new Set(prev).add(sceneNumber));
              subscribeToJob(jobId, queueType);
            }
          } catch (err: any) {
            showToast(`Failed for scene ${sceneNumber}`, 'error');
            setFailedGenerations(prev => new Set(prev).add(sceneNumber));
          }
        });
        await Promise.all(fallbackPromises);
        return;
      }

      for (const j of response.data.jobs) {
        const { sceneNumber, jobId, type } = j;
        if (!videoJobIdsRef.current.has(sceneNumber)) {
          videoJobIdsRef.current.set(sceneNumber, new Set());
        }
        videoJobIdsRef.current.get(sceneNumber)!.add(jobId);
        jobToSceneRef.current.set(jobId, sceneNumber);
        setGeneratingVideos(prev => new Set(prev).add(sceneNumber));
        const queueType = getVideoJobQueueType(type);
        subscribeToJob(jobId, queueType);
        console.log(`[Workspace] Subscribed to ${queueType} job ${jobId} for scene ${sceneNumber}`);
      }
    } catch (error: any) {
      console.error('Failed to start video generation:', error);
      showToast('Failed to start video generation', 'error');
      setWorkspaceMode('images');
    }
  };

  // Stage labels for rendering progress
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

  // Rendering timeout (10 minutes)
  const RENDERING_TIMEOUT_MS = 30 * 60 * 1000;
  const renderingStartTimeRef = useRef<number | null>(null);
  const consecutiveErrorsRef = useRef<number>(0);
  const MAX_CONSECUTIVE_ERRORS = 5;

  // Start rendering status polling
  const startRenderingPolling = useCallback(() => {
    if (renderingPollingRef.current) {
      clearInterval(renderingPollingRef.current);
    }

    // Reset counters
    renderingStartTimeRef.current = Date.now();
    consecutiveErrorsRef.current = 0;

    renderingPollingRef.current = setInterval(async () => {
      if (!projectId) return;

      // Check for timeout
      if (renderingStartTimeRef.current && (Date.now() - renderingStartTimeRef.current > RENDERING_TIMEOUT_MS)) {
        clearInterval(renderingPollingRef.current!);
        renderingPollingRef.current = null;
        showToast('Video rendering timed out. Please try again.', 'error');
        setWorkspaceMode('videos');
        return;
      }

      try {
        const response = await apiClient.getRenderingStatus(projectId);
        
        // Reset error counter on successful response
        consecutiveErrorsRef.current = 0;
        
        if (response.success && response.data) {
          const { renderingStatus, renderingProgress: progress, status, videoUrl, videoPublicUrl, videoGcsUrl, errorMessage } = response.data;
          
          // Update progress
          setRenderingProgress(progress || 0);
          setRenderingStage(renderingStatus || 'pending');

          // Check for failure
          if (status === 'FAILED' || renderingStatus === 'failed') {
            clearInterval(renderingPollingRef.current!);
            renderingPollingRef.current = null;
            showToast(errorMessage || 'Video rendering failed. Please try again.', 'error');
            setWorkspaceMode('videos');
            return;
          }

          // Check for completion — final ready: exit render UI; preview continues in background
          if (status === 'COMPLETED' || renderingStatus === 'completed') {
            clearInterval(renderingPollingRef.current!);
            renderingPollingRef.current = null;
            setRenderingProgress(100);
            setRenderingStage('completed');

            let landedOnVideosEditing = false;

            try {
              const projectRes = await apiClient.getVideoProject(projectId);
              if (projectRes.success && projectRes.data) {
                setProject(projectRes.data);
                applyProjectVideoUrls(projectRes.data);

                if (isRawAvatarClipEditingPhase(projectRes.data)) {
                  landedOnVideosEditing = true;
                  const meta = (projectRes.data.metadata || {}) as Record<string, unknown>;
                  const rawUrl =
                    (typeof meta.rawAvatarClipUrl === 'string'
                      ? meta.rawAvatarClipUrl
                      : projectRes.data.videoUrl) || projectRes.data.videoUrl;
                  if (rawUrl) {
                    setFinalVideoUrl(
                      rawUrl.startsWith('http')
                        ? rawUrl
                        : `${VIDEO_SERVICE_ORIGIN}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`,
                    );
                  }
                }
              } else if (videoUrl) {
                applyProjectVideoUrls({
                  videoUrl,
                  metadata: response.data?.metadata,
                });
              }
            } catch {
              if (videoUrl) {
                applyProjectVideoUrls({ videoUrl, metadata: response.data?.metadata });
              }
            }

            previewPollStoppedRef.current = false;
            previewPollFingerprintRef.current = null;

            setTimeout(() => {
              if (landedOnVideosEditing) {
                setWorkspaceMode('videos');
                showToast('Avatar video ready — add music and captions, then export.', 'success');
              } else {
                setWorkspaceMode('completed');
                showToast('Video rendering completed!', 'success');
              }
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('credits-refresh'));
              }
            }, 500);
            return;
          }
        }
      } catch (error: any) {
        console.error('Failed to poll rendering status:', error);
        consecutiveErrorsRef.current++;
        
        // Stop polling after too many consecutive errors
        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
          clearInterval(renderingPollingRef.current!);
          renderingPollingRef.current = null;
          showToast('Lost connection to server. Please check your connection and try again.', 'error');
          setWorkspaceMode('videos');
          return;
        }
        // Otherwise, don't stop polling on transient errors
      }
    }, 2000);
  }, [projectId, showToast]);

  const startRenderAfterConfirmation = async () => {
    if (!projectId) return;
    setWorkspaceMode('rendering');
    setRenderingProgress(0);
    setRenderingStage('pending');

    try {
      // Persist current caption state before rendering (enabled or disabled).
      await apiClient.updateVideoProject(projectId, {
        captionsEnabled,
        captionSettings: buildCaptionSettingsPayload(),
      });
      console.log('[Workspace] Caption settings saved before rendering');

      const usePostProcess = isRawAvatarClipEditingPhase(project || {});

      const response = usePostProcess
        ? await apiClient.postProcessVideoExport(projectId)
        : await apiClient.startVideoRendering(projectId);

      if (!response.success) {
        throw new Error(response.message || 'Failed to start rendering');
      }

      console.log(
        usePostProcess
          ? '[Workspace] Post-process export started successfully'
          : '[Workspace] Rendering started successfully',
      );
      startRenderingPolling();
    } catch (error: any) {
      console.error('Failed to start rendering:', error);
      const status = error?.response?.status;
      const raw = error?.response?.data;
      const payload = typeof raw?.message === 'object' && raw?.message !== null ? raw.message : raw;
      if (
        status === 402 ||
        payload?.code === 'INSUFFICIENT_CREDITS' ||
        (typeof raw?.message === 'object' && (raw.message as { code?: string })?.code === 'INSUFFICIENT_CREDITS')
      ) {
        const req = (payload as { requiredCredits?: number })?.requiredCredits;
        const cur = (payload as { currentBalance?: number })?.currentBalance;
        const line =
          typeof req === 'number' && typeof cur === 'number'
            ? `This export requires ${req} credits; you have ${cur}.`
            : (payload as { message?: string })?.message ||
              (typeof raw?.message === 'string' ? raw.message : 'Insufficient credits');
        showToast(line, 'error');
      } else {
        const msg =
          (typeof raw?.message === 'string' ? raw.message : null) ||
          (typeof payload?.message === 'string' ? payload.message : null) ||
          error.message ||
          'Failed to start rendering. Please try again.';
        showToast(msg, 'error');
      }
      setWorkspaceMode('videos');
      throw error;
    }
  };

  // Handle export - show cost confirmation before starting final rendering
  const handleExport = async () => {
    if (!projectId) return;
    try {
      const quote = await apiClient.getProjectCostBreakdown(projectId);
      if (quote.success) {
        setExportCostBreakdown(quote.data || null);
      } else {
        setExportCostBreakdown(null);
      }
    } catch {
      setExportCostBreakdown(null);
    }
    setShowExportConfirm(true);
  };

  const confirmExportAndRender = async () => {
    setExportConfirmLoading(true);
    try {
      setShowExportConfirm(false);
      await startRenderAfterConfirmation();
    } finally {
      setExportConfirmLoading(false);
    }
  };

  // Handle opening B-roll selection modal
  const handleOpenBrollModal = (sceneNumber: number) => {
    setBrollModalSceneNumber(sceneNumber);
    setBrollModalOpen(true);
  };

  // Handle B-roll selection from modal
  const handleBrollSelection = async (selection: BRollSelection) => {
    if (!projectId) return;

    try {
      let fileUrl = selection.url;

      // For uploads: upload file first to get a URL, then process (avoids 413 from large base64 in JSON)
      if (selection.source === 'upload' && selection.file) {
        const formData = new FormData();
        formData.append('file', selection.file);
        const uploadRes = await fetch(`/api/video/${projectId}/upload-broll`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData.success || !uploadData.data?.url) {
          throw new Error(uploadData.message || 'Failed to upload file');
        }
        fileUrl = uploadData.data.url;
      }

      const response = await fetch(`/api/video/${projectId}/process-custom-broll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({
          sceneNumber: brollModalSceneNumber,
          source: selection.source,
          sourceId: selection.id,
          fileUrl,
          mediaType: selection.type.includes('image') ? 'image' : 'video',
          targetAspectRatio:
            project?.style === 'HALF_N_HALF'
              ? '9:8'
              : '9:16',
        }),
      });

      const data = await response.json();

      if (data.success) {
        showToast(`B-roll updated for scene ${brollModalSceneNumber}`, 'success');

        // Reload project from API so preview / scene rail match persisted GCS URLs and script (same as AI chat flow)
        try {
          const refreshed = await apiClient.getVideoProject(projectId);
          if (refreshed.success && refreshed.data) {
            const pd = refreshed.data;
            setProject(pd);
            if (pd.bRollImages) {
              setBrollImages(Array.isArray(pd.bRollImages) ? pd.bRollImages : []);
            }
            if (pd.bRollVideoTasks) {
              setBrollVideos(Array.isArray(pd.bRollVideoTasks) ? pd.bRollVideoTasks : []);
            }
            if (pd.avatarVideos) {
              setAvatarVideos(Array.isArray(pd.avatarVideos) ? pd.avatarVideos : []);
            }
            if (pd.script) {
              const script = typeof pd.script === 'string' ? JSON.parse(pd.script) : pd.script;
              const scriptScenes = script.scenes || script.scene_plan || [];
              setScenes(scriptScenes);
            }
          }
        } catch (reErr) {
          console.warn('[Workspace] Refetch after B-roll failed, using optimistic state:', reErr);
          if (selection.type.includes('image')) {
            setBrollImages(prev => {
              const exists = prev.some(b => b.sceneNumber === brollModalSceneNumber);
              const newEntry = {
                sceneNumber: brollModalSceneNumber,
                imageUrl: fileUrl,
                localUrl: fileUrl,
                customUpload: selection.source === 'upload',
              };
              if (exists) {
                return prev.map(b => (b.sceneNumber === brollModalSceneNumber ? { ...b, ...newEntry } : b));
              }
              return [...prev, newEntry];
            });
          } else {
            setBrollVideos(prev => {
              const exists = prev.some(b => b.sceneNumber === brollModalSceneNumber);
              const newEntry = {
                sceneNumber: brollModalSceneNumber,
                videoUrl: fileUrl,
                localUrl: fileUrl,
                customUpload: selection.source === 'upload',
              };
              if (exists) {
                return prev.map(b => (b.sceneNumber === brollModalSceneNumber ? { ...b, ...newEntry } : b));
              }
              return [...prev, newEntry];
            });
          }
        }
      } else {
        throw new Error(data.message || 'Failed to process B-roll');
      }
    } catch (error: any) {
      console.error('Failed to process B-roll:', error);
      showToast(error.message || 'Failed to update B-roll', 'error');
    }
  };

  // Cancel rendering and go back to videos mode
  const handleCancelRendering = useCallback(() => {
    if (renderingPollingRef.current) {
      clearInterval(renderingPollingRef.current);
      renderingPollingRef.current = null;
    }
    setWorkspaceMode('videos');
    showToast('Rendering cancelled', 'info');
  }, [showToast]);

  // Cleanup rendering polling on unmount
  useEffect(() => {
    return () => {
      if (renderingPollingRef.current) {
        clearInterval(renderingPollingRef.current);
      }
    };
  }, []);

  // WebSocket handler for video generation and scene-composite updates
  const handleJobStatusUpdate = useCallback((update: JobStatusUpdate) => {
    if (update.queueType === 'image-generation') {
      const jobId = update.jobId;
      const img = update.result?.image;
      const sceneFromImage = img?.sceneNumber ?? img?.scene_number;
      const sceneNumber =
        (typeof sceneFromImage === 'number'
          ? sceneFromImage
          : sceneFromImage != null
            ? parseInt(String(sceneFromImage), 10)
            : undefined) ?? imageRegenJobToSceneRef.current.get(jobId);

      if (update.state === 'completed' && img && sceneNumber != null && !Number.isNaN(sceneNumber)) {
        if (processedImageJobIdsRef.current.has(jobId)) {
          return;
        }
        processedImageJobIdsRef.current.add(jobId);

        const next = mapServerImageToBroll(img, sceneNumber);
        setBrollImages((prev) => {
          const exists = prev.some((i) => i.sceneNumber === sceneNumber);
          if (exists) {
            return prev.map((i) => (i.sceneNumber === sceneNumber ? next : i));
          }
          return [...prev, next];
        });

        setRegeneratingImageScenes((prev) => {
          const n = new Set(prev);
          n.delete(sceneNumber);
          return n;
        });
        imageRegenJobToSceneRef.current.delete(jobId);
        unsubscribeFromJobRef.current?.(jobId);
        showToast(`Image ready for Scene ${sceneNumber}`, 'success');
        return;
      }

      if (update.state === 'failed') {
        const sn = sceneNumber ?? imageRegenJobToSceneRef.current.get(jobId);
        if (sn != null) {
          setRegeneratingImageScenes((prev) => {
            const n = new Set(prev);
            n.delete(sn);
            return n;
          });
          imageRegenJobToSceneRef.current.delete(jobId);
          showToast(update.error || `Image regeneration failed for Scene ${sn}`, 'error');
        }
        unsubscribeFromJobRef.current?.(jobId);
        return;
      }

      return;
    }

    const isVideo = update.queueType === 'video-generation';
    const isAvatar = update.queueType === 'avatar-video-generation';
    const isComposite = update.queueType === 'scene-composite';
    const sceneNum = update.result?.video?.sceneNumber ?? update.metadata?.sceneNumber;

    if (update.state === 'progress' && isComposite && sceneNum) {
      console.log('[Workspace] Legacy scene-composite progress:', sceneNum, update.metadata?.stage);
      return;
    }

    if (isVideo || isAvatar || isComposite) {
      if (update.state === 'completed' && update.result?.success && isAvatar) {
        const video = update.result.video;
        const jobId = update.jobId;
        const sceneNumber =
          normalizeSceneNumber(video?.sceneNumber) ??
          normalizeSceneNumber(update.metadata?.sceneNumber) ??
          jobToSceneRef.current.get(jobId);
        
        console.log('[Workspace] 🎬 Avatar video completed via WebSocket:', {
          jobId,
          sceneNumber,
          hasVideo: !!video,
          localUrl: video?.localUrl || video?.local_url,
        });
        
        if (sceneNumber != null) {
          // Update avatarVideos state with the completed video from WebSocket
          if (video) {
            const updatedVideo: BrollVideo = {
              ...video,
              jobId,
              sceneNumber,
              localPath: video.localPath || video.local_path,
              localUrl: video.localUrl || video.local_url,
              videoUrl: video.videoUrl || video.video_url,
            };
            console.log('[Workspace] ✅ Updating avatarVideos state with:', updatedVideo);
            setAvatarVideos((prev) => {
              const exists = prev.some((v) => normalizeSceneNumber(v.sceneNumber) === sceneNumber);
              const updated = exists
                ? prev.map((v) => normalizeSceneNumber(v.sceneNumber) === sceneNumber ? updatedVideo : v)
                : [...prev, updatedVideo];
              console.log('[Workspace] 📊 avatarVideos state updated:', updated.length, 'videos');
              return updated;
            });
          }
          setGeneratingVideos((prev) => {
            const next = new Set(prev);
            next.delete(sceneNumber);
            return next;
          });
          setRegeneratingVideoScenes((prev) => {
            const next = new Set(prev);
            next.delete(sceneNumber);
            return next;
          });
          showToast(`Avatar video generated for Scene ${sceneNumber}`, 'success');
        }
        processedJobIdsRef.current.add(jobId);
        unsubscribeFromJobRef.current?.(jobId);
        jobToSceneRef.current.delete(jobId);
        
        // Delay project refresh to avoid race condition with database commit
        // Don't overwrite avatarVideos since we just updated it from WebSocket
        if (projectId) {
          setTimeout(() => {
            apiClient.getVideoProject(projectId).then((refreshed) => {
              if (refreshed.success && refreshed.data) {
                // Update project but preserve the avatarVideos we just set from WebSocket
                setProject(refreshed.data);
                // Only update avatarVideos from server if it has more videos than our current state
                // This prevents race condition where server returns stale data
                setAvatarVideos((currentAvatarVideos) => {
                  const serverAvatarVideos = Array.isArray(refreshed.data.avatarVideos) ? refreshed.data.avatarVideos : [];
                  // Keep the version with more complete data (more videos or same count)
                  if (serverAvatarVideos.length > currentAvatarVideos.length) {
                    console.log('[Workspace] 🔄 Server has more avatar videos, updating state');
                    return serverAvatarVideos;
                  }
                  console.log('[Workspace] ⏭️ Keeping WebSocket avatarVideos (server has same or fewer)');
                  return currentAvatarVideos;
                });
              }
            }).catch(() => {});
          }, 1000); // 1 second delay to allow database commit
        }
        return;
      }

      if (update.state === 'completed' && update.result?.success && update.result?.video) {
        const video = update.result.video;
        const jobId = update.jobId;
        const sceneNumber =
          normalizeSceneNumber(video.sceneNumber) ??
          normalizeSceneNumber(update.metadata?.sceneNumber) ??
          jobToSceneRef.current.get(jobId);
        if (sceneNumber == null) {
          console.warn('[Workspace] Completed video missing sceneNumber', { jobId, video });
          processedJobIdsRef.current.add(jobId);
          unsubscribeFromJobRef.current?.(jobId);
          jobToSceneRef.current.delete(jobId);
          return;
        }

        // Prevent duplicate processing
        if (processedJobIdsRef.current.has(jobId)) {
          console.log(`[Workspace] ⏭️ Job ${jobId} already processed, skipping duplicate update`);
          return;
        }
        processedJobIdsRef.current.add(jobId);

        console.log('[Workspace] ✅ Processing completed video:', {
          jobId,
          sceneNumber,
          localUrl: video.localUrl || video.local_url,
          localPath: video.localPath || video.local_path,
          videoUrl: video.videoUrl || video.video_url,
        });

        // Update broll videos state
        setBrollVideos((prev) => {
          const exists = prev.some((v) => normalizeSceneNumber(v.sceneNumber) === sceneNumber);
          const updatedVideo: BrollVideo = {
            ...video,
            jobId,
            sceneNumber,
            localPath: video.localPath || video.local_path,
            localUrl: video.localUrl || video.local_url,
            videoUrl: video.videoUrl || video.video_url,
          };

          if (exists) {
            return prev.map((v) =>
              normalizeSceneNumber(v.sceneNumber) === sceneNumber ? updatedVideo : v,
            );
          }
          return [...prev, updatedVideo];
        });

        // Remove from generating set (always use numeric scene index)
        setGeneratingVideos((prev) => {
          const next = new Set(prev);
          next.delete(sceneNumber);
          return next;
        });
        setRegeneratingVideoScenes((prev) => {
          const next = new Set(prev);
          next.delete(sceneNumber);
          return next;
        });

        unsubscribeFromJobRef.current?.(jobId);
        videoRegenJobToSceneRef.current.delete(jobId);

        const expectedJobs = videoJobIdsRef.current.get(sceneNumber);
        if (expectedJobs) {
          expectedJobs.delete(jobId);
          if (expectedJobs.size === 0) {
            videoJobIdsRef.current.delete(sceneNumber);
          }
        }
        jobToSceneRef.current.delete(jobId);

        showToast(`Video generated for Scene ${sceneNumber}`, 'success');
      } else if (
        update.state === 'completed' &&
        (isVideo || isComposite) &&
        !(update.result?.success && update.result?.video)
      ) {
        const jobId = update.jobId;
        const mapped = jobToSceneRef.current.get(jobId);
        const sceneNumber =
          normalizeSceneNumber(update.metadata?.sceneNumber) ??
          normalizeSceneNumber(update.result?.video?.sceneNumber) ??
          mapped;
        console.warn('[Workspace] Job completed without usable video payload', {
          jobId,
          queueType: update.queueType,
          success: update.result?.success,
        });
        if (!processedJobIdsRef.current.has(jobId)) {
          processedJobIdsRef.current.add(jobId);
        }
        unsubscribeFromJobRef.current?.(jobId);
        if (sceneNumber != null) {
          setGeneratingVideos((prev) => {
            const next = new Set(prev);
            next.delete(sceneNumber);
            return next;
          });
          setRegeneratingVideoScenes((prev) => {
            const next = new Set(prev);
            next.delete(sceneNumber);
            return next;
          });
          setFailedGenerations((prev) => new Set(prev).add(sceneNumber));
          const expectedJobs = videoJobIdsRef.current.get(sceneNumber);
          if (expectedJobs) {
            expectedJobs.delete(jobId);
            if (expectedJobs.size === 0) {
              videoJobIdsRef.current.delete(sceneNumber);
            }
          }
          showToast(`Video generation finished without output for Scene ${sceneNumber}`, 'warning');
        }
        jobToSceneRef.current.delete(jobId);
        videoRegenJobToSceneRef.current.delete(jobId);
      } else if (update.state === 'failed') {
        const jobId = update.jobId;
        const sceneNumber =
          normalizeSceneNumber(jobToSceneRef.current.get(jobId)) ??
          normalizeSceneNumber(update.metadata?.sceneNumber);

        if (sceneNumber != null) {
          setGeneratingVideos((prev) => {
            const next = new Set(prev);
            next.delete(sceneNumber);
            return next;
          });
          setRegeneratingVideoScenes((prev) => {
            const next = new Set(prev);
            next.delete(sceneNumber);
            return next;
          });

          setFailedGenerations((prev) => new Set(prev).add(sceneNumber));

          const expectedJobs = videoJobIdsRef.current.get(sceneNumber);
          if (expectedJobs) {
            expectedJobs.delete(jobId);
            if (expectedJobs.size === 0) {
              videoJobIdsRef.current.delete(sceneNumber);
            }
          }
          showToast(`Video generation failed for Scene ${sceneNumber}`, 'error');
        }

        jobToSceneRef.current.delete(jobId);
        videoRegenJobToSceneRef.current.delete(jobId);
        unsubscribeFromJobRef.current?.(jobId);
      }
    }
  }, [showToast, mapServerImageToBroll]);

  // WebSocket integration
  const { subscribeToJob, unsubscribeFromJob } = useWebSocket({
    onJobStatusUpdate: handleJobStatusUpdate,
  });
  unsubscribeFromJobRef.current = unsubscribeFromJob;
  subscribeToJobRef.current = subscribeToJob;

  // Video playback handlers
  const handlePlayVideo = (sceneNumber: number, videoUrl: string) => {
    // Stop currently playing video
    if (playingVideo !== null && videoElementsRef.current[playingVideo]) {
      videoElementsRef.current[playingVideo].pause();
      videoElementsRef.current[playingVideo].currentTime = 0;
    }

    // Create or get video element
    let video = videoElementsRef.current[sceneNumber];
    if (!video) {
      video = document.createElement('video');
      video.src = videoUrl;
      video.controls = true;
      video.className = 'w-full h-full object-cover';
      video.onended = () => {
        setPlayingVideo(null);
      };
      videoElementsRef.current[sceneNumber] = video;
    }

    if (playingVideo === sceneNumber) {
      // Pause if already playing
      video.pause();
      setPlayingVideo(null);
    } else {
      // Play video
      video.play();
      setPlayingVideo(sceneNumber);
    }
  };

  const handleVideoEnd = (sceneNumber: number) => {
    if (videoElementsRef.current[sceneNumber]) {
      videoElementsRef.current[sceneNumber].currentTime = 0;
    }
    setPlayingVideo(null);
  };

  // Cleanup WebSocket subscriptions and video elements on unmount
  useEffect(() => {
    return () => {
      // Unsubscribe from all WebSocket jobs
      videoJobIdsRef.current.forEach((jobIds) => {
        jobIds.forEach(jobId => {
          unsubscribeFromJob(jobId);
        });
      });
      videoJobIdsRef.current.clear();
      jobToSceneRef.current.clear();

      imageRegenJobToSceneRef.current.forEach((_, jobId) => {
        unsubscribeFromJob(jobId);
      });
      imageRegenJobToSceneRef.current.clear();
      
      // Clean up video elements
      Object.values(videoElementsRef.current).forEach(video => {
        if (video) {
          video.pause();
          video.src = '';
        }
      });
      videoElementsRef.current = {};
    };
  }, [unsubscribeFromJob]);

  // Detect when all video generation is complete and switch modes accordingly
  useEffect(() => {
    if (workspaceMode !== 'converting') return;
    
    // Check if there are no more scenes being generated
    if (generatingVideos.size === 0 && scenes.length > 0) {
      // For ALTERNATE style, count both brollVideos (b-roll scenes) AND avatarVideos (avatar scenes)
      // For other styles, only count brollVideos
      const isAlternateStyle = project?.style === 'ALTERNATE';
      const successfulVideos = isAlternateStyle 
        ? brollVideos.length + avatarVideos.length 
        : brollVideos.length;
      const totalScenesNeeded = scenes.length;
      
      console.log('[Workspace] Completion check:', {
        style: project?.style,
        isAlternateStyle,
        brollVideos: brollVideos.length,
        avatarVideos: avatarVideos.length,
        successfulVideos,
        totalScenesNeeded,
        generatingVideos: generatingVideos.size,
        failedGenerations: failedGenerations.size,
      });
      
      if (successfulVideos >= totalScenesNeeded) {
        // All videos generated successfully
        handleSwitchToVideos();
        showToast('All videos generated successfully!', 'success');
      } else if (failedGenerations.size > 0) {
        // Some videos failed
        const failedCount = failedGenerations.size;
        if (successfulVideos > 0) {
          // Partial success - switch to videos mode but warn
          handleSwitchToVideos();
          showToast(`${failedCount} video(s) failed to generate. You can retry from images view.`, 'warning');
        } else {
          // All failed - go back to images mode
          handleBackToImages();
          showToast('Video generation failed. Please try again.', 'error');
        }
      }
    }
  }, [generatingVideos.size, brollVideos.length, avatarVideos.length, scenes.length, failedGenerations.size, workspaceMode, project?.style, showToast, handleSwitchToVideos, handleBackToImages]);

  // Resume rendering polling only during an active final render (not raw-clip staging)
  useEffect(() => {
    if (project && isProjectActivelyRendering(project) && workspaceMode === 'rendering') {
      startRenderingPolling();
    }
  }, [project, workspaceMode, startRenderingPolling]);

  // Preview/caption: keep hooks above any early return (Rules of Hooks)
  const currentScene = scenes[selectedSceneIndex];
  const currentSceneNumber = currentScene?.scene_number || currentScene?.sceneNumber || (selectedSceneIndex + 1);
  const currentImageUrl = getImageUrl(currentSceneNumber);
  const isRegeneratingCurrentImage = regeneratingImageScenes.has(currentSceneNumber);
  const isRegeneratingCurrentVideo = regeneratingVideoScenes.has(currentSceneNumber);
  const currentSceneText = currentScene ? getSceneText(currentScene) : '';
  const isSingleClipStyle = useMemo(
    () => isSingleClipVideoStyle(project?.style),
    [project?.style],
  );
  const singleClipPreviewUrl =
    finalVideoUrl ||
    (project ? getFinalVideoUrl(project, VIDEO_SERVICE_ORIGIN) : null) ||
    project?.videoUrl ||
    null;
  const canEditLayout = selectedSceneIndex === 0;
  const currentBrollVideoUrl =
    workspaceMode === 'videos' && !isSingleClipStyle ? getVideoUrl(currentSceneNumber) : null;
  const hasPreviewMedia =
    Boolean(
      (isSingleClipStyle && singleClipPreviewUrl) ||
        currentImageUrl ||
        currentBrollVideoUrl,
    ) && !isRegeneratingCurrentImage && !isRegeneratingCurrentVideo;
  const currentAudioForScene = audioFiles.find((af) => af.sceneNumber === currentSceneNumber);

  useEffect(() => {
    setPreviewPlaybackTime(0);
  }, [currentSceneNumber]);

  const previewAspectRatio = useMemo(() => {
    const style = project?.style;
    if (style === 'HALF_N_HALF') return '9/16';
    return '9/16';
  }, [project?.style]);

  const previewCaptionText = useMemo(() => {
    const base =
      (currentSceneText || currentAudioForScene?.voiceover || '').trim() || 'Sample caption text';
    if (captionDisplayMode === 'full-sentence') return base;
    if (!currentBrollVideoUrl) {
      return firstCaptionWord(base, currentAudioForScene?.wordTimestamps);
    }
    const sceneDur =
      currentAudioForScene?.duration && isFinite(currentAudioForScene.duration) && currentAudioForScene.duration > 0
        ? currentAudioForScene.duration
        : undefined;
    return (
      captionTextForVideoPreview(
        'word-by-word',
        base === 'Sample caption text' ? '' : base,
        previewPlaybackTime,
        currentAudioForScene?.wordTimestamps,
        sceneDur
      ).trim() || base
    );
  }, [
    currentBrollVideoUrl,
    captionDisplayMode,
    currentSceneText,
    currentAudioForScene,
    previewPlaybackTime,
  ]);

  const captionLayoutText = useMemo(() => {
    const base =
      (currentSceneText || currentAudioForScene?.voiceover || '').trim() || 'Sample caption text';
    if (captionDisplayMode === 'full-sentence') return base;
    const timedWords = (currentAudioForScene?.wordTimestamps || [])
      .map((w) => (w.word ?? w.text ?? '').trim())
      .filter(Boolean);
    if (timedWords.length) return longestWord(timedWords.join(' '));
    return longestWord(base);
  }, [captionDisplayMode, currentSceneText, currentAudioForScene]);

  if (loading || authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="text-[clamp(1rem,1.76vh,18px)] text-[#212121]">Loading workspace...</div>
      </div>
    );
  }

  const finalReady =
    Boolean(finalVideoUrl) || isFinalReady(project || {}, VIDEO_SERVICE_ORIGIN);
  const canTranslate = isVideoTranslationEligible(project || {});
  const previewPlayerReady =
    Boolean(previewPlaybackUrl) && isPreviewReady(project || {});
  const completedPlaybackUrl =
    translationPlaybackOverride ??
    previewPlaybackUrl ??
    getFinalVideoUrl(project || {}, VIDEO_SERVICE_ORIGIN);
  const showCompletedVideo = Boolean(completedPlaybackUrl);

  const showCompletedScreen =
    workspaceMode === 'completed' &&
    finalReady &&
    !isRawAvatarClipEditingPhase(project || {});

  // In `completed` mode the dedicated completed view owns the whole area, so
  // the main workspace must be hidden for ALL styles (previously single-clip
  // was excepted, which caused the completed view to render on top of the
  // videos page). The pre-export editing page is unaffected because it runs in
  // `videos` mode, not `completed`.
  const showMainWorkspace =
    workspaceMode !== 'rendering' &&
    !showCompletedScreen;

  return (
    <div className="relative h-full min-h-0 flex flex-col overflow-hidden">
      {/* Shimmer animation keyframes */}
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>

      {/* Rendering — dedicated full-area state (not stacked over main workspace) */}
      {workspaceMode === 'rendering' && (
        <div className="flex flex-col flex-1 min-h-0 w-full items-center justify-center px-4 py-10">
          <div className="max-w-lg w-full text-center space-y-8">
            {/* Fun Facts */}
            <div>
              <h2 className="font-heading text-[clamp(18px,2.34vh,24px)] font-semibold mb-4 text-[#212121]">Fun Facts</h2>
              <p className="font-heading text-[clamp(14px,1.76vh,16px)] text-gray-600">
                {['Adding a smile in your script makes your avatar more engaging.',
                  'Shorter videos tend to perform better on social media.',
                  'Good lighting can make your avatar look more professional.'][Math.floor(Math.random() * 3)]}
              </p>
            </div>

            {/* Rendering Progress */}
            <div>
              <h2 className="font-heading text-[clamp(24px,3.1vh,32px)] font-bold mb-6 text-[#212121]">Rendering</h2>
              <div className="w-full bg-gray-200 rounded-full h-3 mb-4 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-[#E86412] to-[#F12A4C] h-full rounded-full transition-all duration-500"
                  style={{ width: `${renderingProgress}%` }}
                />
              </div>
              
              {/* Stage label */}
              <div className="mb-6">
                <p className="font-heading text-[clamp(14px,1.76vh,16px)] text-gray-600">
                  {stageLabels[renderingStage] || 'Processing...'}
                </p>
                <p className="font-heading text-[clamp(12px,1.37vh,14px)] text-gray-400 mt-1">
                  {renderingProgress}% complete
                </p>
              </div>
            </div>

            {/* Cancel button */}
            <button
              onClick={handleCancelRendering}
              className="mt-8 px-6 py-2 text-gray-500 hover:text-gray-700 transition-colors font-heading text-[clamp(12px,1.37vh,14px)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Completed — dedicated full-area final video (not overlay) */}
      {showCompletedScreen && (
        <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
          <div className="relative max-w-[1248px] w-full mx-auto pt-0 sm:pt-2 md:pt-[43px] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-2 md:pb-[43px] flex flex-col flex-1 min-h-0 px-3 sm:px-6 md:px-[96px]">
            {/* Header Row */}
            <div className="flex flex-row justify-between items-center mb-0 sm:mb-2 md:mb-[24px] h-[clamp(20px,3.3vh,34px)] flex-shrink-0">
              {/* Left: Back + Workspace */}
              <div className="flex flex-row items-center gap-[clamp(0.75rem,2vh,20px)] min-w-[90px] sm:min-w-[110px] md:min-w-[125px]">
                <button
                  onClick={handleBack}
                  className="flex items-center justify-center w-[clamp(16px,2.34vh,24px)] h-[clamp(16px,2.34vh,24px)] cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <ArrowLeft className="w-full h-full text-[#212121]" strokeWidth={1.5} />
                </button>
                <h2 className="font-heading text-[clamp(14px,2.34vh,24px)] font-medium leading-[clamp(14px,2.34vh,24px)] text-[#212121]">Workspace</h2>
              </div>

              {/* Right: Translate button */}
              <button
                type="button"
                onClick={() => setShowTranslateModal(true)}
                disabled={!canTranslate}
                title={!canTranslate ? 'Export your final video before translating' : undefined}
                className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] px-[clamp(12px,1.39vw,20px)] py-[clamp(8px,1.17vh,12px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[26px] min-w-[clamp(120px,14vw,202px)] h-[clamp(32px,3.3vh,40px)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Languages className="w-4 h-4 text-white shrink-0" />
                <span className="font-heading font-semibold text-[clamp(12px,1.37vh,14px)] leading-[clamp(12px,1.37vh,14px)] text-white">
                  Translate
                </span>
              </button>
            </div>

            {/* Main content — languages sidebar + centered preview + empty right column */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-start gap-4 lg:gap-[clamp(12px,1.39vw,20px)] flex-1 min-h-0 overflow-y-auto lg:overflow-y-hidden px-0 pb-4 lg:pb-0">
              {/* Left sidebar — language variants */}
              <div
                className={cn(
                  'flex-col items-start p-[clamp(12px,1.56vh,16px)] gap-[clamp(6px,0.98vh,8px)] w-full lg:basis-[clamp(280px,28vw,360px)] lg:min-w-[280px] lg:max-w-[360px] h-auto lg:h-full min-h-[200px] lg:min-h-0 bg-white/95 shadow-[0px_1px_12px_rgba(242,126,53,0.12)] overflow-hidden shrink-0',
                  'hidden lg:flex lg:relative lg:rounded-[20px]',
                  'fixed left-0 z-40 flex w-[86vw] max-w-[340px] min-[560px]:w-[70vw] min-[560px]:max-w-[420px] rounded-r-2xl border border-[#EFE5DF] transition-transform duration-300 ease-out lg:transition-none',
                  leftDrawerOpen
                    ? 'translate-x-0 opacity-100 pointer-events-auto'
                    : '-translate-x-full opacity-0 pointer-events-none lg:translate-x-0 lg:opacity-100 lg:pointer-events-auto',
                )}
                style={
                  leftDrawerOpen
                    ? {
                        top: `${mobileDrawerFrame.top}px`,
                        height: `${mobileDrawerFrame.height}px`,
                        maxHeight: `${mobileDrawerFrame.height}px`,
                      }
                    : undefined
                }
              >
                <VideoTranslationsPanel
                  projectId={projectId!}
                  originalLanguageLabel="Original"
                  originalVideoUrl={finalVideoUrl || getFinalVideoUrl(project || {})}
                  initialTranslations={(project as any)?.videoTranslations || []}
                  onPlaybackUrlChange={(url, variantId) => {
                    setTranslationPlaybackOverride(url);
                    setSelectedTranslationVariantId(variantId);
                  }}
                  modalOpen={showTranslateModal}
                  onModalOpenChange={setShowTranslateModal}
                  layout="sidebar"
                  onSelectItem={() => setLeftDrawerOpen(false)}
                  videoServiceBase={VIDEO_SERVICE_ORIGIN}
                />
              </div>

              {/* Center — preview + export */}
              <div className="relative flex flex-col items-center gap-[clamp(12px,1.56vh,20px)] w-full min-w-0 lg:flex-1 lg:max-w-[520px] lg:min-w-[340px] max-w-[min(520px,calc(100vw-2rem))] min-[560px]:max-w-[min(620px,calc(100vw-1rem))] mx-auto h-auto lg:h-full shrink-0 min-h-0">
                {/* Mobile languages drawer rail */}
                <button
                  type="button"
                  onClick={() => setLeftDrawerOpen(true)}
                  className="lg:hidden absolute left-[-10px] min-[560px]:left-[-14px] top-1/2 -translate-y-1/2 z-30 inline-flex flex-col items-center justify-center gap-1 h-[46%] min-h-[180px] max-h-[280px] w-8 min-[560px]:w-10 rounded-r-2xl border border-[#E0D5CF] bg-white/95 shadow-sm"
                  aria-label="Open languages drawer"
                >
                  <Languages className="w-3.5 h-3.5 text-[#8B6C5C]" />
                  <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] tracking-[0.08em] font-heading text-[#8B6C5C]">
                    LANGS
                  </span>
                </button>

                {(() => {
                  const bp = (project?.metadata as Record<string, unknown> | undefined)
                    ?.brandPackaging as { status?: string } | undefined;
                  const bpStatus = bp?.status;
                  if (bpStatus === 'pending' || bpStatus === 'processing') {
                    return (
                      <p className="mb-1 text-center text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 max-w-md">
                        Preparing brand assets… Download for the final video with your logo.
                      </p>
                    );
                  }
                  return null;
                })()}

                {/* Video player container - 9:16 aspect ratio */}
                <div className="relative w-full flex-1 flex items-center justify-center min-h-[min(60vh,560px)] lg:min-h-0">
                  <div className="relative h-full max-h-[min(70vh,640px)] aspect-[9/16] rounded-[20px] overflow-hidden shadow-lg bg-black w-auto">
                    {showCompletedVideo ? (
                      <>
                        <video
                          src={completedPlaybackUrl ?? undefined}
                          className="w-full h-full object-contain"
                          controls
                          controlsList="nodownload noremoteplayback"
                          disablePictureInPicture
                          onContextMenu={(e) => e.preventDefault()}
                          autoPlay={false}
                          playsInline
                        >
                          Your browser does not support the video tag.
                        </video>
                        {!previewPlayerReady && !translationPlaybackOverride ? (
                          <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/70 px-4 pointer-events-none">
                            Watermarked preview is still preparing. Playback uses your final video.
                          </p>
                        ) : null}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 hover:opacity-100 transition-opacity">
                          <div className="w-16 h-16 bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-full flex items-center justify-center">
                            <Play className="w-8 h-8 text-white ml-1" fill="white" />
                          </div>
                        </div>
                      </>
                    ) : previewGenerationError ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/90 z-10 px-6 text-center">
                        <p className="font-heading text-sm">Preview could not be prepared.</p>
                        <p className="text-xs text-white/70 max-w-[240px]">{previewGenerationError}</p>
                        <button
                          type="button"
                          onClick={handleRetryPreview}
                          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Retry preview
                        </button>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/90 z-10">
                        <Loader2 className="w-10 h-10 animate-spin text-white" />
                        <p className="font-heading text-sm">Preparing preview…</p>
                        {finalReady ? (
                          <p className="text-xs text-white/60">Download is available for the clean final video.</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                {/* Export & Share section */}
                <div className="mt-4 lg:mt-6 text-center space-y-4 w-full shrink-0">
                  <h3 className="font-heading text-[clamp(18px,2.34vh,24px)] font-semibold text-[#212121]">
                    Export & Share
                  </h3>
                  <div className="flex justify-center gap-6">
                    <button
                      type="button"
                      onClick={() => void handleCompletedDownload()}
                      disabled={!finalReady || isDownloadingFinal || isDownloadingTranslation}
                      className="flex flex-col items-center gap-2 p-3 hover:bg-gray-50 rounded-lg transition-colors min-w-[70px] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <svg className="w-6 h-6 text-[#E86412]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span className="text-xs text-gray-600">Download</span>
                    </button>

                    <button className="flex flex-col items-center gap-2 p-3 hover:bg-gray-50 rounded-lg transition-colors min-w-[70px]">
                      <svg className="w-6 h-6 text-[#E86412]" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zM12 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                      </svg>
                      <span className="text-xs text-gray-600">Instagram</span>
                    </button>

                    <button className="flex flex-col items-center gap-2 p-3 hover:bg-gray-50 rounded-lg transition-colors min-w-[70px]">
                      <svg className="w-6 h-6 text-[#E86412]" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                      </svg>
                      <span className="text-xs text-gray-600">Facebook</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const shareUrl =
                          typeof window !== 'undefined'
                            ? window.location.href
                            : projectId
                              ? `/create-video/workspace?projectId=${projectId}`
                              : '';
                        if (navigator.share) {
                          void navigator.share({
                            title: project?.title || 'My Video',
                            url: shareUrl,
                          });
                        } else {
                          void navigator.clipboard.writeText(shareUrl);
                          showToast('Link copied to clipboard!', 'success');
                        }
                      }}
                      className="flex flex-col items-center gap-2 p-3 hover:bg-gray-50 rounded-lg transition-colors min-w-[70px]"
                    >
                      <svg className="w-6 h-6 text-[#E86412]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                      </svg>
                      <span className="text-xs text-gray-600">Share</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right spacer — matches settings drawer width on main workspace */}
              <div
                className="hidden lg:block lg:basis-[clamp(320px,26.7vw,384px)] lg:min-w-[320px] lg:max-w-[384px] shrink-0"
                aria-hidden="true"
              />
            </div>

            {leftDrawerOpen && (
              <button
                type="button"
                aria-label="Close languages drawer"
                className="lg:hidden fixed inset-0 z-30 bg-black/30"
                onClick={() => setLeftDrawerOpen(false)}
              />
            )}
          </div>
        </div>
      )}

      {showMainWorkspace && (
      <>
      {/* Main Container - matches AI chat page structure */}
      <div className="relative max-w-[1248px] w-full mx-auto pt-3 sm:pt-2 md:pt-[43px] pb-0 sm:pb-2 md:pb-[43px] flex flex-col flex-1 min-h-0">
        {/* Header Row - matches AI chat navigation bar */}
        <div className="flex flex-row justify-between items-center mb-0 sm:mb-2 md:mb-[24px] h-[clamp(20px,3.3vh,34px)] flex-shrink-0 px-3 sm:px-6 md:px-[96px]">
          {/* Left: Back + Workspace */}
          <div className="flex flex-row items-center gap-2 sm:gap-[clamp(0.75rem,2vh,20px)] min-w-[90px] sm:min-w-[110px] md:min-w-[125px]">
            <button
              onClick={handleBack}
              className="flex items-center justify-center w-[clamp(16px,2.34vh,24px)] h-[clamp(16px,2.34vh,24px)] cursor-pointer hover:opacity-80 transition-opacity"
            >
              <ArrowLeft className="w-full h-full text-[#212121]" strokeWidth={1.5} />
            </button>
            <h2 className="font-heading text-[clamp(14px,2.34vh,24px)] font-medium leading-[clamp(14px,2.34vh,24px)] text-[#212121]">Workspace</h2>
          </div>

          {/* Center: Mode toggle tabs - only show when videos exist and not converting/rendering/completed */}
          {brollVideos.length > 0 && !isSingleClipStyle && !['converting', 'rendering', 'completed'].includes(workspaceMode) && (
            <div className="hidden lg:flex items-center gap-1 bg-gray-100 rounded-full p-1">
              <button
                onClick={handleBackToImages}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[clamp(11px,1.17vh,13px)] font-medium transition-all",
                  workspaceMode === 'images' 
                    ? "bg-white shadow-sm text-[#212121]" 
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                Images
              </button>
              <button
                onClick={handleSwitchToVideos}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[clamp(11px,1.17vh,13px)] font-medium transition-all",
                  workspaceMode === 'videos' 
                    ? "bg-white shadow-sm text-[#212121]" 
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                Videos
              </button>
            </div>
          )}

          {/* Right: Convert to Videos / Export button */}
          <div className="flex items-center gap-2">
          <button
            onClick={
              workspaceMode === 'videos' || (isSingleClipStyle && finalReady)
                ? handleExport
                : handleConvertToVideos
            }
            disabled={workspaceMode === 'converting'}
            className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] px-[clamp(12px,1.39vw,20px)] py-[clamp(8px,1.17vh,12px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[26px] min-w-[clamp(120px,14vw,202px)] h-[clamp(32px,3.3vh,40px)] hover:opacity-90 transition-opacity disabled:opacity-70 disabled:cursor-wait">
            <span className="font-heading font-semibold text-[clamp(12px,1.37vh,14px)] leading-[clamp(12px,1.37vh,14px)] text-white flex items-center gap-2">
              {workspaceMode === 'converting' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Converting...
                </>
              ) : workspaceMode === 'videos' || (isSingleClipStyle && finalReady) ? (
                'Export →'
              ) : (
                'Convert to Videos →'
              )}
            </span>
          </button>
          </div>
        </div>

        {/* Main content area — stack on small screens; three columns from lg up */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-start gap-4 lg:gap-[clamp(12px,1.39vw,20px)] flex-1 min-h-0 overflow-y-auto lg:overflow-y-hidden lg:overflow-x-visible px-4 sm:px-6 pb-6 lg:pb-0 min-h-0">
        {/* Left sidebar - Scene list */}
        <div className={cn(
          "flex-col items-start p-[clamp(12px,1.56vh,16px)] gap-[clamp(6px,0.98vh,8px)] w-full lg:basis-[clamp(280px,28vw,360px)] lg:min-w-[280px] lg:max-w-[360px] h-auto lg:h-full bg-white/95 shadow-[0px_1px_12px_rgba(242,126,53,0.12)] overflow-hidden shrink-0",
          "hidden lg:flex lg:relative lg:inset-auto lg:z-auto lg:rounded-[20px]",
          "lg:translate-x-0 lg:opacity-100 lg:pointer-events-auto",
          "fixed left-0 z-40 flex w-[86vw] max-w-[340px] min-[560px]:w-[70vw] min-[560px]:max-w-[420px] rounded-r-2xl border border-[#EFE5DF] transition-transform duration-300 ease-out lg:transition-none",
          leftDrawerOpen ? "translate-x-0 opacity-100 pointer-events-auto" : "-translate-x-full opacity-0 pointer-events-none"
        )}
        style={leftDrawerOpen ? { top: `${mobileDrawerFrame.top}px`, height: `${mobileDrawerFrame.height}px`, maxHeight: `${mobileDrawerFrame.height}px` } : undefined}>
          <div className="flex flex-col items-center gap-[clamp(8px,0.98vh,10px)] w-full h-full overflow-y-auto pr-[clamp(4px,0.52vw,8px)]">
            {isSingleClipStyle && (
              <p className="w-full text-[clamp(11px,1.27vh,13px)] text-[#616161] leading-snug px-1 pb-1">
                This style uses one continuous avatar video. Scenes show your script; adjust music and captions on the right, then export.
              </p>
            )}
            {scenes.length > 0 ? (
              scenes.map((scene, index) => {
                const sceneNumber = scene.scene_number || scene.sceneNumber || (index + 1);
                const imageUrl = getImageUrl(sceneNumber);
                const videoUrl = getVideoUrl(sceneNumber);
                const sceneText = getSceneText(scene);
                const timeRange = getSceneTimeRange(index);
                const isSelected = index === selectedSceneIndex;
                const isGenerating = generatingVideos.has(sceneNumber);
                const isRegeneratingImage = regeneratingImageScenes.has(sceneNumber);
                const isRegeneratingVideo = regeneratingVideoScenes.has(sceneNumber);
                const isRegeneratingScene =
                  workspaceMode === 'videos' ? isRegeneratingVideo : isRegeneratingImage;
                const hasVideo = !!videoUrl;

                return (
                  <div
                    key={index}
                    onClick={() => {
                      setSelectedSceneIndex(index);
                      setLeftDrawerOpen(false);
                    }}
                    className={cn(
                      "rounded-[12px] cursor-pointer transition-all",
                      isSelected ? "p-[2px]" : "p-0"
                    )}
                    style={isSelected ? {
                      background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)'
                    } : {}}
                  >
                    <div                     className={cn(
                      "flex flex-row justify-center items-start gap-[clamp(8px,0.98vh,12px)] w-full bg-white rounded-[10px] transition-all",
                      isSelected ? "p-[clamp(12px,1.76vh,22px)]" : "p-[clamp(14px,1.95vh,24px)]",
                      isSingleClipStyle && "opacity-80"
                    )}>
                      <div className="h-[clamp(73px,11vh,113px)] w-auto aspect-[9/16] max-w-[clamp(58px,7.8vw,90px)] rounded-[12px] overflow-hidden flex-shrink-0 relative">
                        {workspaceMode === 'videos' && hasVideo && !isRegeneratingVideo ? (
                          <video
                            src={videoUrl}
                            poster={imageUrl ?? undefined}
                            className="w-full h-full object-cover"
                            muted
                            playsInline
                            preload="metadata"
                            onError={(e) => {
                              console.error('Video failed to load:', videoUrl);
                              const target = e.target as HTMLVideoElement;
                              target.style.opacity = '0.5';
                            }}
                          />
                        ) : (workspaceMode === 'converting' || isGenerating || isRegeneratingScene) ? (
                          <div className="w-full h-full relative overflow-hidden">
                            {/* Skeleton shimmer animation */}
                            <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse" />
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" 
                              style={{ animation: 'shimmer 1.5s infinite' }} 
                            />
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <Loader2 className="w-[clamp(16px,2vh,20px)] h-[clamp(16px,2vh,20px)] text-gray-500 animate-spin" />
                            </div>
                          </div>
                        ) : imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={`Scene ${sceneNumber}`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              console.error('Image failed to load:', imageUrl);
                              const target = e.target as HTMLImageElement;
                              // Try BytePlus URL if local URL fails
                              const image = brollImages.find(img => img.sceneNumber === sceneNumber);
                              if (image?.imageUrl && image?.localUrl) {
                                console.log('Trying BytePlus URL as fallback:', image.imageUrl);
                                target.src = image.imageUrl;
                              } else {
                                target.style.opacity = '0.5';
                                target.alt = 'Failed to load image';
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                            <span className="text-[clamp(10px,1.17vh,12px)] text-gray-500">No image</span>
                          </div>
                        )}
                        {workspaceMode === 'videos' && hasVideo && (
                          <div className="absolute inset-0 flex items-center justify-center bg-opacity-20 hover:bg-opacity-30 transition-opacity">
                            <Play className="w-[clamp(20px,2.5vh,24px)] h-[clamp(20px,2.5vh,24px)] text-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-start gap-[clamp(8px,1.17vh,12px)] flex-1 min-w-0">
                        <span className="font-heading font-normal text-[clamp(14px,1.76vh,18px)] leading-[clamp(18px,2.15vh,22px)] text-[#212121] line-clamp-2">
                          {sceneText || `Scene ${sceneNumber}`}
                        </span>
                        <span className="font-heading font-normal text-[clamp(12px,1.17vh,14px)] leading-[clamp(14px,1.56vh,16px)] text-[#616161]">
                          {timeRange}
                        </span>
                        {!isSingleClipStyle && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSceneUpload(sceneNumber);
                              }}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-[#E4D7CF] text-[#8B6C5C] hover:text-[#E86412] hover:border-[#E86412] transition-colors"
                              title="Upload scene media"
                              aria-label={`Upload media for scene ${sceneNumber}`}
                            >
                              <Upload className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                await handleSceneRegenerate(index);
                              }}
                              disabled={isRegeneratingScene}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-[#E4D7CF] text-[#8B6C5C] hover:text-[#E86412] hover:border-[#E86412] transition-colors disabled:opacity-50 disabled:pointer-events-none"
                              title={workspaceMode === 'videos' ? 'Regenerate video' : 'Regenerate image'}
                              aria-label={`Regenerate ${workspaceMode === 'videos' ? 'video' : 'image'} for scene ${sceneNumber}`}
                            >
                              {isRegeneratingScene ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        )}
                        {isSingleClipStyle && (
                          <span className="text-[10px] uppercase tracking-wide text-[#9E9E9E] font-medium">
                            Script only
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="w-full py-[clamp(20px,2.93vh,40px)] text-center text-[clamp(14px,1.76vh,18px)] text-[#616161]">
                No scenes available
              </div>
            )}
          </div>
        </div>

        {/* Center - Preview */}
        <div className="relative flex flex-col items-center gap-[clamp(12px,1.56vh,20px)] w-full min-w-0 lg:flex-1 lg:max-w-[520px] lg:min-w-[340px] max-w-[min(520px,calc(100vw-2rem))] min-[560px]:max-w-[min(620px,calc(100vw-1rem))] mx-auto h-auto lg:h-full shrink-0">
          {/* Scene counter */}
          <div className="flex flex-row justify-center items-center w-full">
            <span className="font-heading font-medium text-[clamp(14px,1.56vh,16px)] leading-[clamp(14px,1.56vh,16px)] text-[#212121]">
              Scene {selectedSceneIndex + 1} of {sceneCount}
            </span>
          </div>

          {/* Preview area with navigation arrows on sides */}
          <div className="flex flex-row items-center justify-center gap-[clamp(8px,0.98vh,12px)] w-full flex-1 min-h-0 min-[0px]:min-h-[min(60vh,560px)] lg:min-h-0">
            {/* Mobile edge rails */}
            <button
              type="button"
              onClick={() => {
                setRightDrawerOpen(false);
                setLeftDrawerOpen(true);
              }}
              className="lg:hidden absolute left-[-10px] min-[560px]:left-[-14px] top-1/2 -translate-y-1/2 z-30 inline-flex flex-col items-center justify-center gap-1 h-[46%] min-h-[180px] max-h-[280px] min-[560px]:h-[54%] min-[560px]:min-h-[230px] min-[560px]:max-h-[420px] w-8 min-[560px]:w-10 rounded-r-2xl border border-[#E0D5CF] bg-white/95 shadow-sm"
              aria-label="Open scenes drawer"
            >
              <Clapperboard className="w-3.5 h-3.5 text-[#8B6C5C]" />
              <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] tracking-[0.08em] font-heading text-[#8B6C5C]">SCENES</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLeftDrawerOpen(false);
                setRightDrawerOpen(true);
              }}
              className="lg:hidden absolute right-[-10px] min-[560px]:right-[-14px] top-1/2 -translate-y-1/2 z-30 inline-flex flex-col items-center justify-center gap-1 h-[46%] min-h-[180px] max-h-[280px] min-[560px]:h-[54%] min-[560px]:min-h-[230px] min-[560px]:max-h-[420px] w-8 min-[560px]:w-10 rounded-l-2xl border border-[#E0D5CF] bg-white/95 shadow-sm"
              aria-label="Open settings drawer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#8B6C5C]" />
              <span className="[writing-mode:vertical-rl] text-[10px] tracking-[0.08em] font-heading text-[#8B6C5C]">SETTINGS</span>
            </button>

            {/* Left navigation arrow */}
            <button
              onClick={handlePreviousScene}
              disabled={selectedSceneIndex === 0}
              className="w-[clamp(32px,3.5vh,40px)] h-[clamp(32px,3.5vh,40px)] rounded-full flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors bg-white shadow-sm border border-gray-200 flex-shrink-0"
            >
              <ChevronLeft className="w-[clamp(16px,1.76vh,20px)] h-[clamp(16px,1.76vh,20px)] text-[#212121]" />
            </button>

            {/* Preview image/video — 9:8 for half-frame styles, else 9:16 (ALTERNATE even = full bleed) */}
            <div 
              ref={previewContainerRef}
              className="relative rounded-[12px] overflow-hidden bg-gray-200 flex items-center justify-center flex-shrink-0"
              style={{ 
                width: isTabletViewport ? 'min(340px, calc((100% - 128px)))' : 'min(260px, calc((100% - 100px)))',
                aspectRatio: previewAspectRatio
              }}
            >
              {isRegeneratingCurrentVideo ? (
                <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse" />
                  <div className="absolute inset-0 overflow-hidden">
                    <div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                      style={{
                        animation: 'shimmer 1.5s infinite',
                        transform: 'translateX(-100%)',
                      }}
                    />
                  </div>
                  <div className="relative z-10 flex flex-col items-center justify-center px-4 text-center">
                    <Loader2 className="w-[clamp(40px,5vh,48px)] h-[clamp(40px,5vh,48px)] text-gray-500 animate-spin" />
                    <span className="text-[clamp(14px,1.76vh,18px)] text-gray-600 mt-2">Regenerating video…</span>
                    <span className="text-[clamp(11px,1.27vh,13px)] text-gray-400 mt-1">Scene {currentSceneNumber}</span>
                  </div>
                </div>
              ) : isRegeneratingCurrentImage ? (
                <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse" />
                  <div className="absolute inset-0 overflow-hidden">
                    <div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                      style={{
                        animation: 'shimmer 1.5s infinite',
                        transform: 'translateX(-100%)',
                      }}
                    />
                  </div>
                  <div className="relative z-10 flex flex-col items-center justify-center px-4 text-center">
                    <Loader2 className="w-[clamp(40px,5vh,48px)] h-[clamp(40px,5vh,48px)] text-gray-500 animate-spin" />
                    <span className="text-[clamp(14px,1.76vh,18px)] text-gray-600 mt-2">Regenerating image…</span>
                    <span className="text-[clamp(11px,1.27vh,13px)] text-gray-400 mt-1">Scene {currentSceneNumber}</span>
                  </div>
                </div>
              ) : isSingleClipStyle && singleClipPreviewUrl ? (
                <video
                  key="single-clip-preview"
                  src={singleClipPreviewUrl}
                  className="w-full h-full object-cover"
                  controls
                  onTimeUpdate={(e) => setPreviewPlaybackTime(e.currentTarget.currentTime)}
                  onError={(e) => {
                    console.error('Single-clip video failed to load:', singleClipPreviewUrl);
                    const target = e.target as HTMLVideoElement;
                    target.style.opacity = '0.5';
                  }}
                />
              ) : workspaceMode === 'videos' && getVideoUrl(currentSceneNumber) ? (
                <video
                  ref={(el) => {
                    // Use ref to avoid infinite re-renders - don't call setState here
                    if (el && !videoElementsRef.current[currentSceneNumber]) {
                      el.controls = true;
                      el.className = 'w-full h-full object-cover';
                      el.onended = () => handleVideoEnd(currentSceneNumber);
                      videoElementsRef.current[currentSceneNumber] = el;
                    }
                  }}
                  src={getVideoUrl(currentSceneNumber) || undefined}
                  className="w-full h-full object-cover"
                  onTimeUpdate={(e) => setPreviewPlaybackTime(e.currentTarget.currentTime)}
                  onError={(e) => {
                    console.error('Video failed to load:', getVideoUrl(currentSceneNumber));
                    const target = e.target as HTMLVideoElement;
                    target.style.opacity = '0.5';
                  }}
                />
              ) : (workspaceMode === 'converting' || generatingVideos.has(currentSceneNumber)) ? (
                <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden">
                  {/* Skeleton shimmer background */}
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse" />
                  <div className="absolute inset-0 overflow-hidden">
                    <div 
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent" 
                      style={{ 
                        animation: 'shimmer 1.5s infinite',
                        transform: 'translateX(-100%)'
                      }} 
                    />
                  </div>
                  <div className="relative z-10 flex flex-col items-center justify-center">
                    <Loader2 className="w-[clamp(40px,5vh,48px)] h-[clamp(40px,5vh,48px)] text-gray-500 animate-spin" />
                    <span className="text-[clamp(14px,1.76vh,18px)] text-gray-600 mt-2">Converting to video...</span>
                    <span className="text-[clamp(11px,1.27vh,13px)] text-gray-400 mt-1">
                      {generatingVideos.size > 0 ? `${generatingVideos.size} scene(s) remaining` : 'Preparing...'}
                    </span>
                  </div>
                </div>
              ) : currentImageUrl ? (
                <img
                  src={currentImageUrl}
                  alt={`Scene ${currentSceneNumber}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-[clamp(14px,1.76vh,18px)] text-gray-500">No image available</span>
              )}

              {previewDimensions.width > 0 && previewDimensions.height > 0 && (
              <div className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
              {/* Avatar Overlay - Only for AVATAR_CUTOUT style when enabled, hidden during converting */}
              {project?.style === 'AVATAR_CUTOUT' && avatarOverlayEnabled && avatarImageUrl && hasPreviewMedia && workspaceMode !== 'converting' && (
                <DraggableResizableAvatar
                  avatarImageUrl={avatarImageUrl}
                  position={getCurrentAvatarPosition()}
                  onPositionChange={handleAvatarPositionChange}
                  onAspectRatioChange={handleAvatarAspectRatioChange}
                  containerWidth={previewDimensions.width}
                  containerHeight={previewDimensions.height}
                  containerRef={previewContainerRef}
                  disabled={!canEditLayout}
                />
              )}
              
              {/* Caption Overlay - For all styles when captions enabled, hidden during converting */}
              {captionsEnabled && hasPreviewMedia && workspaceMode !== 'converting' && (
                <DraggableResizableCaption
                  displayText={previewCaptionText}
                  layoutText={captionLayoutText}
                  position={getCurrentCaptionPosition()}
                  style={captionStyle}
                  onPositionChange={handleCaptionPositionChange}
                  onStyleChange={handleCaptionStyleChange}
                  containerWidth={previewDimensions.width}
                  containerHeight={previewDimensions.height}
                  containerRef={previewContainerRef}
                  disabled={!canEditLayout}
                />
              )}
              </div>
              )}
            </div>

            {/* Right navigation arrow */}
            <button
              onClick={handleNextScene}
              disabled={selectedSceneIndex >= sceneCount - 1}
              className="w-[clamp(32px,3.5vh,40px)] h-[clamp(32px,3.5vh,40px)] rounded-full flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors bg-white shadow-sm border border-gray-200 flex-shrink-0"
            >
              <ChevronRight className="w-[clamp(16px,1.76vh,20px)] h-[clamp(16px,1.76vh,20px)] text-[#212121]" />
            </button>
          </div>

          {/* Mobile mode toggle below preview */}
          {brollVideos.length > 0 && !isSingleClipStyle && !['converting', 'rendering', 'completed'].includes(workspaceMode) && (
            <div className="lg:hidden flex items-center gap-1 bg-gray-100 rounded-full p-1">
              <button
                onClick={handleBackToImages}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[12px] font-medium transition-all",
                  workspaceMode === 'images'
                    ? "bg-white shadow-sm text-[#212121]"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                Images
              </button>
              <button
                onClick={handleSwitchToVideos}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[12px] font-medium transition-all",
                  workspaceMode === 'videos'
                    ? "bg-white shadow-sm text-[#212121]"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                Videos
              </button>
            </div>
          )}

        </div>

        {/* Right sidebar - Settings */}
        <div className={cn(
          "flex-col items-start p-[clamp(12px,1.56vh,16px)] gap-[clamp(8px,0.98vh,10px)] w-full lg:basis-[clamp(320px,26.7vw,384px)] lg:min-w-[320px] lg:max-w-[384px] min-h-0 lg:h-full bg-white/95 shadow-[0px_1px_12px_rgba(242,126,53,0.12)] overflow-hidden shrink-0",
          "hidden lg:flex lg:relative lg:inset-auto lg:z-auto lg:rounded-[20px]",
          "lg:translate-x-0 lg:opacity-100 lg:pointer-events-auto",
          "fixed right-0 z-40 flex w-[86vw] max-w-[340px] min-[560px]:w-[70vw] min-[560px]:max-w-[420px] rounded-l-2xl border border-[#EFE5DF] transition-transform duration-300 ease-out lg:transition-none",
          rightDrawerOpen ? "translate-x-0 opacity-100 pointer-events-auto" : "translate-x-full opacity-0 pointer-events-none"
        )}
        style={rightDrawerOpen ? { top: `${mobileDrawerFrame.top}px`, height: `${mobileDrawerFrame.height}px`, maxHeight: `${mobileDrawerFrame.height}px` } : undefined}>
          <div className="flex flex-col justify-start items-start gap-[clamp(8px,0.98vh,10px)] w-full h-full overflow-hidden">
            
            {/* Avatar Overlay Section - Only for AVATAR_CUTOUT style */}
            {project?.style === 'AVATAR_CUTOUT' && (
              <div className="flex flex-col items-start p-[clamp(12px,1.76vh,20px)] gap-[clamp(8px,1.17vh,12px)] w-full bg-white border border-[#E0E0E0] rounded-[12px] flex-shrink-0">
                <div className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] w-full flex-shrink-0">
                  <User className="w-[clamp(18px,2.34vh,24px)] h-[clamp(18px,2.34vh,24px)] text-[#212121]" />
                  <span className="font-heading font-semibold text-[clamp(14px,1.76vh,18px)] leading-[clamp(14px,1.76vh,18px)] text-[#212121] flex-1">Avatar Overlay</span>
                  <button
                    onClick={() => setAvatarOverlayExpanded(!avatarOverlayExpanded)}
                    className="w-[clamp(18px,2.34vh,24px)] h-[clamp(18px,2.34vh,24px)] flex items-center justify-center flex-shrink-0"
                  >
                    <ChevronUp className={`w-full h-full text-[#212121] transition-transform ${avatarOverlayExpanded ? '' : 'rotate-180'}`} />
                  </button>
                  <div
                    onClick={handleAvatarOverlayToggle}
                    className={`relative w-[44px] h-[24px] rounded-full cursor-pointer transition-all flex-shrink-0 ${avatarOverlayEnabled ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C]' : 'bg-gray-300'}`}
                  >
                    <div className={`absolute top-[2px] w-[20px] h-[20px] bg-white rounded-full transition-all shadow-sm ${avatarOverlayEnabled ? 'left-[22px]' : 'left-[2px]'}`} />
                  </div>
                </div>

                {avatarOverlayExpanded && (
                  <div className="flex flex-col gap-[clamp(8px,1.17vh,12px)] w-full">
                    {/* TODO(per-scene-layout): re-enable when caption burn-in supports perScenePositions */}
                    {false && (
                    <label className="flex items-center gap-[clamp(8px,0.98vh,10px)] cursor-pointer group">
                      <div 
                        onClick={(e) => { e.preventDefault(); handleApplyToAllToggle(); }}
                        className={`relative w-[20px] h-[20px] rounded-[4px] border-2 transition-all flex items-center justify-center ${
                          avatarApplyToAll 
                            ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C] border-transparent' 
                            : 'bg-white border-gray-300 group-hover:border-[#E86412]'
                        }`}
                      >
                        {avatarApplyToAll && (
                          <svg className="w-[12px] h-[12px] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span className="font-heading font-normal text-[clamp(12px,1.37vh,14px)] leading-[clamp(14px,1.56vh,16px)] text-[#212121]">
                        Apply to all scenes
                      </span>
                    </label>
                    )}

                    {/* Helper text */}
                    <p className="font-heading font-normal text-[clamp(10px,1.17vh,12px)] leading-[clamp(12px,1.37vh,14px)] text-[#616161]">
                      Drag the avatar on the preview to reposition. Use corner handles to resize.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Background Music Section - takes equal remaining space with Captions when expanded */}
            <div className={`flex flex-col items-start p-[clamp(12px,1.76vh,20px)] gap-[clamp(8px,1.17vh,12px)] w-full bg-white border border-[#E0E0E0] rounded-[12px] min-h-0 overflow-hidden ${musicExpanded ? 'flex-1' : 'flex-shrink-0'}`}>
              <div className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] w-full flex-shrink-0">
                <Music className="w-[clamp(18px,2.34vh,24px)] h-[clamp(18px,2.34vh,24px)] text-[#212121]" />
                <span className="font-heading font-semibold text-[clamp(14px,1.76vh,18px)] leading-[clamp(14px,1.76vh,18px)] text-[#212121]">Background Music</span>
                {/* Search in header - compact expandable */}
                {musicExpanded && musicTab === 'library' && (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0 mx-2">
                    <div
                      className={`overflow-hidden transition-all duration-200 ease-in-out rounded-full border border-[#E8E2DB] bg-white ${
                        musicSearchExpanded ? 'flex-1 opacity-100 px-3 py-1.5' : 'w-0 opacity-0 px-0 py-0 border-0'
                      }`}
                    >
                      <input
                        ref={musicSearchInputRef}
                        value={musicSearchInput}
                        onChange={(e) => setMusicSearchInput(e.target.value)}
                        placeholder="Search..."
                        aria-label="Search music"
                        className="w-full min-w-0 bg-transparent border-0 outline-none font-heading text-[clamp(12px,1.3vh,14px)] text-[#212121] placeholder:text-[#9E9E9E]"
                        onBlur={() => {
                          if (!musicSearchInput.trim()) setMusicSearchExpanded(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            fetchMusicLibrary({ query: musicSearchInput, useSeed: false });
                          } else if (e.key === 'Escape') {
                            if (!musicSearchInput.trim()) {
                              setMusicSearchExpanded(false);
                            } else {
                              setMusicSearchInput('');
                              fetchMusicLibrary({ useSeed: true });
                            }
                          }
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMusicSearchExpanded((prev) => !prev);
                        if (!musicSearchExpanded) {
                          requestAnimationFrame(() => musicSearchInputRef.current?.focus());
                        }
                      }}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#E8E2DB] bg-white hover:bg-orange-50/60 transition-colors"
                      aria-label={musicSearchExpanded ? 'Collapse search' : 'Search music'}
                    >
                      {musicSearchExpanded ? (
                        <X className="h-4 w-4 text-[#E86512]" />
                      ) : (
                        <Search className="h-4 w-4 text-[#E86512]" />
                      )}
                    </button>
                    {musicSearchInput.trim() && (
                      <button
                        onClick={() => {
                          setMusicSearchInput('');
                          setMusicSearchExpanded(false);
                          fetchMusicLibrary({ useSeed: true });
                        }}
                        className="text-xs text-[#E86512] hover:underline shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
                {!musicExpanded || musicTab !== 'library' ? <div className="flex-1" /> : null}
                <button
                  onClick={() => setMusicExpanded(!musicExpanded)}
                  className="w-[clamp(18px,2.34vh,24px)] h-[clamp(18px,2.34vh,24px)] flex items-center justify-center flex-shrink-0"
                >
                  <ChevronUp className={`w-full h-full text-[#212121] transition-transform ${musicExpanded ? '' : 'rotate-180'}`} />
                </button>
                <div
                  onClick={() => setBackgroundMusicEnabled(!backgroundMusicEnabled)}
                  className={`relative w-[44px] h-[24px] rounded-full cursor-pointer transition-all flex-shrink-0 ${backgroundMusicEnabled ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C]' : 'bg-gray-300'}`}
                >
                  <div className={`absolute top-[2px] w-[20px] h-[20px] bg-white rounded-full transition-all shadow-sm ${backgroundMusicEnabled ? 'left-[22px]' : 'left-[2px]'}`} />
                </div>
              </div>

              {musicExpanded && (
                <div className="flex flex-col gap-[clamp(8px,1.17vh,12px)] w-full flex-1 min-h-0 overflow-hidden">
                  <GradientTabBar
                    size="xs"
                    tabs={[
                      { id: 'library', label: 'Library' },
                      { id: 'upload', label: 'Upload' },
                    ]}
                    value={musicTab}
                    onChange={(id) => setMusicTab(id as 'library' | 'upload')}
                  />

                  {musicTab === 'library' && (
                    <>
                      {musicRelaxLevel > 0 && (
                        <div className="text-[11px] text-[#616161]">Showing relaxed results</div>
                      )}
                      {musicError && <div className="text-[11px] text-red-500">{musicError}</div>}

                      {/* Music List - Compact list items for thinner rows */}
                      <div className="flex flex-col gap-[clamp(6px,0.8vh,10px)] w-full flex-1 min-h-0 overflow-y-auto pr-1">
                        {musicLoading && (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="w-5 h-5 animate-spin text-[#E86512]" />
                            <span className="ml-2 text-sm text-[#616161]">Loading music...</span>
                          </div>
                        )}
                        {!musicLoading && musicLibraryItems.length === 0 && (
                          <div className="text-center py-6 text-sm text-[#616161]">No music found</div>
                        )}
                        {musicLibraryItems.map((item) => {
                          const isSelected = item.source === 'heygen' 
                            ? musicSelected?.heygenTrackId === item.heygenTrackId 
                            : musicSelected?.externalId === item.externalId;
                          const isPlaying = musicPreviewPlayingId === item.externalId;
                          const isLoadingPreview = musicPreviewLoading === item.externalId;
                          return (
                            <div
                              key={item.id}
                              onClick={() => {
                                if (!projectId) return;
                                // Build config based on source type
                                const isHeygen = item.source === 'heygen';
                                const selected: BackgroundMusicConfig = {
                                  enabled: true,
                                  source: item.source,
                                  externalId: item.externalId,
                                  title: item.title,
                                  artist: item.artistName,
                                  durationSeconds: item.durationSeconds || item.seconds,
                                  previewUrl: item.previewUrl || item.audioUrl || undefined,
                                  // For HeyGen: store the search query as searchSeed for re-fetching at export time
                                  searchSeed: isHeygen 
                                    ? { query: musicSearchInput || musicSearchSeed?.query || 'background music' }
                                    : musicSearchSeed || undefined,
                                  mixVolume: 0.05,
                                  voiceDuckTo: 1.0,
                                  fadeInMs: 500,
                                  fadeOutMs: 1500,
                                  // HeyGen-specific fields
                                  ...(isHeygen && {
                                    heygenTrackId: item.heygenTrackId,
                                    heygenTrackName: item.title,
                                    heygenTrackDuration: item.duration || item.durationSeconds,
                                    heygenTrackScore: item.score,
                                  }),
                                };
                                setBackgroundMusicEnabled(true);
                                setMusicSelected(selected);
                                void persistBackgroundMusic(selected);
                                showToast('Background music selected', 'success');
                              }}
                              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md border transition-all duration-200 cursor-pointer ${
                                isSelected
                                  ? 'border-[#E86512] bg-[#E86512]/10 shadow-sm'
                                  : 'border-[#E0E0E0] hover:bg-[#FFF5F0] hover:border-[#E86512]/50'
                              }`}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div className="flex flex-col flex-1 min-w-0">
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs font-medium text-[#212121] truncate">{item.title}</span>
                                    {isSelected && (
                                      <Check className="w-3 h-3 text-[#E86512] shrink-0" />
                                    )}
                                  </div>
                                  <span className="text-[10px] text-[#616161] truncate">
                                    {item.artistName || 'Unknown artist'} {item.time ? `• ${item.time}` : ''}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isLoadingPreview) return;
                                  void handleMusicPreview(item, isPlaying);
                                }}
                                disabled={isLoadingPreview}
                                className={`ml-2 p-1.5 rounded-full transition-all duration-200 shrink-0 ${
                                  isPlaying
                                    ? 'bg-[#E86512] text-white hover:bg-[#D55A10]'
                                    : isLoadingPreview
                                      ? 'bg-gray-100 border border-gray-300 text-gray-400'
                                      : 'bg-white border border-[#E0E0E0] text-[#212121] hover:bg-[#FFF5F0] hover:border-[#E86512] hover:text-[#E86512]'
                                }`}
                                title={isLoadingPreview ? 'Loading preview...' : isPlaying ? 'Pause' : 'Play preview'}
                              >
                                {isLoadingPreview ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : isPlaying ? (
                                  <Pause className="w-3 h-3" />
                                ) : (
                                  <Play className="w-3 h-3 fill-current" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {musicTab === 'upload' && (
                    <div className="flex flex-col gap-2 w-full">
                      <input
                        type="file"
                        accept=".mp3,.wav,.aac,.ogg,audio/mpeg,audio/wav,audio/aac,audio/ogg"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !projectId) return;
                          if (file.size > 25 * 1024 * 1024) {
                            showToast('Max upload size is 25MB', 'error');
                            return;
                          }
                          try {
                            setMusicUploading(true);
                            const form = new FormData();
                            form.append('file', file);
                            const r = await fetch(`/api/video/${encodeURIComponent(projectId)}/upload-music`, {
                              method: 'POST',
                              headers: musicHeaders(),
                              body: form,
                            });
                            const j = await r.json();
                            if (!r.ok || !j?.success) throw new Error(j?.message || 'Upload failed');
                            const selected: BackgroundMusicConfig = {
                              enabled: true,
                              source: 'upload',
                              title: j.data?.originalName || file.name,
                              durationSeconds: j.data?.durationSeconds,
                              publicUrl: j.data?.publicUrl || j.data?.url,
                              gcsUrl: j.data?.gcsUrl,
                              searchSeed: musicSearchSeed || undefined,
                              mixVolume: 0.05,
                              voiceDuckTo: 1.0,
                              fadeInMs: 500,
                              fadeOutMs: 1500,
                            };
                            setBackgroundMusicEnabled(true);
                            setMusicSelected(selected);
                            await persistBackgroundMusic(selected);
                            showToast('Background music uploaded', 'success');
                          } catch (err: any) {
                            showToast(err?.message || 'Music upload failed', 'error');
                          } finally {
                            setMusicUploading(false);
                          }
                        }}
                        className="text-sm"
                      />
                      <span className="text-[11px] text-[#616161]">Supported: mp3, wav, aac, ogg (max 25MB)</span>
                      {musicUploading && <span className="text-sm text-gray-500">Uploading...</span>}
                      {musicSelected?.title && <span className="text-sm text-[#212121]">Selected: {musicSelected.title}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Captions Section - takes equal remaining space with Background Music when expanded */}
            <div className={`flex flex-col items-start p-[clamp(12px,1.76vh,20px)] gap-[clamp(8px,1.17vh,12px)] w-full bg-white border border-[#E0E0E0] rounded-[12px] min-h-0 overflow-hidden ${captionsExpanded ? 'flex-1' : 'flex-shrink-0'}`}>
              <div className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] w-full flex-shrink-0">
                <Type className="w-[clamp(18px,2.34vh,24px)] h-[clamp(18px,2.34vh,24px)] text-[#212121]" />
                <span className="font-heading font-semibold text-[clamp(14px,1.76vh,18px)] leading-[clamp(14px,1.76vh,18px)] text-[#212121] flex-1">Captions</span>
                <button
                  onClick={() => setCaptionsExpanded(!captionsExpanded)}
                  className="w-[clamp(18px,2.34vh,24px)] h-[clamp(18px,2.34vh,24px)] flex items-center justify-center flex-shrink-0"
                >
                  <ChevronUp className={`w-full h-full text-[#212121] transition-transform ${captionsExpanded ? '' : 'rotate-180'}`} />
                </button>
                <div
                  onClick={() => setCaptionsEnabled(!captionsEnabled)}
                  className={`relative w-[44px] h-[24px] rounded-full cursor-pointer transition-all flex-shrink-0 ${captionsEnabled ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C]' : 'bg-gray-300'}`}
                >
                  <div className={`absolute top-[2px] w-[20px] h-[20px] bg-white rounded-full transition-all shadow-sm ${captionsEnabled ? 'left-[22px]' : 'left-[2px]'}`} />
                </div>
              </div>

              {captionsExpanded && (
                <div className="flex flex-col items-start gap-[clamp(10px,1.17vh,12px)] w-full flex-1 min-h-0 overflow-y-auto pr-1">
                  {/* Info text when disabled */}
                  {!captionsEnabled && (
                    <div className="text-[clamp(11px,1.17vh,13px)] text-gray-500 text-center w-full py-2">
                      Enable captions to show them on the video preview
                    </div>
                  )}

                  {captionsEnabled && (
                    <>
                      {selectedSceneIndex !== 0 && (
                        <p className="text-[clamp(10px,1.07vh,11px)] text-gray-500 w-full">
                          Caption layout is set on Scene 1 and applies to the whole video.
                        </p>
                      )}

                      {/* Display Mode */}
                      <div className="flex flex-col gap-[clamp(6px,0.78vh,8px)] w-full">
                        <span className="text-[clamp(11px,1.27vh,13px)] font-medium text-gray-600">Display Mode</span>
                        <GradientTabBar
                          size="xs"
                          tabs={[
                            { id: 'word-by-word', label: 'Word-by-word' },
                            { id: 'full-sentence', label: 'Full sentence' },
                          ]}
                          value={captionDisplayMode}
                          onChange={(id) =>
                            setCaptionDisplayMode(id as 'word-by-word' | 'full-sentence')
                          }
                        />
                      </div>

                      {/* Style Presets */}
                      <div className="flex flex-col gap-[clamp(6px,0.78vh,8px)] w-full">
                        <span className="text-[clamp(11px,1.27vh,13px)] font-medium text-gray-600">Style Preset</span>
                        <GradientTabBar
                          size="xs"
                          tabs={[
                            { id: 'light', label: 'Light' },
                            { id: 'dark', label: 'Dark' },
                            { id: 'transparent', label: 'Transparent' },
                          ]}
                          value={captionStylePreset === 'custom' ? 'dark' : captionStylePreset}
                          onChange={(id) =>
                            applyCaptionPreset(id as 'light' | 'dark' | 'transparent')
                          }
                        />
                        {captionStylePreset === 'custom' && (
                          <div className="text-[clamp(10px,1.07vh,11px)] text-gray-500 text-center">
                            Custom style - edit using the overlay toolbar
                          </div>
                        )}
                      </div>

                      {/* TODO(per-scene-layout): re-enable when export supports perScenePositions */}
                      {false && (
                      <div className="flex items-center gap-2 w-full pt-1">
                        <button
                          onClick={() => setCaptionApplyToAll(!captionApplyToAll)}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                            captionApplyToAll
                              ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C] border-transparent'
                              : 'bg-white border-gray-300'
                          }`}
                        >
                          {captionApplyToAll && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <span className="text-[clamp(11px,1.27vh,13px)] text-gray-700">Apply to all scenes</span>
                      </div>
                      )}

                      {/* Tip */}
                      <div className="text-[clamp(10px,1.07vh,11px)] text-gray-400 italic">
                        Drag and resize the caption box on the preview to position it
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        </div>
      </div>

      {(leftDrawerOpen || rightDrawerOpen) && (
        <button
          type="button"
          aria-label="Close workspace drawers"
          className="lg:hidden fixed inset-0 z-40 bg-black/20"
          onClick={() => {
            setLeftDrawerOpen(false);
            setRightDrawerOpen(false);
          }}
        />
      )}
      </>
      )}

      {/* B-Roll Selection Modal */}
      <BRollSelectionModal
        isOpen={brollModalOpen}
        onClose={() => setBrollModalOpen(false)}
        onSelect={handleBrollSelection}
        sceneNumber={brollModalSceneNumber}
        defaultSearchTerm={scenes[brollModalSceneNumber - 1]?.stock_search_term || ''}
        allowedTabs={workspaceMode === 'images' ? ['images', 'upload'] : ['videos', 'upload']}
        targetAspectRatio={
          project?.style === 'HALF_N_HALF'
            ? '9:8'
            : '9:16'
        }
        stockVideoDurationParams={
          workspaceMode === 'videos'
            ? { minDuration: 4, maxDuration: 120, targetDuration: 15 }
            : undefined
        }
      />
      {showExportConfirm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white border border-[#E0E0E0] shadow-xl">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-[#212121]">Confirm Export</h3>
              <p className="text-sm text-gray-600 mt-1">Credits are charged only after successful final render.</p>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[50vh] overflow-y-auto">
              {exportBreakdownDisplay.hasRows ? (
                <>
                  {exportBreakdownDisplay.rows.map((row, idx) => (
                    <div
                      key={`${row.label}-${idx}`}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-gray-700 min-w-0">
                        {row.label}
                        {row.detail ? (
                          <span className="text-gray-500 font-normal"> ({row.detail})</span>
                        ) : null}
                      </span>
                      <span className="font-medium text-[#212121] shrink-0">{row.credits} credits</span>
                    </div>
                  ))}
                  <div className="pt-2 mt-1 border-t border-gray-200 flex items-center justify-between">
                    <span className="font-semibold text-[#212121]">Estimated total at export</span>
                    <span className="font-semibold text-[#E86412]">
                      {exportBreakdownDisplay.estimatedTotalCredits} credits
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 pt-1">
                    Credits are deducted only after a successful render. This total includes the final render fee when it applies.
                  </p>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">
                    No generation charges recorded for this project yet. Export will run standard affordability checks before rendering.
                  </p>
                  {exportBreakdownDisplay.estimatedTotalCredits > 0 && (
                      <p className="text-sm text-[#212121]">
                        Estimated total at export:{' '}
                        <span className="font-semibold text-[#E86412]">
                          {exportBreakdownDisplay.estimatedTotalCredits} credits
                        </span>
                      </p>
                    )}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => setShowExportConfirm(false)}
                disabled={exportConfirmLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-gradient-to-b from-[#E86412] to-[#F12A4C] text-white text-sm font-medium disabled:opacity-60"
                onClick={confirmExportAndRender}
                disabled={exportConfirmLoading}
              >
                {exportConfirmLoading ? 'Starting...' : 'Confirm & Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <WorkspacePageContent />
    </Suspense>
  );
}

