'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Play, Pause, Download, Instagram, Facebook, Share2, Edit2, Home, Eye, EyeOff, X, Bold, Italic, Underline } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { useVideoStepNavigation } from '@/hooks/useVideoStepNavigation';

interface Scene {
  sceneNumber?: number;
  scene_number?: number;
  timeRange?: string;
  time_range?: string;
  voiceover: string;
  filePath?: string;
  localUrl?: string;
  duration?: number;
}

interface AudioFile {
  sceneNumber: number;
  filePath: string;
  localUrl: string;
  voiceover: string;
}

function PreviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [projectId, setProjectId] = useState<string | null>(() => searchParams?.get('projectId') ?? null);
  
  const [project, setProject] = useState<any>(null);
  const { goToPreviousStep } = useVideoStepNavigation(projectId, project?.currentStep);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingSceneIndex, setPlayingSceneIndex] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [audioElements, setAudioElements] = useState<Record<number, HTMLAudioElement>>({});
  
  // Video player state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Get service URLs
  // Static files are served at /uploads/* (not /api/uploads/*)
  // Use NEXT_PUBLIC_WS_URL which is already set to the base domain (e.g., https://api.dev.usergen.ai)
  const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
  const VOICE_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9002';
  
  // Caption settings state
  const [captionSettingsOpen, setCaptionSettingsOpen] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [fontFamily, setFontFamily] = useState('Poppins');
  const [fontSize, setFontSize] = useState(24);
  const [textColor, setTextColor] = useState('#000000');
  const [borderColor, setBorderColor] = useState('#000000');
  const [backgroundColor, setBackgroundColor] = useState('#FFFFFF');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);

  // Load audio duration - Fix URL to use correct service
  const loadAudioDuration = (sceneNumber: number, audioUrl: string) => {
    // Construct full URL based on path
    const audioSrc = audioUrl.startsWith('http') 
      ? audioUrl 
      : audioUrl.startsWith('/uploads/audio')
        ? `${VOICE_SERVICE_BASE_URL}${audioUrl}`
        : `${VIDEO_SERVICE_BASE_URL}${audioUrl}`;
    
    const audio = new Audio(audioSrc);
    audio.addEventListener('loadedmetadata', () => {
      setDurations(prev => ({ ...prev, [sceneNumber]: audio.duration }));
    });
    audio.addEventListener('error', (e) => {
      console.error(`Failed to load audio for scene ${sceneNumber}:`, e);
      console.error(`Audio URL tried: ${audioSrc}`);
    });
  };

  // Get projectId from URL as a string value for dependencies
  const projectIdFromUrlStr = searchParams?.get('projectId') || '';

  // Load project data
  useEffect(() => {
    const loadProject = async () => {
      // Wait for auth to finish loading
      if (authLoading) {
        console.log('Waiting for auth to finish loading...');
        return;
      }

      // Redirect if not authenticated
      if (!isAuthenticated) {
        sessionStorage.setItem('pendingRedirect', '/create-video/preview');
        setLoading(false);
        return;
      }

      // Get projectId from URL or state
      let currentProjectId = projectIdFromUrlStr || projectId;

      // If projectId is not in URL, try to get active project
      if (!currentProjectId) {
        console.log('Project ID not in URL, fetching active project...');
        try {
          const activeProjectResponse = await apiClient.getActiveVideoProject();
          if (activeProjectResponse.success && activeProjectResponse.data) {
            currentProjectId = activeProjectResponse.data.id;
            setProjectId(currentProjectId);
            // Update URL with projectId
            router.replace(`/create-video/preview?projectId=${currentProjectId}`);
            console.log('Found active project:', currentProjectId);
          } else {
            console.error('No active project found');
            showToast('No active project found. Please start a new video.', 'warning');
            setLoading(false);
            return;
          }
        } catch (error: any) {
          console.error('Failed to get active project:', error);
          showToast('Failed to load project. Please start a new video.', 'error');
          setLoading(false);
          return;
        }
      }

      // Now we should have a projectId
      if (!currentProjectId) {
        console.error('Project ID is missing');
        showToast('Project ID is missing', 'error');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        console.log('Loading project with ID:', currentProjectId);
        const response = await apiClient.getVideoProject(currentProjectId);
        console.log('Project response:', response);
        if (response.success && response.data) {
          const projectData = response.data;
          console.log('Project data loaded:', projectData);
          setProject(projectData);

          // Load video URL if available - prioritize GCS URLs
          if (projectData.videoPublicUrl || projectData.videoGcsUrl || projectData.videoUrl) {
            let videoSrc: string;
            
            // Priority 1: Use videoPublicUrl (GCS URL if available)
            if (projectData.videoPublicUrl && projectData.videoPublicUrl.startsWith('http')) {
              videoSrc = projectData.videoPublicUrl;
            }
            // Priority 2: Direct GCS URL
            else if (projectData.videoGcsUrl && projectData.videoGcsUrl.startsWith('http')) {
              videoSrc = projectData.videoGcsUrl;
            }
            // Priority 3: Fallback to videoUrl
            else if (projectData.videoUrl) {
              videoSrc = projectData.videoUrl.startsWith('http')
                ? projectData.videoUrl
                : `${VIDEO_SERVICE_BASE_URL}${projectData.videoUrl}`;
            } else {
              videoSrc = '';
            }
            
            if (videoSrc) {
              setVideoUrl(videoSrc);
              console.log('Video URL set:', videoSrc);
            }
          }

          // Load caption settings
          if (projectData.captionSettings) {
            const caps = projectData.captionSettings;
            setCaptionsEnabled(projectData.captionsEnabled || false);
            setFontFamily(caps.fontFamily || 'Poppins');
            setFontSize(caps.fontSize || 24);
            setTextColor(caps.textColor || '#000000');
            setBorderColor(caps.borderColor || '#000000');
            setBackgroundColor(caps.backgroundColor || '#FFFFFF');
            setIsBold(caps.isBold || false);
            setIsItalic(caps.isItalic || false);
            setIsUnderline(caps.isUnderline || false);
          }

          // Parse script to get scenes
          if (projectData.script) {
            try {
              const script = typeof projectData.script === 'string' 
                ? JSON.parse(projectData.script) 
                : projectData.script;
              
              const scriptScenes = script.scenes || script.scene_plan || [];
              console.log('Parsed scenes from script:', scriptScenes);
              setScenes(scriptScenes);
            } catch (e) {
              console.error('Failed to parse script:', e);
            }
          }

          // Load audio files
          if (projectData.audioFiles) {
            const audioFilesData = Array.isArray(projectData.audioFiles) 
              ? projectData.audioFiles 
              : Object.values(projectData.audioFiles);
            console.log(`[Preview] Loaded ${audioFilesData.length} audio files from project:`, audioFilesData.map((af: any) => ({
              sceneNumber: af.sceneNumber,
              localUrl: af.localUrl,
            })));
            setAudioFiles(audioFilesData);
            
            // Load audio durations
            audioFilesData.forEach((audioFile: AudioFile) => {
              if (audioFile.localUrl) {
                console.log(`[Preview] Loading audio duration for scene ${audioFile.sceneNumber}: ${audioFile.localUrl}`);
                loadAudioDuration(audioFile.sceneNumber, audioFile.localUrl);
              } else {
                console.warn(`[Preview] Audio file for scene ${audioFile.sceneNumber} has no localUrl:`, audioFile);
              }
            });
          } else {
            console.warn(`[Preview] No audio files found in project data. Project step: ${projectData.currentStep}`);
            // If we're on preview/rendering step but no audio files, they might still be generating
            if (projectData.currentStep === 'RENDERING' || projectData.currentStep === 'VOICE') {
              console.log('[Preview] Audio files may still be generating. Check console for audio generation logs.');
            }
          }
        } else {
          console.error('Failed to load project: Invalid response', response);
          showToast('Failed to load project', 'error');
        }
      } catch (error: any) {
        console.error('Failed to load project:', error);
        showToast(error.response?.data?.message || error.message || 'Failed to load project', 'error');
        if (error.response?.status === 401) {
          // AuthExpiryProvider handles 401
        }
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [projectIdFromUrlStr, projectId, isAuthenticated, authLoading, router]);

  // Play scene audio
  const handlePlayScene = (sceneIndex: number, scene: Scene) => {
    // Stop currently playing audio
    if (playingSceneIndex !== null && audioElements[playingSceneIndex]) {
      audioElements[playingSceneIndex].pause();
      audioElements[playingSceneIndex].currentTime = 0;
    }

    // Find audio file for this scene - match by scene number
    const sceneNumber = scene.sceneNumber || scene.scene_number || (sceneIndex + 1);
    
    console.log(`[Preview] Looking for audio for scene:`, {
      sceneIndex,
      sceneNumber,
      scene: {
        sceneNumber: scene.sceneNumber,
        scene_number: scene.scene_number,
        voiceover: scene.voiceover?.substring(0, 50) + '...',
      },
      availableAudioFiles: audioFiles.map(af => ({
        sceneNumber: af.sceneNumber,
        localUrl: af.localUrl,
      })),
    });
    
    // Match by exact sceneNumber first
    let audioFile = audioFiles.find(af => af.sceneNumber === sceneNumber);
    
    // If no exact match, try matching by scene.sceneNumber or scene.scene_number
    if (!audioFile) {
      audioFile = audioFiles.find(af => 
        af.sceneNumber === (scene.sceneNumber || scene.scene_number) ||
        af.sceneNumber === (sceneIndex + 1)
      );
    }
    
    console.log(`[Preview] Matched audio file:`, audioFile ? {
      sceneNumber: audioFile.sceneNumber,
      localUrl: audioFile.localUrl,
    } : 'NOT FOUND');
    
    if (!audioFile || !audioFile.localUrl) {
      console.error('[Preview] Audio file not found for scene:', {
        sceneIndex,
        sceneNumber,
        scene,
        availableAudioFiles: audioFiles,
      });
      showToast(`Audio file not available for scene ${sceneNumber}. Please regenerate audio.`, 'warning');
      return;
    }

    // Construct full URL based on path
    const audioUrl = audioFile.localUrl.startsWith('http') 
      ? audioFile.localUrl 
      : audioFile.localUrl.startsWith('/uploads/audio')
        ? `${VOICE_SERVICE_BASE_URL}${audioFile.localUrl}`
        : `${VIDEO_SERVICE_BASE_URL}${audioFile.localUrl}`;

    // Create or use existing audio element
    let audio = audioElements[sceneIndex];
    if (!audio) {
      audio = new Audio(audioUrl);
      audio.addEventListener('timeupdate', () => {
        if (playingSceneIndex === sceneIndex) {
          setCurrentTime(audio.currentTime);
        }
      });
      audio.addEventListener('ended', () => {
        setPlayingSceneIndex(null);
        setCurrentTime(0);
      });
      setAudioElements(prev => ({ ...prev, [sceneIndex]: audio }));
    }

    if (playingSceneIndex === sceneIndex) {
      // Pause if already playing
      audio.pause();
      setPlayingSceneIndex(null);
      setCurrentTime(0);
    } else {
      // Play new audio
      audio.play();
      setPlayingSceneIndex(sceneIndex);
    }
  };

  // Handle video play
  const handleVideoPlay = () => {
    if (videoRef.current) {
      if (isVideoPlaying) {
        videoRef.current.pause();
        setIsVideoPlaying(false);
      } else {
        videoRef.current.play();
        setIsVideoPlaying(true);
      }
    }
  };

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate total duration
  const totalDuration = scenes.reduce((total, scene) => {
    const audioFile = audioFiles.find(af => af.sceneNumber === scene.sceneNumber);
    if (audioFile && durations[audioFile.sceneNumber]) {
      return total + durations[audioFile.sceneNumber];
    }
    return total;
  }, 0);

  // Calculate current scene's elapsed time
  const calculateSceneElapsedTime = (sceneIndex: number): number => {
    let elapsed = 0;
    for (let i = 0; i < sceneIndex; i++) {
      const scene = scenes[i];
      const sceneNum = scene.sceneNumber || scene.scene_number || (i + 1);
      const audioFile = audioFiles.find(af => af.sceneNumber === sceneNum);
      if (audioFile && durations[audioFile.sceneNumber]) {
        elapsed += durations[audioFile.sceneNumber];
      }
    }
    if (playingSceneIndex === sceneIndex) {
      elapsed += currentTime;
    } else if (playingSceneIndex !== null && playingSceneIndex < sceneIndex) {
      const playingScene = scenes[playingSceneIndex];
      const playingSceneNum = playingScene.sceneNumber || playingScene.scene_number || (playingSceneIndex + 1);
      const playingAudioFile = audioFiles.find(af => af.sceneNumber === playingSceneNum);
      if (playingAudioFile && durations[playingAudioFile.sceneNumber]) {
        elapsed += durations[playingAudioFile.sceneNumber];
      }
    }
    return elapsed;
  };

  // Format time range for scene
  const getSceneTimeRange = (sceneIndex: number): string => {
    const scene = scenes[sceneIndex];
    const sceneNum = scene.sceneNumber || scene.scene_number || (sceneIndex + 1);
    const audioFile = audioFiles.find(af => af.sceneNumber === sceneNum);
    const sceneDuration = audioFile ? durations[audioFile.sceneNumber] : 0;
    
    if (!sceneDuration) {
      return scene.timeRange || scene.time_range || `00:00/00:00`;
    }

    const startTime = calculateSceneElapsedTime(sceneIndex);
    const endTime = startTime + sceneDuration;
    
    const currentTimeFormatted = playingSceneIndex === sceneIndex 
      ? formatTime(startTime + currentTime)
      : formatTime(startTime);
    const endTimeFormatted = formatTime(endTime);
    
    return `${currentTimeFormatted}/${endTimeFormatted}`;
  };

  // Save caption settings
  const handleSaveCaptionSettings = async () => {
    if (!projectId) return;

    try {
      await apiClient.updateVideoProject(projectId, {
        captionsEnabled,
        captionSettings: {
          fontFamily,
          fontSize,
          textColor,
          borderColor,
          backgroundColor,
          isBold,
          isItalic,
          isUnderline,
        },
      });
      showToast('Caption settings saved', 'success');
    } catch (error: any) {
      console.error('Failed to save caption settings:', error);
      showToast('Failed to save caption settings', 'error');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className={typography.body.large}>Loading preview...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Video Preview */}
          <div>
            <button
              onClick={goToPreviousStep}
              className="mb-6 flex items-center gap-2 text-text-primary hover:text-text-secondary transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>

            <h2 className={cn(typography.heading.h4, "mb-2")}>{project?.title || 'Name_Video'}</h2>
            
            {/* Video Player - Updated to show actual video */}
            <div className="bg-secondary border border-border rounded-lg p-8 aspect-video flex items-center justify-center relative mb-4 overflow-hidden">
              {videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="w-full h-full object-contain"
                  controls={true}
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  onEnded={() => setIsVideoPlaying(false)}
                >
                  Your browser does not support the video tag.
                </video>
              ) : (
                <>
                  <div 
                    className="w-24 h-24 bg-primary rounded-full flex items-center justify-center cursor-pointer hover:bg-primary-dark transition-colors"
                    onClick={handleVideoPlay}
                  >
                    {isVideoPlaying ? (
                      <Pause className="w-12 h-12 text-secondary" fill="currentColor" />
                    ) : (
                <Play className="w-12 h-12 text-secondary" fill="currentColor" />
                    )}
                  </div>
                  {!project?.videoUrl && (
                    <div className="absolute bottom-4 left-4 text-sm text-text-secondary">
                      Video is still rendering...
              </div>
                  )}
                </>
              )}
              <div className="absolute bottom-2 right-2">
                <span className="px-2 py-1 bg-secondary border border-border text-xs">WATERMARK</span>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-sm">Export & Share via</p>
              <div className="flex gap-4">
                <button className="flex flex-col items-center gap-2 p-3 border border-border rounded-lg hover:bg-primary-light transition-colors">
                  <Download className="w-6 h-6" />
                  <span className="text-xs">Download</span>
                </button>
                <button className="flex flex-col items-center gap-2 p-3 border border-border rounded-lg hover:bg-primary-light transition-colors relative">
                  <Instagram className="w-6 h-6" />
                  <span className="text-xs">Instagram</span>
                  <span className="absolute -top-1 -right-1 text-xs bg-primary text-secondary px-1 rounded">+¢50</span>
                </button>
                <button className="flex flex-col items-center gap-2 p-3 border border-border rounded-lg hover:bg-primary-light transition-colors">
                  <Facebook className="w-6 h-6" />
                  <span className="text-xs">Facebook</span>
                </button>
                <button className="flex flex-col items-center gap-2 p-3 border border-border rounded-lg hover:bg-primary-light transition-colors">
                  <Share2 className="w-6 h-6" />
                  <span className="text-xs">Share</span>
                </button>
              </div>

              <Button 
                variant="primary" 
                size="lg" 
                fullWidth 
                icon={<Home className="w-5 h-5" />} 
                onClick={() => router.push('/dashboard')}
              >
                PROCEED TO DASHBOARD
              </Button>
            </div>
          </div>

          {/* Right: Edit Panel */}
          <div>
            <Card className="p-6 space-y-6">
              <h3 className={cn(typography.heading.h4)}>Preview</h3>
              
              {/* Audio Section */}
              <div className="space-y-2 border-b border-border pb-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Audio</h4>
                  <span className="text-sm text-text-secondary">▼</span>
                </div>
                <div className="text-sm">
                  <p>{project?.voiceId ? `Voice ID: ${project.voiceId.substring(0, 8)}...` : 'Custom_Audio1234'}</p>
                  <div className="flex items-center justify-between mt-2">
                    <button className="text-primary hover:underline">Replace</button>
                    <span>100%</span>
                  </div>
                </div>
              </div>

              {/* Background Music */}
              <div className="space-y-2 border-b border-border pb-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Background Music</h4>
                  <span className="text-sm text-text-secondary">▼</span>
                </div>
                <div className="text-sm">
                  <p>Commercial_music</p>
                  <div className="flex items-center justify-between mt-2">
                    <button className="text-primary hover:underline">Replace</button>
                    <span>100%</span>
                  </div>
                </div>
              </div>

              {/* Scene by Scene */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Scene by Scene</h4>
                  <button 
                    className="text-sm text-primary hover:underline"
                    onClick={() => setCaptionSettingsOpen(!captionSettingsOpen)}
                  >
                    {captionSettingsOpen ? 'Hide Caption Settings' : 'Caption Settings'}
                  </button>
                </div>

                {/* Caption Settings Panel */}
                {captionSettingsOpen && (
                  <div className="p-4 border border-border rounded-lg bg-secondary space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm underline">Caption Settings</span>
                      <button 
                        onClick={() => setCaptionSettingsOpen(false)}
                        className="text-text-secondary hover:text-text-primary"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm">Enable Captions</span>
                      <button
                        onClick={() => setCaptionsEnabled(!captionsEnabled)}
                        className={cn(
                          'w-10 h-6 rounded-full transition-colors flex items-center',
                          captionsEnabled ? 'bg-primary justify-end' : 'bg-border justify-start'
                        )}
                      >
                        <div className={cn(
                          'w-4 h-4 rounded-full bg-secondary m-1 transition-transform',
                          captionsEnabled ? 'translate-x-0' : 'translate-x-0'
                        )}>
                          {captionsEnabled ? (
                            <Eye className="w-4 h-4 text-primary" />
                          ) : (
                            <EyeOff className="w-4 h-4 text-text-secondary" />
                          )}
                        </div>
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-text-secondary mb-1 block">Font Family</label>
                        <select
                          value={fontFamily}
                          onChange={(e) => setFontFamily(e.target.value)}
                          className="w-full px-3 py-2 border border-border rounded bg-background text-sm"
                        >
                          <option value="Poppins">Poppins</option>
                          <option value="Arial">Arial</option>
                          <option value="Helvetica">Helvetica</option>
                          <option value="Roboto">Roboto</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs text-text-secondary mb-1 block">Font Size</label>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setFontSize(Math.max(12, fontSize - 1))}
                            className="px-2 py-1 border border-border rounded text-sm hover:bg-primary-light"
                          >
                            ←
                          </button>
                          <input
                            type="number"
                            value={fontSize}
                            onChange={(e) => setFontSize(Math.max(12, Math.min(72, parseInt(e.target.value) || 24)))}
                            className="flex-1 px-3 py-2 border border-border rounded bg-background text-sm text-center"
                            min={12}
                            max={72}
                          />
                          <button
                            onClick={() => setFontSize(Math.min(72, fontSize + 1))}
                            className="px-2 py-1 border border-border rounded text-sm hover:bg-primary-light"
                          >
                            →
                          </button>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => setIsBold(!isBold)}
                          className={cn(
                            'p-2 border rounded transition-colors',
                            isBold ? 'bg-primary text-secondary border-primary' : 'border-border hover:bg-primary-light'
                          )}
                        >
                          <Bold className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setIsItalic(!isItalic)}
                          className={cn(
                            'p-2 border rounded transition-colors',
                            isItalic ? 'bg-primary text-secondary border-primary' : 'border-border hover:bg-primary-light'
                          )}
                        >
                          <Italic className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setIsUnderline(!isUnderline)}
                          className={cn(
                            'p-2 border rounded transition-colors',
                            isUnderline ? 'bg-primary text-secondary border-primary' : 'border-border hover:bg-primary-light'
                          )}
                        >
                          <Underline className="w-4 h-4" />
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-text-secondary mb-1 block">Text Color</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={textColor}
                            onChange={(e) => setTextColor(e.target.value)}
                            className="w-10 h-10 border border-border rounded cursor-pointer"
                          />
                          <input
                            type="text"
                            value={textColor}
                            onChange={(e) => setTextColor(e.target.value)}
                            className="flex-1 px-3 py-2 border border-border rounded bg-background text-sm"
                            placeholder="#000000"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-xs text-text-secondary mb-1 block">Text Border Color</label>
                        <div className="flex items-center gap-2">
                          <Eye className="w-5 h-5 text-text-secondary" />
                          <input
                            type="color"
                            value={borderColor}
                            onChange={(e) => setBorderColor(e.target.value)}
                            className="w-10 h-10 border border-border rounded cursor-pointer"
                          />
                          <input
                            type="text"
                            value={borderColor}
                            onChange={(e) => setBorderColor(e.target.value)}
                            className="flex-1 px-3 py-2 border border-border rounded bg-background text-sm"
                            placeholder="#000000"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-xs text-text-secondary mb-1 block">Background Color</label>
                        <div className="flex items-center gap-2">
                          <Eye className="w-5 h-5 text-text-secondary" />
                          <input
                            type="color"
                            value={backgroundColor}
                            onChange={(e) => setBackgroundColor(e.target.value)}
                            className="w-10 h-10 border border-border rounded cursor-pointer"
                          />
                          <input
                            type="text"
                            value={backgroundColor}
                            onChange={(e) => setBackgroundColor(e.target.value)}
                            className="flex-1 px-3 py-2 border border-border rounded bg-background text-sm"
                            placeholder="#FFFFFF"
                          />
                        </div>
                      </div>

                      <Button
                        variant="primary"
                        size="sm"
                        fullWidth
                        onClick={handleSaveCaptionSettings}
                      >
                        Save Settings
                      </Button>
                    </div>
                  </div>
                )}

                {/* Scenes List */}
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {scenes.length > 0 ? (
                    scenes.map((scene, idx) => {
                      const isPlaying = playingSceneIndex === idx;
                      const audioFile = audioFiles.find(af => af.sceneNumber === scene.sceneNumber);
                      const sceneDuration = audioFile ? durations[audioFile.sceneNumber] : 0;
                      
                      return (
                        <div key={idx} className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-secondary transition-colors">
                          {/* Play Button */}
                          <button
                            onClick={() => handlePlayScene(idx, scene)}
                            className={cn(
                              'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors',
                              isPlaying 
                                ? 'bg-primary text-secondary' 
                                : 'bg-background border border-border text-text-primary hover:bg-primary-light hover:border-primary'
                            )}
                            title={isPlaying ? 'Pause audio' : 'Play audio'}
                          >
                            {isPlaying ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4 fill-current" />
                            )}
                          </button>

                          {/* Time Range */}
                          <div className="flex-shrink-0 w-20 text-xs text-text-secondary font-mono">
                            {getSceneTimeRange(idx)}
                          </div>

                          {/* Voiceover Text */}
                          <p className="text-sm flex-1 text-text-primary">{scene.voiceover}</p>

                          {/* Edit Button */}
                          <button className="flex-shrink-0 text-text-secondary hover:text-primary transition-colors">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-text-secondary">
                      <p>No scenes available</p>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PreviewPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <PreviewPageContent />
    </Suspense>
  );
}
