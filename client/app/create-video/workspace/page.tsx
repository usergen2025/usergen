'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, ChevronLeft, ChevronRight, Edit, Music, Type, ChevronUp, Play, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket, JobStatusUpdate } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils/cn';

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

interface AudioFile {
  sceneNumber: number;
  filePath?: string;
  localUrl: string;
  voiceover?: string;
  duration?: number;
  gcsUrl?: string;      // GCS public URL
  publicUrl?: string;   // Preferred public URL (GCS if available, fallback to backend)
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
  const projectIdFromUrl = searchParams.get('projectId');

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
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [musicExpanded, setMusicExpanded] = useState(true);
  const [captionsExpanded, setCaptionsExpanded] = useState(true);
  
  // Workspace mode: 'images' | 'converting' | 'videos'
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('images');
  const [generatingVideos, setGeneratingVideos] = useState<Set<number>>(new Set());
  const [failedGenerations, setFailedGenerations] = useState<Set<number>>(new Set());
  const [playingVideo, setPlayingVideo] = useState<number | null>(null);
  // Use ref instead of state to avoid infinite re-renders when setting video elements
  const videoElementsRef = useRef<Record<number, HTMLVideoElement>>({});
  
  // Rendering state
  const [renderingProgress, setRenderingProgress] = useState(0);
  const [renderingStage, setRenderingStage] = useState<string>('pending');
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const renderingPollingRef = useRef<NodeJS.Timeout | null>(null);
  
  // Derived state for backward compatibility
  const isVideoMode = workspaceMode === 'videos';
  const isConverting = workspaceMode === 'converting';
  const isRendering = workspaceMode === 'rendering';
  const isCompleted = workspaceMode === 'completed';
  
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

          // Verify it's an AI chat flow project
          if (projectData.metadata?.generationFlow !== 'AI_CHAT') {
            // Show a local message instead of redirecting into the classic flow
            showToast('This project was created with the classic flow and is not available in the AI workspace.', 'info');
            setProject(null);
            setLoading(false);
            return;
          }

          setProject(projectData);

          // Parse script to get scenes
          if (projectData.script) {
            const script = typeof projectData.script === 'string'
              ? JSON.parse(projectData.script)
              : projectData.script;
            const scriptScenes = script.scenes || script.scene_plan || [];
            setScenes(scriptScenes);
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
            // If videos exist, set to videos mode
            if (videos.length > 0) {
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

  // Handle image upload
  const handleUpload = () => {
    showToast('Upload functionality coming soon', 'info');
  };

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
    
    // For ALTERNATE style, if prompt is empty and it's an even scene, 
    // we still need a b-roll image for the top half
    if (!prompt && project?.style === 'ALTERNATE' && sceneNumber % 2 === 0) {
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
  const RENDERING_TIMEOUT_MS = 10 * 60 * 1000;
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
      // Progress events for ALTERNATE even scenes (broll_complete, avatar_complete, compositing)
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

  if (loading || authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FFFCF8]">
        <div className="text-[clamp(1rem,1.76vh,18px)] text-[#212121]">Loading workspace...</div>
      </div>
    );
  }

  const currentScene = scenes[selectedSceneIndex];
  const currentSceneNumber = currentScene?.scene_number || currentScene?.sceneNumber || (selectedSceneIndex + 1);
  const currentImageUrl = getImageUrl(currentSceneNumber);
  const currentSceneText = currentScene ? getSceneText(currentScene) : '';

  return (
    <div className="relative h-full bg-[#FFFCF8] overflow-hidden flex flex-col">
      {/* Shimmer animation keyframes */}
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>

      {/* Rendering Overlay */}
      {workspaceMode === 'rendering' && (
        <div className="absolute inset-0 z-50 bg-[#FFFCF8] flex flex-col items-center justify-center px-4">
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

      {/* Completed State - Final Video Preview */}
      {workspaceMode === 'completed' && finalVideoUrl && (
        <div className="absolute inset-0 z-50 bg-[#FFFCF8] flex flex-col overflow-hidden">
          {/* Background ellipses for completed state */}
          <div className="absolute w-[1146px] h-[1146px] left-[calc(50%+720px)] top-[calc(50%-512px)] bg-[#E86512] opacity-10 blur-[200px] pointer-events-none" />
          <div className="absolute w-[1146px] h-[1146px] left-[calc(50%-720px)] top-[calc(50%+512px)] bg-[#E86512] opacity-10 blur-[200px] pointer-events-none" />
          
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
                  <a
                    href={finalVideoUrl}
                    download
                    className="flex flex-col items-center gap-2 p-3 hover:bg-gray-50 rounded-lg transition-colors min-w-[70px]"
                  >
                    <svg className="w-6 h-6 text-[#E86412]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span className="text-xs text-gray-600">Download</span>
                  </a>
                  
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
      
      {/* Background ellipses */}
      <div className="absolute w-[1146px] h-[1146px] left-[calc(50%+720px)] top-[calc(50%-512px)] bg-[#E86512] opacity-10 blur-[200px] pointer-events-none" />
      <div className="absolute w-[1146px] h-[1146px] left-[calc(50%-720px)] top-[calc(50%+512px)] bg-[#E86512] opacity-10 blur-[200px] pointer-events-none" />

      {/* Main Container - matches AI chat page structure */}
      <div className="relative max-w-[1248px] w-full mx-auto pt-0 sm:pt-2 md:pt-[43px] pb-0 sm:pb-2 md:pb-[43px] flex flex-col flex-1 min-h-0">
        {/* Header Row - matches AI chat navigation bar */}
        <div className="flex flex-row justify-between items-center mb-0 sm:mb-2 md:mb-[24px] h-[clamp(20px,3.3vh,34px)] flex-shrink-0 px-3 sm:px-6 md:px-[96px]">
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

          {/* Center: Mode toggle tabs - only show when videos exist and not converting/rendering/completed */}
          {brollVideos.length > 0 && !['converting', 'rendering', 'completed'].includes(workspaceMode) && (
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-1">
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

        {/* Main content area - flex layout with internal scrolling */}
        <div className="flex flex-row items-start gap-[clamp(12px,1.39vw,20px)] flex-1 min-h-0 overflow-hidden px-6">
        {/* Left sidebar - Scene list */}
        <div className="flex flex-col items-start p-[clamp(12px,1.56vh,16px)] gap-[clamp(6px,0.98vh,8px)] w-[clamp(250px,28vw,380px)] h-full bg-white shadow-[0px_1px_12px_rgba(242,126,53,0.12)] rounded-[20px] overflow-hidden">
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
                    onClick={() => setSelectedSceneIndex(index)}
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
                        <div className="flex flex-row justify-between items-center gap-[clamp(6px,0.69vw,8px)] w-full">
                          <span className="font-heading font-normal text-[clamp(12px,1.17vh,14px)] leading-[clamp(14px,1.56vh,16px)] text-[#616161]">
                            {timeRange}
                          </span>
                          <button className="w-[clamp(22px,2.73vh,28px)] h-[clamp(22px,2.73vh,28px)] flex items-center justify-center">
                            <Edit className="w-full h-full text-[#212121]" />
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
        <div className="flex flex-col items-center pt-[clamp(20px,2.93vh,30px)] gap-[clamp(12px,1.56vh,20px)] w-[clamp(320px,31.7vw,410px)] h-full overflow-y-auto">
          {/* Scene navigation */}
          <div className="flex flex-row justify-between items-center gap-[clamp(8px,0.98vh,10px)] w-full">
            <button
              onClick={handlePreviousScene}
              disabled={selectedSceneIndex === 0}
              className="w-[clamp(24px,2.5vh,32px)] h-[clamp(24px,2.5vh,32px)] rounded-[16px] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
            >
              <ChevronLeft className="w-[clamp(14px,1.56vh,16px)] h-[clamp(14px,1.56vh,16px)] text-[#212121]" />
            </button>
            <span className="font-heading font-medium text-[clamp(14px,1.56vh,16px)] leading-[clamp(14px,1.56vh,16px)] text-[#212121]">
              Scene {selectedSceneIndex + 1} of {sceneCount}
            </span>
            <button
              onClick={handleNextScene}
              disabled={selectedSceneIndex >= sceneCount - 1}
              className="w-[clamp(24px,2.5vh,32px)] h-[clamp(24px,2.5vh,32px)] rounded-[16px] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
            >
              <ChevronRight className="w-[clamp(14px,1.56vh,16px)] h-[clamp(14px,1.56vh,16px)] text-[#212121]" />
            </button>
          </div>

          {/* Preview image/video */}
          <div className="w-[clamp(280px,31.7vw,320px)] h-[clamp(430px,52.5vh,537px)] rounded-[12px] overflow-hidden bg-gray-200 flex items-center justify-center relative">
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
          </div>

          {/* Action buttons */}
          <div className="flex flex-row items-center gap-[clamp(6px,0.69vw,8px)]">
            <button
              onClick={handleUpload}
              className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] px-[clamp(6px,0.69vw,8px)] py-[clamp(6px,0.69vw,8px)] rounded-[16px] hover:bg-gray-100 transition-colors"
            >
              <Image src="/assets/u_upload.svg" alt="Upload" width={16} height={16} className="w-[clamp(14px,1.56vh,16px)] h-[clamp(14px,1.56vh,16px)]" />
              <span className="font-heading font-medium text-[clamp(14px,1.56vh,16px)] leading-[clamp(14px,1.56vh,16px)] text-[#212121] underline">Upload</span>
            </button>
            <button
              onClick={handleRegenerate}
              className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] px-[clamp(6px,0.69vw,8px)] py-[clamp(6px,0.69vw,8px)] rounded-[16px] hover:bg-gray-100 transition-colors"
            >
              <Image src="/assets/u_redo.svg" alt="Regenerate" width={16} height={16} className="w-[clamp(14px,1.56vh,16px)] h-[clamp(14px,1.56vh,16px)]" />
              <span className="font-heading font-medium text-[clamp(14px,1.56vh,16px)] leading-[clamp(14px,1.56vh,16px)] text-[#212121] underline">Regenerate</span>
            </button>
          </div>
        </div>

        {/* Right sidebar - Settings */}
        <div className="flex flex-col items-start p-[clamp(12px,1.56vh,16px)] gap-[clamp(8px,0.98vh,10px)] w-[clamp(300px,26.7vw,384px)] h-full bg-white shadow-[0px_1px_12px_rgba(242,126,53,0.12)] rounded-[20px] overflow-hidden">
          <div className="flex flex-col justify-start items-start gap-[clamp(8px,0.98vh,10px)] w-full h-full overflow-hidden">
            {/* Background Music Section - 65% of available space */}
            <div className="flex flex-col items-start p-[clamp(12px,1.76vh,20px)] gap-[clamp(8px,1.17vh,12px)] w-full bg-white border border-[#E0E0E0] rounded-[12px] flex-[0.65] min-h-0 overflow-hidden">
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
                  className={`flex flex-row items-center p-[clamp(10px,1.17vh,12px)] gap-[clamp(6px,0.69vw,8px)] w-[clamp(32px,3.9vw,40px)] h-[clamp(18px,1.95vh,20px)] rounded-[14px] cursor-pointer transition-all flex-shrink-0 ${backgroundMusicEnabled ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C] justify-end' : 'bg-gray-300 justify-start'}`}
                >
                  <div className="w-[clamp(14px,1.67vw,16px)] h-[clamp(14px,1.67vw,16px)] bg-white rounded-full transition-transform" />
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

            {/* Captions Section - 35% of available space */}
            <div className="flex flex-col items-start p-[clamp(12px,1.76vh,20px)] gap-[clamp(8px,1.17vh,12px)] w-full bg-white border border-[#E0E0E0] rounded-[12px] flex-[0.35] min-h-0 overflow-hidden">
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
                  className={`flex flex-row items-center p-[clamp(10px,1.17vh,12px)] gap-[clamp(6px,0.69vw,8px)] w-[clamp(32px,3.9vw,40px)] h-[clamp(18px,1.95vh,20px)] rounded-[14px] cursor-pointer transition-all flex-shrink-0 ${captionsEnabled ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C] justify-end' : 'bg-gray-300 justify-start'}`}
                >
                  <div className="w-[clamp(14px,1.67vw,16px)] h-[clamp(14px,1.67vw,16px)] bg-white rounded-full transition-transform" />
                </div>
              </div>

              {captionsExpanded && (
                <div className="flex flex-col items-center gap-[clamp(8px,0.98vh,10px)] w-full flex-1 min-h-0 overflow-y-auto pr-1">
                  {/* Light caption preview */}
                  <div className="flex flex-col items-start p-[clamp(4px,0.52vw,4px)] gap-[clamp(8px,0.98vh,10px)] w-full rounded-[12px] flex-shrink-0">
                    <div className="flex flex-col justify-center items-center p-[clamp(6px,0.78vh,8px)] px-[clamp(12px,1.56vh,16px)] w-full bg-gradient-to-r from-[#E0E0E0] to-[#7A7A7A] rounded-[8px]">
                      <div className="flex flex-col items-center p-[clamp(10px,1.17vh,12px)] w-[clamp(200px,20.8vw,240px)] bg-white rounded-[12px]">
                        <span className="font-heading font-normal text-[clamp(12px,1.37vh,14px)] leading-[clamp(14px,1.56vh,16px)] text-center text-black">
                          {currentSceneText || 'The quick brown fox jumps over the lazy dog'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Dark caption preview */}
                  <div className="flex flex-col items-start p-[clamp(4px,0.52vw,4px)] gap-[clamp(8px,0.98vh,10px)] w-full rounded-[12px] flex-shrink-0">
                    <div className="flex flex-col justify-center items-center p-[clamp(6px,0.78vh,8px)] px-[clamp(12px,1.56vh,16px)] w-full bg-gradient-to-r from-[#616161] to-[#C7C7C7] rounded-[8px]">
                      <div className="flex flex-col items-center p-[clamp(10px,1.17vh,12px)] w-[clamp(200px,20.8vw,240px)] bg-black rounded-[12px]">
                        <span className="font-heading font-normal text-[clamp(12px,1.37vh,14px)] leading-[clamp(14px,1.56vh,16px)] text-center text-white">
                          {currentSceneText || 'The quick brown fox jumps over the lazy dog'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
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

