'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, ChevronLeft, ChevronRight, Music, Type, ChevronUp, Play, Loader2, User, Check, Clapperboard, SlidersHorizontal, Upload, RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket, JobStatusUpdate } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils/cn';
import { DraggableResizableAvatar } from '@/components/create-video/DraggableResizableAvatar';
import { DraggableResizableCaption } from '@/components/create-video/DraggableResizableCaption';
import BRollSelectionModal, { BRollSelection } from '@/components/create-video/BRollSelectionModal';

interface Scene {
  scene_number?: number;
  sceneNumber?: number;
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

const VOICE_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_VOICE_SERVICE_URL || 'http://localhost:3003';
const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:3002';

function WorkspacePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const projectIdFromUrl = searchParams?.get('projectId') ?? null;

  const [projectId, setProjectId] = useState<string | null>(projectIdFromUrl);
  const [project, setProject] = useState<any>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [brollImages, setBrollImages] = useState<BrollImage[]>([]);
  const [brollVideos, setBrollVideos] = useState<BrollVideo[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [backgroundMusicEnabled, setBackgroundMusicEnabled] = useState(true);
  const [musicTab, setMusicTab] = useState<'library' | 'upload'>('library');
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
  
  // Avatar overlay state (AVATAR_CUTOUT style only)
  const [avatarOverlayEnabled, setAvatarOverlayEnabled] = useState(true);
  const [avatarOverlayExpanded, setAvatarOverlayExpanded] = useState(true);
  const [avatarApplyToAll, setAvatarApplyToAll] = useState(true);
  const [avatarGlobalPosition, setAvatarGlobalPosition] = useState({ x: 0.5, y: 0.85, scale: 0.4 });
  const [avatarPerScenePositions, setAvatarPerScenePositions] = useState<Record<number, { x: number; y: number; scale: number }>>({});
  const [avatarImageUrl, setAvatarImageUrl] = useState<string | null>(null);
  const avatarSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewDimensions, setPreviewDimensions] = useState({ width: 320, height: 537 });
  const [mobileDrawerFrame, setMobileDrawerFrame] = useState({ top: 170, height: 420 });
  const [viewportWidth, setViewportWidth] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1280);
  
  // Workspace mode: 'images' | 'converting' | 'videos'
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('images');
  const [generatingVideos, setGeneratingVideos] = useState<Set<number>>(new Set());
  const [failedGenerations, setFailedGenerations] = useState<Set<number>>(new Set());
  const [playingVideo, setPlayingVideo] = useState<number | null>(null);
  // Use ref instead of state to avoid infinite re-renders when setting video elements
  const videoElementsRef = useRef<Record<number, HTMLVideoElement>>({});
  const [previewPlaybackTime, setPreviewPlaybackTime] = useState(0);

  // Rendering state
  const [renderingProgress, setRenderingProgress] = useState(0);
  const [renderingStage, setRenderingStage] = useState<string>('pending');
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
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
  const isTabletViewport = viewportWidth >= 560 && viewportWidth < 1280;
  
  // WebSocket job tracking
  const videoJobIdsRef = useRef<Map<number, Set<string>>>(new Map());
  const jobToSceneRef = useRef<Map<string, number>>(new Map());
  const processedJobIdsRef = useRef<Set<string>>(new Set());
  const unsubscribeFromJobRef = useRef<((jobId: string) => void) | null>(null);

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
  const getImageUrl = (sceneNumber: number): string | null => {
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
    
    // Last resort: original provider URL
    return image.imageUrl || null;
  };

  // Get video URL for scene - prioritize GCS URLs, fallback to local
  const getVideoUrl = (sceneNumber: number): string | null => {
    const video = brollVideos.find(vid => vid.sceneNumber === sceneNumber);
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

          if (projectData.captionsEnabled && projectData.captionSettings) {
            const caps = projectData.captionSettings as Record<string, unknown>;
            setCaptionsEnabled(true);
            if (caps.displayMode === 'full-sentence' || caps.displayMode === 'word-by-word') {
              setCaptionDisplayMode(caps.displayMode);
            }
            if (caps.applyToAll === false) setCaptionApplyToAll(false);
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
            
            if (startModeParam === 'videos' && videos.length > 0) {
              // Explicitly requested videos mode and we have videos
              setWorkspaceMode('videos');
            } else if (startModeParam === 'images') {
              // Explicitly requested images mode (mixed content case)
              setWorkspaceMode('images');
            } else if (videos.length > 0) {
              // Default: if videos exist, set to videos mode
              setWorkspaceMode('videos');
            }
          }

          // Check if project is already completed or rendering
          if (projectData.status === 'COMPLETED' && (projectData.videoPublicUrl || projectData.videoGcsUrl || projectData.videoUrl)) {
            // Project already has final video - go to completed mode
            const finalUrl = projectData.videoPublicUrl || projectData.videoGcsUrl || 
              (projectData.videoUrl?.startsWith('http') ? projectData.videoUrl : `${VIDEO_SERVICE_BASE_URL}${projectData.videoUrl}`);
            setFinalVideoUrl(finalUrl);
            setWorkspaceMode('completed');
            setRenderingProgress(100);
            setRenderingStage('completed');
          } else if (projectData.status === 'IN_PROGRESS' && projectData.renderingStatus) {
            // Project is currently rendering - resume polling
            setWorkspaceMode('rendering');
            setRenderingProgress(projectData.renderingProgress || 0);
            setRenderingStage(projectData.renderingStatus);
            // Start polling from here - but we need to use the function after it's defined
            // So we'll set a flag and handle it in a useEffect
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

  // Handle back navigation
  const handleBack = () => {
    if (projectId) {
      router.push(`/create-video/ai-chat?projectId=${projectId}`);
    } else {
      router.push('/create-video/ai-chat');
    }
  };

  const handleDownloadFinalVideo = useCallback(async () => {
    if (!finalVideoUrl) return;

    try {
      const response = await fetch(finalVideoUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch video (${response.status})`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${project?.title || `project-${projectId || 'video'}`}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      showToast('Download started', 'success');
    } catch (error) {
      console.warn('Direct download failed, falling back to opening URL:', error);
      window.open(finalVideoUrl, '_blank');
      showToast('Download could not start directly. Opened video in a new tab.', 'info');
    }
  }, [finalVideoUrl, project?.title, projectId, showToast]);

  // Track preview container dimensions for avatar overlay positioning
  useEffect(() => {
    const updateDimensions = () => {
      setViewportWidth(window.innerWidth);
      if (previewContainerRef.current) {
        const rect = previewContainerRef.current.getBoundingClientRect();
        setPreviewDimensions({
          width: previewContainerRef.current.offsetWidth,
          height: previewContainerRef.current.offsetHeight,
        });
        setMobileDrawerFrame({
          top: Math.max(96, rect.top),
          height: Math.max(260, Math.round(rect.height)),
        });
      }
    };
    
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [workspaceMode, selectedSceneIndex, sceneCount]);

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      if (window.innerWidth >= 1280) {
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
            avatarOverlay: settings
          }
        });
        console.log('[Workspace] Avatar overlay settings saved');
      } catch (error) {
        console.error('[Workspace] Failed to save avatar overlay settings:', error);
      }
    }, 300);
  }, [projectId, project]);

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

  // Handle avatar position change (from drag or resize)
  const handleAvatarPositionChange = useCallback((newPosition: { x: number; y: number; scale: number }) => {
    if (avatarApplyToAll) {
      // Update global position for all scenes
      setAvatarGlobalPosition(newPosition);
      saveAvatarOverlaySettings({
        enabled: avatarOverlayEnabled,
        applyToAll: true,
        globalPosition: newPosition,
        perScenePositions: avatarPerScenePositions
      });
    } else {
      // Update only current scene's position
      const currentSceneNumber = scenes[selectedSceneIndex]?.scene_number || 
                                  scenes[selectedSceneIndex]?.sceneNumber || 
                                  (selectedSceneIndex + 1);
      const newPerScenePositions = {
        ...avatarPerScenePositions,
        [currentSceneNumber]: newPosition
      };
      setAvatarPerScenePositions(newPerScenePositions);
      saveAvatarOverlaySettings({
        enabled: avatarOverlayEnabled,
        applyToAll: false,
        globalPosition: avatarGlobalPosition,
        perScenePositions: newPerScenePositions
      });
    }
  }, [avatarApplyToAll, avatarOverlayEnabled, avatarGlobalPosition, avatarPerScenePositions, scenes, selectedSceneIndex, saveAvatarOverlaySettings]);

  // Get current avatar position for the selected scene
  const getCurrentAvatarPosition = useCallback(() => {
    if (avatarApplyToAll) {
      return avatarGlobalPosition;
    }
    const currentSceneNumber = scenes[selectedSceneIndex]?.scene_number || 
                                scenes[selectedSceneIndex]?.sceneNumber || 
                                (selectedSceneIndex + 1);
    return avatarPerScenePositions[currentSceneNumber] || avatarGlobalPosition;
  }, [avatarApplyToAll, avatarGlobalPosition, avatarPerScenePositions, scenes, selectedSceneIndex]);

  // Handle caption position change
  const handleCaptionPositionChange = useCallback((newPosition: { x: number; y: number; scale: number; widthScale: number }) => {
    if (captionApplyToAll) {
      setCaptionGlobalPosition(newPosition);
    } else {
      const currentSceneNumber = scenes[selectedSceneIndex]?.scene_number || 
                                  scenes[selectedSceneIndex]?.sceneNumber || 
                                  (selectedSceneIndex + 1);
      setCaptionPerScenePositions(prev => ({
        ...prev,
        [currentSceneNumber]: newPosition
      }));
    }
  }, [captionApplyToAll, scenes, selectedSceneIndex]);

  // Handle caption style change
  const handleCaptionStyleChange = useCallback((newStyle: typeof captionStyle) => {
    setCaptionStyle(newStyle);
    setCaptionStylePreset('custom');
  }, []);

  // Get current caption position for the selected scene
  const getCurrentCaptionPosition = useCallback(() => {
    if (captionApplyToAll) {
      return captionGlobalPosition;
    }
    const currentSceneNumber = scenes[selectedSceneIndex]?.scene_number || 
                                scenes[selectedSceneIndex]?.sceneNumber || 
                                (selectedSceneIndex + 1);
    return captionPerScenePositions[currentSceneNumber] || captionGlobalPosition;
  }, [captionApplyToAll, captionGlobalPosition, captionPerScenePositions, scenes, selectedSceneIndex]);

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

  // Handle image regeneration
  const handleRegenerate = async () => {
    if (!projectId) return;

    const currentScene = scenes[selectedSceneIndex];
    if (!currentScene) return;

    const sceneNumber = currentScene.scene_number || currentScene.sceneNumber || (selectedSceneIndex + 1);
    
    // For ALTERNATE style, ALL scenes need b-roll images
    // Even scenes (half-n-half) need b-roll for the top half
    // So we need to check multiple fields and handle missing prompts
    let prompt = currentScene.broll_image_prompt || currentScene.broll_prompt || currentScene.broll_visual_description || '';
    
    // For ALTERNATE style, if prompt is empty and it's an odd (half-n-half) scene,
    // we still need a b-roll image for the top half
    if (!prompt && project?.style === 'ALTERNATE' && sceneNumber % 2 === 1) {
      // Try to use broll_visual_description or generate a fallback
      prompt = currentScene.broll_visual_description || `Scene ${sceneNumber} b-roll for half-n-half composition`;
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
      const response = await apiClient.regenerateImage(projectId, sceneNumber, prompt, defaultModel);
      if (response.success) {
        showToast('Image regeneration started', 'success');
        // Reload project to get updated image
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
    } catch (error: any) {
      console.error('Failed to regenerate image:', error);
      showToast('Failed to regenerate image', 'error');
    }
  };

  const handleSceneRegenerate = async (sceneIndex: number) => {
    setSelectedSceneIndex(sceneIndex);
    await handleRegenerate();
  };

  // Handle convert to videos (uses batch API)
  const handleConvertToVideos = async () => {
    if (!projectId) return;

    const scenesNeedingVideos = scenes.filter((scene, index) => {
      const sceneNumber = scene.scene_number || scene.sceneNumber || (index + 1);
      const hasImage = brollImages.some(img => img.sceneNumber === sceneNumber);
      const hasVideo = brollVideos.some(vid => vid.sceneNumber === sceneNumber);
      return hasImage && !hasVideo;
    });

    if (scenesNeedingVideos.length === 0) {
      showToast('All scenes already have videos', 'info');
      setWorkspaceMode('videos');
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
              const queueType = r.data?.type === 'scene' ? 'scene-composite' : 'video-generation';
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
        const queueType = type === 'scene' ? 'scene-composite' : 'video-generation';
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

          // Check for completion
          if (status === 'COMPLETED' || renderingStatus === 'completed') {
            clearInterval(renderingPollingRef.current!);
            renderingPollingRef.current = null;
            setRenderingProgress(100);
            setRenderingStage('completed');
            
            // Set final video URL (prioritize GCS/public URLs)
            const finalUrl = videoPublicUrl || videoGcsUrl || 
              (videoUrl?.startsWith('http') ? videoUrl : `${VIDEO_SERVICE_BASE_URL}${videoUrl}`);
            setFinalVideoUrl(finalUrl);
            
            // Transition to completed mode after a short delay
            setTimeout(() => {
              setWorkspaceMode('completed');
              showToast('Video rendering completed!', 'success');
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('credits-refresh'));
              }
            }, 1000);
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

  // Handle export - start final video rendering
  const handleExport = async () => {
    if (!projectId) return;

    setWorkspaceMode('rendering');
    setRenderingProgress(0);
    setRenderingStage('pending');

    try {
      // Save caption settings to project before rendering
      if (captionsEnabled) {
        const captionSettingsToSave = {
          enabled: captionsEnabled,
          displayMode: captionDisplayMode,
          applyToAll: captionApplyToAll,
          globalPosition: captionGlobalPosition,
          perScenePositions: captionPerScenePositions,
          previewContainerHeight: previewDimensions.height,
          previewContainerWidth: previewDimensions.width,
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
        };
        
        await apiClient.updateVideoProject(projectId, {
          captionsEnabled: true,
          captionSettings: captionSettingsToSave,
        });
        console.log('[Workspace] Caption settings saved before rendering');
      }

      const response = await apiClient.startVideoRendering(projectId);
      
      if (!response.success) {
        throw new Error(response.message || 'Failed to start rendering');
      }

      console.log('[Workspace] Rendering started successfully');
      startRenderingPolling();
    } catch (error: any) {
      console.error('Failed to start rendering:', error);
      showToast(error.response?.data?.message || error.message || 'Failed to start rendering. Please try again.', 'error');
      setWorkspaceMode('videos');
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
              : project?.style === 'ALTERNATE' && brollModalSceneNumber % 2 === 1
                ? '9:8'
                : '9:16',
        }),
      });

      const data = await response.json();

      if (data.success) {
        showToast(`B-roll updated for scene ${brollModalSceneNumber}`, 'success');

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
    const isVideo = update.queueType === 'video-generation';
    const isComposite = update.queueType === 'scene-composite';
    const sceneNum = update.result?.video?.sceneNumber ?? update.metadata?.sceneNumber;

    if (update.state === 'progress' && isComposite && sceneNum) {
      // Progress events for ALTERNATE odd / half-n-half scenes (broll_complete, avatar_complete, compositing)
      // Optionally update per-scene progress UI; for now we just log
      console.log('[Workspace] Scene progress:', sceneNum, update.metadata?.stage);
      return;
    }

    if (isVideo || isComposite) {
      if ((update.state === 'completed') && update.result?.success && update.result?.video) {
        const video = update.result.video;
        const jobId = update.jobId;
        const sceneNumber = video.sceneNumber;
        
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
        setBrollVideos(prev => {
          const exists = prev.some(v => v.sceneNumber === sceneNumber);
          const updatedVideo: BrollVideo = {
            ...video,
            jobId,
            sceneNumber: typeof sceneNumber === 'number' ? sceneNumber : parseInt(String(sceneNumber), 10),
            localPath: video.localPath || video.local_path,
            localUrl: video.localUrl || video.local_url,
            videoUrl: video.videoUrl || video.video_url,
          };
          
          if (exists) {
            return prev.map(v => v.sceneNumber === sceneNumber ? updatedVideo : v);
          }
          return [...prev, updatedVideo];
        });
        
        // Remove from generating set
        setGeneratingVideos(prev => {
          const next = new Set(prev);
          next.delete(sceneNumber);
          return next;
        });
        
        // Unsubscribe from job
        unsubscribeFromJobRef.current?.(jobId);
        
        // Clean up job tracking
        const expectedJobs = videoJobIdsRef.current.get(sceneNumber);
        if (expectedJobs) {
          expectedJobs.delete(jobId);
          if (expectedJobs.size === 0) {
            videoJobIdsRef.current.delete(sceneNumber);
          }
        }
        jobToSceneRef.current.delete(jobId);
        
        showToast(`Video generated for Scene ${sceneNumber}`, 'success');
      } else if (update.state === 'failed') {
        const jobId = update.jobId;
        const sceneNumber = jobToSceneRef.current.get(jobId);
        
        if (sceneNumber) {
          setGeneratingVideos(prev => {
            const next = new Set(prev);
            next.delete(sceneNumber);
            return next;
          });
          
          // Track failed generation
          setFailedGenerations(prev => new Set(prev).add(sceneNumber));
          
          // Clean up job tracking
          const expectedJobs = videoJobIdsRef.current.get(sceneNumber);
          if (expectedJobs) {
            expectedJobs.delete(jobId);
            if (expectedJobs.size === 0) {
              videoJobIdsRef.current.delete(sceneNumber);
            }
          }
          jobToSceneRef.current.delete(jobId);
          
          showToast(`Video generation failed for Scene ${sceneNumber}`, 'error');
        }
        
        unsubscribeFromJobRef.current?.(jobId);
      }
    }
  }, [showToast]);

  // WebSocket integration
  const { subscribeToJob, unsubscribeFromJob } = useWebSocket({
    onJobStatusUpdate: handleJobStatusUpdate,
  });
  unsubscribeFromJobRef.current = unsubscribeFromJob;

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
      // Count successful videos
      const successfulVideos = brollVideos.length;
      const totalScenesNeeded = scenes.length;
      
      if (successfulVideos >= totalScenesNeeded) {
        // All videos generated successfully
        setWorkspaceMode('videos');
        showToast('All videos generated successfully!', 'success');
      } else if (failedGenerations.size > 0) {
        // Some videos failed
        const failedCount = failedGenerations.size;
        if (successfulVideos > 0) {
          // Partial success - switch to videos mode but warn
          setWorkspaceMode('videos');
          showToast(`${failedCount} video(s) failed to generate. You can retry from images view.`, 'warning');
        } else {
          // All failed - go back to images mode
          setWorkspaceMode('images');
          showToast('Video generation failed. Please try again.', 'error');
        }
      }
    }
  }, [generatingVideos.size, brollVideos.length, scenes.length, failedGenerations.size, workspaceMode, showToast]);

  // Resume rendering polling if project was loading during rendering
  useEffect(() => {
    if (project && project.status === 'IN_PROGRESS' && project.renderingStatus && workspaceMode === 'rendering') {
      startRenderingPolling();
    }
  }, [project, workspaceMode, startRenderingPolling]);

  // Handle switching back to images mode
  const handleBackToImages = useCallback(() => {
    setWorkspaceMode('images');
    setFailedGenerations(new Set());
  }, []);

  // Preview/caption: keep hooks above any early return (Rules of Hooks)
  const currentScene = scenes[selectedSceneIndex];
  const currentSceneNumber = currentScene?.scene_number || currentScene?.sceneNumber || (selectedSceneIndex + 1);
  const currentImageUrl = getImageUrl(currentSceneNumber);
  const currentSceneText = currentScene ? getSceneText(currentScene) : '';
  const currentBrollVideoUrl =
    workspaceMode === 'videos' ? getVideoUrl(currentSceneNumber) : null;
  const hasPreviewMedia = Boolean(currentImageUrl || currentBrollVideoUrl);
  const currentAudioForScene = audioFiles.find((af) => af.sceneNumber === currentSceneNumber);

  useEffect(() => {
    setPreviewPlaybackTime(0);
  }, [currentSceneNumber]);

  const previewCaptionText = useMemo(() => {
    const base =
      (currentSceneText || currentAudioForScene?.voiceover || '').trim() || 'Sample caption text';
    if (!currentBrollVideoUrl) return base;
    if (captionDisplayMode === 'full-sentence') return base;
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

  if (loading || authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="text-[clamp(1rem,1.76vh,18px)] text-[#212121]">Loading workspace...</div>
      </div>
    );
  }

  const showMainWorkspace =
    workspaceMode !== 'rendering' && !(workspaceMode === 'completed' && finalVideoUrl);

  return (
    <div className="relative min-h-full flex flex-col overflow-hidden">
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
      {workspaceMode === 'completed' && finalVideoUrl && (
        <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
          <div className="relative max-w-[1248px] w-full mx-auto pt-0 sm:pt-2 md:pt-[43px] pb-0 sm:pb-2 md:pb-[43px] flex flex-col flex-1 min-h-0 px-3 sm:px-6 md:px-[96px]">
            {/* Header Row */}
            <div className="flex flex-row justify-between items-center mb-0 sm:mb-2 md:mb-[24px] h-[clamp(20px,3.3vh,34px)] flex-shrink-0">
              {/* Left: Back + Workspace */}
              <div className="flex flex-row items-center gap-[clamp(0.75rem,2vh,20px)] min-w-[90px] sm:min-w-[110px] md:min-w-[125px]">
                <button
                  onClick={() => setWorkspaceMode('videos')}
                  className="flex items-center justify-center w-[clamp(16px,2.34vh,24px)] h-[clamp(16px,2.34vh,24px)] cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <ArrowLeft className="w-full h-full text-[#212121]" strokeWidth={1.5} />
                </button>
                <h2 className="font-heading text-[clamp(14px,2.34vh,24px)] font-medium leading-[clamp(14px,2.34vh,24px)] text-[#212121]">Workspace</h2>
              </div>

              {/* Right: Export button */}
              <button
                onClick={() => {
                  if (finalVideoUrl) {
                    window.open(finalVideoUrl, '_blank');
                  }
                }}
                className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] px-[clamp(12px,1.39vw,20px)] py-[clamp(8px,1.17vh,12px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[26px] min-w-[clamp(120px,14vw,202px)] h-[clamp(32px,3.3vh,40px)] hover:opacity-90 transition-opacity"
              >
                <span className="font-heading font-semibold text-[clamp(12px,1.37vh,14px)] leading-[clamp(12px,1.37vh,14px)] text-white">
                  Export →
                </span>
              </button>
            </div>

            {/* Main content - Video Preview centered */}
            <div className="flex-1 flex flex-col items-center justify-center min-h-0 py-4">
              {/* Video player container - 9:16 aspect ratio */}
              <div className="relative h-[60vh] max-h-[500px] aspect-[9/16] rounded-[20px] overflow-hidden shadow-lg bg-black">
                <video
                  src={finalVideoUrl}
                  className="w-full h-full object-contain"
                  controls
                  autoPlay={false}
                  playsInline
                >
                  Your browser does not support the video tag.
                </video>
                
                {/* Play button overlay - shows when video is not playing */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 hover:opacity-100 transition-opacity">
                  <div className="w-16 h-16 bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-full flex items-center justify-center">
                    <Play className="w-8 h-8 text-white ml-1" fill="white" />
                  </div>
                </div>
              </div>

              {/* Export & Share section */}
              <div className="mt-8 text-center space-y-4">
                <h3 className="font-heading text-[clamp(18px,2.34vh,24px)] font-semibold text-[#212121]">Export & Share</h3>
                <div className="flex justify-center gap-6">
                  {/* Download */}
                  <button
                    type="button"
                    onClick={handleDownloadFinalVideo}
                    className="flex flex-col items-center gap-2 p-3 hover:bg-gray-50 rounded-lg transition-colors min-w-[70px]"
                  >
                    <svg className="w-6 h-6 text-[#E86412]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span className="text-xs text-gray-600">Download</span>
                  </button>
                  
                  {/* Instagram */}
                  <button className="flex flex-col items-center gap-2 p-3 hover:bg-gray-50 rounded-lg transition-colors min-w-[70px]">
                    <svg className="w-6 h-6 text-[#E86412]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zM12 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                    </svg>
                    <span className="text-xs text-gray-600">Instagram</span>
                  </button>
                  
                  {/* Facebook */}
                  <button className="flex flex-col items-center gap-2 p-3 hover:bg-gray-50 rounded-lg transition-colors min-w-[70px]">
                    <svg className="w-6 h-6 text-[#E86412]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                    <span className="text-xs text-gray-600">Facebook</span>
                  </button>
                  
                  {/* Share */}
                  <button
                    onClick={() => {
                      if (navigator.share && finalVideoUrl) {
                        navigator.share({
                          title: 'My Video',
                          url: finalVideoUrl,
                        });
                      } else {
                        navigator.clipboard.writeText(finalVideoUrl || '');
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
          {brollVideos.length > 0 && !['converting', 'rendering', 'completed'].includes(workspaceMode) && (
            <div className="hidden xl:flex items-center gap-1 bg-gray-100 rounded-full p-1">
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
                onClick={() => setWorkspaceMode('videos')}
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
            onClick={workspaceMode === 'videos' ? handleExport : handleConvertToVideos}
            disabled={workspaceMode === 'converting'}
            className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] px-[clamp(12px,1.39vw,20px)] py-[clamp(8px,1.17vh,12px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[26px] min-w-[clamp(120px,14vw,202px)] h-[clamp(32px,3.3vh,40px)] hover:opacity-90 transition-opacity disabled:opacity-70 disabled:cursor-wait">
            <span className="font-heading font-semibold text-[clamp(12px,1.37vh,14px)] leading-[clamp(12px,1.37vh,14px)] text-white flex items-center gap-2">
              {workspaceMode === 'converting' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Converting...
                </>
              ) : workspaceMode === 'videos' ? (
                'Export →'
              ) : (
                'Convert to Videos →'
              )}
            </span>
          </button>
          </div>
        </div>

        {/* Main content area — stack on small screens; three columns from lg up */}
        <div className="flex flex-col xl:flex-row items-stretch xl:items-start gap-4 xl:gap-[clamp(12px,1.39vw,20px)] flex-1 min-h-0 overflow-y-auto xl:overflow-y-hidden xl:overflow-x-visible px-4 sm:px-6 pb-6 xl:pb-0 min-h-0">
        {/* Left sidebar - Scene list */}
        <div className={cn(
          "flex-col items-start p-[clamp(12px,1.56vh,16px)] gap-[clamp(6px,0.98vh,8px)] w-full xl:basis-[clamp(280px,28vw,360px)] xl:min-w-[280px] xl:max-w-[360px] h-auto xl:h-full bg-white/95 shadow-[0px_1px_12px_rgba(242,126,53,0.12)] overflow-hidden shrink-0",
          "hidden xl:flex xl:relative xl:inset-auto xl:z-auto xl:rounded-[20px]",
          "xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto",
          "fixed left-0 z-50 flex w-[86vw] max-w-[340px] min-[560px]:w-[70vw] min-[560px]:max-w-[420px] rounded-r-2xl border border-[#EFE5DF] transition-transform duration-300 ease-out xl:transition-none",
          leftDrawerOpen ? "translate-x-0 opacity-100 pointer-events-auto" : "-translate-x-full opacity-0 pointer-events-none"
        )}
        style={leftDrawerOpen ? { top: `${mobileDrawerFrame.top}px`, height: `${mobileDrawerFrame.height}px`, maxHeight: `${mobileDrawerFrame.height}px` } : undefined}>
          <div className="flex flex-col items-center gap-[clamp(8px,0.98vh,10px)] w-full h-full overflow-y-auto pr-[clamp(4px,0.52vw,8px)]">
            {scenes.length > 0 ? (
              scenes.map((scene, index) => {
                const sceneNumber = scene.scene_number || scene.sceneNumber || (index + 1);
                const imageUrl = getImageUrl(sceneNumber);
                const videoUrl = getVideoUrl(sceneNumber);
                const sceneText = getSceneText(scene);
                const timeRange = getSceneTimeRange(index);
                const isSelected = index === selectedSceneIndex;
                const isGenerating = generatingVideos.has(sceneNumber);
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
                    <div className={cn(
                      "flex flex-row justify-center items-start gap-[clamp(8px,0.98vh,12px)] w-full bg-white rounded-[10px] transition-all",
                      isSelected ? "p-[clamp(12px,1.76vh,22px)]" : "p-[clamp(14px,1.95vh,24px)]"
                    )}>
                      <div className="w-[clamp(58px,7.8vw,90px)] h-[clamp(73px,11vh,113px)] rounded-[12px] overflow-hidden flex-shrink-0 relative">
                        {workspaceMode === 'videos' && hasVideo ? (
                          <video
                            src={videoUrl}
                            className="w-full h-full object-cover"
                            muted
                            playsInline
                            onError={(e) => {
                              console.error('Video failed to load:', videoUrl);
                              const target = e.target as HTMLVideoElement;
                              target.style.opacity = '0.5';
                            }}
                          />
                        ) : (workspaceMode === 'converting' || isGenerating) ? (
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
                          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-20 hover:bg-opacity-30 transition-opacity">
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
                            className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-[#E4D7CF] text-[#8B6C5C] hover:text-[#E86412] hover:border-[#E86412] transition-colors"
                            title="Regenerate scene"
                            aria-label={`Regenerate scene ${sceneNumber}`}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
        <div className="relative flex flex-col items-center gap-[clamp(12px,1.56vh,20px)] w-full min-w-0 xl:flex-1 xl:max-w-[520px] xl:min-w-[340px] max-w-[min(520px,calc(100vw-2rem))] min-[560px]:max-w-[min(620px,calc(100vw-1rem))] mx-auto h-auto xl:h-full shrink-0">
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
              className="xl:hidden absolute left-[-10px] min-[560px]:left-[-14px] top-1/2 -translate-y-1/2 z-30 inline-flex flex-col items-center justify-center gap-1 h-[46%] min-h-[180px] max-h-[280px] min-[560px]:h-[54%] min-[560px]:min-h-[230px] min-[560px]:max-h-[420px] w-8 min-[560px]:w-10 rounded-r-2xl border border-[#E0D5CF] bg-white/95 shadow-sm"
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
              className="xl:hidden absolute right-[-10px] min-[560px]:right-[-14px] top-1/2 -translate-y-1/2 z-30 inline-flex flex-col items-center justify-center gap-1 h-[46%] min-h-[180px] max-h-[280px] min-[560px]:h-[54%] min-[560px]:min-h-[230px] min-[560px]:max-h-[420px] w-8 min-[560px]:w-10 rounded-l-2xl border border-[#E0D5CF] bg-white/95 shadow-sm"
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

            {/* Preview image/video - 9:16 aspect ratio */}
            <div 
              ref={previewContainerRef}
              className="relative rounded-[12px] overflow-hidden bg-gray-200 flex items-center justify-center flex-shrink-0"
              style={{ 
                width: isTabletViewport ? 'min(340px, calc((100% - 128px)))' : 'min(260px, calc((100% - 100px)))',
                aspectRatio: '9/16'
              }}
            >
              {workspaceMode === 'videos' && getVideoUrl(currentSceneNumber) ? (
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
              
              {/* Avatar Overlay - Only for AVATAR_CUTOUT style when enabled, hidden during converting */}
              {project?.style === 'AVATAR_CUTOUT' && avatarOverlayEnabled && avatarImageUrl && hasPreviewMedia && workspaceMode !== 'converting' && (
                <DraggableResizableAvatar
                  avatarImageUrl={avatarImageUrl}
                  position={getCurrentAvatarPosition()}
                  onPositionChange={handleAvatarPositionChange}
                  containerWidth={previewDimensions.width}
                  containerHeight={previewDimensions.height}
                  disabled={false}
                />
              )}
              
              {/* Caption Overlay - For all styles when captions enabled, hidden during converting */}
              {captionsEnabled && hasPreviewMedia && workspaceMode !== 'converting' && (
                <DraggableResizableCaption
                  captionText={previewCaptionText}
                  position={getCurrentCaptionPosition()}
                  style={captionStyle}
                  onPositionChange={handleCaptionPositionChange}
                  onStyleChange={handleCaptionStyleChange}
                  containerWidth={previewDimensions.width}
                  containerHeight={previewDimensions.height}
                  disabled={false}
                />
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
          {brollVideos.length > 0 && !['converting', 'rendering', 'completed'].includes(workspaceMode) && (
            <div className="xl:hidden flex items-center gap-1 bg-gray-100 rounded-full p-1">
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
                onClick={() => setWorkspaceMode('videos')}
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
          "flex-col items-start p-[clamp(12px,1.56vh,16px)] gap-[clamp(8px,0.98vh,10px)] w-full xl:basis-[clamp(320px,26.7vw,384px)] xl:min-w-[320px] xl:max-w-[384px] min-h-0 xl:h-full bg-white/95 shadow-[0px_1px_12px_rgba(242,126,53,0.12)] overflow-hidden shrink-0",
          "hidden xl:flex xl:relative xl:inset-auto xl:z-auto xl:rounded-[20px]",
          "xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto",
          "fixed right-0 z-50 flex w-[86vw] max-w-[340px] min-[560px]:w-[70vw] min-[560px]:max-w-[420px] rounded-l-2xl border border-[#EFE5DF] transition-transform duration-300 ease-out xl:transition-none",
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
                    {/* Apply to all scenes checkbox - custom styled */}
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
                <span className="font-heading font-semibold text-[clamp(14px,1.76vh,18px)] leading-[clamp(14px,1.76vh,18px)] text-[#212121] flex-1">Background Music</span>
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
                  {/* Tabs */}
                  <div className="flex flex-row items-center gap-0 w-full h-[clamp(28px,3.52vh,36px)] bg-[#E0E0E0] rounded-[24px] p-[clamp(2px,0.39vh,4px)] flex-shrink-0">
                    <button
                      onClick={() => setMusicTab('library')}
                      className={`flex flex-row justify-center items-center gap-[clamp(8px,0.98vh,10px)] flex-1 h-full rounded-[24px] transition-colors ${musicTab === 'library' ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C]' : ''}`}
                    >
                      <span className={`font-heading font-medium text-[clamp(14px,1.56vh,16px)] leading-[clamp(14px,1.56vh,16px)] ${musicTab === 'library' ? 'text-white' : 'text-[#212121]'}`}>Library</span>
                    </button>
                    <button
                      onClick={() => setMusicTab('upload')}
                      className={`flex flex-row justify-center items-center gap-[clamp(8px,0.98vh,10px)] flex-1 h-full rounded-[24px] transition-colors ${musicTab === 'upload' ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C]' : ''}`}
                    >
                      <span className={`font-heading font-normal text-[clamp(14px,1.56vh,16px)] leading-[clamp(14px,1.56vh,16px)] ${musicTab === 'upload' ? 'text-white' : 'text-[#212121]'}`}>Upload</span>
                    </button>
                  </div>

                  {/* Music list - scrollable */}
                  {musicTab === 'library' && (
                    <div className="flex flex-col gap-[clamp(6px,0.78vh,8px)] w-full flex-1 min-h-0 overflow-y-auto pr-1">
                      {['Commercial Music', 'Advertisement Music', 'Motivation Music', 'Nature Music'].map((category, index) => (
                        <div key={index} className="flex flex-row items-center gap-[clamp(10px,1.17vh,12px)] w-full h-[clamp(50px,5.15vh,66px)] rounded-[8px] flex-shrink-0">
                          <button className="w-[clamp(32px,3.9vw,40px)] h-[clamp(32px,3.9vw,40px)] bg-[#E0E0E0] rounded-full flex items-center justify-center flex-shrink-0">
                            <Play className="w-[clamp(14px,1.56vh,16px)] h-[clamp(14px,1.56vh,16px)] text-[#212121]" />
                          </button>
                          <div className="flex flex-col justify-center items-start flex-1 min-w-0">
                            <span className="font-heading font-medium text-[clamp(14px,1.56vh,16px)] leading-[clamp(14px,1.56vh,16px)] text-[#212121] truncate w-full">{category}</span>
                          </div>
                          <div className="flex flex-col items-center p-[clamp(3px,0.39vh,4px)] w-[clamp(260px,27.1vw,278px)] h-[clamp(8px,0.98vh,10px)] bg-white rounded-[18px] flex-shrink-0">
                            <div className="w-[clamp(6px,0.65vw,8px)] h-[clamp(6px,0.65vw,8px)] bg-white rounded-full" />
                          </div>
                        </div>
                      ))}
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
                      {/* Display Mode */}
                      <div className="flex flex-col gap-[clamp(6px,0.78vh,8px)] w-full">
                        <span className="text-[clamp(11px,1.27vh,13px)] font-medium text-gray-600">Display Mode</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setCaptionDisplayMode('word-by-word')}
                            className={`flex-1 px-3 py-1.5 text-[clamp(10px,1.17vh,12px)] rounded-lg border transition-all ${
                              captionDisplayMode === 'word-by-word'
                                ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C] text-white border-transparent'
                                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            Word-by-word
                          </button>
                          <button
                            onClick={() => setCaptionDisplayMode('full-sentence')}
                            className={`flex-1 px-3 py-1.5 text-[clamp(10px,1.17vh,12px)] rounded-lg border transition-all ${
                              captionDisplayMode === 'full-sentence'
                                ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C] text-white border-transparent'
                                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            Full sentence
                          </button>
                        </div>
                      </div>

                      {/* Style Presets */}
                      <div className="flex flex-col gap-[clamp(6px,0.78vh,8px)] w-full">
                        <span className="text-[clamp(11px,1.27vh,13px)] font-medium text-gray-600">Style Preset</span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => applyCaptionPreset('light')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border transition-all ${
                              captionStylePreset === 'light'
                                ? 'border-[#E86412] bg-orange-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className="w-5 h-5 rounded bg-white border border-gray-300 flex items-center justify-center">
                              <span className="text-[8px] font-bold text-black">Aa</span>
                            </div>
                            <span className="text-[clamp(10px,1.17vh,12px)] text-gray-700">Light</span>
                          </button>
                          <button
                            onClick={() => applyCaptionPreset('dark')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border transition-all ${
                              captionStylePreset === 'dark'
                                ? 'border-[#E86412] bg-orange-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className="w-5 h-5 rounded bg-black flex items-center justify-center">
                              <span className="text-[8px] font-bold text-white">Aa</span>
                            </div>
                            <span className="text-[clamp(10px,1.17vh,12px)] text-gray-700">Dark</span>
                          </button>
                          <button
                            onClick={() => applyCaptionPreset('transparent')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border transition-all ${
                              captionStylePreset === 'transparent'
                                ? 'border-[#E86412] bg-orange-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className="w-5 h-5 rounded flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                              <span className="text-[8px] font-bold text-gray-800 drop-shadow-sm">Aa</span>
                            </div>
                            <span className="text-[clamp(10px,1.17vh,12px)] text-gray-700">Transparent</span>
                          </button>
                        </div>
                        {captionStylePreset === 'custom' && (
                          <div className="text-[clamp(10px,1.07vh,11px)] text-gray-500 text-center">
                            Custom style - edit using the overlay toolbar
                          </div>
                        )}
                      </div>

                      {/* Apply to All Scenes */}
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
          className="xl:hidden fixed inset-0 z-40 bg-black/20"
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
            : project?.style === 'ALTERNATE' && brollModalSceneNumber % 2 === 1
              ? '9:8'
              : '9:16'
        }
      />
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

