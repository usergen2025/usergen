'use client';

import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, RefreshCw, Loader2, Image as ImageIcon } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/layout/ProgressBar';
import ImagePreview from '@/components/ui/ImagePreview';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { useVideoStepNavigation } from '@/hooks/useVideoStepNavigation';
import { useWebSocket, JobStatusUpdate } from '@/hooks/useWebSocket';
import { ModelSelector } from '@/components/create-video/ModelSelector';

interface BrollImage {
  sceneNumber: number;
  jobId?: string; // Unique identifier for the generation job
  imageUrl: string;
  localPath?: string;
  localUrl?: string;
  prompt: string;
}

interface Scene {
  scene_number?: number;
  sceneNumber?: number;
  type?: string;
  voiceover?: string;
  broll_image_prompt?: string;
  broll_prompt?: string;
  broll_visual_description?: string;
}

function BrollImagesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const projectIdFromUrl = searchParams.get('projectId');
  
  const [projectId, setProjectId] = useState<string | null>(projectIdFromUrl);
  const [project, setProject] = useState<any>(null);
  const { goToPreviousStep } = useVideoStepNavigation(projectId, project?.currentStep);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [brollImages, setBrollImages] = useState<BrollImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbLoaded, setDbLoaded] = useState(false); // Track DB load completion
  const [regenerating, setRegenerating] = useState<Record<number, boolean>>({});
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [updateKey, setUpdateKey] = useState(0); // Force re-render on WebSocket updates
  const [selectedModels, setSelectedModels] = useState<Record<number, string>>({}); // Track selected model per scene
  // Track active jobs per scene: Map<sceneNumber, Set<jobId>>
  const activeJobsBySceneRef = React.useRef<Map<number, Set<string>>>(new Map());
  const jobToSceneRef = React.useRef<Map<string, number>>(new Map());
  const processedJobIdsRef = React.useRef<Set<string>>(new Set()); // Track processed job IDs to prevent duplicate toasts

  // Memoize the WebSocket handler to prevent duplicate subscriptions
  const handleJobStatusUpdate = useCallback((update: JobStatusUpdate) => {
    console.log('[BrollImages] 🔔 WebSocket update received:', {
      jobId: update.jobId,
      queueType: update.queueType,
      state: update.state,
      sceneNumber: update.queueType === 'image-generation' ? update.result?.image?.sceneNumber : undefined,
    });
    
    if (update.queueType === 'image-generation') {
      if (update.state === 'completed' && update.result?.success && update.result?.image) {
        const image = update.result.image;
        const jobId = update.jobId;
        const sceneNumber = image.sceneNumber;
        
        // Prevent duplicate processing for the same job
        if (processedJobIdsRef.current.has(jobId)) {
          console.log(`[BrollImages] ⏭️ Job ${jobId} already processed, skipping duplicate update`);
          return;
        }
        processedJobIdsRef.current.add(jobId);
        
        console.log('[BrollImages] ✅ Processing completed image:', {
          jobId,
          sceneNumber,
          sceneNumberType: typeof sceneNumber,
          localUrl: image.localUrl || image.local_url,
          localPath: image.localPath || image.local_path,
          imageUrl: image.imageUrl || image.image_url,
        });
        
        // Verify this jobId is expected for this scene
        const expectedJobs = activeJobsBySceneRef.current.get(sceneNumber);
        if (!expectedJobs || !expectedJobs.has(jobId)) {
          console.warn(`[BrollImages] ⚠️ Received update for unexpected job ${jobId} for scene ${sceneNumber}`);
          // Still process it, but log warning
        }
        
        // Update local state immediately with WebSocket data (includes localPath and localUrl)
        // Create new array reference to ensure React re-renders
        setBrollImages(prev => {
          console.log('[BrollImages] 🔄 Updating state - Before:', prev.length, 'images');
          
          // Create a new array to ensure React detects the change
          const newImages = [...prev];
          
          // Normalize sceneNumber from WebSocket update (ensure it's a number)
          const normalizedSceneNumber = typeof sceneNumber === 'number' 
            ? sceneNumber 
            : parseInt(String(sceneNumber), 10);
          
          // Find existing image by jobId first, then by sceneNumber
          const existingIndex = newImages.findIndex(img => {
            // Match by jobId if available
            if (img.jobId && jobId && img.jobId === jobId) return true;
            // Match by sceneNumber (normalized)
            const imgSceneNumber = typeof img.sceneNumber === 'number' 
              ? img.sceneNumber 
              : parseInt(String(img.sceneNumber || 0), 10);
            return imgSceneNumber === normalizedSceneNumber;
          });
          
          console.log('[BrollImages] 🔍 Found existing image at index:', existingIndex);
          
          // Ensure sceneNumber is preserved and image data is complete
          // Include all fields from backend: localPath, localUrl, imageUrl, etc.
          const updatedImage: BrollImage = {
            ...image,
            jobId,
            sceneNumber: normalizedSceneNumber, // Ensure sceneNumber is a number
            // Ensure we have both localPath and localUrl for UI display
            localPath: image.localPath || image.local_path,
            localUrl: image.localUrl || image.local_url,
            imageUrl: image.imageUrl || image.image_url,
          };
          
          console.log('[BrollImages] 🖼️ Updated image data:', {
            sceneNumber: updatedImage.sceneNumber,
            jobId: updatedImage.jobId,
            localUrl: updatedImage.localUrl,
            localPath: updatedImage.localPath,
          });
          
          if (existingIndex >= 0) {
            // Replace existing image with new object reference (for regeneration)
            newImages[existingIndex] = updatedImage;
            console.log('[BrollImages] 🔄 Replaced image at index:', existingIndex);
          } else {
            // Add new image
            newImages.push(updatedImage);
            console.log('[BrollImages] ➕ Added new image');
          }
          
          // Sort and return new array reference
          const sorted = newImages.sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
          console.log('[BrollImages] ✅ State updated - After:', sorted.length, 'images');
          return sorted;
        });
        
        // Force re-render by updating key
        setUpdateKey(prev => {
          const newKey = prev + 1;
          console.log('[BrollImages] 🔑 Update key:', prev, '->', newKey);
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
          setGeneratingImages(prev => {
            const next = new Set(prev);
            next.delete(sceneNumber);
            return next;
          });
        }
        
        // Show toast only once per job
        showToast(`Image generated for scene ${sceneNumber}`, 'success');
        
        // Don't reload from DB - trust WebSocket data which includes localPath and localUrl
      } else if (update.state === 'failed') {
        // Find scene number from job mapping
        const sceneNumber = jobToSceneRef.current.get(update.jobId);
        
        // Prevent duplicate failure toasts
        if (!processedJobIdsRef.current.has(update.jobId)) {
          processedJobIdsRef.current.add(update.jobId);
          
          if (sceneNumber !== undefined) {
            showToast(`Image generation failed for scene ${sceneNumber}`, 'error');
          } else {
            showToast('Image generation failed', 'error');
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
              setGeneratingImages(prev => {
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
      setRegenerating({});
      setPreviewImage(null);
      setPreviewOpen(false);
      setLoading(true);
      setDbLoaded(false); // Reset DB loaded flag
      // Clear active jobs tracking
      activeJobsBySceneRef.current.clear();
      jobToSceneRef.current.clear();
      processedJobIdsRef.current.clear(); // Clear processed job IDs
      setGeneratingImages(new Set());
      setProjectId(projectIdFromUrl);
    }
  }, [projectIdFromUrl, projectId]);

  // Determine which scenes need B-roll images based on video style
  const scenesNeedingBroll = useMemo((): Scene[] => {
    if (!project || !scenes.length) return [];
    
    const style = project.style;
    
    if (style === 'HALF_N_HALF' || style === 'AVATAR_CUTOUT') {
      // All scenes need B-roll
      return scenes;
    } else if (style === 'ALTERNATE') {
      // Only scenes with type "b-roll" need B-roll images
      return scenes.filter((scene) => {
        const sceneType = scene.type?.toLowerCase();
        return sceneType === 'b-roll' || sceneType === 'broll';
      });
    }
    
    return scenes;
  }, [project, scenes]);

  // Load project and images
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
          
          // Update currentStep to BROLL_IMAGES if not already set
          if (response.data.currentStep !== 'BROLL_IMAGES') {
            try {
              await apiClient.updateVideoProject(projectId, {
                currentStep: 'BROLL_IMAGES',
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

  // Initialize default model for all scenes - ensure Model 1 is selected by default
  useEffect(() => {
    if (!scenesNeedingBroll.length || !dbLoaded) return;

    setSelectedModels(prev => {
      const updated = { ...prev };
      let hasChanges = false;
      
      scenesNeedingBroll.forEach((scene, index) => {
        const sceneNumber = normalizeSceneNumber(scene, index);
        // Always set default to 'model-1' if not already set
        if (!updated[sceneNumber]) {
          updated[sceneNumber] = 'model-1'; // Default to Model 1 (FAL imagen4)
          hasChanges = true;
        }
      });
      
      return hasChanges ? updated : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenesNeedingBroll.length, dbLoaded]);

  // Generate images for all scenes that need them (with duplicate prevention)
  const [generatingImages, setGeneratingImages] = React.useState<Set<number>>(new Set());
  
  useEffect(() => {
    const generateMissingImages = async () => {
      // Wait for project to be fully loaded, DB data loaded, and images to be populated
      if (!projectId || !scenesNeedingBroll.length || loading || !dbLoaded || !project) {
        return;
      }
      
      // Check which scenes are missing images
      // IMPORTANT: Check database (project.bRollImages) FIRST, then state
      const missingScenes = scenesNeedingBroll.filter((scene, index) => {
        const sceneNumber = normalizeSceneNumber(scene, index);
        
        // Check database first (most reliable source)
        const projectImages = ((project.bRollImages as any[]) || []);
        const hasImageInDB = projectImages.some((img: any) => {
          const imgSceneNumber = typeof img.sceneNumber === 'number' 
            ? img.sceneNumber 
            : parseInt(String(img.sceneNumber || 0), 10);
          return imgSceneNumber === sceneNumber && 
                 (img.localUrl || img.localPath || img.imageUrl);
        });
        
        // Check state (may be empty on reload)
        const hasImageInState = brollImages.some(img => {
          const imgSceneNumber = typeof img.sceneNumber === 'number' 
            ? img.sceneNumber 
            : parseInt(String(img.sceneNumber || 0), 10);
          return imgSceneNumber === sceneNumber && 
                 (img.localUrl || img.localPath || img.imageUrl);
        });
        
        // Check if currently generating
        const isGenerating = generatingImages.has(sceneNumber);
        const hasActiveJobs = (activeJobsBySceneRef.current.get(sceneNumber)?.size || 0) > 0;
        
        // Image exists if it's in DB OR state
        const hasImage = hasImageInDB || hasImageInState;
        
        // If image exists in DB but not in state, add it to state
        if (hasImageInDB && !hasImageInState) {
          const dbImage = projectImages.find((img: any) => {
            const imgSceneNumber = typeof img.sceneNumber === 'number' 
              ? img.sceneNumber 
              : parseInt(String(img.sceneNumber || 0), 10);
            return imgSceneNumber === sceneNumber;
          });
          if (dbImage) {
            setBrollImages(prev => {
              const exists = prev.some(img => {
                const imgSceneNumber = typeof img.sceneNumber === 'number' 
                  ? img.sceneNumber 
                  : parseInt(String(img.sceneNumber || 0), 10);
                return imgSceneNumber === sceneNumber;
              });
              if (!exists) {
                return [...prev, dbImage].sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
              }
              return prev;
            });
          }
        }
        
        return !hasImage && !isGenerating && !hasActiveJobs;
      });

      if (missingScenes.length === 0) {
        // All images exist - nothing to generate
        return;
      }

      // Generate images for missing scenes (all at once, non-blocking)
      const promises = missingScenes.map((scene, index) => {
        const sceneNumber = normalizeSceneNumber(scene, scenesNeedingBroll.findIndex(s => s === scene));
        // Try multiple prompt fields: broll_image_prompt, broll_prompt, broll_visual_description
        const prompt = scene.broll_image_prompt || scene.broll_prompt || scene.broll_visual_description;
        
        if (!prompt) {
          return Promise.resolve();
        }

        // Update state immediately
        setGeneratingImages(prev => new Set(prev).add(sceneNumber));
        setRegenerating(prev => ({ ...prev, [sceneNumber]: true }));
        
        // Get selected model for this scene (default to model-1)
        const selectedModelId = selectedModels[sceneNumber] || 'model-1';

        // Fire API call without awaiting (non-blocking)
        return apiClient.regenerateImage(projectId, sceneNumber, prompt, selectedModelId)
          .then(response => {
            // Handle existing image response
            if (response.success && response.data?.existing && response.data?.image) {
              // Image already exists in DB, add to state
              const existingImage = response.data.image;
              setBrollImages(prev => {
                const exists = prev.some(img => img.sceneNumber === sceneNumber);
                if (!exists) {
                  return [...prev, existingImage].sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
                }
                return prev.map(img => 
                  img.sceneNumber === sceneNumber ? existingImage : img
                );
              });
              setGeneratingImages(prev => {
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
              subscribeToJob(jobId, 'image-generation');
              console.log(`[BrollImages] Subscribed to job ${jobId} for scene ${sceneNumber}`);
            }
          })
          .catch((error: any) => {
            console.error(`Failed to generate image for scene ${sceneNumber}:`, error);
            showToast(`Failed to generate image for scene ${sceneNumber}`, 'error');
            
            // Remove from active jobs tracking
            const expectedJobs = activeJobsBySceneRef.current.get(sceneNumber);
            if (expectedJobs) {
              expectedJobs.clear();
              activeJobsBySceneRef.current.delete(sceneNumber);
            }
            
            setGeneratingImages(prev => {
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

    generateMissingImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, scenesNeedingBroll.length, loading, dbLoaded, project, brollImages.length]);

  const handleRegenerate = async (sceneNumber: number) => {
    if (!projectId) return;

    const scene = scenesNeedingBroll.find(
      (s, idx) => normalizeSceneNumber(s, idx) === sceneNumber
    );
    
    if (!scene) return;

    // Try multiple prompt fields: broll_image_prompt, broll_prompt, broll_visual_description
    const prompt = scene.broll_image_prompt || scene.broll_prompt || scene.broll_visual_description;
    if (!prompt) {
      showToast('No prompt found for this scene', 'warning');
      return;
    }

    // Check if already generating for this scene
    const activeJobs = activeJobsBySceneRef.current.get(sceneNumber);
    if (activeJobs && activeJobs.size > 0) {
      showToast('Image generation already in progress for this scene', 'warning');
      return;
    }

    try {
      // REMOVE OLD IMAGE IMMEDIATELY to show loader
      setBrollImages(prev => prev.filter(img => {
        const imgSceneNumber = typeof img.sceneNumber === 'number' 
          ? img.sceneNumber 
          : parseInt(String(img.sceneNumber || 0), 10);
        return imgSceneNumber !== sceneNumber;
      }));
      
      // Set regenerating state to show loader
      setRegenerating(prev => ({ ...prev, [sceneNumber]: true }));
      setGeneratingImages(prev => new Set(prev).add(sceneNumber));
      
      // Get selected model for this scene (default to model-1)
      const selectedModelId = selectedModels[sceneNumber] || 'model-1';
      
      // Pass force: true to always regenerate when user manually clicks the button
      const response = await apiClient.regenerateImage(projectId, sceneNumber, prompt, selectedModelId, true);
      
      // Handle existing image response
      if (response.success && response.data?.existing && response.data?.image) {
        const existingImage = response.data.image;
        setBrollImages(prev => {
          const exists = prev.some(img => img.sceneNumber === sceneNumber);
          if (!exists) {
            return [...prev, existingImage].sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0));
          }
          return prev.map(img => 
            img.sceneNumber === sceneNumber ? existingImage : img
          );
        });
        setGeneratingImages(prev => {
          const next = new Set(prev);
          next.delete(sceneNumber);
          return next;
        });
        setRegenerating(prev => ({ ...prev, [sceneNumber]: false }));
        showToast('Image already exists', 'info');
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
        subscribeToJob(jobId, 'image-generation');
        showToast('Image regeneration started', 'info');
      }
    } catch (error: any) {
      console.error('Failed to regenerate image:', error);
      showToast('Failed to regenerate image', 'error');
      setRegenerating(prev => ({ ...prev, [sceneNumber]: false }));
      setGeneratingImages(prev => {
        const next = new Set(prev);
        next.delete(sceneNumber);
        return next;
      });
    }
  };

  const handleImageClick = (imageUrl: string) => {
    setPreviewImage(imageUrl);
    setPreviewOpen(true);
  };

  const handleNext = async () => {
    if (!projectId) return;
    
    // Update currentStep to BROLL_VIDEOS before navigating
    try {
      await apiClient.updateVideoProject(projectId, {
        currentStep: 'BROLL_VIDEOS',
      });
    } catch (error) {
      console.error('Failed to update currentStep:', error);
    }
    
    router.push(`/create-video/broll-videos?projectId=${projectId}`);
  };

  const getImageUrl = (image: BrollImage): string => {
    // Prefer localUrl (served from our server)
    if (image.localUrl) {
      // Ensure localUrl starts with /uploads
      const url = image.localUrl.startsWith('/uploads') 
        ? image.localUrl 
        : `/uploads${image.localUrl}`;
      // Static files are served at /uploads/* (not /api/uploads/*)
      // Use NEXT_PUBLIC_WS_URL which is already set to the base domain (e.g., https://api.dev.usergen.ai)
      const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
      return `${VIDEO_SERVICE_BASE_URL}${url}`;
    }
    // Fallback to imageUrl (BytePlus URL)
    return image.imageUrl;
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
              onClick={goToPreviousStep}
              className="mb-6 flex items-center gap-2 text-text-primary hover:text-text-secondary transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>

            <h1 className={cn(typography.heading.h2, "mb-8")}>B-Roll Images</h1>

            {scenesNeedingBroll.length === 0 ? (
              <Card className="p-8 text-center">
                <ImageIcon className="w-16 h-16 mx-auto mb-4 text-text-secondary" />
                <p className="text-text-secondary">No scenes require B-roll images for this video style.</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {scenesNeedingBroll.map((scene, index) => (
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

          <h1 className={cn(typography.heading.h2, "mb-8")}>B-Roll Images</h1>

          {scenesNeedingBroll.length === 0 ? (
            <Card className="p-8 text-center">
              <ImageIcon className="w-16 h-16 mx-auto mb-4 text-text-secondary" />
              <p className="text-text-secondary">No scenes require B-roll images for this video style.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {scenesNeedingBroll.map((scene, index) => {
                const sceneNumber = normalizeSceneNumber(scene, index);
                const image = brollImages.find(img => {
                  const imgSceneNumber = typeof img.sceneNumber === 'number' 
                    ? img.sceneNumber 
                    : parseInt(String(img.sceneNumber || 0), 10);
                  return imgSceneNumber === sceneNumber;
                });
                const voiceover = getSceneVoiceover(sceneNumber);
                const isRegenerating = regenerating[sceneNumber] || generatingImages.has(sceneNumber);
                
                // Debug logging for render
                if (image) {
                  console.log(`[BrollImages] 🎨 Rendering scene ${sceneNumber}:`, {
                    hasImage: !!image,
                    sceneNumber: image.sceneNumber,
                    jobId: image.jobId,
                    localUrl: image.localUrl,
                    localPath: image.localPath,
                    imageUrl: image.imageUrl,
                    finalUrl: getImageUrl(image),
                    isRegenerating,
                    updateKey,
                  });
                }

                return (
                  <Card key={`${sceneNumber}-${updateKey}`} className="overflow-hidden">
                    <div className="relative aspect-[9/16] bg-primary-light/20 cursor-pointer group">
                      {/* Show loader if regenerating OR if no image exists */}
                      {!isRegenerating && image ? (
                        <>
                          <img
                            src={getImageUrl(image)}
                            alt={`Scene ${sceneNumber}`}
                            className="w-full h-full object-cover"
                            onClick={() => handleImageClick(getImageUrl(image))}
                            onLoad={() => {
                              console.log(`[BrollImages] ✅ Image loaded for scene ${sceneNumber}:`, getImageUrl(image));
                            }}
                            onError={(e) => {
                              console.error('Image failed to load:', getImageUrl(image));
                              console.error('Image data:', image);
                              console.error('Error event:', e);
                              const target = e.target as HTMLImageElement;
                              // Try BytePlus URL if local URL fails
                              if (image.imageUrl && image.localUrl) {
                                console.log('Trying BytePlus URL as fallback:', image.imageUrl);
                                target.src = image.imageUrl;
                              } else {
                                target.style.opacity = '0.5';
                                target.alt = 'Failed to load image';
                              }
                            }}
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
                            <span className="text-white opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium">
                              Click to preview
                            </span>
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
                    </div>
                    
                    <div className="p-4 space-y-3">
                      {voiceover && (
                        <div>
                          <p className="text-xs text-text-secondary mb-1">Script:</p>
                          <p className="text-sm text-text-primary line-clamp-3">{voiceover}</p>
                        </div>
                      )}
                      
                      {/* Split button with Regenerate and Model Selector */}
                      <div className="flex items-stretch border border-border rounded-md overflow-hidden">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRegenerate(sceneNumber)}
                          disabled={isRegenerating}
                          className="flex-1 rounded-none border-0 border-r border-border"
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
                        
                        {/* Model selector - integrated as part of button */}
                        <ModelSelector
                          selectedModelId={selectedModels[sceneNumber] ?? 'model-1'}
                          onModelSelect={(modelId) => {
                            setSelectedModels(prev => ({
                              ...prev,
                              [sceneNumber]: modelId,
                            }));
                          }}
                          disabled={isRegenerating}
                        />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ImagePreview
        imageUrl={previewImage || ''}
        isOpen={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewImage(null);
        }}
        alt="B-roll image preview"
      />

      <ProgressBar
        progress={scenesNeedingBroll.length > 0 && brollImages.length === scenesNeedingBroll.length ? 70 : 60}
        message={
          scenesNeedingBroll.length > 0 && brollImages.length === scenesNeedingBroll.length
            ? "All images generated! Ready to create videos."
            : `Generating images... ${brollImages.length}/${scenesNeedingBroll.length}`
        }
        onNext={handleNext}
        disabled={scenesNeedingBroll.length > 0 && brollImages.length !== scenesNeedingBroll.length}
      />
    </div>
  );
}

export default function BrollImagesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <BrollImagesPageContent />
    </Suspense>
  );
}

