'use client';

import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, RefreshCw, Loader2, Play, Pause, Video as VideoIcon } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/layout/ProgressBar';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket, JobStatusUpdate } from '@/hooks/useWebSocket';

interface BrollVideo {
  sceneNumber: number;
  jobId?: string; // Unique identifier for the generation job
  taskId?: string;
  videoUrl?: string;
  localPath?: string;
  localUrl?: string;
  duration?: number;
  prompt?: string;
}

interface Scene {
  scene_number?: number;
  sceneNumber?: number;
  voiceover?: string;
}

function BrollVideosPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const projectIdFromUrl = searchParams.get('projectId');
  
  const [projectId, setProjectId] = useState<string | null>(projectIdFromUrl);
  const [project, setProject] = useState<any>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [brollImages, setBrollImages] = useState<any[]>([]);
  const [brollVideos, setBrollVideos] = useState<BrollVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbLoaded, setDbLoaded] = useState(false); // Track DB load completion
  const [regenerating, setRegenerating] = useState<Record<number, boolean>>({});
  const [playingVideo, setPlayingVideo] = useState<number | null>(null);
  const [videoElements, setVideoElements] = useState<Record<number, HTMLVideoElement>>({});
  const [updateKey, setUpdateKey] = useState(0); // Force re-render on WebSocket updates
  
  // Track active jobs per scene: Map<sceneNumber, Set<jobId>>
  const activeJobsBySceneRef = React.useRef<Map<number, Set<string>>>(new Map());
  const jobToSceneRef = React.useRef<Map<string, number>>(new Map());
  const processedJobIdsRef = React.useRef<Set<string>>(new Set()); // Track processed job IDs to prevent duplicate toasts

  // Memoize the WebSocket handler to prevent duplicate subscriptions
  const handleJobStatusUpdate = useCallback((update: JobStatusUpdate) => {
    console.log('[BrollVideos] 🔔 WebSocket update received:', {
      jobId: update.jobId,
      queueType: update.queueType,
      state: update.state,
      sceneNumber: update.queueType === 'video-generation' ? update.result?.video?.sceneNumber : undefined,
    });
    
    if (update.queueType === 'video-generation') {
      if (update.state === 'completed' && update.result?.success && update.result?.video) {
        const video = update.result.video;
        const jobId = update.jobId;
        const sceneNumber = video.sceneNumber;
        
        // Prevent duplicate processing for the same job
        if (processedJobIdsRef.current.has(jobId)) {
          console.log(`[BrollVideos] ⏭️ Job ${jobId} already processed, skipping duplicate update`);
          return;
        }
        processedJobIdsRef.current.add(jobId);
        
        console.log('[BrollVideos] ✅ Processing completed video:', {
          jobId,
          sceneNumber,
          sceneNumberType: typeof sceneNumber,
          localUrl: video.localUrl || video.local_url,
          localPath: video.localPath || video.local_path,
          videoUrl: video.videoUrl || video.video_url,
        });
        
        // Verify this jobId is expected for this scene
        const expectedJobs = activeJobsBySceneRef.current.get(sceneNumber);
        if (!expectedJobs || !expectedJobs.has(jobId)) {
          console.warn(`[BrollVideos] ⚠️ Received update for unexpected job ${jobId} for scene ${sceneNumber}`);
          // Still process it, but log warning
        }
        
        // Update local state immediately with WebSocket data (includes localPath and localUrl)
        // Create new array reference to ensure React re-renders
        setBrollVideos(prev => {
          console.log('[BrollVideos] 🔄 Updating state - Before:', prev.length, 'videos');
          
          // Create a new array to ensure React detects the change
          const newVideos = [...prev];
          
          // Normalize sceneNumber from WebSocket update (ensure it's a number)
          const normalizedSceneNumber = typeof sceneNumber === 'number' 
            ? sceneNumber 
            : parseInt(String(sceneNumber), 10);
          
          // Find existing video by jobId first, then by sceneNumber
          const existingIndex = newVideos.findIndex(v => {
            // Match by jobId if available
            if (v.jobId && jobId && v.jobId === jobId) return true;
            // Match by sceneNumber (normalized)
            const vSceneNumber = typeof v.sceneNumber === 'number' 
              ? v.sceneNumber 
              : parseInt(String(v.sceneNumber || 0), 10);
            return vSceneNumber === normalizedSceneNumber;
          });
          
          console.log('[BrollVideos] 🔍 Found existing video at index:', existingIndex);
          
          // Ensure sceneNumber is preserved and video data is complete
          // Include all fields from backend: localPath, localUrl, videoUrl, etc.
          const updatedVideo: BrollVideo = {
            ...video,
            jobId,
            sceneNumber: normalizedSceneNumber, // Ensure sceneNumber is a number
            // Ensure we have both localPath and localUrl for UI display
            localPath: video.localPath || video.local_path,
            localUrl: video.localUrl || video.local_url,
            videoUrl: video.videoUrl || video.video_url,
          };
          
          console.log('[BrollVideos] 🎬 Updated video data:', {
            sceneNumber: updatedVideo.sceneNumber,
            jobId: updatedVideo.jobId,
            localUrl: updatedVideo.localUrl,
            localPath: updatedVideo.localPath,
          });
          
          if (existingIndex >= 0) {
            // Replace existing video with new object reference (for regeneration)
            newVideos[existingIndex] = updatedVideo;
            console.log('[BrollVideos] 🔄 Replaced video at index:', existingIndex);
          } else {
            // Add new video
            newVideos.push(updatedVideo);
            console.log('[BrollVideos] ➕ Added new video');
          }
          
          // Sort and return new array reference
          const sorted = newVideos.sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
          console.log('[BrollVideos] ✅ State updated - After:', sorted.length, 'videos');
          return sorted;
        });
        
        // Force re-render by updating key
        setUpdateKey(prev => {
          const newKey = prev + 1;
          console.log('[BrollVideos] 🔑 Update key:', prev, '->', newKey);
          return newKey;
        });
        
        // Remove from active jobs tracking
        if (expectedJobs) {
          expectedJobs.delete(jobId);
          if (expectedJobs.size === 0) {
            activeJobsBySceneRef.current.delete(sceneNumber);
          }
        }
        jobToSceneRef.current.delete(jobId);
        
        // Update regenerating state only if no other jobs are active for this scene
        const remainingJobs = activeJobsBySceneRef.current.get(sceneNumber);
        if (!remainingJobs || remainingJobs.size === 0) {
          setRegenerating(prev => ({ ...prev, [sceneNumber]: false }));
          setGeneratingVideos(prev => {
            const next = new Set(prev);
            next.delete(sceneNumber);
            return next;
          });
        }
        
        // Show toast only once per job
        showToast(`Video generated for scene ${sceneNumber}`, 'success');
        
        // Don't reload from DB - trust WebSocket data which includes localPath and localUrl
      } else if (update.state === 'failed') {
        // Find scene number from job mapping
        const sceneNumber = jobToSceneRef.current.get(update.jobId);
        
        // Prevent duplicate failure toasts
        if (!processedJobIdsRef.current.has(update.jobId)) {
          processedJobIdsRef.current.add(update.jobId);
          
          if (sceneNumber !== undefined) {
            showToast(`Video generation failed for scene ${sceneNumber}`, 'error');
          } else {
            showToast('Video generation failed', 'error');
          }
        }
        
        // Remove from active jobs tracking
        if (sceneNumber !== undefined) {
          const expectedJobs = activeJobsBySceneRef.current.get(sceneNumber);
          if (expectedJobs) {
            expectedJobs.delete(update.jobId);
            if (expectedJobs.size === 0) {
              activeJobsBySceneRef.current.delete(sceneNumber);
              setRegenerating(prev => ({ ...prev, [sceneNumber]: false }));
              setGeneratingVideos(prev => {
                const next = new Set(prev);
                next.delete(sceneNumber);
                return next;
              });
            }
          }
        }
        
        // Remove from job mapping
        jobToSceneRef.current.delete(update.jobId);
      }
    }
  }, [showToast]); // Only depend on showToast

  // WebSocket hook for real-time job status updates
  const { subscribeToJob } = useWebSocket({
    onJobStatusUpdate: handleJobStatusUpdate,
  });
  
  // Reset all state when projectId changes
  useEffect(() => {
    if (projectIdFromUrl && projectIdFromUrl !== projectId) {
      // Reset all state
      setProject(null);
      setScenes([]);
      setBrollImages([]);
      setBrollVideos([]);
      setRegenerating({});
      setPlayingVideo(null);
      setVideoElements({});
      setLoading(true);
      setDbLoaded(false); // Reset DB loaded flag
      // Clear active jobs tracking
      activeJobsBySceneRef.current.clear();
      jobToSceneRef.current.clear();
      processedJobIdsRef.current.clear(); // Clear processed job IDs
      setGeneratingVideos(new Set());
      setProjectId(projectIdFromUrl);
    }
  }, [projectIdFromUrl, projectId]);

  // Determine which scenes need B-roll videos based on video style
  const scenesNeedingVideos = useMemo((): number[] => {
    if (!project || !brollImages.length) return [];
    
    const style = project.style;
    
    if (style === 'HALF_N_HALF' || style === 'AVATAR_CUTOUT') {
      // All scenes with images need videos
      return brollImages.map(img => img.sceneNumber);
    } else if (style === 'ALTERNATE') {
      // All scenes with images need videos (images are already filtered to only b-roll scenes)
      return brollImages.map(img => img.sceneNumber);
    }
    
    return brollImages.map(img => img.sceneNumber);
  }, [project, brollImages]);

  // Load project and videos
  useEffect(() => {
    const loadProject = async () => {
      if (!isAuthenticated || authLoading) return;
      if (!projectId) return;

      try {
        setLoading(true);
        setDbLoaded(false); // Reset DB loaded flag
        // Clear active jobs tracking when loading starts
        activeJobsBySceneRef.current.clear();
        jobToSceneRef.current.clear();
        processedJobIdsRef.current.clear(); // Clear processed job IDs
        
        const response = await apiClient.getVideoProject(projectId);
        
        if (response.success && response.data) {
          setProject(response.data);
          
          // Update currentStep to BROLL_VIDEOS if not already set
          if (response.data.currentStep !== 'BROLL_VIDEOS') {
            try {
              await apiClient.updateVideoProject(projectId, {
                currentStep: 'BROLL_VIDEOS',
              });
            } catch (error) {
              console.error('Failed to update currentStep:', error);
            }
          }
          
          // Parse script to get scenes
          if (response.data.script) {
            const script = typeof response.data.script === 'string' 
              ? JSON.parse(response.data.script) 
              : response.data.script;
            const scriptScenes = script.scenes || script.scene_plan || [];
            setScenes(scriptScenes);
          }
          
          // Load B-roll images
          if (response.data.bRollImages) {
            const images = Array.isArray(response.data.bRollImages) 
              ? response.data.bRollImages 
              : [];
            setBrollImages(images);
          }
          
          // Load B-roll videos - ensure all videos are loaded and sorted
          if (response.data.bRollVideoTasks) {
            const videos = Array.isArray(response.data.bRollVideoTasks) 
              ? response.data.bRollVideoTasks 
              : [];
            
            console.log(`[BrollVideos] Loaded ${videos.length} videos from project:`, videos.map((v: any) => ({
              sceneNumber: v.sceneNumber,
              hasLocalPath: !!v.localPath,
              hasLocalUrl: !!v.localUrl,
              hasVideoUrl: !!v.videoUrl,
            })));
            
            // Filter out invalid videos and ensure sceneNumber is set
            const validVideos = videos.filter((vid: any) => {
              const hasUrl = vid.localUrl || vid.localPath || vid.videoUrl;
              const hasSceneNumber = vid.sceneNumber !== undefined && vid.sceneNumber !== null;
              return hasUrl && hasSceneNumber;
            });
            
            console.log(`[BrollVideos] ${validVideos.length} valid videos after filtering`);
            
            // Sort by sceneNumber for consistent display
            validVideos.sort((a: any, b: any) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
            setBrollVideos(validVideos);
          }
          
          // Mark DB as loaded AFTER all state updates complete
          setDbLoaded(true);
        }
      } catch (error: any) {
        console.error('Failed to load project:', error);
        showToast('Failed to load project', 'error');
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [projectId, isAuthenticated, authLoading, showToast]);

  // Generate videos for all scenes that need them
  const [generatingVideos, setGeneratingVideos] = React.useState<Set<number>>(new Set());
  
  useEffect(() => {
    const generateMissingVideos = async () => {
      // Wait for project to be fully loaded, DB data loaded, and videos to be populated
      if (!projectId || !scenesNeedingVideos.length || loading || !dbLoaded || !project) {
        return;
      }
      
      // Check which scenes are missing videos
      // IMPORTANT: Check database (project.bRollVideoTasks) FIRST, then state
      const missingScenes = scenesNeedingVideos.filter(sceneNumber => {
        // Normalize sceneNumber for comparison (ensure it's a number)
        const normalizedSceneNumber = typeof sceneNumber === 'number' 
          ? sceneNumber 
          : parseInt(String(sceneNumber), 10);
        
        // Check database first (most reliable source)
        const projectVideos = ((project.bRollVideoTasks as any[]) || []);
        const hasVideoInDB = projectVideos.some((vid: any) => {
          const vidSceneNumber = typeof vid.sceneNumber === 'number' 
            ? vid.sceneNumber 
            : parseInt(String(vid.sceneNumber || 0), 10);
          return vidSceneNumber === normalizedSceneNumber && 
                 (vid.localUrl || vid.localPath || vid.videoUrl);
        });
        
        // Check state (may be empty on reload)
        const hasVideoInState = brollVideos.some(vid => {
          const vidSceneNumber = typeof vid.sceneNumber === 'number' 
            ? vid.sceneNumber 
            : parseInt(String(vid.sceneNumber || 0), 10);
          return vidSceneNumber === normalizedSceneNumber && 
                 (vid.localPath || vid.videoUrl || vid.localUrl);
        });
        
        // Check if currently generating
        const isGenerating = generatingVideos.has(normalizedSceneNumber);
        const hasActiveJobs = (activeJobsBySceneRef.current.get(normalizedSceneNumber)?.size || 0) > 0;
        
        // Video exists if it's in DB OR state
        const hasVideo = hasVideoInDB || hasVideoInState;
        
        // If video exists in DB but not in state, add it to state
        if (hasVideoInDB && !hasVideoInState) {
          const dbVideo = projectVideos.find((vid: any) => {
            const vidSceneNumber = typeof vid.sceneNumber === 'number' 
              ? vid.sceneNumber 
              : parseInt(String(vid.sceneNumber || 0), 10);
            return vidSceneNumber === normalizedSceneNumber;
          });
          if (dbVideo) {
            setBrollVideos(prev => {
              const exists = prev.some(vid => {
                const vidSceneNumber = typeof vid.sceneNumber === 'number' 
                  ? vid.sceneNumber 
                  : parseInt(String(vid.sceneNumber || 0), 10);
                return vidSceneNumber === normalizedSceneNumber;
              });
              if (!exists) {
                return [...prev, dbVideo].sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
              }
              return prev;
            });
          }
        }
        
        return !hasVideo && !isGenerating && !hasActiveJobs;
      });

      if (missingScenes.length === 0) {
        // All videos exist - nothing to generate
        console.log('[BrollVideos] ✅ All videos already exist, skipping generation');
        return;
      }

      console.log(`[BrollVideos] 🔄 Generating ${missingScenes.length} missing videos for scenes:`, missingScenes);

      // Generate videos for missing scenes (all at once, non-blocking)
      const promises = missingScenes.map((sceneNumber) => {
        const image = brollImages.find(img => img.sceneNumber === sceneNumber);
        if (!image || !image.imageUrl) {
          return Promise.resolve();
        }

        // Update state immediately
        setGeneratingVideos(prev => new Set(prev).add(sceneNumber));
        setRegenerating(prev => ({ ...prev, [sceneNumber]: true }));
        
        // Fire API call without awaiting (non-blocking)
        return apiClient.regenerateVideo(projectId, sceneNumber)
          .then(response => {
            // Handle existing video response
            if (response.success && response.data?.existing && response.data?.video) {
              // Video already exists in DB, add to state
              const existingVideo = response.data.video;
              setBrollVideos(prev => {
                const exists = prev.some(vid => vid.sceneNumber === sceneNumber);
                if (!exists) {
                  return [...prev, existingVideo].sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
                }
                return prev.map(vid => 
                  vid.sceneNumber === sceneNumber ? existingVideo : vid
                );
              });
              setGeneratingVideos(prev => {
                const next = new Set(prev);
                next.delete(sceneNumber);
                return next;
              });
              setRegenerating(prev => ({ ...prev, [sceneNumber]: false }));
              return;
            }
            
            // Handle new job creation
            if (response.success && response.data?.jobId) {
              // Subscribe to job updates via WebSocket instead of polling
              const jobId = response.data.jobId;
              
              // Track job per scene
              if (!activeJobsBySceneRef.current.has(sceneNumber)) {
                activeJobsBySceneRef.current.set(sceneNumber, new Set());
              }
              activeJobsBySceneRef.current.get(sceneNumber)!.add(jobId);
              jobToSceneRef.current.set(jobId, sceneNumber);
              subscribeToJob(jobId, 'video-generation');
              console.log(`[BrollVideos] Subscribed to job ${jobId} for scene ${sceneNumber}`);
            }
          })
          .catch((error: any) => {
            console.error(`Failed to generate video for scene ${sceneNumber}:`, error);
            showToast(`Failed to generate video for scene ${sceneNumber}`, 'error');
            
            // Remove from active jobs tracking
            const expectedJobs = activeJobsBySceneRef.current.get(sceneNumber);
            if (expectedJobs) {
              expectedJobs.clear();
              activeJobsBySceneRef.current.delete(sceneNumber);
            }
            
            setGeneratingVideos(prev => {
              const next = new Set(prev);
              next.delete(sceneNumber);
              return next;
            });
            setRegenerating(prev => ({ ...prev, [sceneNumber]: false }));
          });
      });

      // Wait for all promises to complete (but they're already fired)
      await Promise.all(promises);
    };

    generateMissingVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, loading, dbLoaded, scenesNeedingVideos.length, brollImages.length, project, brollVideos.length]);

  const handleRegenerate = async (sceneNumber: number) => {
    if (!projectId) return;

    const image = brollImages.find(img => img.sceneNumber === sceneNumber);
    if (!image || !image.imageUrl) {
      showToast('Image not found for this scene', 'warning');
      return;
    }

    // Check if already generating for this scene
    const activeJobs = activeJobsBySceneRef.current.get(sceneNumber);
    if (activeJobs && activeJobs.size > 0) {
      showToast('Video generation already in progress for this scene', 'warning');
      return;
    }

    try {
      // REMOVE OLD VIDEO IMMEDIATELY to show loader
      setBrollVideos(prev => prev.filter(vid => {
        const vidSceneNumber = typeof vid.sceneNumber === 'number' 
          ? vid.sceneNumber 
          : parseInt(String(vid.sceneNumber || 0), 10);
        return vidSceneNumber !== sceneNumber;
      }));
      
      // Set regenerating state to show loader
      setRegenerating(prev => ({ ...prev, [sceneNumber]: true }));
      setGeneratingVideos(prev => new Set(prev).add(sceneNumber));
      
      const response = await apiClient.regenerateVideo(projectId, sceneNumber, true); // Pass force: true for manual regeneration
      
      // Handle existing video response
      if (response.success && response.data?.existing && response.data?.video) {
        const existingVideo = response.data.video;
        setBrollVideos(prev => {
          const exists = prev.some(vid => vid.sceneNumber === sceneNumber);
          if (!exists) {
            return [...prev, existingVideo].sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
          }
          return prev.map(vid => 
            vid.sceneNumber === sceneNumber ? existingVideo : vid
          );
        });
        setGeneratingVideos(prev => {
          const next = new Set(prev);
          next.delete(sceneNumber);
          return next;
        });
        setRegenerating(prev => ({ ...prev, [sceneNumber]: false }));
        showToast('Video already exists', 'info');
        return;
      }
      
      // Handle new job creation
      if (response.success && response.data?.jobId) {
        const jobId = response.data.jobId;
        // Track job ID to scene mapping
        if (!activeJobsBySceneRef.current.has(sceneNumber)) {
          activeJobsBySceneRef.current.set(sceneNumber, new Set());
        }
        activeJobsBySceneRef.current.get(sceneNumber)!.add(jobId);
        jobToSceneRef.current.set(jobId, sceneNumber);
        // Subscribe to job updates via WebSocket
        subscribeToJob(jobId, 'video-generation');
        showToast('Video regeneration started', 'info');
      }
    } catch (error: any) {
      console.error('Failed to regenerate video:', error);
      showToast('Failed to regenerate video', 'error');
      setRegenerating(prev => ({ ...prev, [sceneNumber]: false }));
      setGeneratingVideos(prev => {
        const next = new Set(prev);
        next.delete(sceneNumber);
        return next;
      });
    }
  };

  const handlePlayVideo = (sceneNumber: number, videoUrl: string) => {
    // Stop currently playing video
    if (playingVideo !== null && videoElements[playingVideo]) {
      videoElements[playingVideo].pause();
      videoElements[playingVideo].currentTime = 0;
    }

    // Create or get video element
    let video = videoElements[sceneNumber];
    if (!video) {
      video = document.createElement('video');
      video.src = videoUrl;
      video.controls = true;
      video.className = 'w-full h-full object-cover';
      setVideoElements(prev => ({ ...prev, [sceneNumber]: video }));
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

  const getVideoUrl = (video: BrollVideo): string => {
    // Prefer localUrl (served from our server)
    if (video.localUrl) {
      // Ensure localUrl starts with /uploads
      const url = video.localUrl.startsWith('/uploads') 
        ? video.localUrl 
        : `/uploads${video.localUrl}`;
      // Static files are served at /uploads/* (not /api/uploads/*)
      return `http://localhost:9004${url}`;
    }
    // Fallback to videoUrl (BytePlus URL)
    return video.videoUrl || '';
  };

  // Helper function to normalize sceneNumber consistently
  // This ensures we use the actual scene_number from the scene object, not a default
  const normalizeSceneNumber = (scene: Scene, index: number): number => {
    // Priority: scene_number > sceneNumber > index + 1
    // Only use index + 1 if both scene_number and sceneNumber are undefined/null
    if (scene.scene_number !== undefined && scene.scene_number !== null) {
      return typeof scene.scene_number === 'number' ? scene.scene_number : parseInt(String(scene.scene_number), 10);
    }
    if (scene.sceneNumber !== undefined && scene.sceneNumber !== null) {
      return typeof scene.sceneNumber === 'number' ? scene.sceneNumber : parseInt(String(scene.sceneNumber), 10);
    }
    // Fallback to index + 1 (1-based indexing)
    return index + 1;
  };

  const getSceneVoiceover = (sceneNumber: number): string | undefined => {
    const scene = scenes.find((s, idx) => normalizeSceneNumber(s, idx) === sceneNumber);
    return scene?.voiceover;
  };

  // Show skeleton loading UI while DB is loading
  if (loading || !dbLoaded) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-7xl mx-auto">
            <button
              onClick={() => router.back()}
              className="mb-6 flex items-center gap-2 text-text-primary hover:text-text-secondary transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>

            <h1 className={cn(typography.heading.h2, "mb-8")}>B-Roll Videos</h1>

            {scenesNeedingVideos.length === 0 ? (
              <Card className="p-8 text-center">
                <VideoIcon className="w-16 h-16 mx-auto mb-4 text-text-secondary" />
                <p className="text-text-secondary">No videos to generate for this video style.</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {scenesNeedingVideos.map((sceneNumber, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <button
            onClick={() => router.back()}
            className="mb-6 flex items-center gap-2 text-text-primary hover:text-text-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back</span>
          </button>

          <h1 className={cn(typography.heading.h2, "mb-8")}>B-Roll Videos</h1>

          {scenesNeedingVideos.length === 0 ? (
            <Card className="p-8 text-center">
              <VideoIcon className="w-16 h-16 mx-auto mb-4 text-text-secondary" />
              <p className="text-text-secondary">No videos to generate for this video style.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {scenesNeedingVideos
                .sort((a, b) => a - b) // Sort scene numbers
                .map((sceneNumber) => {
                const video = brollVideos.find(vid => {
                  const vidSceneNumber = typeof vid.sceneNumber === 'number' 
                    ? vid.sceneNumber 
                    : parseInt(String(vid.sceneNumber || 0), 10);
                  return vidSceneNumber === sceneNumber;
                });
                const voiceover = getSceneVoiceover(sceneNumber);
                const isRegenerating = regenerating[sceneNumber] || generatingVideos.has(sceneNumber);
                const isPlaying = playingVideo === sceneNumber;
                
                // Debug logging for render
                if (video) {
                  console.log(`[BrollVideos] 🎨 Rendering scene ${sceneNumber}:`, {
                    hasVideo: !!video,
                    sceneNumber: video.sceneNumber,
                    jobId: video.jobId,
                    localUrl: video.localUrl,
                    localPath: video.localPath,
                    videoUrl: video.videoUrl,
                    finalUrl: getVideoUrl(video),
                    isRegenerating,
                    updateKey,
                  });
                }

                return (
                  <Card key={`${sceneNumber}-${updateKey}`} className="overflow-hidden">
                    <div className="relative aspect-[9/16] bg-primary-light/20 group">
                      {/* Show loader if regenerating OR if no video exists */}
                      {!isRegenerating && video ? (
                        <>
                          <video
                            ref={(el) => {
                              if (el && !videoElements[sceneNumber]) {
                                setVideoElements(prev => ({ ...prev, [sceneNumber]: el }));
                              }
                            }}
                            src={getVideoUrl(video)}
                            className="w-full h-full object-cover"
                            loop
                            muted
                            onLoadedData={() => {
                              console.log(`[BrollVideos] ✅ Video loaded for scene ${sceneNumber}:`, getVideoUrl(video));
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                            <button
                              onClick={() => video && handlePlayVideo(sceneNumber, getVideoUrl(video))}
                              className={cn(
                                'p-3 rounded-full bg-background/90 hover:bg-background',
                                'text-text-primary transition-all opacity-0 group-hover:opacity-100',
                                isPlaying && 'opacity-100'
                              )}
                            >
                              {isPlaying ? (
                                <Pause className="w-6 h-6" />
                              ) : (
                                <Play className="w-6 h-6 fill-current" />
                              )}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        </div>
                      )}
                      <div className="absolute top-2 right-2 bg-background/90 px-2 py-1 rounded text-xs font-medium">
                        Scene {sceneNumber}
                      </div>
                      {video?.duration && (
                        <div className="absolute bottom-2 left-2 bg-background/90 px-2 py-1 rounded text-xs">
                          {Math.floor(video.duration)}s
                        </div>
                      )}
                    </div>
                    
                    <div className="p-4 space-y-3">
                      {voiceover && (
                        <div>
                          <p className="text-xs text-text-secondary mb-1">Script:</p>
                          <p className="text-sm text-text-primary line-clamp-3">{voiceover}</p>
                        </div>
                      )}
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRegenerate(sceneNumber)}
                        disabled={isRegenerating}
                        className="w-full"
                      >
                        {isRegenerating ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Regenerating...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Regenerate
                          </>
                        )}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ProgressBar
        progress={scenesNeedingVideos.length > 0 && brollVideos.length === scenesNeedingVideos.length ? 80 : 70}
        message={
          scenesNeedingVideos.length > 0 && brollVideos.length === scenesNeedingVideos.length
            ? "All videos generated! Ready for final rendering."
            : `Generating videos... ${brollVideos.length}/${scenesNeedingVideos.length}`
        }
        onNext={() => {
          if (!projectId) return;
          router.push(`/create-video/rendering?projectId=${projectId}`);
        }}
        disabled={scenesNeedingVideos.length > 0 && brollVideos.length !== scenesNeedingVideos.length}
      />
    </div>
  );
}

export default function BrollVideosPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <BrollVideosPageContent />
    </Suspense>
  );
}

