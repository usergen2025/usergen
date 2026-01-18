'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, ChevronLeft, ChevronRight, Edit, Music, Type, ChevronUp, Play } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils/cn';

interface Scene {
  scene_number?: number;
  sceneNumber?: number;
  voiceover?: string;
  broll?: string;
  prompt?: string;
  text?: string;
}

interface BrollImage {
  sceneNumber: number;
  imageUrl: string;
  localPath?: string;
  localUrl?: string;
  prompt?: string;
}

interface AudioFile {
  sceneNumber: number;
  filePath?: string;
  localUrl: string;
  voiceover?: string;
  duration?: number;
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
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [backgroundMusicEnabled, setBackgroundMusicEnabled] = useState(true);
  const [musicTab, setMusicTab] = useState<'library' | 'upload'>('library');
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [musicExpanded, setMusicExpanded] = useState(true);
  const [captionsExpanded, setCaptionsExpanded] = useState(true);

  // Calculate dynamic scene count based on available data
  const sceneCount = useMemo(() => {
    const scriptScenes = scenes.length;
    const imageScenes = brollImages.length;
    const audioScenes = audioFiles.length;
    // Return the maximum count to ensure we show all available scenes
    return Math.max(scriptScenes, imageScenes, audioScenes, 0);
  }, [scenes, brollImages, audioFiles]);

  // Load audio duration
  const loadAudioDuration = (sceneNumber: number, audioUrl: string) => {
    const audioSrc = audioUrl.startsWith('http')
      ? audioUrl
      : audioUrl.startsWith('/uploads/audio')
        ? `${VOICE_SERVICE_BASE_URL}${audioUrl}`
        : `${VIDEO_SERVICE_BASE_URL}${audioUrl}`;

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

  // Get image URL for scene - match broll-images page pattern
  const getImageUrl = (sceneNumber: number): string | null => {
    const image = brollImages.find(img => img.sceneNumber === sceneNumber);
    if (!image) return null;

    // Prefer localUrl (served from our server) - match broll-images page pattern
    if (image.localUrl) {
      // Ensure localUrl starts with /uploads
      const url = image.localUrl.startsWith('/uploads') 
        ? image.localUrl 
        : `/uploads${image.localUrl}`;
      // Use NEXT_PUBLIC_WS_URL which is already set to the base domain (e.g., https://api.dev.usergen.ai)
      const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
      return `${VIDEO_SERVICE_BASE_URL}${url}`;
    }
    // Fallback to imageUrl (BytePlus URL)
    return image.imageUrl || null;
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
            showToast('This project uses the classic flow. Redirecting...', 'info');
            router.push(`/create-video?projectId=${projectId}`);
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

          // Load audio files
          if (projectData.audioFiles) {
            const audioFilesData = Array.isArray(projectData.audioFiles)
              ? projectData.audioFiles
              : Object.values(projectData.audioFiles);
            setAudioFiles(audioFilesData);

            // Load durations for all audio files
            audioFilesData.forEach((audioFile: AudioFile) => {
              if (audioFile.localUrl) {
                // If duration is already stored, use it
                if (audioFile.duration) {
                  setDurations(prev => ({ ...prev, [audioFile.sceneNumber]: audioFile.duration! }));
                } else {
                  // Otherwise load from audio metadata
                  loadAudioDuration(audioFile.sceneNumber, audioFile.localUrl);
                }
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
          router.push('/login');
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
      router.push('/create-video');
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
    const prompt = currentScene.broll || currentScene.prompt || '';

    try {
      showToast('Regenerating image...', 'info');
      const response = await apiClient.regenerateImage(projectId, sceneNumber, prompt, 'model-1');
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
    <div className="relative w-full min-h-screen bg-[#FFFCF8]">
      {/* Background ellipses */}
      <div className="absolute w-[1146px] h-[1146px] left-[calc(50%+720px)] top-[calc(50%-512px)] bg-[#E86512] opacity-10 blur-[200px] pointer-events-none" />
      <div className="absolute w-[1146px] h-[1146px] left-[calc(50%-720px)] top-[calc(50%+512px)] bg-[#E86512] opacity-10 blur-[200px] pointer-events-none" />

      {/* Header with back button and title */}
      <div className="absolute w-[clamp(800px,86.7vw,1248px)] h-[clamp(40px,5.08vh,52px)] left-[clamp(24px,6.7vw,96px)] top-[clamp(100px,13.3vh,136px)] flex flex-row justify-between items-center">
        <div className="flex flex-row items-center gap-[clamp(12px,1.39vw,20px)]">
          <button onClick={handleBack} className="w-[clamp(20px,2.5vh,24px)] h-[clamp(20px,2.5vh,24px)] flex items-center justify-center">
            <ArrowLeft className="w-full h-full text-[#212121]" />
          </button>
          <span className="font-heading font-medium text-[clamp(18px,2.5vh,24px)] leading-[clamp(18px,2.5vh,24px)] text-[#212121]">Workspace</span>
        </div>
        <button className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] px-[clamp(12px,1.39vw,20px)] py-[clamp(12px,1.56vh,16px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[26px] min-w-[clamp(120px,14vw,202px)] h-[clamp(40px,5.08vh,52px)]">
          <span className="font-heading font-semibold text-[clamp(14px,1.56vh,16px)] leading-[clamp(14px,1.56vh,16px)] text-white">Convert to Videos →</span>
        </button>
      </div>

      {/* Main content area */}
      <div className="absolute w-[clamp(1000px,90.3vw,1300px)] h-[clamp(500px,73.5vh,753px)] left-[calc(50%-clamp(500px,45.15vw,650px))] top-[clamp(170px,18.4vh,189px)] flex flex-row items-start gap-[clamp(12px,1.39vw,20px)]">
        {/* Left sidebar - Scene list */}
        <div className="flex flex-col items-start p-[clamp(12px,1.56vh,16px)] gap-[clamp(6px,0.98vh,8px)] w-[clamp(300px,32.3vw,466px)] h-full bg-white shadow-[0px_1px_12px_rgba(242,126,53,0.12)] rounded-[20px] overflow-hidden">
          <div className="flex flex-col items-center gap-[clamp(8px,0.98vh,10px)] w-full h-full overflow-y-auto pr-[clamp(4px,0.52vw,8px)]">
            {scenes.length > 0 ? (
              scenes.map((scene, index) => {
                const sceneNumber = scene.scene_number || scene.sceneNumber || (index + 1);
                const imageUrl = getImageUrl(sceneNumber);
                const sceneText = getSceneText(scene);
                const timeRange = getSceneTimeRange(index);
                const isSelected = index === selectedSceneIndex;

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
                      <div className="w-[clamp(58px,7.8vw,90px)] h-[clamp(73px,11vh,113px)] rounded-[12px] overflow-hidden flex-shrink-0">
                        {imageUrl ? (
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
        <div className="flex flex-col items-center pt-[clamp(30px,4.2vh,40px)] gap-[clamp(12px,1.56vh,20px)] w-[clamp(320px,31.7vw,410px)] h-full">
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

          {/* Preview image */}
          <div className="w-[clamp(280px,31.7vw,320px)] h-[clamp(430px,52.5vh,537px)] rounded-[12px] overflow-hidden bg-gray-200 flex items-center justify-center">
            {currentImageUrl ? (
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
          <div className="flex flex-col justify-center items-start gap-[clamp(8px,0.98vh,10px)] w-full h-full overflow-y-auto pr-[clamp(4px,0.52vw,8px)]">
            {/* Background Music Section */}
            <div className="flex flex-col items-start p-[clamp(16px,2.34vh,24px)] gap-[clamp(8px,1.17vh,12px)] w-full bg-white border border-[#E0E0E0] rounded-[12px]">
              <div className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] w-full">
                <Music className="w-[clamp(20px,2.5vh,24px)] h-[clamp(20px,2.5vh,24px)] text-[#212121]" />
                <span className="font-heading font-semibold text-[clamp(16px,2.4vh,18px)] leading-[clamp(20px,2.93vh,23px)] text-[#212121] flex-1">Background Music</span>
                <button
                  onClick={() => setMusicExpanded(!musicExpanded)}
                  className="w-[clamp(20px,2.5vh,24px)] h-[clamp(20px,2.5vh,24px)] flex items-center justify-center"
                >
                  <ChevronUp className={`w-full h-full text-[#212121] transition-transform ${musicExpanded ? '' : 'rotate-180'}`} />
                </button>
                <div
                  onClick={() => setBackgroundMusicEnabled(!backgroundMusicEnabled)}
                  className={`flex flex-row justify-end items-center p-[clamp(10px,1.17vh,12px)] gap-[clamp(6px,0.69vw,8px)] w-[clamp(32px,3.9vw,40px)] h-[clamp(18px,1.95vh,20px)] rounded-[14px] cursor-pointer transition-colors ${backgroundMusicEnabled ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C]' : 'bg-gray-300'}`}
                >
                  <div className="w-[clamp(14px,1.67vw,16px)] h-[clamp(14px,1.67vw,16px)] bg-white rounded-full" />
                </div>
              </div>

              {musicExpanded && (
                <>
                  {/* Tabs */}
                  <div className="flex flex-row items-center gap-0 w-full h-[clamp(28px,3.52vh,36px)] bg-[#E0E0E0] rounded-[24px] p-[clamp(2px,0.39vh,4px)]">
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

                  {/* Music list */}
                  {musicTab === 'library' && (
                    <div className="flex flex-col gap-[clamp(6px,0.78vh,8px)] w-full">
                      {['Commercial Music', 'Advertisement Music', 'Motivation Music', 'Nature Music'].map((category, index) => (
                        <div key={index} className="flex flex-row items-center gap-[clamp(10px,1.17vh,12px)] w-full h-[clamp(50px,5.15vh,66px)] rounded-[8px]">
                          <button className="w-[clamp(32px,3.9vw,40px)] h-[clamp(32px,3.9vw,40px)] bg-[#E0E0E0] rounded-[20px] flex items-center justify-center">
                            <Play className="w-[clamp(14px,1.56vh,16px)] h-[clamp(14px,1.56vh,16px)] text-[#212121]" />
                          </button>
                          <div className="flex flex-col justify-center items-start flex-1 min-w-0">
                            <span className="font-heading font-medium text-[clamp(14px,1.56vh,16px)] leading-[clamp(14px,1.56vh,16px)] text-[#212121] truncate w-full">{category}</span>
                          </div>
                          <div className="flex flex-col items-center p-[clamp(3px,0.39vh,4px)] w-[clamp(260px,27.1vw,278px)] h-[clamp(8px,0.98vh,10px)] bg-white rounded-[18px]">
                            <div className="w-[clamp(6px,0.65vw,8px)] h-[clamp(6px,0.65vw,8px)] bg-white rounded-full" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Captions Section */}
            <div className="flex flex-col items-start p-[clamp(16px,2.34vh,24px)] gap-[clamp(8px,1.17vh,12px)] w-full bg-white border border-[#E0E0E0] rounded-[12px]">
              <div className="flex flex-row justify-center items-center gap-[clamp(6px,0.69vw,8px)] w-full">
                <Type className="w-[clamp(20px,2.5vh,24px)] h-[clamp(20px,2.5vh,24px)] text-[#212121]" />
                <span className="font-heading font-semibold text-[clamp(16px,2.4vh,18px)] leading-[clamp(20px,2.93vh,23px)] text-[#212121] flex-1">Captions</span>
                <button
                  onClick={() => setCaptionsExpanded(!captionsExpanded)}
                  className="w-[clamp(20px,2.5vh,24px)] h-[clamp(20px,2.5vh,24px)] flex items-center justify-center"
                >
                  <ChevronUp className={`w-full h-full text-[#212121] transition-transform ${captionsExpanded ? '' : 'rotate-180'}`} />
                </button>
                <div
                  onClick={() => setCaptionsEnabled(!captionsEnabled)}
                  className={`flex flex-row justify-end items-center p-[clamp(10px,1.17vh,12px)] gap-[clamp(6px,0.69vw,8px)] w-[clamp(32px,3.9vw,40px)] h-[clamp(18px,1.95vh,20px)] rounded-[14px] cursor-pointer transition-colors ${captionsEnabled ? 'bg-gradient-to-b from-[#E86412] to-[#F12A4C]' : 'bg-gray-300'}`}
                >
                  <div className="w-[clamp(14px,1.67vw,16px)] h-[clamp(14px,1.67vw,16px)] bg-white rounded-full" />
                </div>
              </div>

              {captionsExpanded && (
                <div className="flex flex-col justify-center items-center gap-[clamp(8px,0.98vh,10px)] w-full">
                  {/* Light caption preview */}
                  <div className="flex flex-col items-start p-[clamp(4px,0.52vw,4px)] gap-[clamp(8px,0.98vh,10px)] w-full rounded-[12px]">
                    <div className="flex flex-col justify-center items-center p-[clamp(6px,0.78vh,8px)] px-[clamp(12px,1.56vh,16px)] w-full bg-gradient-to-r from-[#E0E0E0] to-[#7A7A7A] rounded-[8px]">
                      <div className="flex flex-col items-center p-[clamp(10px,1.17vh,12px)] w-[clamp(200px,20.8vw,240px)] bg-white rounded-[12px]">
                        <span className="font-heading font-normal text-[clamp(14px,1.56vh,16px)] leading-[clamp(16px,1.95vh,19px)] text-center text-black">
                          {currentSceneText || 'The quick brown fox jumps over the lazy dog'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Dark caption preview */}
                  <div className="flex flex-col items-start p-[clamp(4px,0.52vw,4px)] gap-[clamp(8px,0.98vh,10px)] w-full rounded-[12px]">
                    <div className="flex flex-col justify-center items-center p-[clamp(6px,0.78vh,8px)] px-[clamp(12px,1.56vh,16px)] w-full bg-gradient-to-r from-[#616161] to-[#C7C7C7] rounded-[8px]">
                      <div className="flex flex-col items-center p-[clamp(10px,1.17vh,12px)] w-[clamp(200px,20.8vw,240px)] bg-black rounded-[12px]">
                        <span className="font-heading font-normal text-[clamp(14px,1.56vh,16px)] leading-[clamp(16px,1.95vh,19px)] text-center text-white">
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
  );
}

export default function WorkspacePage() {
  return (
    <WorkspacePageContent />
  );
}

