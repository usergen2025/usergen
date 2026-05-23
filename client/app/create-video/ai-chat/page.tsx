'use client';

import { useState, useEffect, useRef, Suspense, type ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, X, Image as ImageIcon, Sparkles, Mic, Upload, Play, Pause, Check, Pencil, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';
import { useDownloadFinalVideo } from '@/hooks/useDownloadFinalVideo';
import { apiClient, User } from '@/lib/api/client';
import {
  getFinalVideoUrl,
  getPreviewPlaybackUrl,
  hasFinalVideo,
  hasPreviewGenerationError,
  isPreviewReady,
} from '@/lib/video-urls';
import { cn } from '@/lib/utils/cn';
import { useToast } from '@/lib/toast/toast';
import { useWebSocket } from '@/hooks/useWebSocket';
import { VideoStyle } from '@/types';
import AIChatTagAwareInput from '@/components/ui/AIChatTagAwareInput';
import ImagePreview from '@/components/ui/ImagePreview';
import SceneEditInput from '@/components/ui/SceneEditInput';
import { AVATAR_VISUAL_STYLE_PRESETS, type AvatarVisualStylePresetId } from '@/lib/config/avatar-visual-style-presets';
import BRollSelectionModal, { BRollSelection } from '@/components/create-video/BRollSelectionModal';

// Define asset types
interface Asset {
  id: string;
  name: string;
  type: 'image' | 'url';
  file?: File;
  preview?: string; // Object URL for image preview
  url?: string; // For URL assets
  category?: string; // User-provided category (logo, product, etc.)
}

interface ManualSceneAudioState {
  status: 'pending' | 'uploading' | 'uploaded' | 'error';
  duration?: number;
  localUrl?: string;
  errorMessage?: string;
}

type VoiceMode = 'AI' | 'MANUAL' | null;

// Define chat flow steps
type ChatStep = 'welcome' | 'option-selected' | 'style-selection' | 'asset-upload' | 'assets-attached' | 'script-input' | 'script-generated' | 'avatar-selection' | 'voice-selection' | 'audio-image-generation' | 'workspace';

// Define substeps for multi-stage steps
type AvatarSubstep =
  | 'question'
  | 'selection'
  | 'generate-visual-style'
  | 'text-generation'
  | 'visual-style'
  | 'avatar-preview';
type VoiceSubstep = 'question' | 'selection' | 'manual' | 'voice-transform' | 'scene-review' | 'confirmed';
type StyleSubstep = 'selection' | 'confirmed';
type VideoDurationChoice = '30 seconds' | '45 seconds' | '1 minute' | '90 seconds';
type ScriptSubstep = 'language' | 'duration' | 'input';

const VIDEO_SERVICE_ORIGIN = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';

const VIDEO_DURATION_OPTIONS: { value: VideoDurationChoice; label: string }[] = [
  { value: '30 seconds', label: '30 seconds' },
  { value: '45 seconds', label: '45 seconds' },
  { value: '1 minute', label: '1 minute' },
  { value: '90 seconds', label: '1 min 30 sec' },
];

function AIChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useAuth();
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<ChatStep>('welcome');
  const [showAddAssetsModal, setShowAddAssetsModal] = useState(false);
  // Modal state - temporary, only visible in modal
  const [modalLogoAsset, setModalLogoAsset] = useState<Asset | null>(null);
  const [modalProductImages, setModalProductImages] = useState<Asset[]>([]);
  const [modalCompanyUrl, setModalCompanyUrl] = useState<string>('');
  // Typing area state - shown after clicking "Attach" in modal
  const [pendingAssets, setPendingAssets] = useState<Asset[]>([]);
  // Chat display state - shown after clicking send in typing area
  const [attachedAssets, setAttachedAssets] = useState<Asset[]>([]);
  const [scriptInput, setScriptInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [generatedScript, setGeneratedScript] = useState<any | null>(null);
  const [formattedScript, setFormattedScript] = useState<string | null>(null);
  const [activeSceneEditNumber, setActiveSceneEditNumber] = useState<number | null>(null);
  const [sceneDraftByNumber, setSceneDraftByNumber] = useState<
    Record<number, { voiceover: string; brollPrompt: string }>
  >({});
  const [scriptSceneSaveError, setScriptSceneSaveError] = useState<string | null>(null);
  const [isSavingScriptScene, setIsSavingScriptScene] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [userScriptMessage, setUserScriptMessage] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const {
    download: downloadFinalVideo,
    isDownloading: isDownloadingFinal,
  } = useDownloadFinalVideo(projectId, projectId ? `video-${projectId}.mp4` : undefined);
  const [proceedConfirmed, setProceedConfirmed] = useState<boolean>(false);
  const [avatarPreference, setAvatarPreference] = useState<'library' | 'generate' | 'skip' | null>(null);
  const [avatarYesMessage, setAvatarYesMessage] = useState<boolean>(false); // Track if user selected "yes"
  // Avatar selection state
  const [activeAvatarTab, setActiveAvatarTab] = useState<'library' | 'upload' | 'hire'>('library');
  const [avatars, setAvatars] = useState<any[]>([]);
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [showAvatarPreview, setShowAvatarPreview] = useState(false);
  const [previewAvatar, setPreviewAvatar] = useState<any | null>(null);
  const [loadingAvatars, setLoadingAvatars] = useState(false);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const [previewImageFailed, setPreviewImageFailed] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<any | null>(null); // Store selected avatar object for preview
  const [avatarConfirmed, setAvatarConfirmed] = useState<boolean>(false); // Track if avatar is confirmed and ready to proceed
  const [avatarSubstep, setAvatarSubstep] = useState<AvatarSubstep>('question'); // Track avatar selection substep
  const [selectedAvatarVisualStyle, setSelectedAvatarVisualStyle] = useState<AvatarVisualStylePresetId | null>(null);
  // Avatar text-to-image generation state
  const [avatarDescription, setAvatarDescription] = useState<string>('');
  const [isGeneratingAvatarFromText, setIsGeneratingAvatarFromText] = useState<boolean>(false);
  const [avatarGenerationError, setAvatarGenerationError] = useState<string | null>(null);
  const [avatarDescriptionFocused, setAvatarDescriptionFocused] = useState<boolean>(false);
  // Avatar upload state
  const [avatarUploadFile, setAvatarUploadFile] = useState<File | null>(null);
  const [avatarUploadPreview, setAvatarUploadPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState<boolean>(false);
  const [avatarUploadSuccess, setAvatarUploadSuccess] = useState<boolean>(false);
  const [avatarImageKey, setAvatarImageKey] = useState<string | null>(null);
  const [avatarAssetId, setAvatarAssetId] = useState<string | null>(null);
  const [avatarCreationStarted, setAvatarCreationStarted] = useState<boolean>(false);
  const [avatarUploadMessageShown, setAvatarUploadMessageShown] = useState<boolean>(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [pendingAvatarPreview, setPendingAvatarPreview] = useState<string | null>(null);
  // Avatar preview state (new substep after visual-style)
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarPreviewOriginalUrl, setAvatarPreviewOriginalUrl] = useState<string | null>(null);
  const [avatarPreviewImageKey, setAvatarPreviewImageKey] = useState<string | null>(null);
  const [isGeneratingAvatarPreview, setIsGeneratingAvatarPreview] = useState<boolean>(false);
  const [avatarPreviewModalOpen, setAvatarPreviewModalOpen] = useState(false);
  // Avatar-only video rendering state (for direct rendering in AI chat)
  const [isRenderingVideo, setIsRenderingVideo] = useState<boolean>(false);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [previewPlaybackUrl, setPreviewPlaybackUrl] = useState<string | null>(null);
  const [previewPreparing, setPreviewPreparing] = useState(false);
  const [previewGenerationError, setPreviewGenerationError] = useState<string | null>(null);
  // Voice selection state
  const [voicePreference, setVoicePreference] = useState<'yes' | 'no' | null>(null);
  const [voiceYesMessage, setVoiceYesMessage] = useState<boolean>(false);
  const [voiceConfirmed, setVoiceConfirmed] = useState<boolean>(false); // Track if voice is confirmed and ready to proceed
  const [voiceSubstep, setVoiceSubstep] = useState<VoiceSubstep>('question'); // Track voice selection substep
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(null);
  const [activeVoiceTab, setActiveVoiceTab] = useState<'library' | 'upload' | 'record'>('library');
  const [voices, setVoices] = useState<any[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  // Voice cloning state
  const [voiceCloneMode, setVoiceCloneMode] = useState<'upload' | 'record' | null>(null);
  const [voiceCloneFile, setVoiceCloneFile] = useState<File | null>(null);
  const [voiceCloneAudioUrl, setVoiceCloneAudioUrl] = useState<string | null>(null);
  const [voiceCloneName, setVoiceCloneName] = useState<string>('');
  const [voiceRecording, setVoiceRecording] = useState<boolean>(false);
  const [voiceCloning, setVoiceCloning] = useState<boolean>(false);
  const [voiceRemoveBackgroundNoise, setVoiceRemoveBackgroundNoise] = useState<boolean>(false);
  const [voiceUploadSuccess, setVoiceUploadSuccess] = useState<boolean>(false);
  const [pendingVoiceFile, setPendingVoiceFile] = useState<File | null>(null);
  const [pendingVoicePreview, setPendingVoicePreview] = useState<string | null>(null);
  const [pendingVoiceName, setPendingVoiceName] = useState<string>('');
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatBottomSentinelRef = useRef<HTMLDivElement>(null);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const productImagesInputRef = useRef<HTMLInputElement>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const voiceFileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Manual per-scene recording state
  const [manualAudioByScene, setManualAudioByScene] = useState<Record<number, ManualSceneAudioState>>({});
  const [manualRecordingScene, setManualRecordingScene] = useState<number | null>(null);
  const [manualRecording, setManualRecording] = useState<boolean>(false);
  const [manualRecordingError, setManualRecordingError] = useState<string | null>(null);
  const manualMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const manualRecordingStreamRef = useRef<MediaStream | null>(null);
  const manualAudioChunksRef = useRef<Blob[]>([]);
  const [manualPlayingScene, setManualPlayingScene] = useState<number | null>(null);
  const manualPlaybackAudioRef = useRef<HTMLAudioElement | null>(null);
  const manualAudioContextRef = useRef<AudioContext | null>(null);
  const manualAnalyserRef = useRef<AnalyserNode | null>(null);
  const manualVisualizerRafRef = useRef<number | null>(null);
  const manualVisualizerLastUpdateRef = useRef<number>(0);
  const [manualVisualizerLevels, setManualVisualizerLevels] = useState<number[]>([]);
  const [manualPlaybackProgress, setManualPlaybackProgress] = useState<Record<number, number>>({});
  const manualVisualizerContainerRef = useRef<HTMLDivElement | null>(null);
  const [manualVisualizerLaneCount, setManualVisualizerLaneCount] =
    useState<number>(64);
  const manualUploadInputRef = useRef<HTMLInputElement | null>(null);
  const manualUploadSceneRef = useRef<number | null>(null);
  const manualSaveOnStopRef = useRef<boolean>(false);
  const manualPausedPositionBySceneRef = useRef<Record<number, number>>({});
  
  // Input recording state (Speech-to-Text for script input)
  const [isInputRecording, setIsInputRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const inputMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const inputRecordingStreamRef = useRef<MediaStream | null>(null);
  const inputAudioChunksRef = useRef<Blob[]>([]);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputVisualizerRafRef = useRef<number | null>(null);
  const inputVisualizerLastUpdateRef = useRef<number>(0);
  const [inputVisualizerLevels, setInputVisualizerLevels] = useState<number[]>([]);
  const inputVisualizerContainerRef = useRef<HTMLDivElement | null>(null);
  const [inputVisualizerLaneCount, setInputVisualizerLaneCount] = useState<number>(64);

  // Avatar description recording state (speech-to-text for avatar step)
  const [avatarDescriptionRecording, setAvatarDescriptionRecording] = useState(false);
  const avatarMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const avatarRecordingStreamRef = useRef<MediaStream | null>(null);
  const avatarAudioChunksRef = useRef<Blob[]>([]);
  const avatarAudioContextRef = useRef<AudioContext | null>(null);
  const avatarAnalyserRef = useRef<AnalyserNode | null>(null);
  const avatarVisualizerRafRef = useRef<number | null>(null);
  const avatarVisualizerLastUpdateRef = useRef<number>(0);
  const [avatarDescriptionVisualizerLevels, setAvatarDescriptionVisualizerLevels] = useState<number[]>([]);
  const avatarVisualizerContainerRef = useRef<HTMLDivElement | null>(null);
  const AVATAR_VISUALIZER_HISTORY_LENGTH = 64;
  
  // Voice transformation state (Speech-to-Speech)
  // Note: showVoiceTransformQuestion is now derived from voiceSubstep === 'voice-transform' || voiceSubstep === 'scene-review'
  // Note: showSceneTransformView is now derived from voiceSubstep === 'scene-review'
  const [isTransformingVoice, setIsTransformingVoice] = useState(false);
  const [voiceTransformSettings, setVoiceTransformSettings] = useState<{
    voiceId: string;
    stability: number;
    similarityBoost: number;
    style: number;
    useSpeakerBoost: boolean;
    removeBackgroundNoise: boolean;
  } | null>(null);
  const [transformedAudioByScene, setTransformedAudioByScene] = useState<Record<number, {
    status: 'pending' | 'processing' | 'completed' | 'error';
    originalUrl?: string;
    transformedUrl?: string;
    duration?: number;
    settings?: {
      voiceId: string;
      stability: number;
      similarityBoost: number;
      style: number;
      useSpeakerBoost: boolean;
      removeBackgroundNoise: boolean;
    };
    error?: string;
  }>>({});
  const [stsVoices, setStsVoices] = useState<any[]>([]);
  const [selectedStsVoiceId, setSelectedStsVoiceId] = useState<string | null>(null);
  const [stsVoicesLoading, setStsVoicesLoading] = useState(false);
  const [isVoiceDropdownOpen, setIsVoiceDropdownOpen] = useState(false);
  const voiceDropdownRef = useRef<HTMLDivElement>(null);
  const [transformActionMessage, setTransformActionMessage] = useState<'skip' | 'transform' | null>(null);
  const [perSceneTransformModal, setPerSceneTransformModal] = useState<{
    isOpen: boolean;
    sceneNumber: number | null;
    voiceoverText: string;
  }>({ isOpen: false, sceneNumber: null, voiceoverText: '' });
  const [perSceneSettings, setPerSceneSettings] = useState<{
    voiceId: string;
    stability: number;
    similarityBoost: number;
    style: number;
    useSpeakerBoost: boolean;
    removeBackgroundNoise: boolean;
  } | null>(null);
  const [isTransformingSingleScene, setIsTransformingSingleScene] = useState(false);
  const [isModalVoiceDropdownOpen, setIsModalVoiceDropdownOpen] = useState(false);
  const modalVoiceDropdownRef = useRef<HTMLDivElement>(null);
  
  // Review section audio playback state
  const [reviewPlayingScene, setReviewPlayingScene] = useState<number | null>(null);
  const [reviewPlayingType, setReviewPlayingType] = useState<'original' | 'transformed' | null>(null);
  const reviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [reviewPlaybackProgress, setReviewPlaybackProgress] = useState<Record<number, number>>({});
  
  // B-roll source selection state
  // 'ai' = AI-generated visuals, 'stock' = manual stock selection, 'upload' = user uploads only
  // 'stock-auto' kept for legacy/backwards compatibility
  const [brollSourcePreference, setBrollSourcePreference] = useState<'ai' | 'stock' | 'upload' | 'stock-auto' | null>(null);
  const [isAutoSelectingStock, setIsAutoSelectingStock] = useState(false);
  const [stockDownloadProgress, setStockDownloadProgress] = useState(0);
  const stockJobsCompleteRef = useRef(false);
  const [brollSourceConfirmed, setBrollSourceConfirmed] = useState(false);
  const [manualBrollByScene, setManualBrollByScene] = useState<Record<number, {
    type: 'stock-image' | 'stock-video' | 'upload-image' | 'upload-video';
    url: string;
    thumbnailUrl?: string;
    id: string;
    source: 'stock-image' | 'stock-video' | 'upload-image' | 'upload-video';
    file?: File; // Original file for uploads (used for server-side upload)
  } | null>>({});
  const [brollModalOpen, setBrollModalOpen] = useState(false);
  const [brollModalSceneNumber, setBrollModalSceneNumber] = useState(1);
  
  // Style selection state
  const [selectedVideoStyle, setSelectedVideoStyle] = useState<VideoStyle | null>(null);
  const [styleSubstep, setStyleSubstep] = useState<StyleSubstep>('selection');
  // Script/Language selection state
  const [selectedLanguage, setSelectedLanguage] = useState<'english' | 'hindi' | 'hinglish' | null>(null);
  const [selectedVideoDuration, setSelectedVideoDuration] = useState<VideoDurationChoice>('30 seconds');
  const [scriptSubstep, setScriptSubstep] = useState<ScriptSubstep>('language');
  const [extractedTags, setExtractedTags] = useState<string[]>([]);
  // Generation tracking state
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [isGeneratingBroll, setIsGeneratingBroll] = useState(false);
  const [isProcessingManualAudio, setIsProcessingManualAudio] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const audioJobIdRef = useRef<string | null>(null); // Use ref instead of state to avoid closure issues
  const imageJobIdsRef = useRef<Set<string>>(new Set());
  const stockJobIdsRef = useRef<Set<string>>(new Set()); // Track stock download job IDs
  const loadingProjectIdRef = useRef<string | null>(null); // Guard against concurrent/duplicate project loads
  const allScenesHaveVideosRef = useRef<boolean>(false); // Track if all manual selections are videos (for navigation)

  // Fetch user profile when authenticated
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      apiClient.getProfile()
        .then((response) => {
          if (response.data) {
            setUser(response.data);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch user profile:', err);
        });
    }
  }, [isAuthenticated]);

  // Restore language from sessionStorage only for existing projects, clear for new projects
  useEffect(() => {
    const projectIdParam = searchParams?.get('projectId');
    if (typeof window !== 'undefined') {
      if (projectIdParam) {
        // Existing project - language will be restored from project metadata in loadProject
        // Don't restore from sessionStorage here to avoid conflicts
      } else {
        // New project - clear any stored language to start fresh
        sessionStorage.removeItem('selectedScriptLanguage');
        if (selectedLanguage) {
          setSelectedLanguage(null);
          setScriptSubstep('language');
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // AuthGuard shows LoginModal overlay when not authenticated - no redirect to /login

  // NOTE: Beforeunload alert removed - audio is immediately uploaded to the server
  // on recording completion, so there's no risk of losing unsaved work.
  // The previous implementation incorrectly triggered on every reload because
  // manualRecording is a boolean (not nullable), and `false !== null` is always true.

  // Load project if projectId exists in URL (resume functionality)
  useEffect(() => {
    const loadProject = async () => {
      const projectIdParam = searchParams?.get('projectId');
      if (!projectIdParam || !isAuthenticated || isLoading) return;
      
      // Don't reload if we already have this projectId loaded
      if (projectId === projectIdParam) return;
      
      // Guard against concurrent loads of the same project (prevents duplicate toasts)
      if (loadingProjectIdRef.current === projectIdParam) return;
      loadingProjectIdRef.current = projectIdParam;
      
      try {
        const response = await apiClient.getVideoProject(projectIdParam);
        if (response.success && response.data) {
          const project = response.data;
          
          // Only restore if it's an AI chat flow project
          if (project.metadata?.generationFlow === 'AI_CHAT') {
            setProjectId(project.id);
            
            // Restore script
            if (project.script) {
              const script = typeof project.script === 'string' 
                ? JSON.parse(project.script) 
                : project.script;
              setGeneratedScript(script);
              
              // Restore formatted script
              if (project.metadata?.formattedScript) {
                setFormattedScript(project.metadata.formattedScript);
              }
            }
            
            // Restore assets
            if (project.metadata?.assets) {
              const assets = typeof project.metadata.assets === 'string'
                ? JSON.parse(project.metadata.assets)
                : project.metadata.assets;
              setAttachedAssets(assets || []);
            }
            
            // Restore selected option
            if (project.metadata?.selectedOption) {
              setSelectedOption(project.metadata.selectedOption);
            }
            
            // Restore user script message
            if (project.metadata?.userScriptMessage) {
              setUserScriptMessage(project.metadata.userScriptMessage);
            }
            
            // If we have assets but no script and no aiChatStep, restore to assets-attached step
            const hasAssets = project.metadata?.assets && 
              (Array.isArray(project.metadata.assets) ? project.metadata.assets.length > 0 : true);
            const hasScript = project.script && 
              (typeof project.script === 'string' ? JSON.parse(project.script) : project.script);
            if (hasAssets && !hasScript && !project.metadata?.aiChatStep) {
              // Set step to assets-attached if we have assets but no script
              setCurrentStep('assets-attached');
            }
            
            // Restore avatar
            if (project.avatarId) {
              setSelectedAvatarId(project.avatarId);
              setAvatarPreference('library');
              setAvatarYesMessage(true);
            }
            
            // Restore voice
            if (project.voiceId) {
              setSelectedVoiceId(project.voiceId);
              setVoicePreference('yes');
              setVoiceYesMessage(true);
            }

            // Restore voice mode (AI vs MANUAL) if present
            const metaVoiceMode = project.metadata?.voiceMode as VoiceMode | undefined;
            if (metaVoiceMode === 'AI' || metaVoiceMode === 'MANUAL') {
              setVoiceMode(metaVoiceMode);
            } else if (project.voiceId) {
              setVoiceMode('AI');
            } else if (project.audioFiles && Array.isArray(project.audioFiles) && project.audioFiles.length > 0) {
              setVoiceMode('MANUAL');
            }

            // Restore manual recordings from project.audioFiles when voiceMode is MANUAL
            if ((metaVoiceMode === 'MANUAL' || (project.audioFiles && Array.isArray(project.audioFiles) && project.audioFiles.length > 0 && !project.voiceId)) &&
                project.audioFiles && Array.isArray(project.audioFiles) && project.audioFiles.length > 0) {
              const manualMap: Record<number, { status: 'uploaded'; duration?: number; localUrl?: string }> = {};
              for (const entry of project.audioFiles as any[]) {
                const sn = entry.sceneNumber;
                if (sn != null) {
                  manualMap[sn] = {
                    status: 'uploaded',
                    duration: entry.duration,
                    localUrl: entry.publicUrl || entry.gcsUrl || entry.localUrl,
                  };
                }
              }
              setManualAudioByScene(manualMap);
            }
            
            // Restore style
            if (project.style) {
              const styleMap: Record<string, VideoStyle> = {
                'HALF_N_HALF': 'half-n-half',
                'ALTERNATE': 'alternate',
                'AVATAR_CUTOUT': 'avatar-cutout',
                'AVATAR_ONLY': 'avatar-only',
                'PRODUCT_ONLY': 'product-only',
                'AVATAR_PRODUCT': 'avatar-product',
                'ANIMATED_AVATAR': 'animated-avatar',
                'B_ROLL_ONLY': 'broll-only',
              };
              const frontendStyle = styleMap[project.style];
              if (frontendStyle) {
                setSelectedVideoStyle(frontendStyle);
              }
            }
            
            // Also check metadata for selectedVideoStyle (in case it's stored there)
            if (project.metadata?.selectedVideoStyle && !project.style) {
              setSelectedVideoStyle(project.metadata.selectedVideoStyle as VideoStyle);
            }
            
            // Restore step and substeps
            if (project.metadata?.aiChatStep) {
              let restoredStep = project.metadata.aiChatStep as ChatStep;
              
              // If restored step is avatar-selection but style is product-only, skip to voice-selection
              const restoredStyle = project.metadata?.selectedVideoStyle || 
                (project.style ? (() => {
                  const styleMap: Record<string, VideoStyle> = {
                    'HALF_N_HALF': 'half-n-half',
                    'ALTERNATE': 'alternate',
                    'AVATAR_CUTOUT': 'avatar-cutout',
                    'AVATAR_ONLY': 'avatar-only',
                    'PRODUCT_ONLY': 'product-only',
                    'AVATAR_PRODUCT': 'avatar-product',
                    'ANIMATED_AVATAR': 'animated-avatar',
                    'B_ROLL_ONLY': 'broll-only',
                  };
                  return styleMap[project.style];
                })() : null);
              
              if (restoredStep === 'avatar-selection' && (restoredStyle === 'product-only' || restoredStyle === 'broll-only')) {
                restoredStep = 'voice-selection';
                // Set avatar preference to 'skip' for product-only and broll-only
                setAvatarPreference('skip');
                if (typeof window !== 'undefined') {
                  sessionStorage.setItem('avatarPreference', 'skip');
                }
              }
              
              // If restoring from workspace, navigate directly to workspace page
              if (restoredStep === 'workspace') {
                console.log('[AIChat] Restoring to workspace, navigating to workspace page');
                router.replace(`/create-video/workspace?projectId=${project.id}`);
                return; // Don't restore to workspace step in chat
              }
              
              // Check if we're restoring from audio-image-generation step
              // If generation is already complete, navigate to workspace instead
              if (restoredStep === 'audio-image-generation') {
                const hasAudio = project.audioFiles && Array.isArray(project.audioFiles) && project.audioFiles.length > 0;
                const hasImages = project.bRollImages && Array.isArray(project.bRollImages) && project.bRollImages.length > 0;
                const scriptScenes = project.script 
                  ? (typeof project.script === 'string' ? JSON.parse(project.script) : project.script)
                  : null;
                const expectedSceneCount = scriptScenes?.scenes?.length || 0;
                const actualImageCount = project.bRollImages?.length || 0;
                
                // If both audio and images exist (and images match scene count), generation is complete
                if (hasAudio && hasImages && actualImageCount >= expectedSceneCount) {
                  console.log('[AIChat] Generation already complete, navigating to workspace');
                  // Use router.replace instead of push to avoid back button issues
                  router.replace(`/create-video/workspace?projectId=${project.id}`);
                  return; // Don't restore to audio-image-generation step
                } else {
                  // Generation not complete, restore to voice-selection with confirmed substep
                  // This allows user to see what was selected and potentially go back
                  console.log('[AIChat] Generation not complete, restoring to voice-selection');
                  setCurrentStep('voice-selection');
                  setVoiceSubstep('confirmed');
                }
              } else {
                // Set the step AFTER all other state is restored
                setCurrentStep(restoredStep);
              }
            }
            if (project.metadata?.aiChatAvatarSubstep) {
              setAvatarSubstep(project.metadata.aiChatAvatarSubstep as AvatarSubstep);
            }
            if (project.metadata?.aiChatAvatarPreference) {
              setAvatarPreference(
                project.metadata.aiChatAvatarPreference as 'library' | 'generate' | 'skip',
              );
            } else if (
              project.metadata?.aiChatAvatarSubstep &&
              ['generate-visual-style', 'text-generation', 'avatar-preview'].includes(
                project.metadata.aiChatAvatarSubstep as string,
              )
            ) {
              setAvatarPreference('generate');
            }
            if (project.metadata?.avatarVisualStylePreset) {
              setSelectedAvatarVisualStyle(project.metadata.avatarVisualStylePreset as AvatarVisualStylePresetId);
            }
            // Restore avatar preview state
            if (project.metadata?.avatarPreviewUrl) {
              setAvatarPreviewUrl(project.metadata.avatarPreviewUrl as string);
            }
            if (project.metadata?.avatarPreviewOriginalUrl) {
              setAvatarPreviewOriginalUrl(project.metadata.avatarPreviewOriginalUrl as string);
            }
            if (project.metadata?.generatedAvatarImageKey) {
              setAvatarPreviewImageKey(project.metadata.generatedAvatarImageKey as string);
            }
            if (project.metadata?.aiChatVoiceSubstep) {
              setVoiceSubstep(project.metadata.aiChatVoiceSubstep as VoiceSubstep);
            }
            // Restore voice transformation state
            if (project.metadata?.transformedAudioByScene) {
              setTransformedAudioByScene(project.metadata.transformedAudioByScene);
            }
            if (project.metadata?.selectedStsVoiceId) {
              setSelectedStsVoiceId(project.metadata.selectedStsVoiceId);
            }
            if (project.metadata?.voiceTransformSettings) {
              setVoiceTransformSettings(project.metadata.voiceTransformSettings);
            }
            // Handle transform action message restoration with stuck state prevention
            // Only restore transformActionMessage if we can also transition to scene-review
            // Otherwise, the user gets stuck with a message but no options
            if (project.metadata?.transformActionMessage) {
              const savedAction = project.metadata.transformActionMessage as 'skip' | 'transform';
              const hasTransformedAudio = project.metadata?.transformedAudioByScene && 
                Object.values(project.metadata.transformedAudioByScene as Record<string, { status: string }>).some(
                  (entry) => entry.status === 'completed'
                );
              const usedSkip = savedAction === 'skip';
              
              // Only restore the action message AND transition to scene-review together
              // This prevents the stuck state where action is shown but scene-review isn't
              if (usedSkip || hasTransformedAudio) {
                setTransformActionMessage(savedAction);
                setVoiceSubstep('scene-review');
              }
              // If neither condition is met, don't restore transformActionMessage
              // This lets the user re-select their action (transformation may have failed/been interrupted)
            }
            if (project.metadata?.aiChatStyleSubstep) {
              setStyleSubstep(project.metadata.aiChatStyleSubstep as StyleSubstep);
            }
            if (project.metadata?.aiChatScriptSubstep) {
              setScriptSubstep(project.metadata.aiChatScriptSubstep as ScriptSubstep);
            }
            
            // Restore language selection
            if (project.metadata?.selectedLanguage) {
              setSelectedLanguage(project.metadata.selectedLanguage as 'english' | 'hindi' | 'hinglish');
              if (!project.metadata?.aiChatScriptSubstep) {
                setScriptSubstep('input');
              }
            }

            const savedDur = project.metadata?.selectedVideoDuration as string | undefined;
            if (
              savedDur === '30 seconds' ||
              savedDur === '45 seconds' ||
              savedDur === '1 minute' ||
              savedDur === '90 seconds'
            ) {
              setSelectedVideoDuration(savedDur as VideoDurationChoice);
            }
            
            // Restore extracted tags
            if (project.metadata?.extractedTags && Array.isArray(project.metadata.extractedTags)) {
              setExtractedTags(project.metadata.extractedTags);
            }
            
            // Restore voice clone name
            if (project.metadata?.voiceCloneName) {
              setVoiceCloneName(project.metadata.voiceCloneName);
            }
            
            // Restore avatar upload state
            if (project.metadata?.avatarUploadStatus) {
              setAvatarUploadMessageShown(true);
              if (project.metadata.avatarUploadStatus === 'creating') {
                setAvatarCreationStarted(true);
                setAvatarUploadSuccess(true);
              }
            }
            
            showToast('Project resumed successfully', 'success');
          } else {
            // Not an AI chat project – show local error instead of redirecting to classic flow
            setLoadError('This project was created with the classic flow and cannot be edited in AI Chat.');
          }
        }
      } catch (error: any) {
        console.error('Failed to load project:', error);
        showToast('Failed to load project', 'error');
      } finally {
        // Clear loading guard after completion
        loadingProjectIdRef.current = null;
      }
    };
    
    loadProject();
  }, [searchParams, isAuthenticated, isLoading, projectId, router]);

  // Load avatars/voices when resuming to selection substeps (after project is loaded)
  useEffect(() => {
    if (projectId && currentStep === 'avatar-selection' && avatarSubstep === 'selection' && avatars.length === 0 && avatarYesMessage) {
      loadAvatars(activeAvatarTab);
    }
  }, [projectId, currentStep, avatarSubstep, avatars.length, activeAvatarTab, avatarYesMessage]);

  useEffect(() => {
    if (projectId && currentStep === 'voice-selection' && voiceSubstep === 'selection' && voices.length === 0 && voiceYesMessage) {
      loadVoices(activeVoiceTab);
    }
  }, [projectId, currentStep, voiceSubstep, voices.length, activeVoiceTab, voiceYesMessage]);

  // Auto-scroll to bottom on initial mount
  useEffect(() => {
    if (chatContainerRef.current) {
      // Scroll to bottom on initial load with smooth behavior
      setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 100);
    }
  }, []); // Run only on mount

  // Auto-scroll to bottom when content changes (new messages/steps)
  useEffect(() => {
    const t = setTimeout(() => {
      const sentinel = chatBottomSentinelRef.current;
      if (sentinel) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            sentinel.scrollIntoView({ block: 'end', behavior: 'smooth' });
          });
        });
        return;
      }
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
    }, 120);
    return () => clearTimeout(t);
  }, [
    currentStep,
    selectedOption,
    attachedAssets,
    pendingAssets,
    generatedScript,
    formattedScript,
    proceedConfirmed,
    avatarYesMessage,
    avatars,
    selectedAvatarId,
    selectedAvatar,
    avatarConfirmed,
    avatarSubstep,
    selectedAvatarVisualStyle,
    avatarPreviewUrl,
    isGeneratingAvatarPreview,
    voiceYesMessage,
    voices,
    selectedVoiceId,
    voiceConfirmed,
    voiceSubstep,
    selectedVideoStyle,
    styleSubstep,
    transformActionMessage,
    stsVoices,
    selectedStsVoiceId,
    isTransformingVoice,
    manualAudioByScene,
    transformedAudioByScene,
    scriptSubstep,
    selectedLanguage,
    selectedVideoDuration,
    userScriptMessage,
    scriptError,
    isGeneratingScript,
    avatarDescription,
    isGeneratingAvatarFromText,
  ]);

  // WebSocket effect for tracking generation progress
  const { subscribeToJob, unsubscribeFromJob } = useWebSocket({
    onJobStatusUpdate: (update) => {
      console.log('[AIChat] WebSocket update received:', {
        jobId: update.jobId,
        queueType: update.queueType,
        state: update.state,
        progress: update.progress,
        audioJobId: audioJobIdRef.current,
        imageJobIds: Array.from(imageJobIdsRef.current),
        matchesAudio: update.queueType === 'audio-generation' && update.jobId === audioJobIdRef.current,
        matchesImage: update.queueType === 'image-generation' && imageJobIdsRef.current.has(update.jobId),
      });

      if (update.queueType === 'audio-generation' && update.jobId === audioJobIdRef.current) {
        console.log('[AIChat] Processing audio generation update:', update.state);
        if (update.state === 'completed') {
          setIsGeneratingVoice(false);
          if (audioJobIdRef.current) {
            unsubscribeFromJob(audioJobIdRef.current);
            audioJobIdRef.current = null;
          }
          
          // Check if this is an avatar-only style that should trigger direct rendering
          const styleToCheck = selectedVideoStyle || 
            (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
          const isAvatarOnlyStyle = styleToCheck === 'avatar-only' || styleToCheck === 'AVATAR_ONLY' || 
                                     styleToCheck === 'animated-avatar' || styleToCheck === 'ANIMATED_AVATAR';
          
          if (isAvatarOnlyStyle && projectId) {
            // For avatar-only styles, trigger rendering directly
            console.log('[AIChat] Audio completed for avatar-only style, starting rendering');
            setGenerationProgress(30);
            startAvatarOnlyRendering(projectId);
          } else if (brollSourcePreference === 'stock-auto' && stockJobsCompleteRef.current && projectId) {
            // Stock-auto flow: both audio and stock downloads complete, navigate to workspace
            console.log('[AIChat] Audio completed and stock downloads done, navigating to workspace (videos tab)');
            setGenerationProgress(100);
            setTimeout(() => {
              router.push(`/create-video/workspace?projectId=${projectId}&startMode=videos`);
            }, 500);
          } else if (brollSourcePreference === 'stock-auto') {
            // Stock-auto flow: audio complete but still waiting for stock downloads
            console.log('[AIChat] Audio completed, waiting for stock downloads to finish');
            setGenerationProgress(prev => Math.min(prev + 50, 100));
          } else {
            // Normal flow - update progress for b-roll styles
            setGenerationProgress(prev => Math.min(prev + 50, 100));
          }
        } else if (update.state === 'failed') {
          setIsGeneratingVoice(false);
          showToast('Voice generation failed', 'error');
          if (audioJobIdRef.current) {
            unsubscribeFromJob(audioJobIdRef.current);
            audioJobIdRef.current = null;
          }
        } else if (update.progress !== undefined) {
          // Check if avatar-only for progress range
          const styleToCheck = selectedVideoStyle || 
            (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
          const isAvatarOnlyStyle = styleToCheck === 'avatar-only' || styleToCheck === 'AVATAR_ONLY' || 
                                     styleToCheck === 'animated-avatar' || styleToCheck === 'ANIMATED_AVATAR';
          
          if (isAvatarOnlyStyle) {
            // Update progress for voice (0-30% range for avatar-only)
            setGenerationProgress(update.progress * 0.3);
          } else {
          // Update progress for voice (0-50% range)
          setGenerationProgress(update.progress * 0.5);
          }
        }
      } else if (update.queueType === 'image-generation' && imageJobIdsRef.current.has(update.jobId)) {
        console.log('[AIChat] Processing image generation update:', update.state, 'Remaining jobs:', imageJobIdsRef.current.size);
        if (update.state === 'completed') {
          imageJobIdsRef.current.delete(update.jobId);
          if (imageJobIdsRef.current.size === 0 && !isGeneratingVoice) {
            setIsGeneratingBroll(false);
            setGenerationProgress(100);
            // Navigate to workspace page after a brief delay
            setTimeout(() => {
              if (projectId) {
                const startMode = allScenesHaveVideosRef.current ? 'videos' : 'images';
                console.log(`[AIChat] All generation complete, navigating to workspace (startMode=${startMode})`);
                router.push(`/create-video/workspace?projectId=${projectId}&startMode=${startMode}`);
              }
            }, 1000);
          }
        } else if (update.state === 'failed') {
          imageJobIdsRef.current.delete(update.jobId);
          showToast(`Image generation failed for a scene`, 'error');
          if (imageJobIdsRef.current.size === 0 && !isGeneratingVoice) {
            setIsGeneratingBroll(false);
          }
        } else if (update.progress !== undefined) {
          // Update progress for images (50-100% range, distributed across all images)
          const baseProgress = isGeneratingVoice ? 50 : 0;
          const remainingJobs = imageJobIdsRef.current.size;
          const imageProgress = remainingJobs > 0 
            ? (update.progress / remainingJobs) * 50
            : 0;
          setGenerationProgress(baseProgress + imageProgress);
        }
      } else {
        console.warn('[AIChat] WebSocket update received but not handled:', {
          jobId: update.jobId,
          queueType: update.queueType,
          audioJobId: audioJobIdRef.current,
          imageJobIds: Array.from(imageJobIdsRef.current),
        });
      }
    },
  });

  // Cleanup WebSocket subscriptions on unmount or when generation completes
  useEffect(() => {
    if (!isGeneratingVoice && !isGeneratingBroll) {
      if (audioJobIdRef.current) {
        unsubscribeFromJob(audioJobIdRef.current);
        audioJobIdRef.current = null;
      }
      imageJobIdsRef.current.forEach(jobId => {
        unsubscribeFromJob(jobId);
      });
      imageJobIdsRef.current.clear();
    }
  }, [isGeneratingVoice, isGeneratingBroll, unsubscribeFromJob]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (modalLogoAsset?.preview) {
        URL.revokeObjectURL(modalLogoAsset.preview);
      }
      modalProductImages.forEach(asset => {
        if (asset.preview) {
          URL.revokeObjectURL(asset.preview);
        }
      });
      pendingAssets.forEach(asset => {
        if (asset.preview) {
          URL.revokeObjectURL(asset.preview);
        }
      });
      attachedAssets.forEach(asset => {
        if (asset.preview) {
          URL.revokeObjectURL(asset.preview);
        }
      });
      if (previewAvatar?.preview) {
        URL.revokeObjectURL(previewAvatar.preview);
      }
      // Cleanup audio element
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.src = '';
        audioElementRef.current = null;
      }
    };
  }, []); // Only cleanup on unmount

  const handleOptionClick = (option: string) => {
    setSelectedOption(option);
    setCurrentStep('option-selected');
    // Auto-advance to style selection after a short delay
    setTimeout(() => {
      setCurrentStep('style-selection');
    }, 1000);
  };

  // Helper function to check if product image is required
  const isProductImageRequired = () => {
    const style = selectedVideoStyle || 
      (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
    return style === 'product-only' || style === 'avatar-product';
  };

  // Helper function to check if product image exists
  const hasProductImage = () => {
    return attachedAssets.some(asset => 
      asset.type === 'image' && asset.id.startsWith('product-')
    ) || pendingAssets.some(asset => 
      asset.type === 'image' && asset.id.startsWith('product-')
    );
  };

  const handleAddAssets = () => {
    // When opening modal, restore from pendingAssets if they exist
    // This allows user to see previously selected items and modify them
    if (pendingAssets.length > 0) {
      // Restore modal state from pendingAssets
      const logo = pendingAssets.find(a => a.id.startsWith('logo-'));
      const products = pendingAssets.filter(a => a.id.startsWith('product-'));
      const url = pendingAssets.find(a => a.id.startsWith('url-'));
      
      if (logo && logo.type === 'image') {
        setModalLogoAsset(logo);
      }
      if (products.length > 0) {
        setModalProductImages(products);
      }
      if (url && url.type === 'url') {
        // Use url.url first, fallback to url.name if url.url doesn't exist
        setModalCompanyUrl(url.url || url.name || '');
      }
    }
    
    setShowAddAssetsModal(true);
  };

  const handleSkipAssets = () => {
    // Validate product image requirement
    if (isProductImageRequired() && !hasProductImage()) {
      showToast('Product image is required for this video style. Please upload a product image.', 'error');
      return;
    }
    
    // Skip assets and move directly to script generation step
    setCurrentStep('assets-attached');
    // Clear any pending assets if user skipped
    pendingAssets.forEach(asset => {
      if (asset.preview) {
        URL.revokeObjectURL(asset.preview);
      }
    });
    setPendingAssets([]);
  };

  const handleCloseModal = () => {
    // Optionally clear modal state when closing without attaching
    // Or keep it so user can reopen and see previous selections
    // For now, we'll keep the modal state so user can continue editing
    setShowAddAssetsModal(false);
  };

  // Handler for logo upload (single image) - uses modal state
  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB');
        return;
      }
      
      // Validate file type (PNG or JPG only)
      if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
        alert('Please select a valid image file (PNG or JPG only)');
        return;
      }
      
      // Cleanup previous preview if exists
      if (modalLogoAsset?.preview) {
        URL.revokeObjectURL(modalLogoAsset.preview);
      }
      
      const previewUrl = URL.createObjectURL(file);
      setModalLogoAsset({
        id: `logo-${Date.now()}`,
        name: file.name,
        type: 'image',
        file,
        preview: previewUrl
      });
    } else {
      alert('Please select a valid image file (PNG or JPG)');
    }
    // Reset input so same file can be selected again
    if (logoFileInputRef.current) {
      logoFileInputRef.current.value = '';
    }
  };

  // Handler for product images upload (multiple images) - uses modal state
  const handleProductImagesUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const validFiles = files.filter(file => {
      const isValidType = file.type.startsWith('image/') && ['image/png', 'image/jpeg', 'image/jpg'].includes(file.type);
      const isValidSize = file.size <= 5 * 1024 * 1024;
      return isValidType && isValidSize;
    });
    
    if (validFiles.length !== files.length) {
      alert('Some files were invalid. Only PNG/JPG images under 5MB are allowed.');
    }
    
    if (validFiles.length === 0) {
      return;
    }
    
    const newAssets: Asset[] = validFiles.map(file => ({
      id: `product-${Date.now()}-${Math.random()}`,
      name: file.name,
      type: 'image',
      file,
      preview: URL.createObjectURL(file)
    }));
    
    setModalProductImages(prev => [...prev, ...newAssets]);
    // Reset input so same files can be selected again
    if (productImagesInputRef.current) {
      productImagesInputRef.current.value = '';
    }
  };

  // Handler for company URL (text input) - uses modal state
  const handleCompanyUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setModalCompanyUrl(event.target.value);
  };

  // Remove asset handlers - for modal state
  const removeModalLogo = () => {
    if (modalLogoAsset?.preview) {
      URL.revokeObjectURL(modalLogoAsset.preview);
    }
    setModalLogoAsset(null);
  };

  const removeModalProductImage = (id: string) => {
    setModalProductImages(prev => {
      const asset = prev.find(a => a.id === id);
      if (asset?.preview) {
        URL.revokeObjectURL(asset.preview);
      }
      return prev.filter(a => a.id !== id);
    });
  };

  // Remove from pending assets (typing area)
  const removePendingAsset = (id: string) => {
    setPendingAssets(prev => {
      const asset = prev.find(a => a.id === id);
      if (asset?.preview) {
        URL.revokeObjectURL(asset.preview);
      }
      return prev.filter(a => a.id !== id);
    });
  };

  // Remove from attached assets (chat display)
  const removeAttachedAsset = (id: string) => {
    setAttachedAssets(prev => {
      const asset = prev.find(a => a.id === id);
      if (asset?.preview) {
        URL.revokeObjectURL(asset.preview);
      }
      return prev.filter(a => a.id !== id);
    });
  };

  // Handler for "Attach" button in modal - moves assets from modal to typing area
  const handleAttachAssets = () => {
    // Collect all assets from modal state
    const assetsToAttach: Asset[] = [];
    
    if (modalLogoAsset) {
      assetsToAttach.push(modalLogoAsset);
    }
    
    assetsToAttach.push(...modalProductImages);
    
    if (modalCompanyUrl && modalCompanyUrl.trim()) {
      const trimmedUrl = modalCompanyUrl.trim();
      // Check if URL already exists in pendingAssets to preserve its ID
      // Match by URL value (name or url property) to preserve ID if user didn't change it
      const existingUrl = pendingAssets.find(a => 
        a.id.startsWith('url-') && 
        (a.url === trimmedUrl || a.name === trimmedUrl)
      );
      if (existingUrl) {
        // Preserve existing URL asset ID if URL value matches
        assetsToAttach.push({
          ...existingUrl,
          name: trimmedUrl,
          url: trimmedUrl
        });
      } else {
        // Create new URL asset with new ID
        assetsToAttach.push({
          id: `url-${Date.now()}`,
          name: trimmedUrl,
          type: 'url',
          url: trimmedUrl
        });
      }
    }
    
    if (assetsToAttach.length === 0) {
      alert('Please attach at least one asset');
      return;
    }
    
    // REPLACE pendingAssets with current modal state (don't merge)
    // This ensures removals in modal are reflected in typing area
    // Cleanup old pendingAssets that are no longer included
    setPendingAssets(prev => {
      const newAssetIds = new Set(assetsToAttach.map(a => a.id));
      // Cleanup previews from assets that are being removed
      prev.forEach(asset => {
        if (!newAssetIds.has(asset.id) && asset.preview) {
          URL.revokeObjectURL(asset.preview);
        }
      });
      return assetsToAttach;
    });
    
    // Clear modal state after attaching
    setModalLogoAsset(null);
    setModalProductImages([]);
    setModalCompanyUrl('');
    
    // Close modal
    setShowAddAssetsModal(false);
    
    // Don't advance step yet - wait for user to click send in typing area
  };

  // Handler for send button in typing area - moves assets from typing area to chat
  const handleSendAssets = async () => {
    if (pendingAssets.length === 0) {
      return;
    }
    
    // Validate product image requirement
    if (isProductImageRequired()) {
      const hasProduct = pendingAssets.some(asset => 
        asset.type === 'image' && asset.id.startsWith('product-')
      );
      if (!hasProduct) {
        showToast('Product image is required for this video style. Please upload a product image.', 'error');
        return;
      }
    }
    
    // Create a copy of pending assets for chat display
    const assetsToDisplay = [...pendingAssets];
    
    // Move assets from typing area to chat display
    setAttachedAssets(assetsToDisplay);
    
    // Clear typing area immediately
    setPendingAssets([]);
    
    // Create or update project with assets in metadata (triggers background analysis)
    try {
      // Prepare assets for backend (ensure all have public URLs)
      const assetsForBackend = await Promise.all(
        assetsToDisplay.map(async (asset) => {
          let assetUrl = asset.url;
          
          // If asset has a file, upload it to get a public URL
          if (asset.file) {
            try {
              if (asset.type === 'image') {
                showToast(`Uploading ${asset.name || 'asset'}...`, 'info');
                const uploadResponse = await apiClient.uploadProductImage(asset.file);
                if (uploadResponse.success && uploadResponse.data) {
                  assetUrl = uploadResponse.data.publicUrl;
                  // Update the asset with the public URL
                  asset.url = assetUrl;
                }
              }
            } catch (error) {
              console.error('Failed to upload asset:', error);
              // Continue - will try preview URL or skip if invalid
            }
          }
          
          // If asset has a preview URL (blob URL) but no public URL, upload it
          if (!assetUrl && asset.preview && asset.preview.startsWith('blob:')) {
            try {
              // Fetch the blob and upload it
              const response = await fetch(asset.preview);
              if (response.ok) {
                const blob = await response.blob();
                const file = new File([blob], asset.name || 'asset.jpg', { type: blob.type || 'image/jpeg' });
                showToast(`Uploading ${asset.name || 'asset'}...`, 'info');
                const uploadResponse = await apiClient.uploadProductImage(file);
                if (uploadResponse.success && uploadResponse.data) {
                  assetUrl = uploadResponse.data.publicUrl;
                  // Update the asset with the public URL
                  asset.url = assetUrl;
                }
              }
            } catch (error) {
              console.error('Failed to upload asset from preview:', error);
              // Continue - will skip if invalid
            }
          }
          
          // Determine category from asset ID or user-provided category
          let category = asset.category;
          if (!category) {
            if (asset.id.startsWith('logo-')) {
              category = 'logo';
            } else if (asset.id.startsWith('product-')) {
              category = 'product';
            } else {
              category = 'reference';
            }
          }
          
          return {
            id: asset.id,
            url: assetUrl || '',
            type: asset.type || 'image',
            category: category,
            label: asset.name || category,
            userLabel: category, // Pass category as userLabel for backend analysis
          };
        })
      );
      
      // Filter out assets without valid URLs (preview URLs won't work for analysis)
      const validAssets = assetsForBackend.filter(asset => {
        // Accept HTTP(S) URLs or local paths that will be converted
        return asset.url && (
          asset.url.startsWith('http://') || 
          asset.url.startsWith('https://') ||
          asset.url.startsWith('/uploads')
        );
      });
      
      if (validAssets.length > 0) {
        if (projectId) {
          // Update existing project with assets
          await apiClient.updateVideoProject(projectId, {
            metadata: {
              assets: validAssets,
              generationFlow: 'AI_CHAT',
              aiChatStep: 'assets-attached', // Save current step in metadata
            },
          });
          console.log(`[AIChat] Updated project ${projectId} with ${validAssets.length} assets`);
        } else {
          // Create new project with assets
          const createResponse = await apiClient.createVideoProject({
            videoType: 'WITHOUT_AVATAR', // Will be updated later
            currentStep: 'SCRIPT',
            metadata: {
              assets: validAssets,
              generationFlow: 'AI_CHAT',
              aiChatStep: 'assets-attached', // Save current step in metadata
            },
          });
          
          if (createResponse.success && createResponse.data) {
            const newProjectId = createResponse.data.id;
            setProjectId(newProjectId);
            console.log(`[AIChat] Created project ${newProjectId} with ${validAssets.length} assets`);
            
            // Update URL with projectId if needed
            if (typeof window !== 'undefined' && !window.location.search.includes('projectId')) {
              router.replace(`/create-video/ai-chat?projectId=${newProjectId}`, { scroll: false });
            }
          }
        }
      } else {
        console.warn('[AIChat] No valid asset URLs found, skipping project creation');
      }
    } catch (error: any) {
      console.error('Failed to save assets to project:', error);
      // Don't block user flow - assets will be saved later or analysis will happen on next step
      showToast('Assets attached. Analysis will happen in the background.', 'info');
    }
    
    // Note: We keep the preview URLs in attachedAssets, they will be cleaned up on unmount
    // Don't cleanup previews here as they're still needed for display in chat
    
    // Advance to next step: assets-attached
    setCurrentStep('assets-attached');
  };

  // Format script JSON for display
  const formatScriptForDisplay = (scriptData: any): string => {
    let formatted = '';
    
    if (scriptData.video_type) {
      formatted += `Video type: ${scriptData.video_type}\n`;
    }
    
    if (scriptData.duration) {
      formatted += `Duration: ${scriptData.duration}\n`;
    }

    const scenes = scriptData.scenes || scriptData.scene_plan || [];
    
    scenes.forEach((scene: any, index: number) => {
      const sceneNum = scene.scene_number || index + 1;
      const timeRange = scene.time_range || (index === 0 ? '0-5sec' : index === 1 ? '5-10 sec' : 'N/A');
      formatted += `\nScene ${sceneNum}: (${timeRange})\n`;
      
      if (scene.voiceover) {
        formatted += `Voiceover: ${scene.voiceover}\n`;
      }
      
      if (scene.broll_visual_description || scene.broll) {
        formatted += `Broll: ${scene.broll_visual_description || scene.broll}\n`;
      }
      
      if (scene.avatar_action || scene.avatar) {
        formatted += `Avatar: ${scene.avatar_action || scene.avatar}\n`;
      }
    });

    return formatted;
  };

  const getSceneArrayFromScript = (scriptData: any): any[] => {
    if (!scriptData || typeof scriptData !== 'object') return [];
    const scenes = scriptData.scenes || scriptData.scene_plan || [];
    return Array.isArray(scenes) ? scenes : [];
  };

  const getSceneNumber = (scene: any, index: number): number => {
    const value = scene?.scene_number ?? scene?.sceneNumber ?? index + 1;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : index + 1;
  };

  const getSceneVoiceover = (scene: any): string => String(scene?.voiceover ?? '');

  const getSceneBrollPrompt = (scene: any): string =>
    String(scene?.broll_visual_description ?? scene?.broll_prompt ?? scene?.broll_image_prompt ?? '');

  const normalizedSceneList = getSceneArrayFromScript(generatedScript).map((scene, index) => ({
    sceneNumber: getSceneNumber(scene, index),
    voiceover: getSceneVoiceover(scene),
    brollPrompt: getSceneBrollPrompt(scene),
  }));

  const applyEditableFieldsToScript = (
    scriptData: any,
    sceneNumber: number,
    patch: { voiceover: string; brollPrompt: string },
  ) => {
    if (!scriptData || typeof scriptData !== 'object') return scriptData;

    const key = Array.isArray(scriptData.scenes) ? 'scenes' : Array.isArray(scriptData.scene_plan) ? 'scene_plan' : null;
    if (!key) return scriptData;

    const clonedScript = { ...scriptData };
    const originalScenes = Array.isArray(clonedScript[key]) ? clonedScript[key] : [];
    clonedScript[key] = originalScenes.map((scene: any, index: number) => {
      if (getSceneNumber(scene, index) !== sceneNumber) return scene;

      const updatedScene = { ...scene };
      updatedScene.voiceover = patch.voiceover;

      if (Object.prototype.hasOwnProperty.call(updatedScene, 'broll_visual_description')) {
        updatedScene.broll_visual_description = patch.brollPrompt;
      } else if (Object.prototype.hasOwnProperty.call(updatedScene, 'broll_prompt')) {
        updatedScene.broll_prompt = patch.brollPrompt;
      } else if (Object.prototype.hasOwnProperty.call(updatedScene, 'broll_image_prompt')) {
        updatedScene.broll_image_prompt = patch.brollPrompt;
      } else {
        updatedScene.broll_visual_description = patch.brollPrompt;
      }

      return updatedScene;
    });

    return clonedScript;
  };

  const handleStartSceneEdit = (sceneNumber: number) => {
    const scene = normalizedSceneList.find((item) => item.sceneNumber === sceneNumber);
    if (!scene) return;

    setScriptSceneSaveError(null);
    setSceneDraftByNumber((prev) => ({
      ...prev,
      [sceneNumber]: {
        voiceover: scene.voiceover,
        brollPrompt: scene.brollPrompt,
      },
    }));
    setActiveSceneEditNumber(sceneNumber);
  };

  const handleSceneDraftChange = (
    sceneNumber: number,
    field: 'voiceover' | 'brollPrompt',
    value: string,
  ) => {
    setSceneDraftByNumber((prev) => ({
      ...prev,
      [sceneNumber]: {
        ...(prev[sceneNumber] || { voiceover: '', brollPrompt: '' }),
        [field]: value,
      },
    }));
  };

  const handleCancelSceneEdit = (sceneNumber: number) => {
    setScriptSceneSaveError(null);
    setSceneDraftByNumber((prev) => {
      const next = { ...prev };
      delete next[sceneNumber];
      return next;
    });
    setActiveSceneEditNumber((prev) => (prev === sceneNumber ? null : prev));
  };

  const handleSaveSceneEdit = async (sceneNumber: number) => {
    const draft = sceneDraftByNumber[sceneNumber];
    if (!draft || !generatedScript) return;

    if (!projectId) {
      setScriptSceneSaveError('Project is not ready yet. Please try again in a moment.');
      return;
    }
    if (!draft.voiceover.trim()) {
      setScriptSceneSaveError('Voiceover is required.');
      return;
    }
    if (draft.voiceover.length > 1200) {
      setScriptSceneSaveError('Voiceover is too long. Please keep it under 1200 characters.');
      return;
    }
    if (draft.brollPrompt.length > 1200) {
      setScriptSceneSaveError('B-roll prompt is too long. Please keep it under 1200 characters.');
      return;
    }
    try {
      setIsSavingScriptScene(true);
      setScriptSceneSaveError(null);
      const cleanedDraft = {
        voiceover: draft.voiceover.trim(),
        brollPrompt: draft.brollPrompt.trim(),
      };
      const updatedScript = applyEditableFieldsToScript(generatedScript, sceneNumber, cleanedDraft);
      setGeneratedScript(updatedScript);
      setFormattedScript(formatScriptForDisplay(updatedScript));

      await apiClient.updateVideoProject(projectId, {
        script: JSON.stringify(updatedScript),
      });

      setSceneDraftByNumber((prev) => {
        const next = { ...prev };
        delete next[sceneNumber];
        return next;
      });
      setActiveSceneEditNumber(null);
      showToast(`Scene ${sceneNumber} updated`, 'success');
    } catch (error: any) {
      console.error('Failed to save scene edits:', error);
      setScriptSceneSaveError(error?.message || 'Failed to save scene edits');
    } finally {
      setIsSavingScriptScene(false);
    }
  };

  // Auto-cancel scene edits when proceeding to next step
  useEffect(() => {
    if (proceedConfirmed || currentStep !== 'script-generated') {
      if (activeSceneEditNumber !== null) {
        setActiveSceneEditNumber(null);
        setSceneDraftByNumber({});
      }
    }
  }, [proceedConfirmed, currentStep, activeSceneEditNumber]);

  // Extract tags from input (e.g., @technology @professional)
  // Returns cleaned content (without @) and array of tags
  const extractTagsAndContent = (input: string): { content: string; tags: string[] } => {
    const tagRegex = /@(\w+)/g;
    const matches = Array.from(input.matchAll(tagRegex));
    const extracted = matches.map(match => match[1].toLowerCase().trim());
    // Replace @tag with just the tag word in content
    const content = input.replace(/@(\w+)/g, '$1').replace(/\s+/g, ' ').trim();
    return { content, tags: Array.from(new Set(extracted)) };
  };

  const handleSendScript = async () => {
    if (!scriptInput.trim()) return;
    
    const userMessage = scriptInput.trim();
    
    // Extract tags from input (e.g., @technology @professional)
    const { content: cleanedMessage, tags } = extractTagsAndContent(userMessage);
    setExtractedTags(tags);
    
    setUserScriptMessage(userMessage); // Keep original message with @ for display
    setScriptInput(''); // Clear input immediately to avoid duplicate display
    setIsGeneratingScript(true);
    setScriptError(null);
    
    // Advance to script-input step to show user message
    setCurrentStep('script-input');
    
    try {
      // Duration from AI chat sub-step (temporarily disabled: parsing from user message)
      // let duration = '30 seconds';
      // const durationMatch = userMessage.match(/(\d+)\s*(second|sec|minute|min)/i);
      // if (durationMatch) {
      //   const num = parseInt(durationMatch[1]);
      //   const unit = durationMatch[2].toLowerCase().startsWith('min') ? 'minutes' : 'seconds';
      //   duration = `${num} ${unit}`;
      // }
      const duration = selectedVideoDuration || '30 seconds';
      
      // Get selected style from state or sessionStorage
      const styleToUse = selectedVideoStyle || 
        (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
      
      // Map style to backend format
      const styleMap: Record<string, string> = {
        'half-n-half': 'HALF_N_HALF',
        'alternate': 'ALTERNATE',
        'avatar-cutout': 'AVATAR_CUTOUT',
        'avatar-only': 'AVATAR_ONLY',
        'product-only': 'PRODUCT_ONLY',
        'avatar-product': 'AVATAR_PRODUCT',
        'animated-avatar': 'ANIMATED_AVATAR',
        'broll-only': 'B_ROLL_ONLY',
      };
      
      // Extract product image URL from attached assets (if any)
      // Upload File to backend to get public URL (FAL storage in local, backend URL in prod)
      let productImageUrl: string | null = null;
      const productImageAsset = attachedAssets.find(asset => asset.type === 'image');
      if (productImageAsset) {
        if (productImageAsset.url && (productImageAsset.url.startsWith('http://') || productImageAsset.url.startsWith('https://'))) {
          // Already has a public HTTP(S) URL - use it directly
          productImageUrl = productImageAsset.url;
        } else if (productImageAsset.file) {
          // Upload File to backend to get public URL
          try {
            showToast('Uploading product image...', 'info');
            const uploadResponse = await apiClient.uploadProductImage(productImageAsset.file);
            
            if (uploadResponse.success && uploadResponse.data) {
              productImageUrl = uploadResponse.data.publicUrl;
              // Update the asset with the public URL for future reference
              productImageAsset.url = productImageUrl;
            } else {
              throw new Error(uploadResponse.message || 'Failed to upload product image');
            }
          } catch (error: any) {
            console.error('Failed to upload product image:', error);
            const errorMessage = error.response?.data?.message || error.message || 'Failed to upload product image. Please try again.';
            showToast(errorMessage, 'error');
            setIsGeneratingScript(false);
            return;
          }
        } else if (productImageAsset.preview) {
          // Fallback: try to fetch blob URL and upload it
          try {
            const response = await fetch(productImageAsset.preview);
            if (!response.ok) {
              throw new Error(`Failed to fetch image: ${response.statusText}`);
            }
            const blob = await response.blob();
            
            // Convert blob to File for upload
            const file = new File([blob], 'product-image.jpg', { type: blob.type || 'image/jpeg' });
            
            showToast('Uploading product image...', 'info');
            const uploadResponse = await apiClient.uploadProductImage(file);
            
            if (uploadResponse.success && uploadResponse.data) {
              productImageUrl = uploadResponse.data.publicUrl;
              // Update the asset with the public URL
              productImageAsset.url = productImageUrl;
            } else {
              throw new Error(uploadResponse.message || 'Failed to upload product image');
            }
          } catch (error: any) {
            console.error('Failed to upload product image from preview:', error);
            const errorMessage = error.response?.data?.message || error.message || 'Failed to upload product image. Please try uploading the image again.';
            showToast(errorMessage, 'error');
            setIsGeneratingScript(false);
            return;
          }
        }
      }
      
      // Validate product image is present if required
      if ((styleToUse === 'product-only' || styleToUse === 'avatar-product') && !productImageUrl) {
        showToast('Product image is required for this video style. Please upload a product image.', 'error');
        setIsGeneratingScript(false);
        return;
      }
      
      // Determine if avatar is being used
      // For product-only style, hasAvatar is always false
      // For avatar-product style, hasAvatar depends on avatarPreference
      // For other styles, hasAvatar depends on avatarPreference
      const hasAvatar = (styleToUse === 'product-only' || styleToUse === 'broll-only')
        ? false 
        : ((avatarPreference === 'library' || avatarPreference === 'generate') && selectedAvatar !== null);
      
      // Get avatar ID if available
      const avatarId = selectedAvatar || null;

      // Two creation points: (1) When user has assets, project is created at assets-attached.
      // If we have assets but no projectId (e.g. edge case), create project with assets first so script API can wait for analysis.
      let scriptProjectId = projectId ?? null;
      if (attachedAssets.length > 0 && !scriptProjectId) {
        try {
          const validAssetsForCreate = attachedAssets
            .filter(a => a.url && (a.url.startsWith('http://') || a.url.startsWith('https://') || a.url.startsWith('/uploads')))
            .map(asset => ({
              id: asset.id,
              url: asset.url || asset.preview || '',
              type: asset.type || 'image',
              category: asset.category || (asset.id.startsWith('logo-') ? 'logo' : asset.id.startsWith('product-') ? 'product' : 'reference'),
              label: asset.name || asset.category,
            }));
          const createResponse = await apiClient.createVideoProject({
            videoType: 'WITHOUT_AVATAR',
            currentStep: 'SCRIPT',
            metadata: {
              assets: validAssetsForCreate,
              generationFlow: 'AI_CHAT',
              aiChatStep: 'assets-attached',
            },
          });
          if (createResponse.success && createResponse.data) {
            const newProjectId = createResponse.data.id;
            setProjectId(newProjectId);
            scriptProjectId = newProjectId;
            if (typeof window !== 'undefined' && !window.location.search.includes('projectId')) {
              router.replace(`/create-video/ai-chat?projectId=${newProjectId}`, { scroll: false });
            }
            console.log(`[AIChat] Created project with assets before script so analysis can run; projectId=${newProjectId}`);
          }
        } catch (err: any) {
          console.error('Failed to create project with assets before script:', err);
          showToast('Could not create project with assets. Please try again.', 'error');
          setIsGeneratingScript(false);
          return;
        }
      }

      // Generate script WITH the selected style (backend waits for analysis when projectId is set)
      const response = await apiClient.generateVideoScript({
        userPrompt: cleanedMessage, // Use cleaned message (without @ symbols)
        videoStyle: styleToUse ? (styleMap[styleToUse] as any) : 'AVATAR_CUTOUT', // Use selected style, fallback only
        duration: duration,
        language: selectedLanguage || undefined, // Pass selected language
        tags: tags.length > 0 ? tags : undefined, // Pass extracted tags
        productImageUrl: productImageUrl || undefined,
        hasAvatar: hasAvatar,
        avatarId: avatarId || undefined,
        projectId: scriptProjectId || undefined, // Pass projectId so backend waits for analysis and uses it for script
      });

      if (response.success && response.data) {
        const { script: scriptData, formattedScript: formatted } = response.data;
        
        setGeneratedScript(scriptData);
        // Use formatted script from API, or format ourselves if not provided
        const displayScript = formatted || formatScriptForDisplay(scriptData);
        setFormattedScript(displayScript);
        
        // Create project only when user had no assets (second creation point). When user had assets we already have scriptProjectId and only update.
        if (!scriptProjectId) {
          if (attachedAssets.length === 0) {
            try {
              const createResponse = await apiClient.createVideoProject({
                videoType: hasAvatar ? 'WITH_AVATAR' : 'WITHOUT_AVATAR',
                script: JSON.stringify(scriptData),
                scriptGenerated: true,
                currentStep: 'SCRIPT',
                style: styleToUse ? (styleMap[styleToUse] as any) : undefined,
                metadata: {
                  generationFlow: 'AI_CHAT',
                  formattedScript: displayScript,
                  userScriptMessage: userMessage,
                  selectedOption: selectedOption,
                },
              });
              
              if (createResponse.success && createResponse.data) {
                const newProjectId = createResponse.data.id;
                setProjectId(newProjectId);
                console.log(`[AIChat] Created project after script (no assets): ${newProjectId}`);
                router.replace(`/create-video/ai-chat?projectId=${newProjectId}`, { scroll: false });
              }
            } catch (error: any) {
              console.error('Failed to create project after script generation:', error);
              showToast('Script generated but could not save project. Please try again.', 'error');
            }
          } else {
            console.error('[AIChat] Expected projectId when user had assets; create-with-assets before script may have failed.');
            showToast('Script generated but project could not be saved. Please try again.', 'error');
          }
        } else {
          // Update existing project with script (user had assets; project was created at assets-attached or just above)
          try {
            await apiClient.updateVideoProject(scriptProjectId, {
              script: JSON.stringify(scriptData),
              scriptGenerated: true,
              metadata: {
                generationFlow: 'AI_CHAT',
                aiChatStep: 'script-generated',
                formattedScript: displayScript,
                userScriptMessage: userMessage,
                selectedOption: selectedOption,
              },
            });
            console.log(`[AIChat] Updated project ${scriptProjectId} with script`);
          } catch (error: any) {
            console.error('Failed to update project with script:', error);
            showToast('Script generated but could not update project. Please try again.', 'error');
          }
        }
        
        // Store script temporarily in sessionStorage - will be saved to project after style selection
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('pendingScriptData', JSON.stringify(scriptData));
          sessionStorage.setItem('pendingScriptFormatted', displayScript);
          sessionStorage.setItem('pendingUserPrompt', userMessage);
        }
        
        // Advance to script-generated step
        setCurrentStep('script-generated');
        
        showToast('Script generated successfully!', 'success');
      } else {
        throw new Error(response.message || 'Failed to generate script');
      }
    } catch (error: any) {
      console.error('Failed to generate script:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to generate script. Please try again.';
      setScriptError(errorMessage);
      showToast(errorMessage, 'error');
      // Keep user on script-input step so they can retry
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleRegenerateScript = async () => {
    if (!userScriptMessage) {
      showToast('Please generate a script first before regenerating', 'warning');
      return;
    }
    
    setIsGeneratingScript(true);
    setScriptError(null);
    
    try {
      // Duration from AI chat sub-step (temporarily disabled: parsing from user message)
      // let duration = '30 seconds';
      // const durationMatch = userScriptMessage.match(/(\d+)\s*(second|sec|minute|min)/i);
      // if (durationMatch) { ... }
      const duration = selectedVideoDuration || '30 seconds';
      
      // Get selected style from state or sessionStorage
      const styleToUse = selectedVideoStyle || 
        (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
      
      // Map style to backend format
      const styleMap: Record<string, string> = {
        'half-n-half': 'HALF_N_HALF',
        'alternate': 'ALTERNATE',
        'avatar-cutout': 'AVATAR_CUTOUT',
        'avatar-only': 'AVATAR_ONLY',
        'product-only': 'PRODUCT_ONLY',
        'avatar-product': 'AVATAR_PRODUCT',
        'animated-avatar': 'ANIMATED_AVATAR',
        'broll-only': 'B_ROLL_ONLY',
      };
      
      // Extract product image URL from attached assets (if any)
      // Upload File to backend to get public URL (FAL storage in local, backend URL in prod)
      let productImageUrl: string | null = null;
      const productImageAsset = attachedAssets.find(asset => asset.type === 'image');
      if (productImageAsset) {
        if (productImageAsset.url && (productImageAsset.url.startsWith('http://') || productImageAsset.url.startsWith('https://'))) {
          // Already has a public HTTP(S) URL - use it directly
          productImageUrl = productImageAsset.url;
        } else if (productImageAsset.file) {
          // Upload File to backend to get public URL
          try {
            showToast('Uploading product image...', 'info');
            const uploadResponse = await apiClient.uploadProductImage(productImageAsset.file);
            
            if (uploadResponse.success && uploadResponse.data) {
              productImageUrl = uploadResponse.data.publicUrl;
              // Update the asset with the public URL for future reference
              productImageAsset.url = productImageUrl;
            } else {
              throw new Error(uploadResponse.message || 'Failed to upload product image');
            }
          } catch (error: any) {
            console.error('Failed to upload product image:', error);
            const errorMessage = error.response?.data?.message || error.message || 'Failed to upload product image. Please try again.';
            showToast(errorMessage, 'error');
            setIsGeneratingScript(false);
            return;
          }
        } else if (productImageAsset.preview) {
          // Fallback: try to fetch blob URL and upload it
          try {
            const response = await fetch(productImageAsset.preview);
            if (!response.ok) {
              throw new Error(`Failed to fetch image: ${response.statusText}`);
            }
            const blob = await response.blob();
            
            // Convert blob to File for upload
            const file = new File([blob], 'product-image.jpg', { type: blob.type || 'image/jpeg' });
            
            showToast('Uploading product image...', 'info');
            const uploadResponse = await apiClient.uploadProductImage(file);
            
            if (uploadResponse.success && uploadResponse.data) {
              productImageUrl = uploadResponse.data.publicUrl;
              // Update the asset with the public URL
              productImageAsset.url = productImageUrl;
            } else {
              throw new Error(uploadResponse.message || 'Failed to upload product image');
            }
          } catch (error: any) {
            console.error('Failed to upload product image from preview:', error);
            const errorMessage = error.response?.data?.message || error.message || 'Failed to upload product image. Please try uploading the image again.';
            showToast(errorMessage, 'error');
            setIsGeneratingScript(false);
            return;
          }
        }
      }
      
      // Validate product image is present if required
      if ((styleToUse === 'product-only' || styleToUse === 'avatar-product') && !productImageUrl) {
        showToast('Product image is required for this video style. Please upload a product image.', 'error');
        setIsGeneratingScript(false);
        return;
      }
      
      // Determine if avatar is being used
      // For product-only and broll-only styles, hasAvatar is always false
      const hasAvatar = (styleToUse === 'product-only' || styleToUse === 'broll-only') 
        ? false 
        : ((avatarPreference === 'library' || avatarPreference === 'generate') && selectedAvatar !== null);
      
      // Get avatar ID if available
      const avatarId = selectedAvatar || null;
      
      // Extract tags from the original user message for regeneration
      const { content: cleanedMessage, tags } = extractTagsAndContent(userScriptMessage);
      
      // Regenerate script WITH the selected style
      const response = await apiClient.generateVideoScript({
        userPrompt: cleanedMessage, // Use cleaned message (without @ symbols)
        videoStyle: styleToUse ? (styleMap[styleToUse] as any) : 'AVATAR_CUTOUT', // Use selected style, fallback only
        duration: duration,
        language: selectedLanguage || undefined, // Pass selected language
        tags: tags.length > 0 ? tags : (extractedTags.length > 0 ? extractedTags : undefined), // Use extracted tags from original or state
        productImageUrl: productImageUrl || undefined,
        hasAvatar: hasAvatar,
        avatarId: avatarId || undefined,
        projectId: projectId || undefined, // Pass projectId if it exists (created when assets were attached)
      });

      if (response.success && response.data) {
        const { script: scriptData, formattedScript: formatted } = response.data;
        
        setGeneratedScript(scriptData);
        const displayScript = formatted || formatScriptForDisplay(scriptData);
        setFormattedScript(displayScript);
        
        // Update project with regenerated script if project exists
        if (projectId) {
          try {
            await apiClient.updateVideoProject(projectId, {
              script: JSON.stringify(scriptData),
              scriptGenerated: true,
              metadata: {
                formattedScript: displayScript,
                userScriptMessage: userScriptMessage,
              },
            });
            console.log(`[AIChat] Updated project ${projectId} with regenerated script`);
          } catch (error: any) {
            console.error('Failed to update project with regenerated script:', error);
            // Don't block user flow
          }
        }
        
        // Update stored script in sessionStorage
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('pendingScriptData', JSON.stringify(scriptData));
          sessionStorage.setItem('pendingScriptFormatted', displayScript);
          sessionStorage.setItem('pendingUserPrompt', userScriptMessage);
        }
        
        showToast('Script regenerated! A new version of your script has been generated.', 'success');
      } else {
        throw new Error(response.message || 'Failed to regenerate script');
      }
    } catch (error: any) {
      console.error('Failed to regenerate script:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to regenerate script. Please try again.';
      setScriptError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleAvatarSelection = (preference: 'library' | 'generate' | 'skip') => {
    setAvatarPreference(preference);
    // Save preference to sessionStorage for later use
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('avatarPreference', preference);
    }
    
    if (preference === 'library') {
      setSelectedAvatarVisualStyle(null);
      setAvatarYesMessage(true);
      setAvatarSubstep('selection');
      loadAvatars(activeAvatarTab);
    } else if (preference === 'generate') {
      setSelectedAvatarVisualStyle(null);
      setAvatarYesMessage(true);
      setAvatarSubstep('generate-visual-style');
    }
    // Skip option removed from UI; product-only/broll-only still set avatarPreference to 'skip' for metadata
  };

  // Load avatars based on active tab
  const loadAvatars = async (tab: 'library' | 'upload' | 'hire') => {
    setLoadingAvatars(true);
    setFailedImageUrls(new Set()); // Clear failed URLs when loading new avatars
    try {
      let response;
      if (tab === 'library') {
        // Use getUserAvatars WITHOUT source filter to show all avatars (matches old behavior)
        // The old avatar selection page showed all user avatars in the library tab
        response = await apiClient.getUserAvatars();
      } else if (tab === 'upload') {
        // Use getUserAvatars with UPLOAD source filter to show only uploaded avatars
        response = await apiClient.getUserAvatars({ source: 'UPLOAD' });
      } else {
        // Hire tab - placeholder for now
        setAvatars([]);
        setLoadingAvatars(false);
        return;
      }
      
      if (response.success && response.data) {
        setAvatars(response.data);
      } else {
        setAvatars([]);
      }
    } catch (error: any) {
      console.error('Failed to load avatars:', error);
      setAvatars([]);
      showToast('Failed to load avatars. Please try again.', 'error');
    } finally {
      setLoadingAvatars(false);
    }
  };

  // Handle avatar file selection (only sets pending file, doesn't process)
  const handleAvatarFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.match(/image\/(jpeg|jpg|png)/)) {
      showToast('Please upload a JPEG or PNG image', 'error');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      showToast('Image size must be less than 10MB', 'error');
      return;
    }

    // Cleanup previous preview
    if (pendingAvatarPreview) {
      URL.revokeObjectURL(pendingAvatarPreview);
    }

    // Create preview URL and set pending file
    const previewUrl = URL.createObjectURL(file);
    setPendingAvatarPreview(previewUrl);
    setPendingAvatarFile(file);
    
    // Reset input
    if (avatarFileInputRef.current) {
      avatarFileInputRef.current.value = '';
    }
  };

  // Handle sending avatar file (processes the pending file)
  const handleSendAvatarFile = async () => {
    if (!pendingAvatarFile) return;
    if (!projectId) {
      showToast('Project ID not found. Please try again.', 'error');
      return;
    }

    setAvatarUploading(true);
    setAvatarUploadSuccess(false);
    setAvatarImageKey(null);
    setAvatarAssetId(null);

    try {
      // Upload image to HeyGen
      const uploadResponse = await apiClient.uploadAvatarImage(pendingAvatarFile);
      
      if (uploadResponse.success && uploadResponse.data) {
        setAvatarImageKey(uploadResponse.data.imageKey);
        setAvatarAssetId(uploadResponse.data.assetId);
        setAvatarUploadSuccess(true);
        
        // Show upload message
        setAvatarUploadMessageShown(true);
        
        // Start avatar creation
        await createAvatarFromImageKey(
          uploadResponse.data.imageKey, 
          uploadResponse.data.assetId,
          uploadResponse.data.localUrl
        );
        
        // Clear pending file
        if (pendingAvatarPreview) {
          URL.revokeObjectURL(pendingAvatarPreview);
        }
        setPendingAvatarFile(null);
        setPendingAvatarPreview(null);

        // Mark avatar as confirmed and advance to visual style substep
        setAvatarConfirmed(true);
        setAvatarSubstep('visual-style');

      } else {
        throw new Error(uploadResponse.message || 'Failed to upload image');
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to upload image. Please try again.', 'error');
      setAvatarUploading(false);
    }
  };

  // Remove pending avatar file
  const removePendingAvatarFile = () => {
    if (pendingAvatarPreview) {
      URL.revokeObjectURL(pendingAvatarPreview);
    }
    setPendingAvatarFile(null);
    setPendingAvatarPreview(null);
  };

  // Create avatar from uploaded image key
  const createAvatarFromImageKey = async (key: string, assetId?: string, localUrl?: string) => {
    if (!projectId) {
      showToast('Project ID not found. Please try again.', 'error');
      return;
    }

    try {
      setAvatarCreationStarted(true);
      const response = await apiClient.createAvatarFromUpload({
        imageKey: key,
        assetId: assetId,
        originalImageUrl: localUrl,
      });

      if (response.success && response.data) {
        showToast('Avatar generation started! This will take a few minutes.', 'info');
        
        // Show upload message
        setAvatarUploadMessageShown(true);
        
        // Set selected avatar ID
        if (response.data.avatarId) {
          setSelectedAvatarId(response.data.avatarId);
          setSelectedAvatar(response.data.avatarId);
        }
        
        // Update project with avatar ID and mode
        try {
          await apiClient.updateVideoProject(projectId, {
            avatarId: response.data.avatarId,
            avatarMode: 'PREMIUM', // Uploaded avatars use Premium mode
            metadata: {
              avatarUploadStatus: 'creating',
              avatarImageKey: key,
              avatarAssetId: assetId,
            },
          });
        } catch (error: any) {
          console.error('Failed to save avatar to project:', error);
        }
        
        // Reload avatars to show the new one
        await loadAvatars('upload');
      } else {
        throw new Error(response.message || 'Failed to start avatar generation');
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to start avatar generation', 'error');
      setAvatarCreationStarted(false);
    } finally {
      setAvatarUploading(false);
    }
  };

  // Load avatars when tab changes or when in avatar-selection step and user said yes
  useEffect(() => {
    if (currentStep === 'avatar-selection' && avatarYesMessage) {
      loadAvatars(activeAvatarTab);
    }
  }, [activeAvatarTab, currentStep, avatarYesMessage]);

  // Keep selectedAvatar object in sync with selectedAvatarId and loaded avatars
  useEffect(() => {
    if (selectedAvatarId && avatars.length > 0) {
      const avatar = avatars.find(a => a.id === selectedAvatarId);
      if (avatar) {
        setSelectedAvatar(avatar);
      }
    }
  }, [selectedAvatarId, avatars]);

  // Load voices based on active tab
  const loadVoices = async (tab: 'library' | 'upload' | 'record') => {
    setLoadingVoices(true);
    try {
      if (tab === 'library') {
        const response = await apiClient.getElevenLabsVoices();
        if (response.success && response.data) {
          setVoices(response.data);
        } else {
          setVoices([]);
        }
      } else if (tab === 'upload') {
        // Upload tab - placeholder for now
        setVoices([]);
      } else {
        // Record tab - placeholder for now
        setVoices([]);
      }
    } catch (error: any) {
      console.error('Failed to load voices:', error);
      setVoices([]);
      showToast('Failed to load voices. Please try again.', 'error');
    } finally {
      setLoadingVoices(false);
    }
  };

  // Handle voice file upload (only sets pending file, doesn't process)
  const handleVoiceFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      showToast('Please upload a valid audio file', 'warning');
      return;
    }

    const MAX_CLONE_FILE_SIZE = 15 * 1024 * 1024; // 15MB
    if (file.size > MAX_CLONE_FILE_SIZE) {
      showToast('Audio file is too large. Maximum size is 15MB.', 'warning');
      return;
    }

    // Cleanup previous audio URL
    if (pendingVoicePreview) {
      URL.revokeObjectURL(pendingVoicePreview);
    }

    // Create audio preview URL and set pending file
    const audioUrl = URL.createObjectURL(file);
    setPendingVoicePreview(audioUrl);
    setPendingVoiceFile(file);
    setVoiceCloneMode('upload');
    setVoiceUploadSuccess(false); // new upload started
  };

  // Handle voice recording start
  const handleStartVoiceRecording = async () => {
    if (voiceRecording || voiceCloning) return;
    
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showToast('Recording is not supported in this browser.', 'error');
      return;
    }

    try {
      // Request audio with optimal settings
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          sampleRate: { ideal: 44100 },
          channelCount: { ideal: 1 },
        } 
      });
      
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track available from microphone');
      }
      
      recordingStreamRef.current = stream;
      
      // Find best supported codec
      const codecs = [
        'audio/webm;codecs=opus',
        'audio/webm;codecs=pcm',
        'audio/webm',
      ];
      
      let selectedMimeType = '';
      for (const codec of codecs) {
        if (MediaRecorder.isTypeSupported(codec)) {
          selectedMimeType = codec;
          break;
        }
      }
      
      const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event: any) => {
        console.error('[Recording] MediaRecorder error:', event);
        showToast('Recording error occurred. Please try again.', 'error');
        stopActiveVoiceRecording();
        setVoiceRecording(false);
      };

      mediaRecorder.onstop = () => {
        const blobType = selectedMimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: blobType });
        
        if (blob.size === 0) {
          showToast('No audio was recorded. Please try again.', 'error');
          setVoiceRecording(false);
          return;
        }
        
        const fileExtension = blobType.includes('opus') || blobType.includes('webm') ? 'webm' : 'webm';
        const file = new File([blob], `recording_${Date.now()}.${fileExtension}`, { type: blobType });
        
        // Cleanup previous audio URL
        if (voiceCloneAudioUrl) {
          URL.revokeObjectURL(voiceCloneAudioUrl);
        }
        
        const audioUrl = URL.createObjectURL(file);
        
        // Cleanup previous audio URL
        if (pendingVoicePreview) {
          URL.revokeObjectURL(pendingVoicePreview);
        }
        
        setPendingVoicePreview(audioUrl);
        setPendingVoiceFile(file);
        setVoiceCloneMode('record');
        
        stopActiveVoiceRecording();
        setVoiceRecording(false);
      };

      // Start recording
      mediaRecorder.start(1000);
      setVoiceRecording(true);
    } catch (error: any) {
      console.error('Failed to access microphone:', error);
      showToast(error?.message || 'Failed to access microphone', 'error');
      stopActiveVoiceRecording();
      setVoiceRecording(false);
    }
  };

  // Handle voice recording stop
  const handleStopVoiceRecording = () => {
    if (!voiceRecording) return;
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      setVoiceRecording(false);
    }
  };

  // ---- Manual per-scene recording helpers ----

  const stopActiveManualRecording = () => {
    try {
      if (manualMediaRecorderRef.current && manualMediaRecorderRef.current.state !== 'inactive') {
        manualMediaRecorderRef.current.stop();
      }
    } catch (error) {
      console.error('Failed to stop manual recording:', error);
    }
    if (manualRecordingStreamRef.current) {
      manualRecordingStreamRef.current.getTracks().forEach((track) => track.stop());
      manualRecordingStreamRef.current = null;
    }
    manualMediaRecorderRef.current = null;
    manualAudioChunksRef.current = [];
    if (manualVisualizerRafRef.current !== null) {
      cancelAnimationFrame(manualVisualizerRafRef.current);
      manualVisualizerRafRef.current = null;
    }
    if (manualAudioContextRef.current) {
      // Close audio context to release microphone/analyser resources
      manualAudioContextRef.current.close().catch(() => {
        // ignore close errors
      });
      manualAudioContextRef.current = null;
    }
    manualAnalyserRef.current = null;
    manualSaveOnStopRef.current = false;
    manualVisualizerLastUpdateRef.current = 0;
    setManualVisualizerLevels([]);
  };

  const uploadManualSceneAudio = async (sceneNumber: number, file: File, duration?: number) => {
    if (!projectId) {
      showToast('Project not found. Please try again.', 'error');
      setManualAudioByScene((prev) => ({
        ...prev,
        [sceneNumber]: { ...(prev[sceneNumber] || {}), status: 'error', errorMessage: 'Project not found' },
      }));
      return;
    }

    // Extract voiceover text for this scene from the generated script
    let voiceover = '';
    if (generatedScript) {
      const scenes = generatedScript.scenes || generatedScript.scene_plan || [];
      const scene = scenes.find((s: any, index: number) => {
        const num = s.scene_number || s.sceneNumber || index + 1;
        return num === sceneNumber;
      });
      if (scene) {
        voiceover = scene.voiceover || scene.text || '';
      }
    }

    try {
      setManualAudioByScene((prev) => ({
        ...prev,
        [sceneNumber]: { ...(prev[sceneNumber] || {}), status: 'uploading', duration },
      }));

      const response = await apiClient.uploadManualSceneAudio({
        projectId,
        sceneNumber,
        file,
        duration,
        voiceover,
      });

      if (response.success && response.data) {
        const backendDuration = response.data.duration;
        const finalDuration = (duration != null && isFinite(duration) ? duration : undefined) ?? (backendDuration != null && isFinite(backendDuration) ? backendDuration : undefined);
        setManualAudioByScene((prev) => ({
          ...prev,
          [sceneNumber]: {
            status: 'uploaded',
            duration: finalDuration,
            localUrl: response.data.publicUrl || response.data.localUrl || undefined,
          },
        }));
        showToast(`Audio saved for scene ${sceneNumber}`, 'success');
      } else {
        throw new Error(response.message || 'Failed to upload audio');
      }
    } catch (error: any) {
      console.error('Failed to upload manual scene audio:', error);
      setManualAudioByScene((prev) => ({
        ...prev,
        [sceneNumber]: {
          ...(prev[sceneNumber] || {}),
          status: 'error',
          errorMessage: error?.message || 'Upload failed',
        },
      }));
      showToast(`Failed to upload audio for scene ${sceneNumber}`, 'error');
    }
  };

  const handleStartManualRecording = async (sceneNumber: number) => {
    if (manualRecording) {
      showToast('Please stop the current recording before starting a new one.', 'warning');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showToast('Recording is not supported in this browser.', 'error');
      return;
    }

    setManualRecordingError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          sampleRate: { ideal: 44100 },
          channelCount: { ideal: 1 },
        },
      });

      const tracks = stream.getAudioTracks();
      if (tracks.length === 0) {
        throw new Error('No audio track available from microphone');
      }

      manualRecordingStreamRef.current = stream;

      // Reset save-on-stop flag; user must confirm before we upload
      manualSaveOnStopRef.current = false;

      // Set up audio analyser for recording visualizer
      try {
        const AudioContextClass =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioContext: AudioContext = new AudioContextClass();
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 64;

          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyser);

          manualAudioContextRef.current = audioContext;
          manualAnalyserRef.current = analyser;

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          const updateVisualizer = () => {
            if (!manualAnalyserRef.current) {
              return;
            }

            // Throttle visualizer updates to ~10–12 samples/second
            const now = performance.now();
            const last = manualVisualizerLastUpdateRef.current || 0;
            if (now - last < 80) {
              manualVisualizerRafRef.current = requestAnimationFrame(updateVisualizer);
              return;
            }
            manualVisualizerLastUpdateRef.current = now;

            manualAnalyserRef.current.getByteTimeDomainData(dataArray);

            // Compute a single amplitude value from the buffer
            let sum = 0;
            for (let i = 0; i < bufferLength; i += 1) {
              const value = dataArray[i] ?? 128;
              sum += Math.abs(value - 128);
            }
            const avg = sum / bufferLength;
            const amplitude = Math.min(1, avg / 50);

            // Append to history so dots stream left-to-right
            setManualVisualizerLevels((prev) => {
              const next = [...prev, amplitude];
              if (next.length > MANUAL_VISUALIZER_HISTORY_LENGTH) {
                next.splice(0, next.length - MANUAL_VISUALIZER_HISTORY_LENGTH);
              }
              return next;
            });

            manualVisualizerRafRef.current = requestAnimationFrame(updateVisualizer);
          };

          if (manualVisualizerRafRef.current !== null) {
            cancelAnimationFrame(manualVisualizerRafRef.current);
          }
          // Start with an empty history; dots will appear over time from left to right
          setManualVisualizerLevels([]);
          updateVisualizer();
        }
      } catch (visualizerError) {
        console.error('[ManualRecording] Failed to initialize visualizer', visualizerError);
      }

      const codecs = ['audio/webm;codecs=opus', 'audio/webm;codecs=pcm', 'audio/webm'];
      let selectedMimeType = '';
      for (const codec of codecs) {
        if ((window as any).MediaRecorder && MediaRecorder.isTypeSupported(codec)) {
          selectedMimeType = codec;
          break;
        }
      }

      const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      manualMediaRecorderRef.current = recorder;
      manualAudioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          manualAudioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event: any) => {
        console.error('[ManualRecording] MediaRecorder error:', event);
        setManualRecordingError(event.error?.message || 'Recording error occurred');
        showToast('Recording error occurred. Please try again.', 'error');
        stopActiveManualRecording();
        setManualRecording(false);
      };

      recorder.onstop = () => {
        const shouldSave = manualSaveOnStopRef.current;
        manualSaveOnStopRef.current = false;

        const blobType = selectedMimeType || 'audio/webm';
        const blob = new Blob(manualAudioChunksRef.current, { type: blobType });

        if (!shouldSave) {
          // User cancelled recording; just clean up.
          setManualRecording(false);
          setManualRecordingScene(null);
          stopActiveManualRecording();
          return;
        }

        if (blob.size === 0) {
          setManualRecordingError('No audio was recorded. Please try again.');
          showToast('No audio was recorded. Please try again.', 'error');
          setManualRecording(false);
          stopActiveManualRecording();
          return;
        }

        const fileExtension = blobType.includes('opus') || blobType.includes('webm') ? 'webm' : 'webm';
        const file = new File([blob], `manual_scene_${sceneNumber}_${Date.now()}.${fileExtension}`, { type: blobType });

        // Measure duration using browser audio metadata before uploading
        // WebM from MediaRecorder may not have valid duration in loadedmetadata; use durationchange + timeout fallback
        const objectUrl = URL.createObjectURL(file);
        const audio = new Audio();
        let resolved = false;
        const resolveAndUpload = (duration: number | undefined) => {
          if (resolved) return;
          resolved = true;
          URL.revokeObjectURL(objectUrl);
          uploadManualSceneAudio(sceneNumber, file, duration);
        };
        const tryGetDuration = () => {
          const d = audio.duration;
          if (d != null && isFinite(d) && d > 0) {
            resolveAndUpload(d);
          }
        };
        audio.addEventListener('loadedmetadata', tryGetDuration);
        audio.addEventListener('durationchange', tryGetDuration);
        audio.addEventListener('canplay', tryGetDuration);
        audio.addEventListener('loadeddata', tryGetDuration);
        audio.addEventListener('error', () => {
          resolveAndUpload(undefined);
        });
        audio.src = objectUrl;
        // Fallback: if no valid duration after 400ms, upload anyway (backend will extract via ffprobe)
        setTimeout(() => {
          tryGetDuration();
          if (!resolved) resolveAndUpload(undefined);
        }, 400);

        setManualRecording(false);
        setManualRecordingScene(null);
        stopActiveManualRecording();
      };

      recorder.start(1000);
      setManualRecording(true);
      setManualRecordingScene(sceneNumber);
    } catch (error: any) {
      console.error('Failed to start manual recording:', error);
      setManualRecordingError(error?.message || 'Failed to access microphone');
      showToast(error?.message || 'Failed to access microphone', 'error');
      stopActiveManualRecording();
      setManualRecording(false);
    }
  };

  const handleStopManualRecording = () => {
    if (!manualRecording) return;
    try {
      // Mark that we should persist the next onstop payload
      manualSaveOnStopRef.current = true;
      if (manualMediaRecorderRef.current && manualMediaRecorderRef.current.state !== 'inactive') {
        manualMediaRecorderRef.current.stop();
      }
    } catch (error) {
      console.error('Failed to stop manual recording:', error);
      stopActiveManualRecording();
      setManualRecording(false);
    }
  };

  const handlePlayManualScene = (sceneNumber: number) => {
    const state = manualAudioByScene[sceneNumber];
    if (!state?.localUrl) {
      showToast('No audio found for this scene yet. Please record first.', 'warning');
      return;
    }

    // If already playing this scene, toggle pause
    if (manualPlayingScene === sceneNumber && manualPlaybackAudioRef.current) {
      if (!manualPlaybackAudioRef.current.paused) {
        const audio = manualPlaybackAudioRef.current;
        const pos = audio.currentTime;
        manualPausedPositionBySceneRef.current = {
          ...manualPausedPositionBySceneRef.current,
          [sceneNumber]: pos,
        };
        const dur = state?.duration && isFinite(state.duration) ? state.duration : audio.duration;
        const progressRatio = dur && isFinite(dur) && dur > 0 ? pos / dur : 0;
        setManualPlaybackProgress((prev) => ({ ...prev, [sceneNumber]: progressRatio }));
        audio.pause();
        setManualPlayingScene(null);
        manualPlaybackAudioRef.current = null;
        return;
      }
    }

    // Stop any existing playback for a different scene
    if (manualPlaybackAudioRef.current) {
      manualPlaybackAudioRef.current.pause();
      manualPlaybackAudioRef.current = null;
    }

    const startPosition = manualPausedPositionBySceneRef.current[sceneNumber] ?? 0;

    const audio = new Audio(state.localUrl);
    manualPlaybackAudioRef.current = audio;
    setManualPlayingScene(sceneNumber);

    const handleTimeUpdate = () => {
      const sceneDuration =
        state?.duration && isFinite(state.duration) ? state.duration : audio.duration;
      if (!sceneDuration || !isFinite(sceneDuration)) return;
      const progress = Math.min(1, Math.max(0, audio.currentTime / sceneDuration));
      setManualPlaybackProgress((prev) => ({ ...prev, [sceneNumber]: progress }));
    };

    const handleDurationAvailable = () => {
      const d = audio.duration;
      if (d == null || !isFinite(d) || d <= 0) return;
      setManualAudioByScene((prev) => {
        const current = prev[sceneNumber];
        if (!current || (current.duration != null && isFinite(current.duration))) return prev;
        return { ...prev, [sceneNumber]: { ...current, duration: d } };
      });
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleDurationAvailable);
    audio.addEventListener('durationchange', handleDurationAvailable);
    audio.addEventListener('ended', () => {
      setManualPlayingScene((current) => (current === sceneNumber ? null : current));
      setManualPlaybackProgress((prev) => ({ ...prev, [sceneNumber]: 0 }));
      const next = { ...manualPausedPositionBySceneRef.current };
      delete next[sceneNumber];
      manualPausedPositionBySceneRef.current = next;
      manualPlaybackAudioRef.current = null;
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleDurationAvailable);
      audio.removeEventListener('durationchange', handleDurationAvailable);
    });
    audio.addEventListener('error', () => {
      showToast('Failed to play audio for this scene.', 'error');
      setManualPlayingScene((current) => (current === sceneNumber ? null : current));
      manualPlaybackAudioRef.current = null;
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleDurationAvailable);
      audio.removeEventListener('durationchange', handleDurationAvailable);
    });

    let playbackStarted = false;
    const startPlayback = () => {
      if (playbackStarted) return;
      playbackStarted = true;
      handleDurationAvailable();
      if (startPosition > 0) {
        audio.currentTime = startPosition;
        const dur = state?.duration && isFinite(state.duration) ? state.duration : audio.duration;
        if (dur && isFinite(dur) && dur > 0) {
          setManualPlaybackProgress((prev) => ({ ...prev, [sceneNumber]: startPosition / dur }));
        }
      } else {
        setManualPlaybackProgress((prev) => ({ ...prev, [sceneNumber]: 0 }));
      }
      audio.play().catch((error) => {
        console.error('Failed to play manual scene audio:', error);
        showToast('Failed to play audio for this scene.', 'error');
        setManualPlayingScene((current) => (current === sceneNumber ? null : current));
        manualPlaybackAudioRef.current = null;
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('loadedmetadata', handleDurationAvailable);
        audio.removeEventListener('durationchange', handleDurationAvailable);
      });
    };

    if (audio.readyState >= 1) {
      startPlayback();
    } else {
      audio.addEventListener('loadedmetadata', () => startPlayback(), { once: true });
      audio.addEventListener('canplay', () => {
        if (audio.paused && manualPlaybackAudioRef.current === audio) {
          startPlayback();
        }
      }, { once: true });
    }
  };

  // Handle review section audio playback (for scene-review substep)
  const handleReviewAudioPlayback = (
    sceneNumber: number,
    audioType: 'original' | 'transformed',
    audioUrl: string,
    duration?: number
  ) => {
    // If already playing this exact audio, toggle pause/play
    if (reviewPlayingScene === sceneNumber && reviewPlayingType === audioType && reviewAudioRef.current) {
      if (!reviewAudioRef.current.paused) {
        reviewAudioRef.current.pause();
        setReviewPlayingScene(null);
        setReviewPlayingType(null);
        return;
      } else {
        reviewAudioRef.current.play().catch(err => {
          console.error('Failed to resume review audio:', err);
          showToast('Failed to play audio', 'error');
        });
        setReviewPlayingScene(sceneNumber);
        setReviewPlayingType(audioType);
        return;
      }
    }

    // Stop any existing playback
    if (reviewAudioRef.current) {
      reviewAudioRef.current.pause();
      reviewAudioRef.current = null;
    }

    const audio = new Audio(audioUrl);
    reviewAudioRef.current = audio;
    setReviewPlayingScene(sceneNumber);
    setReviewPlayingType(audioType);
    setReviewPlaybackProgress(prev => ({ ...prev, [sceneNumber]: 0 }));

    const handleTimeUpdate = () => {
      const audioDuration = duration || audio.duration;
      if (!audioDuration || !isFinite(audioDuration)) return;
      const progress = Math.min(1, Math.max(0, audio.currentTime / audioDuration));
      setReviewPlaybackProgress(prev => ({ ...prev, [sceneNumber]: progress }));
    };

    const handleEnded = () => {
      setReviewPlayingScene(null);
      setReviewPlayingType(null);
      setReviewPlaybackProgress(prev => ({ ...prev, [sceneNumber]: 0 }));
      reviewAudioRef.current = null;
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };

    const handleError = () => {
      showToast(`Failed to load ${audioType} audio`, 'error');
      setReviewPlayingScene(null);
      setReviewPlayingType(null);
      reviewAudioRef.current = null;
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    audio.play().catch(err => {
      console.error('Review audio playback failed:', err);
      showToast(`Failed to play ${audioType} audio`, 'error');
      setReviewPlayingScene(null);
      setReviewPlayingType(null);
      reviewAudioRef.current = null;
    });
  };

  // Stop active recording and cleanup
  const stopActiveVoiceRecording = () => {
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch (err) {
        // ignore
      }
      mediaRecorderRef.current = null;
    }
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
    }
    audioChunksRef.current = [];
  };

  // Input recording handlers for speech-to-text
  const INPUT_VISUALIZER_HISTORY_LENGTH = 64;

  const stopActiveInputRecording = () => {
    try {
      if (inputMediaRecorderRef.current && inputMediaRecorderRef.current.state !== 'inactive') {
        inputMediaRecorderRef.current.stop();
      }
    } catch (error) {
      console.error('Failed to stop input recording:', error);
    }
    if (inputRecordingStreamRef.current) {
      inputRecordingStreamRef.current.getTracks().forEach((track) => track.stop());
      inputRecordingStreamRef.current = null;
    }
    inputMediaRecorderRef.current = null;
    inputAudioChunksRef.current = [];
    if (inputVisualizerRafRef.current !== null) {
      cancelAnimationFrame(inputVisualizerRafRef.current);
      inputVisualizerRafRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close().catch(() => {});
      inputAudioContextRef.current = null;
    }
    inputAnalyserRef.current = null;
    inputVisualizerLastUpdateRef.current = 0;
    setInputVisualizerLevels([]);
  };

  const handleStartInputRecording = async () => {
    if (isInputRecording) {
      showToast('Recording is already in progress.', 'warning');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showToast('Recording is not supported in this browser.', 'error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          sampleRate: { ideal: 44100 },
          channelCount: { ideal: 1 },
        },
      });

      const tracks = stream.getAudioTracks();
      if (tracks.length === 0) {
        throw new Error('No audio track available from microphone');
      }

      inputRecordingStreamRef.current = stream;

      // Set up audio analyser for recording visualizer
      try {
        const AudioContextClass =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioContext: AudioContext = new AudioContextClass();
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 64;

          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyser);

          inputAudioContextRef.current = audioContext;
          inputAnalyserRef.current = analyser;

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          const updateVisualizer = () => {
            if (!inputAnalyserRef.current) {
              return;
            }

            const now = performance.now();
            const last = inputVisualizerLastUpdateRef.current || 0;
            if (now - last < 80) {
              inputVisualizerRafRef.current = requestAnimationFrame(updateVisualizer);
              return;
            }
            inputVisualizerLastUpdateRef.current = now;

            inputAnalyserRef.current.getByteTimeDomainData(dataArray);

            let sum = 0;
            for (let i = 0; i < bufferLength; i += 1) {
              const value = dataArray[i] ?? 128;
              sum += Math.abs(value - 128);
            }
            const avg = sum / bufferLength;
            const amplitude = Math.min(1, avg / 50);

            setInputVisualizerLevels((prev) => {
              const next = [...prev, amplitude];
              if (next.length > INPUT_VISUALIZER_HISTORY_LENGTH) {
                next.splice(0, next.length - INPUT_VISUALIZER_HISTORY_LENGTH);
              }
              return next;
            });

            inputVisualizerRafRef.current = requestAnimationFrame(updateVisualizer);
          };

          if (inputVisualizerRafRef.current !== null) {
            cancelAnimationFrame(inputVisualizerRafRef.current);
          }
          setInputVisualizerLevels([]);
          updateVisualizer();
        }
      } catch (visualizerError) {
        console.error('[InputRecording] Failed to initialize visualizer', visualizerError);
      }

      const codecs = ['audio/webm;codecs=opus', 'audio/webm;codecs=pcm', 'audio/webm'];
      let selectedMimeType = '';
      for (const codec of codecs) {
        if ((window as any).MediaRecorder && MediaRecorder.isTypeSupported(codec)) {
          selectedMimeType = codec;
          break;
        }
      }

      const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      inputMediaRecorderRef.current = recorder;
      inputAudioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          inputAudioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event: any) => {
        console.error('[InputRecording] MediaRecorder error:', event);
        showToast('Recording error occurred. Please try again.', 'error');
        stopActiveInputRecording();
        setIsInputRecording(false);
      };

      recorder.start(1000);
      setIsInputRecording(true);
    } catch (error: any) {
      console.error('Failed to start input recording:', error);
      showToast(error?.message || 'Failed to access microphone', 'error');
      stopActiveInputRecording();
      setIsInputRecording(false);
    }
  };

  const handleCancelInputRecording = () => {
    stopActiveInputRecording();
    setIsInputRecording(false);
  };

  const handleConfirmInputRecording = async () => {
    if (!isInputRecording || !inputMediaRecorderRef.current) {
      return;
    }

    // Stop the recorder and process the audio
    try {
      const recorder = inputMediaRecorderRef.current;
      const mimeType = recorder.mimeType || 'audio/webm';
      
      // Create a promise to wait for the onstop event
      const audioBlob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(inputAudioChunksRef.current, { type: mimeType });
          resolve(blob);
        };
        recorder.stop();
      });

      setIsInputRecording(false);
      stopActiveInputRecording();

      if (audioBlob.size === 0) {
        showToast('No audio was recorded. Please try again.', 'error');
        return;
      }

      // Transcribe the audio
      setIsTranscribing(true);
      try {
        const response = await apiClient.transcribeSpeech(audioBlob);
        
        if (response.success && response.data?.text) {
          const transcribedText = response.data.text.trim();
          
          if (!transcribedText) {
            showToast('No speech detected. Please try again.', 'warning');
            return;
          }

          // Append to existing input or set as new input
          if (scriptInput.trim()) {
            setScriptInput(scriptInput.trimEnd() + '\n' + transcribedText);
          } else {
            setScriptInput(transcribedText);
          }
        } else {
          showToast(response.message || 'Failed to transcribe audio', 'error');
        }
      } catch (error: any) {
        console.error('Transcription error:', error);
        showToast(error?.message || 'Failed to transcribe audio', 'error');
      } finally {
        setIsTranscribing(false);
      }
    } catch (error: any) {
      console.error('Failed to confirm input recording:', error);
      showToast('Failed to process recording', 'error');
      stopActiveInputRecording();
      setIsInputRecording(false);
    }
  };

  const stopActiveAvatarDescriptionRecording = () => {
    try {
      if (avatarMediaRecorderRef.current && avatarMediaRecorderRef.current.state !== 'inactive') {
        avatarMediaRecorderRef.current.stop();
      }
    } catch (error) {
      console.error('Failed to stop avatar description recording:', error);
    }
    if (avatarRecordingStreamRef.current) {
      avatarRecordingStreamRef.current.getTracks().forEach((track) => track.stop());
      avatarRecordingStreamRef.current = null;
    }
    avatarMediaRecorderRef.current = null;
    avatarAudioChunksRef.current = [];
    if (avatarVisualizerRafRef.current !== null) {
      cancelAnimationFrame(avatarVisualizerRafRef.current);
      avatarVisualizerRafRef.current = null;
    }
    if (avatarAudioContextRef.current) {
      avatarAudioContextRef.current.close().catch(() => {});
      avatarAudioContextRef.current = null;
    }
    avatarAnalyserRef.current = null;
    avatarVisualizerLastUpdateRef.current = 0;
    setAvatarDescriptionVisualizerLevels([]);
  };

  const handleStartAvatarDescriptionRecording = async () => {
    if (avatarDescriptionRecording) {
      showToast('Recording is already in progress.', 'warning');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showToast('Recording is not supported in this browser.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          sampleRate: { ideal: 44100 },
          channelCount: { ideal: 1 },
        },
      });
      const tracks = stream.getAudioTracks();
      if (tracks.length === 0) throw new Error('No audio track available from microphone');
      avatarRecordingStreamRef.current = stream;
      try {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioContext: AudioContext = new AudioContextClass();
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 64;
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyser);
          avatarAudioContextRef.current = audioContext;
          avatarAnalyserRef.current = analyser;
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          const updateVisualizer = () => {
            if (!avatarAnalyserRef.current) return;
            const now = performance.now();
            const last = avatarVisualizerLastUpdateRef.current || 0;
            if (now - last < 80) {
              avatarVisualizerRafRef.current = requestAnimationFrame(updateVisualizer);
              return;
            }
            avatarVisualizerLastUpdateRef.current = now;
            avatarAnalyserRef.current.getByteTimeDomainData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i += 1) {
              const value = dataArray[i] ?? 128;
              sum += Math.abs(value - 128);
            }
            const avg = sum / bufferLength;
            const amplitude = Math.min(1, avg / 50);
            setAvatarDescriptionVisualizerLevels((prev) => {
              const next = [...prev, amplitude];
              if (next.length > AVATAR_VISUALIZER_HISTORY_LENGTH) {
                next.splice(0, next.length - AVATAR_VISUALIZER_HISTORY_LENGTH);
              }
              return next;
            });
            avatarVisualizerRafRef.current = requestAnimationFrame(updateVisualizer);
          };
          if (avatarVisualizerRafRef.current !== null) cancelAnimationFrame(avatarVisualizerRafRef.current);
          setAvatarDescriptionVisualizerLevels([]);
          updateVisualizer();
        }
      } catch (e) {
        console.error('[AvatarDescriptionRecording] Failed to initialize visualizer', e);
      }
      const codecs = ['audio/webm;codecs=opus', 'audio/webm;codecs=pcm', 'audio/webm'];
      let selectedMimeType = '';
      for (const codec of codecs) {
        if ((window as any).MediaRecorder && MediaRecorder.isTypeSupported(codec)) {
          selectedMimeType = codec;
          break;
        }
      }
      const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      avatarMediaRecorderRef.current = recorder;
      avatarAudioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) avatarAudioChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        showToast('Recording error occurred. Please try again.', 'error');
        stopActiveAvatarDescriptionRecording();
        setAvatarDescriptionRecording(false);
      };
      recorder.start(1000);
      setAvatarDescriptionRecording(true);
    } catch (error: any) {
      console.error('Failed to start avatar description recording:', error);
      showToast(error?.message || 'Failed to access microphone', 'error');
      stopActiveAvatarDescriptionRecording();
      setAvatarDescriptionRecording(false);
    }
  };

  const handleCancelAvatarDescriptionRecording = () => {
    stopActiveAvatarDescriptionRecording();
    setAvatarDescriptionRecording(false);
  };

  const handleConfirmAvatarDescriptionRecording = async () => {
    if (!avatarDescriptionRecording || !avatarMediaRecorderRef.current) return;
    try {
      const recorder = avatarMediaRecorderRef.current;
      const mimeType = recorder.mimeType || 'audio/webm';
      const audioBlob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(avatarAudioChunksRef.current, { type: mimeType }));
        };
        recorder.stop();
      });
      setAvatarDescriptionRecording(false);
      stopActiveAvatarDescriptionRecording();
      if (audioBlob.size === 0) {
        showToast('No audio was recorded. Please try again.', 'error');
        return;
      }
      const response = await apiClient.transcribeSpeech(audioBlob);
      if (response.success && response.data?.text) {
        const text = response.data.text.trim();
        if (text) {
          setAvatarDescription((prev) => (prev.trim() ? prev.trimEnd() + '\n' + text : text));
        } else {
          showToast('No speech detected. Please try again.', 'warning');
        }
      } else {
        showToast(response.message || 'Failed to transcribe audio', 'error');
      }
    } catch (error: any) {
      console.error('Avatar description transcription error:', error);
      showToast(error?.message || 'Failed to transcribe audio', 'error');
    }
  };

  // Handle sending voice file (processes the pending file)
  const handleSendVoiceFile = async () => {
    if (!pendingVoiceFile) {
      showToast('No audio file found. Please upload or record again.', 'error');
      return;
    }

    if (!pendingVoiceName.trim()) {
      showToast('Please enter a voice name', 'warning');
      return;
    }

    if (!projectId) {
      showToast('Project ID not found. Please try again.', 'error');
      return;
    }

    setVoiceCloning(true);
    try {
      const cloneResponse = await apiClient.cloneVoice({
        name: pendingVoiceName.trim(),
        audioFile: pendingVoiceFile,
        removeBackgroundNoise: voiceRemoveBackgroundNoise,
      });

      if (!cloneResponse.success || !cloneResponse.data?.voiceId) {
        throw new Error(cloneResponse.message || 'Failed to clone voice');
      }

      const voiceId = cloneResponse.data.voiceId;
      setSelectedVoiceId(voiceId);
      setVoiceUploadSuccess(true);

      // Update project with cloned voice
      await apiClient.updateVideoProject(projectId, {
        voiceId,
        clonedVoiceId: voiceId,
        voiceType: 'CLONED',
        voiceSettings: {
          removeBackgroundNoise: voiceRemoveBackgroundNoise,
          source: 'CLONED',
        },
        metadata: {
          voiceCloneName: pendingVoiceName.trim(),
          voiceCloneMode: voiceCloneMode,
        },
      });

      showToast(
        cloneResponse.data.requiresVerification
          ? 'Voice cloned. Verification may be required before use.'
          : 'Voice cloned successfully!',
        cloneResponse.data.requiresVerification ? 'warning' : 'success'
      );

      // Move to confirmed sub-step
      setVoiceSubstep('confirmed');
      
      // Clear pending file
      if (pendingVoicePreview) {
        URL.revokeObjectURL(pendingVoicePreview);
      }
      setPendingVoiceFile(null);
      setPendingVoicePreview(null);
      setPendingVoiceName('');
      
      // Reload voices to show the new one
      await loadVoices('library');
    } catch (error: any) {
      console.error('Failed to clone voice:', error);
      showToast(error.message || 'Failed to clone voice. Please try again.', 'error');
    } finally {
      setVoiceCloning(false);
    }
  };

  // Remove pending voice file
  const removePendingVoiceFile = () => {
    if (pendingVoicePreview) {
      URL.revokeObjectURL(pendingVoicePreview);
    }
    setPendingVoiceFile(null);
    setPendingVoicePreview(null);
    setPendingVoiceName('');
  };

  // Load voices when tab changes or when in voice-selection step and user said yes
  useEffect(() => {
    if (currentStep === 'voice-selection' && voiceYesMessage) {
      loadVoices(activeVoiceTab);
    }
  }, [activeVoiceTab, currentStep, voiceYesMessage]);

  // Auto-fetch STS voices when entering voice-transform or scene-review substep
  useEffect(() => {
    const fetchStsVoices = async () => {
      if (currentStep === 'voice-selection' && (voiceSubstep === 'voice-transform' || voiceSubstep === 'scene-review') && stsVoices.length === 0 && !stsVoicesLoading) {
        setStsVoicesLoading(true);
        try {
          const response = await apiClient.getSpeechToSpeechVoices({ language: selectedLanguage || undefined });
          if (response.success && response.data) {
            setStsVoices(response.data);
          }
        } catch (e) {
          showToast('Failed to load voices', 'error');
        } finally {
          setStsVoicesLoading(false);
        }
      }
    };
    fetchStsVoices();
  }, [currentStep, voiceSubstep, stsVoices.length, stsVoicesLoading, selectedLanguage]);

  // Handle click outside voice dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (voiceDropdownRef.current && !voiceDropdownRef.current.contains(event.target as Node)) {
        setIsVoiceDropdownOpen(false);
      }
    };
    if (isVoiceDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVoiceDropdownOpen]);

  // Handle click outside modal voice dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalVoiceDropdownRef.current && !modalVoiceDropdownRef.current.contains(event.target as Node)) {
        setIsModalVoiceDropdownOpen(false);
      }
    };
    if (isModalVoiceDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModalVoiceDropdownOpen]);

  // Cleanup voice recording on unmount
  useEffect(() => {
    return () => {
      stopActiveVoiceRecording();
      if (voiceCloneAudioUrl) {
        URL.revokeObjectURL(voiceCloneAudioUrl);
      }
      if (avatarUploadPreview) {
        URL.revokeObjectURL(avatarUploadPreview);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Handle voice selection
  const handleVoiceSelection = (preference: 'yes' | 'no') => {
    setVoicePreference(preference);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('voicePreference', preference);
    }
    
    if (preference === 'yes') {
      setVoiceMode('AI');
      setVoiceYesMessage(true);
      setVoiceSubstep('selection'); // Move to selection substep
      loadVoices(activeVoiceTab);
    } else {
      // Enter manual recording mode instead of redirecting to classic flow
      setVoiceMode('MANUAL');
      setVoiceYesMessage(false);
      setVoiceSubstep('manual');
      setSelectedVoiceId(null);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('selectedVoiceId');
      }
    }
  };

  // Handle voice play/preview
  const handlePlayVoice = (voice: any) => {
    if (!voice.preview_url) {
      showToast('No preview available for this voice', 'warning');
      return;
    }
    
    // If clicking the same voice, toggle play/pause
    if (playingVoiceId === voice.voice_id && audioElementRef.current) {
      if (isAudioPlaying) {
        // Pause
        audioElementRef.current.pause();
        setIsAudioPlaying(false);
      } else {
        // Resume
        audioElementRef.current.play().catch((error) => {
          console.error('Failed to resume voice preview:', error);
          showToast('Failed to resume voice preview', 'error');
        });
        setIsAudioPlaying(true);
      }
      return;
    }
    
    // Stop current audio if playing
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
    }
    
    // Play new voice
    const audio = new Audio(voice.preview_url);
    audioElementRef.current = audio;
    setPlayingVoiceId(voice.voice_id);
    setIsAudioPlaying(true);
    
    audio.play().catch((error) => {
      console.error('Failed to play voice preview:', error);
      showToast('Failed to play voice preview', 'error');
      setPlayingVoiceId(null);
      setIsAudioPlaying(false);
    });
    
    audio.onended = () => {
      setPlayingVoiceId(null);
      setIsAudioPlaying(false);
    };

    audio.onpause = () => {
      setIsAudioPlaying(false);
    };
  };

  // Handle proceed with selected voice
  const handleProceedWithVoice = async () => {
    if (selectedVoiceId) {
      // Mark as confirmed and move to confirmed substep
      setVoiceConfirmed(true);
      setVoiceSubstep('confirmed');
      // Store in sessionStorage
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('selectedVoiceId', selectedVoiceId);
      }
      
      // Check if project exists, if not, create it
      if (!projectId) {
        showToast('Project not found. Please try again.', 'error');
        return;
      }
      
      const styleToUse = selectedVideoStyle || 
        (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
      
      // Check if this is an avatar-only style that skips b-roll
      const isAvatarOnlyStyle = styleToUse === 'avatar-only' || styleToUse === 'AVATAR_ONLY' || 
                                 styleToUse === 'animated-avatar' || styleToUse === 'ANIMATED_AVATAR';
      
      // For avatar-only styles, proceed directly to generation
      // For other styles, show B-roll source choice first
      if (isAvatarOnlyStyle) {
        // After 1.5 seconds, move directly to audio-image-generation
        setTimeout(async () => {
          await startAvatarOnlyGeneration(projectId);
        }, 1500);
      }
      // For non-avatar-only styles, B-roll choice UI will be shown automatically
      // Generation will be triggered by handleBrollSourceSelection or handleProceedWithManualBroll
    }
  };

  // Start avatar-only generation (no B-roll needed)
  const startAvatarOnlyGeneration = async (projectIdToUse: string) => {
    setCurrentStep('audio-image-generation');
    setGenerationProgress(0);
    
    // Start voice generation
    let audioCompleted = false;
    try {
      setIsGeneratingVoice(true);
      const audioResponse = await apiClient.generateAudio(projectIdToUse);
      if (audioResponse.success && audioResponse.data?.jobId) {
        audioJobIdRef.current = audioResponse.data.jobId;
        console.log('[AIChat] Started audio generation, jobId:', audioResponse.data.jobId);
        subscribeToJob(audioResponse.data.jobId, 'audio-generation');
      } else if (audioResponse.success && audioResponse.data?.existing) {
        // Audio already exists, skip voice generation
        setIsGeneratingVoice(false);
        audioCompleted = true;
        setGenerationProgress(30); // Audio done = 30% for avatar-only
      } else {
        throw new Error('Failed to start voice generation');
      }
    } catch (error: any) {
      console.error('Failed to generate audio:', error);
      setIsGeneratingVoice(false);
      showToast('Failed to start voice generation', 'error');
      return;
    }

    console.log('[AIChat] Avatar-only style detected, skipping b-roll image generation');
    setIsGeneratingBroll(false);
    
    // If audio is already done, start rendering immediately
    if (audioCompleted) {
      await startAvatarOnlyRendering(projectIdToUse);
    }
    // Otherwise, rendering will be triggered when audio job completes (handled in WebSocket)
  };

  // Handle B-roll source selection (AI, stock manual selection, upload, or legacy stock-auto)
  const handleBrollSourceSelection = async (source: 'ai' | 'stock' | 'upload' | 'stock-auto') => {
    setBrollSourcePreference(source);
    
    if (source === 'ai') {
      // User chose AI-generated B-roll, proceed with generation
      setBrollSourceConfirmed(true);
      setTimeout(async () => {
        await startBrollGeneration();
      }, 500);
    } else if (source === 'stock' || source === 'upload') {
      // User chose to manually select stock visuals OR upload their own
      // Just show the scene cards UI - no auto-selection, no loading
      // The modal will be opened when user clicks on a scene card
      // allowedTabs will be determined by the source type when opening the modal
    } else if (source === 'stock-auto') {
      // User chose auto stock visuals - generate audio first, then download stock videos using audio durations
      setIsAutoSelectingStock(true);
      setStockDownloadProgress(0);
      stockJobsCompleteRef.current = false;
      
      if (!projectId) {
        showToast('Project not found. Please try again.', 'error');
        setIsAutoSelectingStock(false);
        return;
      }
      
      // Start audio generation first and WAIT for it to complete before downloading stock videos
      // This ensures we have accurate audio durations for matching stock video lengths
      let audioFiles: { sceneNumber: number; duration: number }[] = [];
      try {
        setIsGeneratingVoice(true);
        setBrollSourceConfirmed(true);
        setCurrentStep('audio-image-generation');
        setGenerationProgress(0);
        
        const audioResponse = await apiClient.generateAudio(projectId);
        if (audioResponse.success && audioResponse.data?.jobId) {
          audioJobIdRef.current = audioResponse.data.jobId;
          console.log('[AIChat] Started audio generation for stock-auto, jobId:', audioResponse.data.jobId);
          subscribeToJob(audioResponse.data.jobId, 'audio-generation');
          
          // Wait for audio generation to complete by polling the project
          // This ensures we have actual audio durations before downloading stock videos
          console.log('[AIChat] Waiting for audio generation to complete before downloading stock videos...');
          const maxWaitTime = 300000; // 5 minutes max
          const pollInterval = 2000; // Poll every 2 seconds
          const startTime = Date.now();
          
          while (Date.now() - startTime < maxWaitTime) {
            const projectResponse = await apiClient.getVideoProject(projectId);
            if (projectResponse.success && projectResponse.data) {
              const projectAudioFiles = projectResponse.data.audioFiles;
              const script = projectResponse.data.script;
              const parsedScript = typeof script === 'string' ? JSON.parse(script) : script;
              const expectedSceneCount = parsedScript?.scenes?.length || parsedScript?.scene_plan?.length || 0;
              
              if (projectAudioFiles && Array.isArray(projectAudioFiles) && projectAudioFiles.length >= expectedSceneCount) {
                audioFiles = projectAudioFiles.map((af: any) => ({
                  sceneNumber: af.sceneNumber,
                  duration: af.duration,
                }));
                console.log(`[AIChat] Audio generation complete! Got ${audioFiles.length} audio files with durations:`, 
                  audioFiles.map(af => `Scene ${af.sceneNumber}: ${af.duration?.toFixed(2)}s`).join(', '));
                setIsGeneratingVoice(false);
                setGenerationProgress(50);
                break;
              }
            }
            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }
          
          if (audioFiles.length === 0) {
            console.warn('[AIChat] Timed out waiting for audio generation. Using script time_range as fallback.');
          }
        } else if (audioResponse.success && audioResponse.data?.existing) {
          // Audio already exists - fetch from project
          console.log('[AIChat] Audio already exists, fetching durations from project...');
          const projectResponse = await apiClient.getVideoProject(projectId);
          if (projectResponse.success && projectResponse.data?.audioFiles) {
            audioFiles = projectResponse.data.audioFiles.map((af: any) => ({
              sceneNumber: af.sceneNumber,
              duration: af.duration,
            }));
            console.log(`[AIChat] Got existing ${audioFiles.length} audio files with durations`);
          }
          setIsGeneratingVoice(false);
          setGenerationProgress(50);
        } else {
          throw new Error('Failed to start voice generation');
        }
      } catch (audioError: any) {
        console.error('[AIChat] Failed to generate audio for stock-auto:', audioError);
        setIsGeneratingVoice(false);
        showToast('Failed to start voice generation', 'error');
        setIsAutoSelectingStock(false);
        return;
      }
      
      try {
        const scenes = generatedScript?.scenes || generatedScript?.scene_plan || [];
        console.log(`[AIChat] Auto-selecting and downloading stock videos for ${scenes.length} scenes`);
        
        let completedCount = 0;
        
        // Helper function to parse time_range to duration in seconds (used as fallback)
        const parseTimeRangeToDuration = (timeRange: string | undefined): number | undefined => {
          if (!timeRange) return undefined;
          // Parse formats like "0-5sec", "5-10 sec", "10-15sec"
          const match = timeRange.match(/(\d+)-(\d+)\s*sec/i);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            return end - start;
          }
          return undefined;
        };
        
        // Helper function to determine the correct aspect ratio for stock videos based on video style
        // HALF_N_HALF: All scenes need 1080x960 (9:8) -> use 1:1 stock videos
        // ALTERNATE: Odd scenes need 1080x960 (9:8) -> use 1:1, Even scenes need 1080x1920 (9:16) -> use 9:16
        // Others (AVATAR_CUTOUT, PRODUCT_ONLY, B_ROLL_ONLY): All scenes need 9:16
        const getStockAspectRatio = (sceneNumber: number): '9:16' | '1:1' => {
          const style = selectedVideoStyle || 
            (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
          
          const normalizedStyle = style?.toUpperCase().replace(/-/g, '_');
          
          if (normalizedStyle === 'HALF_N_HALF') {
            // HALF_N_HALF: All scenes use 1:1 (will be scaled to 1080x960)
            return '1:1';
          } else if (normalizedStyle === 'ALTERNATE') {
            // ALTERNATE: Odd scenes use 1:1 (half-n-half), Even scenes use 9:16 (full screen)
            return sceneNumber % 2 === 1 ? '1:1' : '9:16';
          }
          // Default to 9:16 for AVATAR_CUTOUT, PRODUCT_ONLY, B_ROLL_ONLY, etc.
          return '9:16';
        };
        
        // Process each scene: search -> download -> save to backend
        const processPromises = scenes.map(async (scene: any, index: number) => {
          const sceneNumber = scene.scene_number || (index + 1);
          const searchTerm = scene.stock_search_term || scene.broll_visual_description?.substring(0, 50) || 'professional video background';
          
          // CRITICAL FIX: Use audio duration instead of script time_range
          // Find the audio file for this scene and use Math.ceil() to match AI video generation behavior
          const audioFile = audioFiles.find(af => af.sceneNumber === sceneNumber);
          const audioDuration = audioFile?.duration;
          
          // Use audio duration with Math.ceil() (matches AI video generation), fallback to time_range
          let sceneDuration: number;
          if (audioDuration && audioDuration > 0) {
            sceneDuration = Math.ceil(audioDuration);
            console.log(`[AIChat] Scene ${sceneNumber}: Using audio duration ${audioDuration.toFixed(2)}s → target ${sceneDuration}s`);
          } else {
            sceneDuration = parseTimeRangeToDuration(scene.time_range) || 5;
            console.log(`[AIChat] Scene ${sceneNumber}: No audio duration, falling back to time_range → ${sceneDuration}s`);
          }
          
          // Determine correct aspect ratio based on video style and scene number
          const aspectRatio = getStockAspectRatio(sceneNumber);
          
          console.log(`[AIChat] Scene ${sceneNumber} using search term: "${searchTerm}", duration: ${sceneDuration}s, aspectRatio: ${aspectRatio}`);
          
          try {
            // Step 1: Search for stock video with duration matching and correct aspect ratio
            const searchParams = new URLSearchParams({
              term: searchTerm,
              type: 'video',
              page: '1',
              limit: '5', // Get more results to find best duration match
              aspectRatio: aspectRatio,
              targetDuration: sceneDuration.toString(),
            });
            
            const searchResponse = await fetch(`/api/stock/search?${searchParams.toString()}`);
            
            if (!searchResponse.ok) {
              console.warn(`[AIChat] Stock search failed for scene ${sceneNumber}`);
              completedCount++;
              setStockDownloadProgress(Math.round((completedCount / scenes.length) * 100));
              return { sceneNumber, success: false, reason: 'search_failed' };
            }
            
            const searchData = await searchResponse.json();
            if (!searchData.success || !searchData.data?.results?.[0]) {
              console.warn(`[AIChat] No stock video found for scene ${sceneNumber}, search: "${searchTerm}"`);
              completedCount++;
              setStockDownloadProgress(Math.round((completedCount / scenes.length) * 100));
              return { sceneNumber, success: false, reason: 'no_results' };
            }
            
            const stockResult = searchData.data.results[0];
            console.log(`[AIChat] Found stock video for scene ${sceneNumber}: ${stockResult.title} (id: ${stockResult.id}, duration: ${stockResult.durationSeconds}s)`);
            
            // Step 2: Download the stock video with trimming to target duration
            // For 1:1 aspect ratio videos (HALF_N_HALF or ALTERNATE odd), scale to 1080x960
            const needsScaling = aspectRatio === '1:1';
            const downloadParams = new URLSearchParams({
              type: 'video',
              projectId: projectId!,
              targetDuration: sceneDuration.toString(),
              maxSizeMB: '100',
              ...(needsScaling && { targetWidth: '1080', targetHeight: '960' }),
            });
            
            const downloadResponse = await fetch(`/api/stock/${stockResult.id}/download?${downloadParams.toString()}`);
            
            if (!downloadResponse.ok) {
              console.warn(`[AIChat] Stock download failed for scene ${sceneNumber}, using preview URL as fallback`);
              // Fallback: use preview URL (may not work for rendering but at least saves something)
              await apiClient.updateSceneBroll(projectId, sceneNumber, {
                brollUrl: stockResult.previewUrl,
                brollType: 'video',
                source: 'stock-video',
              });
              completedCount++;
              setStockDownloadProgress(Math.round((completedCount / scenes.length) * 100));
              return { sceneNumber, success: true, fallback: true };
            }
            
            const downloadData = await downloadResponse.json();
            if (!downloadData.success || !downloadData.data) {
              console.warn(`[AIChat] Download data invalid for scene ${sceneNumber}, using preview URL as fallback`);
              await apiClient.updateSceneBroll(projectId, sceneNumber, {
                brollUrl: stockResult.previewUrl,
                brollType: 'video',
                source: 'stock-video',
              });
              completedCount++;
              setStockDownloadProgress(Math.round((completedCount / scenes.length) * 100));
              return { sceneNumber, success: true, fallback: true };
            }
            
            const { localPath, gcsUrl, publicUrl, trimmed, extended, compressed, originalDuration, finalDuration, originalSizeMB, finalSizeMB } = downloadData.data;
            console.log(`[AIChat] Downloaded stock video for scene ${sceneNumber}: localPath=${localPath}, gcsUrl=${gcsUrl}`);
            if (trimmed || extended || compressed) {
              console.log(`[AIChat] Video processed: trimmed=${trimmed}, extended=${extended} (${originalDuration?.toFixed(1)}s -> ${finalDuration?.toFixed(1)}s), compressed=${compressed} (${originalSizeMB?.toFixed(1)}MB -> ${finalSizeMB?.toFixed(1)}MB)`);
            }
            
            // Step 3: Save to backend with local path and GCS URL
            await apiClient.updateSceneBroll(projectId, sceneNumber, {
              brollUrl: publicUrl || gcsUrl || stockResult.previewUrl,
              brollType: 'video',
              source: 'stock-video',
              localPath: localPath,
              gcsUrl: gcsUrl,
            });
            
            completedCount++;
            setStockDownloadProgress(Math.round((completedCount / scenes.length) * 100));
            return { sceneNumber, success: true };
          } catch (err) {
            console.error(`[AIChat] Failed to process stock video for scene ${sceneNumber}:`, err);
            completedCount++;
            setStockDownloadProgress(Math.round((completedCount / scenes.length) * 100));
            return { sceneNumber, success: false, reason: 'error', error: err };
          }
        });
        
        const results = await Promise.all(processPromises);
        const downloadedCount = results.filter(r => r.success && !r.fallback).length;
        const fallbackCount = results.filter(r => r.success && r.fallback).length;
        const failedScenes = results.filter(r => !r.success).map(r => r.sceneNumber);
        const totalSuccessCount = downloadedCount + fallbackCount;
        
        setIsAutoSelectingStock(false);
        stockJobsCompleteRef.current = true;
        setStockDownloadProgress(100);
        
        if (totalSuccessCount === 0) {
          showToast('Failed to select any stock videos. Please try again or choose your own.', 'error');
          setBrollSourcePreference(null);
          stockJobsCompleteRef.current = false;
          return;
        }
        
        if (failedScenes.length > 0) {
          console.warn(`[AIChat] Some scenes failed to get stock videos: ${failedScenes.join(', ')}`);
          showToast(`Stock videos selected for ${totalSuccessCount}/${scenes.length} scenes. Missing scenes will use AI generation.`, 'info');
        } else if (fallbackCount > 0 && downloadedCount === 0) {
          console.warn(`[AIChat] All ${fallbackCount} scenes used preview URL fallback - downloads failed`);
          showToast(`Stock videos selected for all ${fallbackCount} scenes, but downloads failed. Using preview URLs as fallback - final video quality may be affected.`, 'warning');
        } else if (fallbackCount > 0) {
          console.warn(`[AIChat] ${fallbackCount} scenes used preview URL fallback`);
          showToast(`Stock videos saved for ${downloadedCount} scenes. ${fallbackCount} scenes using preview URLs as fallback.`, 'info');
        } else {
          showToast(`Stock videos downloaded and saved for all ${downloadedCount} scenes.`, 'success');
        }
        
        // Track that all scenes have video B-roll for navigation
        allScenesHaveVideosRef.current = true;
        
        // No need to generate B-roll images since we have videos - mark as complete
        setIsGeneratingBroll(false);
        
        // Both audio and stock are complete (we waited for audio before downloading stock)
        // Navigate directly to workspace
        console.log('[AIChat] Audio and stock downloads complete, navigating to workspace (videos tab)');
        stockJobsCompleteRef.current = true;
        router.push(`/create-video/workspace?projectId=${projectId}&startMode=videos`);
        
      } catch (error: any) {
        console.error('[AIChat] Failed to process stock-auto videos:', error);
        setIsAutoSelectingStock(false);
        stockJobsCompleteRef.current = false;
        showToast('Failed to select stock videos. Please try again.', 'error');
      }
    }
    // If 'manual', scene cards will be shown for selection
  };

  // Extract first frame from a video URL as a data URL (for preview when workspace is in images mode)
  const extractFirstFrameFromVideo = (videoUrl: string): Promise<string | null> => {
    return new Promise((resolve) => {
      try {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.preload = 'metadata';
        
        const timeoutId = setTimeout(() => {
          console.warn('[AIChat] First frame extraction timed out');
          video.remove();
          resolve(null);
        }, 10000); // 10s timeout
        
        video.onloadeddata = () => {
          video.currentTime = 0.1; // Seek slightly to get a proper frame
        };
        
        video.onseeked = () => {
          clearTimeout(timeoutId);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 1080;
            canvas.height = video.videoHeight || 1920;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
              console.log(`[AIChat] Extracted first frame from video (${canvas.width}x${canvas.height})`);
              video.remove();
              resolve(dataUrl);
            } else {
              video.remove();
              resolve(null);
            }
          } catch (err) {
            console.error('[AIChat] Failed to draw video frame to canvas:', err);
            video.remove();
            resolve(null);
          }
        };
        
        video.onerror = () => {
          clearTimeout(timeoutId);
          console.error('[AIChat] Failed to load video for frame extraction');
          video.remove();
          resolve(null);
        };
        
        video.src = videoUrl;
        video.load();
      } catch (err) {
        console.error('[AIChat] Error in extractFirstFrameFromVideo:', err);
        resolve(null);
      }
    });
  };

  // Handle B-roll selection from modal (stock or upload)
  const handleBrollSelection = (selection: BRollSelection) => {
    const sceneNumber = brollModalSceneNumber;
    
    // Use the type field as the source since it contains the full source type
    // (stock-image, stock-video, upload-image, upload-video)
    setManualBrollByScene(prev => ({
      ...prev,
      [sceneNumber]: {
        type: selection.type,
        url: selection.downloadUrl || selection.url,
        thumbnailUrl: selection.type.includes('video') ? selection.url : undefined,
        id: selection.id || `upload-${Date.now()}`,
        source: selection.type,
        file: selection.file, // Keep the original file for server upload
      }
    }));
    
    setBrollModalOpen(false);
    console.log(`[AIChat] B-roll selected for scene ${sceneNumber}:`, selection.type, selection.file ? '(with file)' : '(no file)');
  };

  // Handle proceeding with manual B-roll selections
  const handleProceedWithManualBroll = async () => {
    if (!projectId) {
      showToast('Project not found. Please try again.', 'error');
      return;
    }

    setBrollSourceConfirmed(true);
    setCurrentStep('audio-image-generation');
    setGenerationProgress(0);

    const styleToUse = selectedVideoStyle || 
      (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);

    // Start voice generation first
    try {
      setIsGeneratingVoice(true);
      const audioResponse = await apiClient.generateAudio(projectId);
      if (audioResponse.success && audioResponse.data?.jobId) {
        audioJobIdRef.current = audioResponse.data.jobId;
        console.log('[AIChat] Started audio generation, jobId:', audioResponse.data.jobId);
        subscribeToJob(audioResponse.data.jobId, 'audio-generation');
      } else if (audioResponse.success && audioResponse.data?.existing) {
        setIsGeneratingVoice(false);
        setGenerationProgress(50);
      } else {
        throw new Error('Failed to start voice generation');
      }
    } catch (error: any) {
      console.error('Failed to generate audio:', error);
      setIsGeneratingVoice(false);
      showToast('Failed to start voice generation', 'error');
      return;
    }

    // Process scenes: use manual selections or generate with AI
    if (generatedScript && (generatedScript.scenes || generatedScript.scene_plan)) {
      try {
        setIsGeneratingBroll(true);
        const scenes = generatedScript.scenes || generatedScript.scene_plan || [];
        
        const productImageUrl = attachedAssets.find(asset => 
          asset.type === 'image' && asset.id.startsWith('product-')
        )?.url || null;

        // First, check if we have a mix of images and videos (need first frame extraction for videos)
        const hasAnyImage = scenes.some((s: any, i: number) => {
          const sNum = s.scene_number || (i + 1);
          const sel = manualBrollByScene[sNum];
          return sel && (sel.type === 'stock-image' || sel.type === 'upload-image');
        });
        const hasAnyVideo = scenes.some((s: any, i: number) => {
          const sNum = s.scene_number || (i + 1);
          const sel = manualBrollByScene[sNum];
          return sel && (sel.type === 'stock-video' || sel.type === 'upload-video');
        });
        const hasMixedContent = hasAnyImage && hasAnyVideo;

        const promises = scenes.map(async (scene: any, index: number) => {
          const sceneNumber = scene.scene_number || (index + 1);
          const manualSelection = manualBrollByScene[sceneNumber];

          if (manualSelection) {
            // Scene has manual B-roll selection - save it to the project
            console.log(`[AIChat] Using manual B-roll for scene ${sceneNumber}:`, manualSelection.type);
            
            try {
              const isVideo = manualSelection.type.includes('video');
              const isUpload = manualSelection.type.startsWith('upload');
              
              let finalUrl = manualSelection.url;
              let localPath: string | undefined;
              let gcsUrl: string | undefined;
              
              // For user uploads, use server-side upload to GCS
              if (isUpload && manualSelection.file) {
                console.log(`[AIChat] Uploading user file to server for scene ${sceneNumber}`);
                
                const formData = new FormData();
                formData.append('file', manualSelection.file);
                formData.append('sceneNumber', String(sceneNumber));
                
                try {
                  const uploadResponse = await fetch(`/api/video/${projectId}/upload-broll`, {
                    method: 'POST',
                    body: formData,
                  });
                  
                  if (uploadResponse.ok) {
                    const uploadData = await uploadResponse.json();
                    if (uploadData.success && uploadData.data) {
                      finalUrl = uploadData.data.url || uploadData.data.publicUrl || uploadData.data.gcsUrl || finalUrl;
                      localPath = uploadData.data.localPath;
                      gcsUrl = uploadData.data.gcsUrl;
                      console.log(`[AIChat] File uploaded for scene ${sceneNumber}: ${finalUrl}`);
                    }
                  } else {
                    console.warn(`[AIChat] Upload failed for scene ${sceneNumber}, using blob URL as fallback`);
                  }
                } catch (uploadError) {
                  console.warn(`[AIChat] Upload error for scene ${sceneNumber}, using blob URL:`, uploadError);
                }
              }
              
              // If mixed content and this is a video, extract first frame for images mode preview
              if (hasMixedContent && isVideo) {
                console.log(`[AIChat] Mixed content detected, extracting first frame for scene ${sceneNumber}`);
                const firstFrame = await extractFirstFrameFromVideo(finalUrl);
                if (firstFrame) {
                  // Save the first frame as an image entry (for images mode preview)
                  // Derive the image source type from the video source type
                  const imageSourceType = manualSelection.type.replace('video', 'image') as 'stock-image' | 'upload-image';
                  await apiClient.updateSceneBroll(projectId, sceneNumber, {
                    brollUrl: firstFrame,
                    brollType: 'image',
                    source: imageSourceType,
                  });
                }
              }
              
              // For uploaded images, analyze and generate a video prompt
              let videoPrompt: string | undefined;
              if (!isVideo && isUpload && finalUrl.startsWith('http')) {
                try {
                  console.log(`[AIChat] Analyzing uploaded image for scene ${sceneNumber} to generate video prompt`);
                  const voiceover = scene.voiceover || scene.script || '';
                  const analysisResult = await apiClient.analyzeBrollImage(finalUrl, voiceover);
                  if (analysisResult.success && analysisResult.data?.videoPrompt) {
                    videoPrompt = analysisResult.data.videoPrompt;
                    console.log(`[AIChat] Generated video prompt for scene ${sceneNumber}: ${videoPrompt.substring(0, 100)}...`);
                  }
                } catch (analysisError) {
                  console.warn(`[AIChat] Failed to analyze image for scene ${sceneNumber}:`, analysisError);
                }
              }
              
              // Update scene with manual B-roll URL (video or image)
              // Use the type field as source which contains the full source type (stock-image, stock-video, upload-image, upload-video)
              await apiClient.updateSceneBroll(projectId, sceneNumber, {
                brollUrl: finalUrl,
                brollType: isVideo ? 'video' : 'image',
                source: manualSelection.type,
                localPath,
                gcsUrl,
                videoPrompt, // Include the generated video prompt for uploaded images
              });
              return; // Skip AI generation for this scene
            } catch (error: any) {
              console.error(`Failed to save manual B-roll for scene ${sceneNumber}:`, error);
              // Fall through to AI generation if manual save fails
            }
          }

          // No manual selection - generate with AI
          let prompt = scene.broll_image_prompt || scene.broll_visual_description || scene.broll || scene.prompt || '';
          
          if (!prompt && (styleToUse === 'broll-only' || styleToUse === 'B_ROLL_ONLY')) {
            prompt = scene.broll_visual_description || 
                     (scene.voiceover ? `B-roll supporting: ${scene.voiceover.substring(0, 100)}` : '') ||
                     `Scene ${sceneNumber} full-screen b-roll for B-roll Only style`;
          }
          
          if (!prompt && (styleToUse === 'alternate' || styleToUse === 'ALTERNATE')) {
            if (sceneNumber % 2 === 1) {
              prompt = scene.broll_visual_description || 
                       (scene.voiceover ? `B-roll supporting: ${scene.voiceover.substring(0, 100)}` : '') ||
                       `Scene ${sceneNumber} b-roll for half-n-half composition (top half)`;
            } else {
              prompt = scene.broll_visual_description || 
                       (scene.voiceover ? `B-roll supporting: ${scene.voiceover.substring(0, 100)}` : '') ||
                       `Scene ${sceneNumber} full-screen b-roll for ALTERNATE style`;
            }
          }
          
          if (!prompt) {
            console.warn(`[AIChat] No prompt found for scene ${sceneNumber}, skipping AI generation`);
            return;
          }

          const modelId = (styleToUse === 'product-only' || styleToUse === 'avatar-product') 
            ? 'model-4' 
            : 'model-1';

          try {
            console.log(`[AIChat] Generating AI B-roll for scene ${sceneNumber}`);
            const imageResponse = await apiClient.regenerateImage(
              projectId,
              sceneNumber,
              prompt,
              modelId,
              undefined,
              undefined,
              productImageUrl || undefined,
              styleToUse || undefined
            );

            if (imageResponse.success && imageResponse.data?.jobId) {
              imageJobIdsRef.current.add(imageResponse.data.jobId);
              console.log('[AIChat] Started image generation for scene', sceneNumber, 'jobId:', imageResponse.data.jobId);
              subscribeToJob(imageResponse.data.jobId, 'image-generation');
            }
          } catch (error: any) {
            console.error(`Failed to generate AI image for scene ${sceneNumber}:`, error);
          }
        });

        await Promise.all(promises);

        // Determine if ALL scenes have manual video selections (skip images page)
        const allScenesHaveVideos = scenes.length > 0 && scenes.every((scene: any, index: number) => {
          const sceneNumber = scene.scene_number || (index + 1);
          const selection = manualBrollByScene[sceneNumber];
          return selection && (selection.type === 'stock-video' || selection.type === 'upload-video');
        });
        // Store for WebSocket navigation callback
        allScenesHaveVideosRef.current = allScenesHaveVideos;

        // Check if we can navigate immediately
        if (imageJobIdsRef.current.size === 0 && !isGeneratingVoice) {
          setIsGeneratingBroll(false);
          setGenerationProgress(100);
          setTimeout(() => {
            const startMode = allScenesHaveVideos ? 'videos' : 'images';
            console.log(`[AIChat] All manual B-roll saved, navigating to workspace (startMode=${startMode})`);
            router.push(`/create-video/workspace?projectId=${projectId}&startMode=${startMode}`);
          }, 1000);
        }
      } catch (error: any) {
        console.error('Failed to process B-roll:', error);
        setIsGeneratingBroll(false);
        showToast('Failed to process visuals', 'error');
      }
    } else {
      if (!isGeneratingVoice) {
        setIsGeneratingBroll(false);
        setGenerationProgress(100);
        setTimeout(() => {
          router.push(`/create-video/workspace?projectId=${projectId}`);
        }, 1000);
      }
    }
  };

  // Start B-roll generation (AI-generated)
  const startBrollGeneration = async () => {
    if (!projectId) {
      showToast('Project not found. Please try again.', 'error');
      return;
    }

    setCurrentStep('audio-image-generation');
    setGenerationProgress(0);
    
    const styleToUse = selectedVideoStyle || 
      (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
    
    // Start voice generation
    let audioCompleted = false;
    try {
      setIsGeneratingVoice(true);
      const audioResponse = await apiClient.generateAudio(projectId);
      if (audioResponse.success && audioResponse.data?.jobId) {
        audioJobIdRef.current = audioResponse.data.jobId;
        console.log('[AIChat] Started audio generation, jobId:', audioResponse.data.jobId);
        subscribeToJob(audioResponse.data.jobId, 'audio-generation');
      } else if (audioResponse.success && audioResponse.data?.existing) {
        // Audio already exists, skip voice generation
        setIsGeneratingVoice(false);
        audioCompleted = true;
        setGenerationProgress(50);
      } else {
        throw new Error('Failed to start voice generation');
      }
    } catch (error: any) {
      console.error('Failed to generate audio:', error);
      setIsGeneratingVoice(false);
      showToast('Failed to start voice generation', 'error');
      return;
    }

    // Start broll image generation for all scenes (non-avatar-only styles)
    if (generatedScript && (generatedScript.scenes || generatedScript.scene_plan)) {
      try {
        setIsGeneratingBroll(true);
        const scenes = generatedScript.scenes || generatedScript.scene_plan || [];
        
        // Extract product image URL and avatar info for avatar-product style
        const productImageUrl = attachedAssets.find(asset => 
          asset.type === 'image' && asset.id.startsWith('product-')
        )?.url || null;
        
        // Get avatar image key if avatar is selected (for avatar-product style)
        let avatarImageKey: string | undefined = undefined;
        if (styleToUse === 'avatar-product' && selectedAvatar) {
          // Avatar image key will be retrieved from backend based on avatarId
          // We'll pass avatarId and let backend handle it
        }
        
        const promises = scenes.map(async (scene: any, index: number) => {
          const sceneNumber = scene.scene_number || (index + 1);
          
          // For ALTERNATE style, ALL scenes need b-roll images (odd: 3:4 top half, even: full 9:16)
          // So we need to handle cases where avatar-type scenes might not have broll_image_prompt
          let prompt = scene.broll_image_prompt || scene.broll_visual_description || scene.broll || scene.prompt || '';
          
          // For B_ROLL_ONLY style, fallback prompt if empty
          if (!prompt && (styleToUse === 'broll-only' || styleToUse === 'B_ROLL_ONLY')) {
            prompt = scene.broll_visual_description || 
                     (scene.voiceover ? `B-roll supporting: ${scene.voiceover.substring(0, 100)}` : '') ||
                     `Scene ${sceneNumber} full-screen b-roll for B-roll Only style`;
          }
          // For ALTERNATE style, if prompt is empty, generate fallback based on scene number
          if (!prompt && (styleToUse === 'alternate' || styleToUse === 'ALTERNATE')) {
            if (sceneNumber % 2 === 1) {
              // Odd scene: 3:4 b-roll for top half (half-n-half)
              prompt = scene.broll_visual_description || 
                       (scene.voiceover ? `B-roll supporting: ${scene.voiceover.substring(0, 100)}` : '') ||
                       `Scene ${sceneNumber} b-roll for half-n-half composition (top half)`;
            } else {
              // Even scene: full 9:16 b-roll
              prompt = scene.broll_visual_description || 
                       (scene.voiceover ? `B-roll supporting: ${scene.voiceover.substring(0, 100)}` : '') ||
                       `Scene ${sceneNumber} full-screen b-roll for ALTERNATE style`;
            }
          }
          
          // Skip if still no prompt (shouldn't happen, but safety check)
          if (!prompt) {
            console.warn(`[AIChat] No prompt found for scene ${sceneNumber}, skipping image generation`);
            return;
          }
          
          // Use model-4 for product/avatar-product; model-1 for other styles (backend uses model-4 when refs present)
          const modelId = (styleToUse === 'product-only' || styleToUse === 'avatar-product') 
            ? 'model-4'  // nano-banana-pro supports reference images
            : 'model-1'; // FAL imagen4 for non-product; processor overrides to model-4 when assets exist

          try {
            const imageResponse = await apiClient.regenerateImage(
              projectId,
              sceneNumber,
              prompt,
              modelId,
              undefined, // aspectRatio
              undefined, // resolution
              productImageUrl || undefined, // productImageUrl
              styleToUse || undefined // videoStyle
            );

            if (imageResponse.success && imageResponse.data?.jobId) {
              imageJobIdsRef.current.add(imageResponse.data.jobId);
              console.log('[AIChat] Started image generation for scene', sceneNumber, 'jobId:', imageResponse.data.jobId, 'Total jobs:', imageJobIdsRef.current.size);
              subscribeToJob(imageResponse.data.jobId, 'image-generation');
            } else if (imageResponse.success && imageResponse.data?.existing) {
              // Image already exists, skip
            }
          } catch (error: any) {
            console.error(`Failed to generate image for scene ${sceneNumber}:`, error);
          }
        });

        // Wait for all API calls to complete (they're non-blocking)
        await Promise.all(promises);

        // If no images needed generation and voice is done, navigate immediately
        if (imageJobIdsRef.current.size === 0 && !isGeneratingVoice) {
          setIsGeneratingBroll(false);
          setGenerationProgress(100);
          setTimeout(() => {
            console.log('[AIChat] No images needed, navigating to workspace');
            router.push(`/create-video/workspace?projectId=${projectId}`);
          }, 1000);
        }
      } catch (error: any) {
        console.error('Failed to start image generation:', error);
        setIsGeneratingBroll(false);
        showToast('Failed to start image generation', 'error');
      }
    } else {
      // No script, just navigate if voice is done
      if (!isGeneratingVoice) {
        setIsGeneratingBroll(false);
        setGenerationProgress(100);
        setTimeout(() => {
          console.log('[AIChat] No script, navigating to workspace');
          router.push(`/create-video/workspace?projectId=${projectId}`);
        }, 1000);
      }
    }
  };

  // Start rendering for avatar-only styles (called after audio completes)
  const startAvatarOnlyRendering = async (pid: string) => {
    try {
      console.log('[AIChat] Starting avatar-only video rendering for project:', pid);
      setIsRenderingVideo(true);
      setGenerationProgress(30); // Start rendering progress at 30%
      
      // Start rendering
      const renderResponse = await apiClient.startVideoRendering(pid);
      if (!renderResponse.success) {
        throw new Error(renderResponse.message || 'Failed to start video rendering');
      }
      
      console.log('[AIChat] Rendering started, polling for status...');
      
      // Poll for rendering status
      pollRenderingStatus(pid);
    } catch (error: any) {
      console.error('Failed to start avatar-only rendering:', error);
      setIsRenderingVideo(false);
      showToast('Failed to create video. Please try again.', 'error');
    }
  };

  // Poll rendering status for avatar-only styles
  const pollRenderingStatus = async (pid: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const statusResponse = await apiClient.getRenderingStatus(pid);
        if (statusResponse.success && statusResponse.data) {
          const { renderingStatus, status, renderingProgress, videoUrl } = statusResponse.data;
          
          // Use renderingStatus if available, otherwise fallback to status
          const effectiveStatus = renderingStatus || status;
          
          // Map rendering progress to UI progress (30-100%)
          const effectiveProgress = renderingProgress ?? 0;
          const uiProgress = 30 + (effectiveProgress * 0.7);
          setGenerationProgress(Math.min(uiProgress, 99));
          
          if (effectiveStatus === 'completed' || effectiveStatus === 'COMPLETED') {
            clearInterval(pollInterval);
            setGenerationProgress(100);
            setIsRenderingVideo(false);
            setIsGeneratingVoice(false);
            
            const styleToCheck = selectedVideoStyle ||
              (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
            const isAvatarOnlyStyle = styleToCheck === 'avatar-only' || styleToCheck === 'AVATAR_ONLY' ||
              styleToCheck === 'animated-avatar' || styleToCheck === 'ANIMATED_AVATAR';

            if (isAvatarOnlyStyle && pid) {
              if (videoUrl) {
                try {
                  await apiClient.updateVideoProject(pid, {
                    videoUrl,
                    status: 'COMPLETED',
                    currentStep: 'COMPLETED',
                    metadata: {
                      generationFlow: 'AI_CHAT',
                      aiChatStep: 'workspace',
                    },
                  });
                } catch (err) {
                  console.error('[AIChat] Failed to update project with video URL:', err);
                }
              }
              router.replace(`/create-video/workspace?projectId=${pid}`);
              return;
            }

            if (videoUrl && pid) {
              try {
                const projectRes = await apiClient.getVideoProject(pid);
                if (projectRes.success && projectRes.data) {
                  const data = projectRes.data;
                  setFinalVideoUrl(getFinalVideoUrl(data, VIDEO_SERVICE_ORIGIN) || videoUrl);
                  const previewErr = data.metadata?.previewGenerationError;
                  setPreviewGenerationError(
                    typeof previewErr === 'string' ? previewErr : null,
                  );
                  if (isPreviewReady(data)) {
                    setPreviewPlaybackUrl(getPreviewPlaybackUrl(data, VIDEO_SERVICE_ORIGIN));
                    setPreviewPreparing(false);
                  } else if (hasPreviewGenerationError(data)) {
                    setPreviewPlaybackUrl(null);
                    setPreviewPreparing(false);
                  } else {
                    setPreviewPlaybackUrl(null);
                    setPreviewPreparing(true);
                  }
                } else {
                  setFinalVideoUrl(videoUrl);
                  setPreviewPreparing(true);
                }
              } catch {
                setFinalVideoUrl(videoUrl);
              }
            }
            console.log('[AIChat] Avatar-only video rendering completed:', videoUrl);
          } else if (effectiveStatus === 'failed' || effectiveStatus === 'FAILED') {
            clearInterval(pollInterval);
            setIsRenderingVideo(false);
            setIsGeneratingVoice(false);
            showToast('Video creation failed. Please try again.', 'error');
          }
        }
      } catch (error: any) {
        console.error('Error polling rendering status:', error);
      }
    }, 3000); // Poll every 3 seconds

    // Clean up interval on component unmount
    return () => clearInterval(pollInterval);
  };

  useEffect(() => {
    if (!projectId || !finalVideoUrl || !previewPreparing || previewPlaybackUrl) return;

    const poll = async () => {
      try {
        const res = await apiClient.getVideoProject(projectId);
        if (!res.success || !res.data) return;
        if (isPreviewReady(res.data)) {
          setPreviewPlaybackUrl(getPreviewPlaybackUrl(res.data, VIDEO_SERVICE_ORIGIN));
          setPreviewPreparing(false);
          setPreviewGenerationError(null);
        } else if (hasPreviewGenerationError(res.data)) {
          const err = res.data.metadata?.previewGenerationError;
          setPreviewGenerationError(typeof err === 'string' ? err : 'Preview failed');
          setPreviewPreparing(false);
        }
      } catch {
        /* ignore */
      }
    };

    void poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [projectId, finalVideoUrl, previewPreparing, previewPlaybackUrl]);

  // Handle proceed with manual recordings (all scenes recorded, process and continue)
  const handleProceedWithManualRecordings = async () => {
    if (!projectId) {
      showToast('Project not found. Please try again.', 'error');
      return;
    }
    if (!generatedScript || !(generatedScript.scenes || generatedScript.scene_plan)?.length) {
      showToast('No script available.', 'error');
      return;
    }
    const scenes = generatedScript.scenes || generatedScript.scene_plan || [];
    const totalScenes = scenes.length;
    const recordedCount = scenes.filter(
      (s: any, i: number) =>
        manualAudioByScene[s.scene_number ?? s.sceneNumber ?? i + 1]?.status === 'uploaded'
    ).length;
    if (recordedCount !== totalScenes) {
      showToast('Please record all scenes before proceeding.', 'warning');
      return;
    }

    try {
      setIsProcessingManualAudio(true);
      
      // Determine if we should use transformed audio
      // transformedAudioByScene state indicates which scenes have been transformed
      const hasTransformedAudio = Object.values(transformedAudioByScene).some(t => t.status === 'completed');
      const useTransformed = hasTransformedAudio && transformActionMessage !== 'skip';
      
      // Set audio preference before processing (tells backend which audio to use for rendering)
      if (hasTransformedAudio) {
        try {
          await apiClient.setAudioPreference(projectId, useTransformed);
          console.log(`[AIChat] Audio preference set: useTransformed=${useTransformed}`);
        } catch (prefError: any) {
          console.error('Failed to set audio preference:', prefError);
          // Continue anyway, the backend will default to original if not set
        }
      }
      
      // Process manual audio (padding + fade on last scene)
      const processResponse = await apiClient.processManualAudio(projectId);
      if (!processResponse.success) {
        throw new Error(processResponse.message || 'Failed to process manual audio');
      }

      setVoiceSubstep('confirmed');
      setCurrentStep('audio-image-generation');
      setGenerationProgress(0);

      const styleToUse = selectedVideoStyle ||
        (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
      
      // Check if this is an avatar-only style that skips b-roll
      const isAvatarOnlyStyle = styleToUse === 'avatar-only' || styleToUse === 'AVATAR_ONLY' || 
                                 styleToUse === 'animated-avatar' || styleToUse === 'ANIMATED_AVATAR';

      // generateAudio returns existing for MANUAL mode
      let audioDone = false;
      setIsGeneratingVoice(true);
      try {
        const audioResponse = await apiClient.generateAudio(projectId);
        if (audioResponse.success && audioResponse.data?.existing) {
          setIsGeneratingVoice(false);
          audioDone = true;
          if (isAvatarOnlyStyle) {
            setGenerationProgress(30); // Audio done = 30% for avatar-only
          } else {
            setGenerationProgress(50);
          }
        } else if (audioResponse.success && audioResponse.data?.jobId) {
          audioJobIdRef.current = audioResponse.data.jobId;
          subscribeToJob(audioResponse.data.jobId, 'audio-generation');
        } else {
          throw new Error('Failed to start voice generation');
        }
      } catch (error: any) {
        console.error('Failed to generate audio:', error);
        setIsGeneratingVoice(false);
        showToast('Failed to prepare audio', 'error');
        return;
      }

      // For avatar-only styles, skip b-roll and trigger direct rendering after audio completes
      if (isAvatarOnlyStyle) {
        console.log('[AIChat] Avatar-only style (manual), skipping b-roll image generation');
        setIsGeneratingBroll(false);
        
        // If audio is already done, start rendering immediately
        if (audioDone) {
          await startAvatarOnlyRendering(projectId);
        }
        // Otherwise, rendering will be triggered when audio job completes (handled in WebSocket)
        return;
      }

      // Start broll image generation (same as AI path, for non-avatar-only styles)
      try {
        setIsGeneratingBroll(true);
        const productImageUrl = attachedAssets.find(asset =>
          asset.type === 'image' && asset.id.startsWith('product-')
        )?.url || null;

        const promises = scenes.map(async (scene: any, index: number) => {
          const sceneNumber = scene.scene_number ?? (index + 1);
          let prompt = scene.broll_image_prompt || scene.broll_visual_description || scene.broll || scene.prompt || '';
          if (!prompt && (styleToUse === 'alternate' || styleToUse === 'ALTERNATE')) {
            if (sceneNumber % 2 === 1) {
              prompt = scene.broll_visual_description ||
                (scene.voiceover ? `B-roll supporting: ${scene.voiceover.substring(0, 100)}` : '') ||
                `Scene ${sceneNumber} b-roll for half-n-half composition (top half)`;
            } else {
              prompt = scene.broll_visual_description ||
                (scene.voiceover ? `B-roll supporting: ${scene.voiceover.substring(0, 100)}` : '') ||
                `Scene ${sceneNumber} full-screen b-roll for ALTERNATE style`;
            }
          }
          if (!prompt) return;
          const modelId = (styleToUse === 'product-only' || styleToUse === 'avatar-product') ? 'model-4' : 'model-1';
          try {
            const imageResponse = await apiClient.regenerateImage(
              projectId, sceneNumber, prompt, modelId,
              undefined, undefined, productImageUrl || undefined, styleToUse || undefined
            );
            if (imageResponse.success && imageResponse.data?.jobId) {
              imageJobIdsRef.current.add(imageResponse.data.jobId);
              subscribeToJob(imageResponse.data.jobId, 'image-generation');
            }
          } catch (err: any) {
            console.error(`Failed to generate image for scene ${sceneNumber}:`, err);
          }
        });
        await Promise.all(promises);

        if (imageJobIdsRef.current.size === 0 && audioDone) {
          setIsGeneratingBroll(false);
          setGenerationProgress(100);
          setTimeout(() => router.push(`/create-video/workspace?projectId=${projectId}`), 1000);
        }
      } catch (error: any) {
        console.error('Failed to start image generation:', error);
        setIsGeneratingBroll(false);
        showToast('Failed to start image generation', 'error');
      }
    } catch (error: any) {
      console.error('Failed to process manual audio:', error);
      showToast(error?.message || 'Failed to process manual audio', 'error');
    } finally {
      setIsProcessingManualAudio(false);
    }
  };

  // Handle proceed to avatar selection (create project after script generation)
  const handleProceedToAvatarSelection = async () => {
    if (!generatedScript) {
      showToast('Please generate a script first', 'warning');
      return;
    }

    try {
      // Map selectedOption to videoType (infer from avatar preference)
      const videoType = (avatarPreference === 'library' || avatarPreference === 'generate') ? 'WITH_AVATAR' : 'WITHOUT_AVATAR';
      
      // Get selected style from state or sessionStorage
      const styleToUse = selectedVideoStyle || 
        (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
      
      // Map style to backend format
      const styleMap: Record<string, string> = {
        'half-n-half': 'HALF_N_HALF',
        'alternate': 'ALTERNATE',
        'avatar-cutout': 'AVATAR_CUTOUT',
        'avatar-only': 'AVATAR_ONLY',
        'product-only': 'PRODUCT_ONLY',
        'avatar-product': 'AVATAR_PRODUCT',
        'animated-avatar': 'ANIMATED_AVATAR',
        'broll-only': 'B_ROLL_ONLY',
      };
      
      // Determine next step based on style
      const shouldSkipAvatarSelection = styleToUse === 'product-only' || styleToUse === 'broll-only';
      const nextStep = shouldSkipAvatarSelection ? 'voice-selection' : 'avatar-selection';
      
      const createResponse = await apiClient.createVideoProject({
        videoType: videoType || 'WITHOUT_AVATAR',
        script: JSON.stringify(generatedScript),
        scriptGenerated: true,
        currentStep: 'SCRIPT', // Backend step for compatibility
        style: styleToUse ? (styleMap[styleToUse] as any) : 'AVATAR_CUTOUT', // Use selected style
        avatarMode: 'PREMIUM', // Set Premium as default for new AI chat flow
        metadata: {
          generationFlow: 'AI_CHAT',
          aiChatStep: nextStep, // Set correct step based on style
          aiChatAvatarSubstep: shouldSkipAvatarSelection ? undefined : 'question', // Skip avatar substep for product-only
          aiChatVoiceSubstep: 'question',
          assets: JSON.stringify(attachedAssets),
          formattedScript: formattedScript,
          selectedOption: selectedOption,
          userScriptMessage: userScriptMessage,
          selectedVideoStyle: styleToUse, // Store frontend style
        },
        status: 'DRAFT',
      });
      
      if (createResponse.success && createResponse.data) {
        const newProjectId = createResponse.data.id;
        setProjectId(newProjectId);
        
        // Update URL with projectId
        router.replace(`/create-video/ai-chat?projectId=${newProjectId}`);
        
        // Clear sessionStorage now that we have a project
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('pendingScriptData');
          sessionStorage.removeItem('pendingScriptFormatted');
          sessionStorage.removeItem('pendingUserPrompt');
          sessionStorage.removeItem('selectedVideoStyle'); // Clear style from sessionStorage
        }
        
        // Check if we should skip avatar selection for product-only style
        if (shouldSkipAvatarSelection) {
          // Skip avatar selection and go directly to voice selection
          setProceedConfirmed(true);
          setCurrentStep('voice-selection');
          // Set avatar preference to 'skip' since product-only doesn't use avatars
          setAvatarPreference('skip');
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('avatarPreference', 'skip');
          }
        } else {
          // Normal flow: advance to avatar selection
          setProceedConfirmed(true);
          setCurrentStep('avatar-selection');
        }
        
        showToast('Project saved successfully', 'success');
      } else {
        showToast('Failed to create project. Please try again.', 'error');
      }
    } catch (error: any) {
      console.error('Failed to create project:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to create project. Please try again.';
      showToast(errorMessage, 'error');
    }
  };

  // Handle proceed with selected style
  const handleProceedWithStyle = async () => {
    if (!selectedVideoStyle) {
      showToast('Please select a video style first', 'warning');
      return;
    }
    
    // Store style in sessionStorage temporarily (will be used for script generation)
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('selectedVideoStyle', selectedVideoStyle);
    }
    
    // Set substep to confirmed first (shows confirmation message)
    setStyleSubstep('confirmed');
    
    // After 1.5 seconds, advance to asset upload step
    setTimeout(() => {
      setCurrentStep('asset-upload');
    }, 1500);
  };

  // Handle language selection
  const handleLanguageSelection = (language: 'english' | 'hindi' | 'hinglish') => {
    setSelectedLanguage(language);
    setScriptSubstep('duration');
    
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('selectedScriptLanguage', language);
    }
  };

  const handleDurationSelection = (duration: VideoDurationChoice) => {
    setSelectedVideoDuration(duration);
    setScriptSubstep('input');
  };

  // Auto-save current step and substeps to project metadata (including assets-attached and script-input so reload restores correctly)
  useEffect(() => {
    if (projectId && currentStep !== 'welcome' && currentStep !== 'option-selected' && currentStep !== 'asset-upload') {
      const metadataUpdate: any = {
        generationFlow: 'AI_CHAT',
        aiChatStep: currentStep,
      };
      
      if (currentStep === 'avatar-selection') {
        metadataUpdate.aiChatAvatarSubstep = avatarSubstep;
        if (selectedAvatarVisualStyle) {
          metadataUpdate.avatarVisualStylePreset = selectedAvatarVisualStyle;
        }
        if (avatarPreference) {
          metadataUpdate.aiChatAvatarPreference = avatarPreference;
        }
      }
      if (currentStep === 'voice-selection') {
        metadataUpdate.aiChatVoiceSubstep = voiceSubstep;
        if (voiceMode) {
          metadataUpdate.voiceMode = voiceMode;
        }
        // Save transformed audio state for persistence
        if (Object.keys(transformedAudioByScene).length > 0) {
          metadataUpdate.transformedAudioByScene = transformedAudioByScene;
        }
        // Save selected STS voice for restoration
        if (selectedStsVoiceId) {
          metadataUpdate.selectedStsVoiceId = selectedStsVoiceId;
        }
        // Save voice transform settings
        if (voiceTransformSettings) {
          metadataUpdate.voiceTransformSettings = voiceTransformSettings;
        }
        // Save transform action message for display persistence
        // Always save (even when null) to properly clear previous value on back navigation
        metadataUpdate.transformActionMessage = transformActionMessage;
      }
      if (currentStep === 'style-selection') {
        metadataUpdate.aiChatStyleSubstep = styleSubstep;
      }
      
      apiClient.updateVideoProject(projectId, {
        metadata: metadataUpdate,
      }).catch(err => console.error('Failed to save step progress:', err));
    }
  }, [
    projectId,
    currentStep,
    avatarSubstep,
    voiceSubstep,
    styleSubstep,
    selectedAvatarVisualStyle,
    avatarPreference,
    voiceMode,
    transformedAudioByScene,
    selectedStsVoiceId,
    voiceTransformSettings,
    transformActionMessage,
  ]);

  // Auto-save language, duration, and tags selection to project metadata
  useEffect(() => {
    if (projectId && selectedLanguage) {
      apiClient.updateVideoProject(projectId, {
        metadata: {
          selectedLanguage: selectedLanguage,
          selectedVideoDuration,
          aiChatScriptSubstep: scriptSubstep,
          extractedTags: extractedTags,
        },
      }).catch(err => console.error('Failed to save language/tags:', err));
    }
  }, [projectId, selectedLanguage, selectedVideoDuration, scriptSubstep, extractedTags]);

  // Auto-save avatar selection to project
  useEffect(() => {
    if (projectId && selectedAvatarId && currentStep === 'avatar-selection') {
      apiClient.updateVideoProject(projectId, {
        avatarId: selectedAvatarId,
        avatarMode: 'PREMIUM', // Set Premium as default for new AI chat flow
      }).catch(err => console.error('Failed to save avatar:', err));
    }
  }, [projectId, selectedAvatarId, currentStep]);

  // Auto-save voice selection to project
  useEffect(() => {
    if (projectId && selectedVoiceId && currentStep === 'voice-selection') {
      apiClient.updateVideoProject(projectId, {
        voiceId: selectedVoiceId,
        voiceType: 'SYNTHETIC',
      }).catch(err => console.error('Failed to save voice:', err));
    }
  }, [projectId, selectedVoiceId, currentStep]);

  // Auto-save style selection to project
  useEffect(() => {
    if (projectId && selectedVideoStyle && currentStep === 'style-selection') {
      const styleMap: Record<string, string> = {
        'half-n-half': 'HALF_N_HALF',
        'alternate': 'ALTERNATE',
        'avatar-cutout': 'AVATAR_CUTOUT',
        'avatar-only': 'AVATAR_ONLY',
        'product-only': 'PRODUCT_ONLY',
        'avatar-product': 'AVATAR_PRODUCT',
        'animated-avatar': 'ANIMATED_AVATAR',
        'broll-only': 'B_ROLL_ONLY',
      };
      
      apiClient.updateVideoProject(projectId, {
        style: styleMap[selectedVideoStyle] as any,
        currentStep: 'STYLE_SELECTION', // For compatibility with old flow
        metadata: {
          generationFlow: 'AI_CHAT',
          aiChatStep: 'style-selection',
          aiChatStyleSubstep: styleSubstep,
        },
      }).catch(err => console.error('Failed to save style:', err));
    }
  }, [projectId, selectedVideoStyle, currentStep, styleSubstep]);

  // Recalculate manual visualizer lane count responsively based on container width
  // Must be before any conditional return to satisfy Rules of Hooks
  const MANUAL_VISUALIZER_HISTORY_LENGTH = 64;
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateLaneCount = () => {
      const el = manualVisualizerContainerRef.current;
      if (!el) return;
      const width = el.getBoundingClientRect().width;
      if (!width || !Number.isFinite(width)) return;

      const approxLanePixelWidth = 6; // dot width + minimal spacing
      const maxLanes = MANUAL_VISUALIZER_HISTORY_LENGTH;
      const lanes = Math.max(
        8,
        Math.min(maxLanes, Math.floor(width / approxLanePixelWidth)),
      );
      setManualVisualizerLaneCount(lanes);
    };

    updateLaneCount();
    window.addEventListener('resize', updateLaneCount);
    return () => {
      window.removeEventListener('resize', updateLaneCount);
    };
  }, []);

  // Recalculate input visualizer lane count responsively based on container width
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateInputLaneCount = () => {
      const el = inputVisualizerContainerRef.current;
      if (!el) return;
      const width = el.getBoundingClientRect().width;
      if (!width || !Number.isFinite(width)) return;

      const approxLanePixelWidth = 6; // bar width + minimal spacing
      const maxLanes = INPUT_VISUALIZER_HISTORY_LENGTH;
      const lanes = Math.max(
        8,
        Math.min(maxLanes, Math.floor(width / approxLanePixelWidth)),
      );
      setInputVisualizerLaneCount(lanes);
    };

    updateInputLaneCount();
    window.addEventListener('resize', updateInputLaneCount);
    return () => {
      window.removeEventListener('resize', updateInputLaneCount);
    };
  }, []);

  // Format duration helper
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle avatar selection
  const handleSelectAvatar = (avatar: any) => {
    setSelectedAvatarId(avatar.id);
    // Store in sessionStorage for later use
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('selectedAvatarId', avatar.id);
    }
  };

  // Handle avatar preview
  const handlePreviewAvatar = (avatar: any) => {
    setPreviewAvatar(avatar);
    setPreviewImageFailed(false); // Reset failed state for new preview
    setShowAvatarPreview(true);
  };

  // Handle proceed with selected avatar - advance to visual style substep
  const handleProceedWithAvatar = () => {
    if (selectedAvatarId) {
      // Find the selected avatar object
      const avatar = avatars.find(a => a.id === selectedAvatarId);
      if (avatar) {
        setSelectedAvatar(avatar);
      }
      setAvatarConfirmed(true);
      setAvatarSubstep('visual-style');
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('selectedAvatarId', selectedAvatarId);
      }
    } else {
      showToast('Please select an avatar first', 'warning');
    }
  };

  /** Absolute product image URL for avatar-product preview composite (server must fetch). */
  const resolveProductImageUrlForAvatarPreview = (): string | undefined => {
    if (selectedVideoStyle !== 'avatar-product') return undefined;
    const productAsset = attachedAssets.find(
      (a) => a.type === 'image' && a.id.startsWith('product-'),
    );
    const u = productAsset?.url;
    if (!u) return undefined;
    if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('blob:')) return u;
        if (typeof window !== 'undefined') {
      return u.startsWith('/') ? `${window.location.origin}${u}` : `${window.location.origin}/${u}`;
    }
    return u;
  };

  /** Shared preview pipeline for library (after visual-style) and generate-with-AI (after text-to-image). */
  const runAvatarPreviewFlow = async (
    rollbackSubstep: AvatarSubstep,
    options?: { avatarId?: string },
  ) => {
    const avatarIdForPreview = options?.avatarId ?? selectedAvatarId;
    if (!selectedAvatarVisualStyle) {
      showToast('Please select a visual style first', 'warning');
      return;
    }
    if (!projectId) {
      showToast('Project not found. Please try again.', 'error');
      return;
    }
    if (!avatarIdForPreview) {
      showToast('No avatar selected. Please select an avatar.', 'error');
      return;
    }
    try {
      await apiClient.updateVideoProject(projectId, {
        metadata: {
          aiChatStep: 'avatar-selection',
          aiChatAvatarSubstep: 'avatar-preview',
          avatarVisualStylePreset: selectedAvatarVisualStyle,
        },
      });
      
      setIsGeneratingAvatarPreview(true);
      setAvatarSubstep('avatar-preview');
      setAvatarPreviewUrl(null);
      setAvatarPreviewOriginalUrl(null);
      setAvatarPreviewImageKey(null);
      
      const previewResult = await apiClient.generateAvatarPreview({
        projectId,
        avatarId: avatarIdForPreview,
        script: generatedScript,
        style: selectedVideoStyle || undefined,
        avatarVisualStylePreset: selectedAvatarVisualStyle,
        productImageUrl: resolveProductImageUrlForAvatarPreview(),
        previewSceneIndex: 0,
      });
      
      if (previewResult.success && previewResult.data) {
        setAvatarPreviewUrl(previewResult.data.publicUrl);
        setAvatarPreviewOriginalUrl(previewResult.data.originalImageUrl ?? null);
        setAvatarPreviewImageKey(previewResult.data.imageKey ?? null);
        
        await apiClient.updateVideoProject(projectId, {
          metadata: {
            aiChatStep: 'avatar-selection',
            aiChatAvatarSubstep: 'avatar-preview',
            avatarVisualStylePreset: selectedAvatarVisualStyle,
            generatedAvatarImageKey: null,
            avatarImageScriptHash: null,
            avatarPreviewUrl: previewResult.data.publicUrl,
            avatarPreviewOriginalUrl: previewResult.data.originalImageUrl,
          },
        });
      } else {
        throw new Error(previewResult.message || 'Failed to generate avatar preview');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to generate avatar preview', 'error');
      setAvatarSubstep(rollbackSubstep);
    } finally {
      setIsGeneratingAvatarPreview(false);
    }
  };

  const handleProceedFromGenerateVisualStyle = () => {
    if (!selectedAvatarVisualStyle) {
      showToast('Please select a visual style first', 'warning');
      return;
    }
    setAvatarSubstep('text-generation');
  };

  // Handle generate avatar from text description (AI text-to-image), then go straight to preview
  const handleGenerateAvatarFromText = async () => {
    if (!avatarDescription.trim()) {
      showToast('Please describe your avatar first', 'warning');
      return;
    }
    if (!selectedAvatarVisualStyle) {
      showToast('Please select a visual style first', 'warning');
      return;
    }

    setIsGeneratingAvatarFromText(true);
    setAvatarGenerationError(null);

    try {
      const scriptPayload =
        generatedScript && typeof generatedScript === 'object'
          ? {
              avatar_image_prompt: generatedScript.avatar_image_prompt,
              visual_style_guide: generatedScript.visual_style_guide,
            }
          : undefined;

      const response = await apiClient.generateAvatarFromText({
        prompt: avatarDescription.trim(),
        projectId: projectId || undefined,
        style: selectedVideoStyle || undefined,
        avatarVisualStylePreset: selectedAvatarVisualStyle,
        script: scriptPayload,
      });

      if (response.success && response.avatarId) {
        setSelectedAvatarId(response.avatarId);
        setSelectedAvatar({
          id: response.avatarId,
          name: 'AI Generated Avatar',
          thumbnailUrl: response.thumbnailUrl,
          avatarUrl: response.avatarUrl,
          originalImageUrl: response.originalImageUrl,
        });
        setAvatarConfirmed(true);
        setAvatarYesMessage(true);

        if (typeof window !== 'undefined') {
          sessionStorage.setItem('selectedAvatarId', response.avatarId);
        }

        showToast('Avatar generated successfully!', 'success');
        await runAvatarPreviewFlow('text-generation', { avatarId: response.avatarId });
      } else {
        throw new Error(response.error || 'Failed to generate avatar');
      }
    } catch (error: any) {
      console.error('Error generating avatar from text:', error);
      setAvatarGenerationError(error.message || 'Failed to generate avatar. Please try again.');
      showToast('Failed to generate avatar', 'error');
    } finally {
      setIsGeneratingAvatarFromText(false);
    }
  };

  // Handle proceed with visual style - generate avatar preview and show preview substep
  const handleProceedWithVisualStyle = async () => {
    await runAvatarPreviewFlow('visual-style');
  };

  // Handle regenerate avatar preview
  const handleRegenerateAvatarPreview = async () => {
    if (!projectId || !selectedAvatarId) {
      showToast('Project or avatar not found. Please try again.', 'error');
      return;
    }
    try {
      setIsGeneratingAvatarPreview(true);
      setAvatarPreviewUrl(null);
      setAvatarPreviewOriginalUrl(null);
      setAvatarPreviewImageKey(null);
      
      const previewResult = await apiClient.generateAvatarPreview({
        projectId,
        avatarId: selectedAvatarId,
        script: generatedScript,
        style: selectedVideoStyle || undefined,
        avatarVisualStylePreset: selectedAvatarVisualStyle || undefined,
        productImageUrl: resolveProductImageUrlForAvatarPreview(),
        previewSceneIndex: 0,
      });
      
      if (previewResult.success && previewResult.data) {
        setAvatarPreviewUrl(previewResult.data.publicUrl);
        setAvatarPreviewOriginalUrl(previewResult.data.originalImageUrl ?? null);
        setAvatarPreviewImageKey(previewResult.data.imageKey ?? null);
        
        await apiClient.updateVideoProject(projectId, {
          metadata: {
            aiChatStep: 'avatar-selection',
            aiChatAvatarSubstep: 'avatar-preview',
            avatarVisualStylePreset: selectedAvatarVisualStyle,
            generatedAvatarImageKey: null,
            avatarImageScriptHash: null,
            avatarPreviewUrl: previewResult.data.publicUrl,
            avatarPreviewOriginalUrl: previewResult.data.originalImageUrl,
          },
        });
      } else {
        throw new Error(previewResult.message || 'Failed to regenerate avatar preview');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to regenerate avatar preview', 'error');
    } finally {
      setIsGeneratingAvatarPreview(false);
    }
  };

  // Handle proceed from avatar preview to voice selection
  const handleProceedFromAvatarPreview = async () => {
    if (!projectId) {
      showToast('Project not found. Please try again.', 'error');
      return;
    }
    if (!selectedAvatarId || !avatarPreviewUrl) {
      showToast('Avatar preview is not ready. Please wait or regenerate.', 'error');
      return;
    }
    try {
      const finalizeRes = await apiClient.finalizeAvatarPreview({
        avatarId: selectedAvatarId,
        previewImageUrl: avatarPreviewUrl,
        originalImageUrl: avatarPreviewOriginalUrl || undefined,
      });
      if (!finalizeRes.success || !finalizeRes.data?.imageKey) {
        throw new Error(
          finalizeRes.message || finalizeRes.error || 'Failed to finalize avatar for HeyGen',
        );
      }
      const imageKey = finalizeRes.data.imageKey;
      setAvatarPreviewImageKey(imageKey);

      // Match video-processing-service: sha256(JSON.stringify(project.script)) where script is a JSON string column
      let avatarImageScriptHash: string | undefined;
      if (generatedScript != null) {
        const inner = JSON.stringify(generatedScript);
        const forHash = JSON.stringify(inner);
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(forHash));
        avatarImageScriptHash = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }

      await apiClient.updateVideoProject(projectId, {
        metadata: {
          aiChatStep: 'voice-selection',
          aiChatAvatarSubstep: 'avatar-preview',
          aiChatVoiceSubstep: 'question',
          generatedAvatarImageKey: imageKey,
          ...(avatarImageScriptHash ? { avatarImageScriptHash } : {}),
        },
      });
      setCurrentStep('voice-selection');
      setVoiceSubstep('question');
      setVoiceYesMessage(false);
      setSelectedVoiceId(null);
      setVoiceUploadSuccess(false);
    } catch (err: any) {
      showToast(err.message || 'Failed to proceed', 'error');
    }
  };

  const handleBack = () => {
    if (currentStep === 'welcome') {
      router.push('/');
    } else if (currentStep === 'option-selected') {
      setCurrentStep('welcome');
      setSelectedOption(null);
    } else if (currentStep === 'asset-upload') {
      // Go back to style-selection
      setCurrentStep('style-selection');
      setStyleSubstep('selection');
      // Clear pending assets when going back
      pendingAssets.forEach(asset => {
        if (asset.preview) {
          URL.revokeObjectURL(asset.preview);
        }
      });
      setPendingAssets([]);
    } else if (currentStep === 'avatar-selection') {
      // Navigate back through substeps
      if (avatarSubstep === 'avatar-preview') {
        setAvatarPreviewUrl(null);
        setAvatarPreviewImageKey(null);
        if (avatarPreference === 'generate') {
          setAvatarSubstep('text-generation');
        } else {
          setAvatarSubstep('visual-style');
        }
      } else if (avatarSubstep === 'visual-style') {
        setAvatarSubstep('selection');
        setSelectedAvatarVisualStyle(null);
      } else if (avatarSubstep === 'text-generation') {
        setAvatarSubstep('generate-visual-style');
        setSelectedAvatarId(null);
        setSelectedAvatar(null);
        setAvatarConfirmed(false);
        setAvatarPreviewUrl(null);
        setAvatarPreviewImageKey(null);
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('selectedAvatarId');
        }
      } else if (avatarSubstep === 'generate-visual-style') {
        setAvatarSubstep('question');
        setAvatarYesMessage(false);
        setAvatarPreference(null);
        setSelectedAvatarVisualStyle(null);
      } else if (avatarSubstep === 'selection') {
        setAvatarConfirmed(false);
        setSelectedAvatar(null);
        // Go back to question substep
        setAvatarSubstep('question');
        setAvatarYesMessage(false);
        setSelectedAvatarId(null);
        setShowAvatarPreview(false);
        setPreviewAvatar(null);
      } else {
        // Go back to script-generated step
        setCurrentStep('script-generated');
        setProceedConfirmed(false);
        setAvatarSubstep('question'); // Reset substep
      }
    } else if (currentStep === 'voice-selection') {
      // Navigate back through substeps - handle both AI and MANUAL modes
      if (voiceMode === 'MANUAL') {
        // MANUAL mode substep order: question -> manual -> voice-transform -> scene-review -> confirmed
        if (voiceSubstep === 'confirmed') {
          // Go back to scene-review substep
          setVoiceSubstep('scene-review');
          setVoiceConfirmed(false);
        } else if (voiceSubstep === 'scene-review') {
          // Go back to voice-transform substep - clear transform state to allow re-selection
          setVoiceSubstep('voice-transform');
          setTransformActionMessage(null);
          // Clear transformed audio so user can re-transform with different settings
          setTransformedAudioByScene({});
        } else if (voiceSubstep === 'voice-transform') {
          // Go back to manual recording substep
          setVoiceSubstep('manual');
        } else if (voiceSubstep === 'manual') {
          // Go back to question substep
          setVoiceSubstep('question');
          setVoiceMode(null);
        } else {
          // At question substep, go back to avatar-selection step (avatar-preview substep)
          setCurrentStep('avatar-selection');
          setAvatarSubstep('avatar-preview');
          setVoiceSubstep('question');
          setAvatarUploadSuccess(false);
          setAvatarUploadMessageShown(false);
        }
      } else {
        // AI mode substep order: question -> selection -> confirmed
      if (voiceSubstep === 'confirmed') {
        // Go back to selection substep
        setVoiceSubstep('selection');
        setVoiceConfirmed(false);
        setSelectedVoiceId(null);
        setVoiceUploadSuccess(false);
      } else if (voiceSubstep === 'selection') {
        // Go back to question substep
        setVoiceSubstep('question');
        setVoiceYesMessage(false);
        setSelectedVoiceId(null);
        setVoiceUploadSuccess(false);
          setVoiceMode(null);
      } else {
          // At question substep, go back to avatar-selection step (avatar-preview substep)
        setCurrentStep('avatar-selection');
        setAvatarSubstep('avatar-preview');
          setVoiceSubstep('question');
        setAvatarUploadSuccess(false);
        setAvatarUploadMessageShown(false);
        }
      }
    } else if (currentStep === 'style-selection') {
      // Navigate back through substeps
      if (styleSubstep === 'confirmed') {
        // Go back to selection substep
        setStyleSubstep('selection');
      } else {
        // Go back to option-selected step (style is now before assets)
        setCurrentStep('option-selected');
        setSelectedVideoStyle(null);
        setStyleSubstep('selection'); // Reset style substep
        // Clear style from sessionStorage
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('selectedVideoStyle');
        }
      }
    } else if (currentStep === 'audio-image-generation') {
      // Go back to voice-selection with confirmed substep
      setCurrentStep('voice-selection');
      setVoiceSubstep('confirmed');
      // Stop generation if in progress
      setIsGeneratingVoice(false);
      setIsGeneratingBroll(false);
      setGenerationProgress(0);
      if (audioJobIdRef.current) {
        unsubscribeFromJob(audioJobIdRef.current);
        audioJobIdRef.current = null;
      }
      imageJobIdsRef.current.forEach(jobId => {
        unsubscribeFromJob(jobId);
      });
      imageJobIdsRef.current.clear();
    } else if (currentStep === 'script-generated') {
      setCurrentStep('script-input');
    } else if (currentStep === 'script-input') {
      setCurrentStep('assets-attached');
      setScriptSubstep('input');
      setUserScriptMessage(null);
      setScriptError(null);
      setScriptInput('');
    } else if (currentStep === 'assets-attached') {
      if (scriptSubstep === 'input') {
        setScriptSubstep('duration');
        setScriptInput('');
        setScriptError(null);
      } else if (scriptSubstep === 'duration') {
        setScriptSubstep('language');
        setSelectedLanguage(null);
        setSelectedVideoDuration('30 seconds');
      } else if (scriptSubstep === 'language') {
      attachedAssets.forEach(asset => {
        if (asset.preview) {
          URL.revokeObjectURL(asset.preview);
        }
      });
      setAttachedAssets([]);
      setGeneratedScript(null);
      setFormattedScript(null);
      setUserScriptMessage(null);
      setScriptError(null);
      setScriptInput('');
      setCurrentStep('asset-upload');
      }
    }
  };

  const getOptionLabel = (option: string) => {
    switch(option) {
      case 'ad': return 'Create an ad';
      case 'promo': return 'Create a promo video';
      case 'tutorial': return 'Create a tutorial';
      case 'ai-clip': return 'Create an AI clip';
      default: return 'Create a video';
    }
  };

  const getProgressStep = () => {
    switch(currentStep) {
      case 'welcome': return 0;
      case 'option-selected': return 1;
      case 'style-selection': return 2;
      case 'asset-upload': return 3;
      case 'assets-attached': return 3;
      case 'script-input': return 4;
      case 'script-generated': return 4;
      case 'avatar-selection': return 5;
      case 'voice-selection': return 6;
      case 'audio-image-generation': return 7;
      case 'workspace': return 7;
      default: return 0;
    }
  };

  const getProgressMessage = () => {
    switch(currentStep) {
      case 'welcome': return "Let's kick things off!";
      case 'option-selected': return "Choose your video style...";
      case 'style-selection': return "Pick your video style...";
      case 'asset-upload': return "Upload your visuals so I can shape your video.";
      case 'assets-attached':
      case 'script-input': return "Awesome! Now share your idea for video or paste your script.";
      case 'script-generated': return "Nice! Your story is set.";
      case 'avatar-selection': return "Choose your avatar style to bring the story to life.";
      case 'voice-selection': return "Time to give your avatar a voice.";
      case 'audio-image-generation': return "Generating audio and images...";
      case 'workspace': return "Your workspace is ready!";
      default: return "Let's kick things off!";
    }
  };

  // Helper function to check if a step has been reached (for cumulative rendering)
  const hasReachedStep = (step: ChatStep): boolean => {
    const stepOrder: ChatStep[] = ['welcome', 'option-selected', 'style-selection', 'asset-upload', 'assets-attached', 'script-input', 'script-generated', 'avatar-selection', 'voice-selection', 'audio-image-generation', 'workspace'];
    const currentIndex = stepOrder.indexOf(currentStep);
    const targetIndex = stepOrder.indexOf(step);
    return currentIndex >= targetIndex;
  };

  // Helper function to check if a substep has been reached
  const hasReachedSubstep = (step: ChatStep, substep: string): boolean => {
    if (!hasReachedStep(step)) return false;
    
    switch (step) {
      case 'avatar-selection': {
        const substepOrder: AvatarSubstep[] = [
          'question',
          'selection',
          'generate-visual-style',
          'text-generation',
          'visual-style',
          'avatar-preview',
        ];
        const targetIndex = substepOrder.indexOf(substep as AvatarSubstep);
        const currentIndex = substepOrder.indexOf(avatarSubstep);
        return targetIndex !== -1 && currentIndex >= targetIndex;
      }
      case 'voice-selection': {
        // Voice substeps depend on mode:
        // - AI mode: question -> selection -> confirmed
        // - MANUAL mode: question -> manual -> voice-transform -> scene-review -> confirmed
        const aiOrder: VoiceSubstep[] = ['question', 'selection', 'confirmed'];
        const manualOrder: VoiceSubstep[] = ['question', 'manual', 'voice-transform', 'scene-review', 'confirmed'];
        const substepOrder: VoiceSubstep[] = voiceMode === 'MANUAL' ? manualOrder : aiOrder;
        const targetIndex = substepOrder.indexOf(substep as VoiceSubstep);
        const currentIndex = substepOrder.indexOf(voiceSubstep);
        return targetIndex !== -1 && currentIndex >= targetIndex;
      }
      case 'style-selection': {
        const substepOrder: StyleSubstep[] = ['selection', 'confirmed'];
        const targetIndex = substepOrder.indexOf(substep as StyleSubstep);
        const currentIndex = substepOrder.indexOf(styleSubstep);
        return targetIndex !== -1 && currentIndex >= targetIndex;
      }
      default:
        return false;
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const userName = user?.name || 'User';
  const firstName = userName.split(' ')[0];
  
  // Compute if modal has any assets selected (for attach button state)
  const hasModalAssets = modalLogoAsset !== null || modalProductImages.length > 0 || (modalCompanyUrl && modalCompanyUrl.trim().length > 0);

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const rounded = Math.floor(seconds);
    const mins = Math.floor(rounded / 60)
      .toString()
      .padStart(2, '0');
    const secs = (rounded % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return (
    <div className="relative h-full flex flex-col min-h-0 overflow-x-hidden">
      {/* Hidden input for per-scene manual audio upload */}
      <input
        ref={manualUploadInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const sceneNumber = manualUploadSceneRef.current;
          const file = event.target.files?.[0] || null;
          // Reset input so selecting the same file again still triggers change
          event.target.value = '';
          if (!sceneNumber || !file) {
            return;
          }

          // Measure duration before upload, similar to recording flow
          const objectUrl = URL.createObjectURL(file);
          const audio = new Audio();
          audio.src = objectUrl;
          audio.addEventListener('loadedmetadata', () => {
            const duration = isFinite(audio.duration) ? audio.duration : undefined;
            URL.revokeObjectURL(objectUrl);
            uploadManualSceneAudio(sceneNumber, file, duration);
          });
          audio.addEventListener('error', () => {
            URL.revokeObjectURL(objectUrl);
            uploadManualSceneAudio(sceneNumber, file, undefined);
          });
        }}
      />

      {/* Main Container - Figma: width: 1248px, left: 96px, top: 43px */}
      <div className="relative max-w-[1248px] w-full mx-auto px-3 sm:px-6 md:px-[96px] pt-0 sm:pt-2 md:pt-[43px] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-2 md:pb-[43px] flex flex-col flex-1 min-h-0">
        {/* Navigation Bar — mobile: auto height so stepper (2 rows) is not clipped */}
        <div className="flex flex-row justify-between items-center mb-0 sm:mb-2 md:mb-[24px] flex-shrink-0 max-lg:min-h-[52px] max-lg:py-1 lg:h-[clamp(20px,3.3vh,34px)]">
          {/* Left: Back Arrow + AI Chat - Figma: gap: 20px */}
          <div className="flex flex-row items-center gap-[clamp(0.75rem,2vh,20px)] min-w-[90px] sm:min-w-[110px] md:min-w-[125px]">
            <button
              onClick={handleBack}
              className="flex items-center justify-center w-[clamp(16px,2.34vh,24px)] h-[clamp(16px,2.34vh,24px)] cursor-pointer hover:opacity-80 transition-opacity"
            >
              <ArrowLeft className="w-full h-full text-[#212121]" strokeWidth={1.5} />
            </button>
            {/* Figma: font: 24px, line-height: 24px */}
            <h2 className="font-heading text-[clamp(14px,2.34vh,24px)] font-medium leading-[clamp(14px,2.34vh,24px)] text-[#212121]">AI Chat</h2>
          </div>

          {/* Right: Stepper - Figma: width: 448px, height: 34px, gap: 6px */}
          <div className="flex flex-row items-center gap-0 pl-1 sm:pl-2 md:pl-2 max-w-[min(100%,280px)] sm:max-w-[300px] md:max-w-[400px] lg:max-w-[448px] w-full min-w-0 flex-1 lg:flex-initial">
            <div className="flex flex-col justify-between items-start gap-0.5 sm:gap-1 md:gap-1 w-full max-w-[180px] sm:max-w-[280px] md:max-w-[380px] lg:max-w-[440px] max-lg:h-auto lg:h-[clamp(20px,3.3vh,34px)] min-w-0">
              {/* Figma: height: 24px, gap: 10px, font: 14px, line-height: 24px */}
              <div className="flex flex-row justify-between items-center gap-[clamp(0.5rem,1vh,10px)] w-full min-h-0 lg:h-[clamp(18px,2.34vh,24px)]">
                <span className="font-heading text-[clamp(10px,1.37vh,14px)] font-normal leading-snug text-black line-clamp-2 min-w-0 flex-1 text-left">
                  {getProgressMessage()}
                </span>
                <span className="font-heading text-[clamp(10px,1.37vh,14px)] font-normal leading-[clamp(18px,2.34vh,24px)] text-black text-center min-w-[16px] sm:min-w-[18px] md:min-w-[19px]">
                  {getProgressStep()}/6
                </span>
              </div>
              {/* Figma: height: 10px, gap: 6px */}
              <div className="flex flex-row items-center gap-[clamp(0.25rem,0.6vh,6px)] w-full h-[clamp(6px,0.98vh,10px)]">
                {[0, 1, 2, 3, 4, 5, 6].map((index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex flex-col items-start h-[clamp(6px,0.98vh,10px)] flex-1 rounded-[5px]",
                      index < getProgressStep()
                        ? "bg-[#E86412]"
                        : "bg-white border border-[#E0E0E0]"
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Chat Window - Figma: padding: 52px 56px, gap: 20px, border-radius: 12px */}
        <div className="bg-white shadow-[0px_4px_22px_rgba(102,118,108,0.12)] rounded-xl py-[clamp(1rem,5.1vh,52px)] px-[clamp(0.75rem,5.5vh,56px)] max-lg:py-5 max-lg:px-4 flex flex-col justify-start items-start gap-[clamp(0.5rem,1.95vh,20px)] flex-1 min-h-0 overflow-hidden">
          {/* Chat Content Container - Figma: gap: 18px, justify-content: flex-end */}
          <div 
            ref={chatContainerRef}
            className="flex flex-col justify-start items-start gap-[clamp(0.5rem,1.76vh,18px)] w-full flex-1 min-h-0 overflow-y-auto scroll-smooth pb-[max(clamp(1rem,3vh,60px),env(safe-area-inset-bottom))] pr-[clamp(0.5rem,1vw,16px)] max-lg:gap-3"
            style={{ scrollBehavior: 'smooth' }}
          >
            {/* Welcome Message - Step 0 - Always show once reached */}
            {hasReachedStep('welcome') && (
              <div className="flex flex-col justify-center items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px]">
                {/* AI Icon - Figma: 64px x 64px */}
                <div className="w-[clamp(2rem,6.25vh,64px)] h-[clamp(2rem,6.25vh,64px)]">
                  <Image
                    src="/assets/mingcute_ai-line.svg"
                    alt="AI"
                    width={64}
                    height={64}
                    className="w-full h-full"
                  />
                </div>
                
                {/* Welcome Text - Figma: font: 48px, line-height: 48px */}
                <h1 className="font-heading text-[clamp(1.5rem,4.69vh,48px)] font-medium leading-[clamp(1.5rem,4.69vh,48px)] text-[#212121] max-w-full sm:max-w-[597px]">
                  Hey {firstName}
                  <br />
                  Welcome to UserGen
                </h1>
                
                {/* Body Text - Figma: font: 18px, line-height: 21px */}
                <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] max-w-full sm:max-w-[428px]">
                  Your creative studio powered by AI.
                  <br />
                  So, tell me... what kind of video are we making today?
                </p>
              </div>
            )}

            {/* Option Selected - Step 1 - Always show user response once option is selected */}
            {hasReachedStep('option-selected') && (
              <>
                {/* User Response - Always show once option is selected (even after moving forward) */}
                {selectedOption && (
                  <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                    <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(200px,26.9vw,275px)]">
                      <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(0.875rem,1.76vh,18px)] text-black text-right">
                        I want to {selectedOption === 'promo' ? 'create a promo video' : getOptionLabel(selectedOption || '').toLowerCase()}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Style Selection Step - MOVED BEFORE asset-upload to maintain correct order */}
            {hasReachedStep('style-selection') && (
              <>
                {/* AI Message - Style selection prompt */}
                <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                  <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                    How would you like your video to be styled? Choose a format that best fits your content.
                  </p>
                </div>

                {/* Style Selection Cards */}
                {hasReachedSubstep('style-selection', 'selection') && (
                  <div className={cn(
                    "flex flex-row flex-wrap items-center gap-[clamp(0.75rem,1.56vh,16px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full pl-[clamp(0.5rem,1vw,16px)]",
                    hasReachedSubstep('style-selection', 'confirmed') && "opacity-50 pointer-events-none"
                  )}>
                    {/* Half-n-Half Card */}
                    <button
                      onClick={() => setSelectedVideoStyle('half-n-half')}
                      className="relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] p-[2px] transition-all"
                      style={selectedVideoStyle === 'half-n-half'
                        ? { background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }
                        : {}}
                    >
                      <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[10px] p-[14px] gap-[clamp(0.375rem,0.59vh,6px)] flex flex-col items-center w-full min-w-0">
                        {/* Illustration */}
                        <div className="w-[clamp(110px,8.6vw,120px)] h-[clamp(150px,11.7vh,160px)] rounded-[8px] border border-white overflow-hidden flex-shrink-0">
                          <Image
                            src="/assets/style-half-n-half.svg"
                            alt="Half-n-Half"
                            width={120}
                            height={160}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        {/* Label */}
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.125rem,0.2vh,2px)] w-full min-w-0">
                          <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                            <Image
                              src="/assets/u_user-square.svg"
                              alt="Half-n-Half"
                              width={24}
                              height={24}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1.5rem,2.34vh,24px)] text-center text-[#000000] truncate min-w-0 flex-shrink">
                            Half-n-Half
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Avatar Only Card */}
                    <button
                      onClick={() => setSelectedVideoStyle('avatar-only')}
                      className="relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] p-[2px] transition-all"
                      style={selectedVideoStyle === 'avatar-only'
                        ? { background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }
                        : {}}
                    >
                      <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[10px] p-[14px] gap-[clamp(0.375rem,0.59vh,6px)] flex flex-col items-center w-full min-w-0">
                        {/* Illustration */}
                        <div className="w-[clamp(110px,8.6vw,120px)] h-[clamp(150px,11.7vh,160px)] rounded-[8px] border border-white overflow-hidden flex-shrink-0">
                          <Image
                            src="/assets/style-avatar-only.svg"
                            alt="Avatar Only"
                            width={120}
                            height={160}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        {/* Label */}
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.125rem,0.2vh,2px)] w-full min-w-0">
                          <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                            <Image
                              src="/assets/u_user-square.svg"
                              alt="Avatar Only"
                              width={24}
                              height={24}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1.5rem,2.34vh,24px)] text-center text-[#000000] truncate min-w-0 flex-shrink">
                            Avatar Only
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Avatar Cut-out Card */}
                    <button
                      onClick={() => setSelectedVideoStyle('avatar-cutout')}
                      className="relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] p-[2px] transition-all"
                      style={selectedVideoStyle === 'avatar-cutout'
                        ? { background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }
                        : {}}
                    >
                      <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[10px] p-[14px] gap-[clamp(0.375rem,0.59vh,6px)] flex flex-col items-center w-full min-w-0">
                        {/* Illustration */}
                        <div className="w-[clamp(110px,8.6vw,120px)] h-[clamp(150px,11.7vh,160px)] rounded-[8px] border border-white overflow-hidden flex-shrink-0">
                          <Image
                            src="/assets/style-avatar-cutout.svg"
                            alt="Avatar Cut-out"
                            width={120}
                            height={160}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        {/* Label */}
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.125rem,0.2vh,2px)] w-full min-w-0">
                          <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                            <Image
                              src="/assets/fi_scissors.svg"
                              alt="Avatar Cut-out"
                              width={24}
                              height={24}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1.5rem,2.34vh,24px)] text-center text-[#000000] truncate min-w-0 flex-shrink">
                            Avatar Cut-out
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Alternate Card */}
                    <button
                      onClick={() => setSelectedVideoStyle('alternate')}
                      className="relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] p-[2px] transition-all"
                      style={selectedVideoStyle === 'alternate'
                        ? { background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }
                        : {}}
                    >
                      <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[10px] p-[14px] gap-[clamp(0.375rem,0.59vh,6px)] flex flex-col items-center w-full min-w-0">
                        {/* Illustration */}
                        <div className="w-[clamp(110px,8.6vw,120px)] h-[clamp(150px,11.7vh,160px)] rounded-[8px] border border-white overflow-hidden flex-shrink-0">
                          <Image
                            src="/assets/style-alternate.svg"
                            alt="Alternate"
                            width={120}
                            height={160}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        {/* Label */}
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.125rem,0.2vh,2px)] w-full min-w-0">
                          <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                            <Image
                              src="/assets/u_sync.svg"
                              alt="Alternate"
                              width={24}
                              height={24}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1.5rem,2.34vh,24px)] text-center text-[#000000] truncate min-w-0 flex-shrink">
                            Alternate
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Product Only Card */}
                    <button
                      onClick={() => setSelectedVideoStyle('product-only')}
                      className="relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] p-[2px] transition-all"
                      style={selectedVideoStyle === 'product-only'
                        ? { background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }
                        : {}}
                    >
                      <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[10px] p-[14px] gap-[clamp(0.375rem,0.59vh,6px)] flex flex-col items-center w-full min-w-0">
                        {/* Illustration */}
                        <div className="w-[clamp(110px,8.6vw,120px)] h-[clamp(150px,11.7vh,160px)] rounded-[8px] border border-white overflow-hidden flex-shrink-0">
                          <Image
                            src="/assets/style-product-only.svg"
                            alt="Product Only"
                            width={120}
                            height={160}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        {/* Label */}
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.125rem,0.2vh,2px)] w-full min-w-0">
                          <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                            <Image
                              src="/assets/u_product.svg"
                              alt="Product Only"
                              width={24}
                              height={24}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1.5rem,2.34vh,24px)] text-center text-[#000000] truncate min-w-0 flex-shrink">
                            Product Only
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* B-roll Only Card */}
                    <button
                      onClick={() => setSelectedVideoStyle('broll-only')}
                      className="relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] p-[2px] transition-all"
                      style={selectedVideoStyle === 'broll-only'
                        ? { background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }
                        : {}}
                    >
                      <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[10px] p-[14px] gap-[clamp(0.375rem,0.59vh,6px)] flex flex-col items-center w-full min-w-0">
                        <div className="w-[clamp(110px,8.6vw,120px)] h-[clamp(150px,11.7vh,160px)] rounded-[8px] border border-white overflow-hidden flex-shrink-0">
                          <Image
                            src="/assets/style-alternate.svg"
                            alt="B-roll Only"
                            width={120}
                            height={160}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.125rem,0.2vh,2px)] w-full min-w-0">
                          <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                            <Image
                              src="/assets/u_sync.svg"
                              alt="B-roll Only"
                              width={24}
                              height={24}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1.5rem,2.34vh,24px)] text-center text-[#000000] truncate min-w-0 flex-shrink">
                            B-roll Only
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Avatar with Product Card */}
                    <button
                      onClick={() => setSelectedVideoStyle('avatar-product')}
                      className="relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] p-[2px] transition-all"
                      style={selectedVideoStyle === 'avatar-product'
                        ? { background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }
                        : {}}
                    >
                      <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[10px] p-[14px] gap-[clamp(0.375rem,0.59vh,6px)] flex flex-col items-center w-full min-w-0">
                        {/* Illustration */}
                        <div className="w-[clamp(110px,8.6vw,120px)] h-[clamp(150px,11.7vh,160px)] rounded-[8px] border border-white overflow-hidden flex-shrink-0">
                          <Image
                            src="/assets/style-avatar-product.svg"
                            alt="Avatar with Product"
                            width={120}
                            height={160}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        {/* Label */}
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.125rem,0.2vh,2px)] w-full min-w-0">
                          <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                            <Image
                              src="/assets/u_user-square.svg"
                              alt="Avatar with Product"
                              width={24}
                              height={24}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1.5rem,2.34vh,24px)] text-center text-[#000000] truncate min-w-0 flex-shrink">
                            Avatar with Product
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Animated Avatar Card */}
                    <button
                      onClick={() => setSelectedVideoStyle('animated-avatar')}
                      className="relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] p-[2px] transition-all"
                      style={selectedVideoStyle === 'animated-avatar'
                        ? { background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }
                        : {}}
                    >
                      <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[10px] p-[14px] gap-[clamp(0.375rem,0.59vh,6px)] flex flex-col items-center w-full min-w-0">
                        {/* Illustration - reuse avatar-only for now; replace with style-animated-avatar.svg when available */}
                        <div className="w-[clamp(110px,8.6vw,120px)] h-[clamp(150px,11.7vh,160px)] rounded-[8px] border border-white overflow-hidden flex-shrink-0">
                          <Image
                            src="/assets/style-avatar-only.svg"
                            alt="Animated Avatar"
                            width={120}
                            height={160}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        {/* Label */}
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.125rem,0.2vh,2px)] w-full min-w-0">
                          <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                            <Image
                              src="/assets/u_user-square.svg"
                              alt="Animated Avatar"
                              width={24}
                              height={24}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1.5rem,2.34vh,24px)] text-center text-[#000000] truncate min-w-0 flex-shrink">
                            Animated Avatar
                          </span>
                        </div>
                      </div>
                    </button>
                  </div>
                )}

                {/* Proceed Button for Style Selection */}
                {hasReachedSubstep('style-selection', 'selection') && selectedVideoStyle && styleSubstep === 'selection' && (
                  <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                    <button
                      onClick={handleProceedWithStyle}
                      className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
                    >
                      <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                        <Image
                          src="/assets/u_arrow-right.svg"
                          alt="Proceed"
                          width={12}
                          height={12}
                          className="w-fit"
                        />
                      </div>
                      <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                        Proceed
                      </span>
                    </button>
                  </div>
                )}

                {/* Selected Style Confirmation */}
                {hasReachedSubstep('style-selection', 'confirmed') && selectedVideoStyle && (
                  <>
                    {/* User message showing selected style */}
                    <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                      <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(275px,21.4vw,275px)]">
                        <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(0.875rem,1.76vh,18px)] text-[#212121] text-right">
                          I want {selectedVideoStyle === 'half-n-half' ? 'Half-n-Half' : 
                                  selectedVideoStyle === 'avatar-only' ? 'Avatar Only' : 
                                  selectedVideoStyle === 'avatar-cutout' ? 'Avatar Cut-out' : 
                                  selectedVideoStyle === 'product-only' ? 'Product Only' :
                                  selectedVideoStyle === 'broll-only' ? 'B-roll Only' :
                                  selectedVideoStyle === 'avatar-product' ? 'Avatar with Product' :
                                  selectedVideoStyle === 'animated-avatar' ? 'Animated Avatar' :
                                  'Alternate'} visual style
                        </span>
                        
                        {/* Selected style card preview */}
                        <div className="flex flex-col items-center p-[14px] gap-[clamp(0.375rem,0.59vh,6px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[12px] w-[clamp(140px,11vw,152px)]">
                          {/* Illustration */}
                          <div className="w-[clamp(110px,8.6vw,120px)] h-[clamp(150px,11.7vh,160px)] rounded-[8px] border border-white overflow-hidden flex-shrink-0">
                            <Image
                              src={`/assets/style-${selectedVideoStyle === 'half-n-half' ? 'half-n-half' : 
                                          selectedVideoStyle === 'avatar-only' ? 'avatar-only' : 
                                          selectedVideoStyle === 'avatar-cutout' ? 'avatar-cutout' : 
                                          selectedVideoStyle === 'product-only' ? 'product-only' :
                                          selectedVideoStyle === 'broll-only' ? 'alternate' :
                                          selectedVideoStyle === 'avatar-product' ? 'avatar-product' :
                                          selectedVideoStyle === 'animated-avatar' ? 'avatar-only' : 'alternate'}.svg`}
                              alt={selectedVideoStyle}
                              width={120}
                              height={160}
                              className="w-full h-full object-contain"
                            />
                          </div>
                          {/* Label */}
                          <div className="flex flex-row justify-center items-center gap-[clamp(0.125rem,0.2vh,2px)] w-full min-w-0">
                            <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                              <Image
                                src={`/assets/${selectedVideoStyle === 'avatar-cutout' ? 'fi_scissors' : 
                                        selectedVideoStyle === 'alternate' ? 'u_sync' : 
                                        selectedVideoStyle === 'product-only' ? 'u_product' :
                                        selectedVideoStyle === 'broll-only' ? 'u_sync' :
                                        selectedVideoStyle === 'animated-avatar' ? 'u_user-square' :
                                        'u_user-square'}.svg`}
                                alt={selectedVideoStyle}
                                width={24}
                                height={24}
                                className="w-full h-full"
                              />
                            </div>
                            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1.5rem,2.34vh,24px)] text-center text-[#000000] truncate min-w-0 flex-shrink">
                              {selectedVideoStyle === 'half-n-half' ? 'Half-n-Half' : 
                               selectedVideoStyle === 'avatar-only' ? 'Avatar Only' : 
                               selectedVideoStyle === 'avatar-cutout' ? 'Avatar Cut-out' : 
                               selectedVideoStyle === 'product-only' ? 'Product Only' :
                               selectedVideoStyle === 'broll-only' ? 'B-roll Only' :
                               selectedVideoStyle === 'avatar-product' ? 'Avatar with Product' :
                               selectedVideoStyle === 'animated-avatar' ? 'Animated Avatar' :
                               'Alternate'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* Asset Upload - Removed duplicate welcome message and user response */}
            {hasReachedStep('asset-upload') && (
              <>
                {/* Asset Upload Section - Only show when on asset-upload step */}
                {hasReachedStep('asset-upload') && !hasReachedStep('assets-attached') && (
                  <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] w-full max-w-full sm:max-w-[459px]">
                    {/* Figma: font: 18px, line-height: 21px */}
                    <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                      Add in your video assets to help us create your video...
                    </p>
                    
                    {/* AI Recommendation Box - Figma: padding: 8px 16px, border-radius: 24px, width: 459px, height: 108px, border: 2px gradient */}
                    <div className="relative w-full rounded-[24px] p-[2px] bg-gradient-to-r from-[rgba(255,211,183,1)] to-[rgba(246,166,166,1)]">
                      <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[22px] py-[clamp(0.5rem,0.78vh,8px)] px-[clamp(1rem,1.56vh,16px)] w-full flex flex-col justify-center items-start gap-[clamp(0.5rem,0.78vh,8px)]">
                        {/* Figma: gap: 10px, height: 21px */}
                        <div className="flex flex-row items-center gap-[clamp(0.625rem,0.98vh,10px)] w-full">
                          {/* Figma: 16px x 16px */}
                          <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] flex-shrink-0">
                            <Image
                              src="/assets/mingcute_ai-line-1.svg"
                              alt="AI"
                              width={16}
                              height={16}
                              className="w-full h-full"
                            />
                          </div>
                          {/* Figma: font: 16px, line-height: 21px, gradient text */}
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-[clamp(1.3125rem,2.05vh,21px)] bg-gradient-to-b from-[#E86412] to-[#F12A4C] bg-clip-text text-transparent">
                            AI recommendation
                          </span>
                        </div>
                        {/* Figma: font: 16px, line-height: 21px, width: 427px (459 - 32px padding) */}
                        <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1.3125rem,2.05vh,21px)] text-[#212121] w-full">
                          Attach your brand logo, product images and your company URL from Add Assets button so we can create a video specialized to your needs.
                        </p>
                      </div>
                    </div>
                    
                    {/* Skip this step - Outside the recommendation box */}
                    {!isProductImageRequired() && (
                      <button
                        onClick={handleSkipAssets}
                        className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1.75rem,2.73vh,28px)] text-transparent bg-gradient-to-b from-[#E86412] to-[#F12A4C] bg-clip-text underline self-start"
                      >
                        Skip this step
                      </button>
                    )}
                    {isProductImageRequired() && !hasProductImage() && (
                      <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1.3125rem,2.05vh,21px)] text-[#F12A4C] self-start">
                        * Product image is required for this video style
                      </p>
                    )}
                  </div>
                )}

                {/* Assets Attached - Display in chat */}
                {hasReachedStep('assets-attached') && (
                  <>
                    {/* Display previously shown messages and attached assets */}
                    {attachedAssets.length > 0 && (
                      <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                        <div className="flex flex-col gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,600px)]">
                          {/* Display assets as chips with previews */}
                          <div className="flex flex-col gap-[clamp(0.25rem,0.39vh,4px)] max-lg:flex-row max-lg:flex-wrap max-lg:justify-between max-lg:w-full">
                            {attachedAssets.map((asset) => (
                              <div
                                key={asset.id}
                                className="flex flex-row items-center gap-[clamp(0.375rem,0.78vh,8px)] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.25rem,0.39vh,4px)] bg-white rounded-[40px]"
                              >
                                {/* Preview icon */}
                                <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] relative flex-shrink-0">
                                  {asset.type === 'image' && asset.preview ? (
                                    <img
                                      src={asset.preview}
                                      alt={asset.name}
                                      className="w-full h-full object-cover rounded-full"
                                    />
                                  ) : asset.type === 'url' ? (
                                    <Image
                                      src="/assets/u_link.svg"
                                      alt="URL"
                                      width={16}
                                      height={16}
                                      className="w-full h-full"
                                    />
                                  ) : (
                                    <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center">
                                      <span className="text-[10px]">IMG</span>
                                    </div>
                                  )}
                                </div>
                                
                                {/* Asset name */}
                                <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-black max-w-[140px] truncate">
                                  {asset.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* AI Response - Language selection prompt after assets attached (stays in history; disabled after choice) */}
                    {hasReachedStep('assets-attached') && (
                      <div className="flex flex-col items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px] mt-[clamp(0.5rem,0.98vh,10px)]">
                        <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] max-w-full sm:max-w-[852px]">
                          Perfect! Before we shape your script, what language would you like your video to be in?
                        </p>
                        
                        {/* Language Selection Buttons */}
                        <div
                          className={cn(
                            'flex flex-row flex-wrap gap-[clamp(0.5rem,0.98vh,10px)] mt-[clamp(0.25rem,0.5vh,6px)]',
                            scriptSubstep !== 'language' && 'opacity-60 pointer-events-none',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => handleLanguageSelection('english')}
                            className={cn(
                              "flex flex-row justify-center items-center px-[clamp(1rem,2vh,24px)] py-[clamp(0.5rem,1vh,12px)] rounded-[20px] transition-all duration-200",
                              selectedLanguage === 'english'
                                ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C] text-white"
                                : "bg-white border border-[#E0E0E0] text-[#212121] hover:border-[#E86412] hover:text-[#E86412]"
                            )}
                          >
                            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium">🇬🇧 English</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLanguageSelection('hindi')}
                            className={cn(
                              "flex flex-row justify-center items-center px-[clamp(1rem,2vh,24px)] py-[clamp(0.5rem,1vh,12px)] rounded-[20px] transition-all duration-200",
                              selectedLanguage === 'hindi'
                                ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C] text-white"
                                : "bg-white border border-[#E0E0E0] text-[#212121] hover:border-[#E86412] hover:text-[#E86412]"
                            )}
                          >
                            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium">🇮🇳 Hindi</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLanguageSelection('hinglish')}
                            className={cn(
                              "flex flex-row justify-center items-center px-[clamp(1rem,2vh,24px)] py-[clamp(0.5rem,1vh,12px)] rounded-[20px] transition-all duration-200",
                              selectedLanguage === 'hinglish'
                                ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C] text-white"
                                : "bg-white border border-[#E0E0E0] text-[#212121] hover:border-[#E86412] hover:text-[#E86412]"
                            )}
                          >
                            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium">🇮🇳 Hinglish</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* User language selection response (shown during duration + script input substeps) */}
                    {hasReachedStep('assets-attached') && selectedLanguage && (
                      <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px]">
                          <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(0.875rem,1.76vh,18px)] text-black text-right">
                            {selectedLanguage === 'english' ? '🇬🇧 English' : selectedLanguage === 'hindi' ? '🇮🇳 Hindi' : '🇮🇳 Hinglish'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Duration selection prompt (options moved to bottom bar while on duration substep) */}
                    {currentStep === 'assets-attached' &&
                      !hasReachedStep('script-input') &&
                      selectedLanguage &&
                      (scriptSubstep === 'duration' || scriptSubstep === 'input') && (
                      <div className="flex flex-col items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px] mt-[clamp(0.5rem,0.98vh,10px)]">
                        <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] max-w-full sm:max-w-[852px]">
                          How long should your video be?
                        </p>
                      </div>
                    )}

                    {/* User duration chip */}
                    {currentStep === 'assets-attached' &&
                      scriptSubstep === 'input' &&
                      selectedLanguage &&
                      !hasReachedStep('script-input') && (
                      <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px]">
                          <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(0.875rem,1.76vh,18px)] text-black text-right">
                            {VIDEO_DURATION_OPTIONS.find((o) => o.value === selectedVideoDuration)?.label ?? selectedVideoDuration}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* AI Response - Script prompt after duration selected */}
                    {currentStep === 'assets-attached' && scriptSubstep === 'input' && !hasReachedStep('script-input') && (
                      <div className="flex flex-col items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px] mt-[clamp(0.5rem,0.98vh,10px)]">
                        <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] max-w-full sm:max-w-[852px]">
                          Perfect! Now let's shape your message.<br />
                          Tell me your video idea, or paste your script if you already have one.<br />
                          If you're not sure, just describe the goal—I'll write the script for you.
                        </p>
                      </div>
                    )}

                    {/* User Script Message - Show when script-input or script-generated */}
                    {hasReachedStep('script-input') && userScriptMessage && (
                      <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                        <div className="flex flex-col items-end gap-[clamp(0.25rem,0.5vh,6px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,568px)]">
                          {/* Display message with highlighted @tags */}
                          <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.76vh,18px)] text-black text-right whitespace-pre-wrap break-words">
                            {userScriptMessage.split(/(@\w+)/g).map((part, index) => {
                              if (part.match(/^@\w+$/)) {
                                // This is a tag - highlight it
                                return (
                                  <span
                                    key={index}
                                    className="inline-flex items-center px-[clamp(0.375rem,0.75vh,8px)] py-[clamp(0.125rem,0.25vh,3px)] bg-gradient-to-r from-[#E86412]/20 to-[#F12A4C]/20 rounded-full text-[#E86412] font-medium mx-[2px]"
                                  >
                                    {part}
                                  </span>
                                );
                              }
                              return part;
                            })}
                          </span>
                          
                          {/* Show extracted tags summary if any */}
                          {extractedTags.length > 0 && (
                            <div className="flex flex-wrap justify-end gap-[clamp(0.25rem,0.5vh,6px)] mt-[clamp(0.25rem,0.5vh,4px)]">
                              <span className="font-heading text-[clamp(0.625rem,1.17vh,12px)] text-[#757575]">
                                Tags: {extractedTags.join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Loading State - Show while generating script */}
                    {isGeneratingScript && (
                      <div className="flex flex-col items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px] mt-[clamp(0.5rem,0.98vh,10px)]">
                        <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                          Generating your script...
                        </p>
                      </div>
                    )}

                    {/* Error Message - Show if script generation fails */}
                    {scriptError && (
                      <div className="flex flex-col items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px] mt-[clamp(0.5rem,0.98vh,10px)]">
                        <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-red-600">
                          {scriptError}
                        </p>
                      </div>
                    )}

                    {/* Script Generated Section */}
                    {hasReachedStep('script-generated') && normalizedSceneList.length > 0 && (
                      <>
                        {/* AI Response - "Here's your script!" */}
                        <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                          <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                            Here's your script!
                          </p>
                        </div>

                        {/* Script Scene Review Box */}
                        <div className="relative w-full sm:w-[760px] max-w-full mt-[clamp(0.5rem,0.78vh,8px)] p-[clamp(0.5rem,0.75vh,12px)] rounded-[8px]" style={{
                          background: 'linear-gradient(251.58deg, rgba(255, 255, 255, 0) 0.74%, rgba(255, 255, 255, 0.8) 58.96%), linear-gradient(114.13deg, rgba(232, 100, 18, 0.4) 35.62%, rgba(254, 89, 191, 0.4) 48.81%, rgba(231, 57, 19, 0.4) 64.75%, rgba(254, 201, 89, 0.4) 83.76%, rgba(232, 100, 18, 0.4) 93.57%)'
                        }}>
                          <div className="bg-white rounded-[8px] p-[clamp(0.5rem,0.78vh,8px)] w-full min-h-[200px]">
                            <div className="flex flex-col gap-[clamp(0.5rem,0.98vh,10px)]">
                              {normalizedSceneList.map((scene) => {
                                const draft = sceneDraftByNumber[scene.sceneNumber] || scene;
                                const isEditing = activeSceneEditNumber === scene.sceneNumber;
                                const isDirty =
                                  draft.voiceover !== scene.voiceover ||
                                  draft.brollPrompt !== scene.brollPrompt;
                                return (
                                  <div
                                    key={scene.sceneNumber}
                                    className="border border-[#F0E0D8] rounded-[14px] p-[clamp(0.5rem,0.98vh,12px)]"
                                  >
                                    <div className="flex flex-row items-start gap-[clamp(0.5rem,0.98vh,12px)]">
                                      <div className="flex items-center justify-center w-[34px] h-[34px] rounded-full bg-[#FFF3EB] border border-[#F4C6AE] text-[#C64D0D] font-heading text-sm font-medium flex-shrink-0">
                                        {scene.sceneNumber}
                                      </div>
                                      <div className="flex-1 min-w-0 flex flex-col gap-3">
                                        <div>
                                          <p className="text-[12px] text-[#7A7A7A] mb-1">Voiceover</p>
                                          {isEditing ? (
                                            <SceneEditInput
                                              value={draft.voiceover}
                                              onChange={(value) => handleSceneDraftChange(scene.sceneNumber, 'voiceover', value)}
                                              onSave={() => handleSaveSceneEdit(scene.sceneNumber)}
                                              onCancel={() => handleCancelSceneEdit(scene.sceneNumber)}
                                              placeholder="Enter voiceover text..."
                                              disabled={isSavingScriptScene}
                                              isSaving={isSavingScriptScene}
                                              isDirty={isDirty}
                                            />
                                          ) : (
                                            <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] text-[#212121] whitespace-pre-wrap">{scene.voiceover || '-'}</p>
                                          )}
                                        </div>
                                        <div>
                                          <p className="text-[12px] text-[#7A7A7A] mb-1">Visuals</p>
                                          {isEditing ? (
                                            <SceneEditInput
                                              value={draft.brollPrompt}
                                              onChange={(value) => handleSceneDraftChange(scene.sceneNumber, 'brollPrompt', value)}
                                              onSave={() => handleSaveSceneEdit(scene.sceneNumber)}
                                              onCancel={() => handleCancelSceneEdit(scene.sceneNumber)}
                                              placeholder="Enter visual description..."
                                              disabled={isSavingScriptScene}
                                              isSaving={isSavingScriptScene}
                                              isDirty={isDirty}
                                            />
                                          ) : (
                                            <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] text-[#212121] whitespace-pre-wrap">{scene.brollPrompt || '-'}</p>
                                          )}
                                        </div>
                                      </div>
                                      {/* Only show Edit button when NOT editing and allowed */}
                                      {!isEditing && !proceedConfirmed && currentStep === 'script-generated' && (
                                        <div className="flex flex-col gap-2 flex-shrink-0">
                                          <button 
                                            type="button"
                                            onClick={() => handleStartSceneEdit(scene.sceneNumber)}
                                            className="w-8 h-8 rounded-full border border-[#E0E0E0] text-[#424242] bg-white hover:border-[#E86412] hover:text-[#E86412] inline-flex items-center justify-center"
                                            aria-label={`Edit scene ${scene.sceneNumber}`}
                                          >
                                            <Pencil className="w-4 h-4" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {scriptSceneSaveError && (
                              <p className="mt-3 text-sm text-red-600">{scriptSceneSaveError}</p>
                            )}
                          </div>
                        </div>

                        {/* "Want me to regenerate?" Message */}
                        <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                          <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                            Want me to regenerate or should we move to the next step?
                          </p>
                        </div>
                      </>
                    )}
                    {hasReachedStep('script-generated') && normalizedSceneList.length === 0 && formattedScript && (
                      <div className="relative w-full sm:w-[637px] max-w-full mt-[clamp(0.5rem,0.78vh,8px)] p-[clamp(0.75rem,1vh,14px)] rounded-[8px] bg-white border border-[#F0E0D8]">
                        <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] text-[#616161]">
                          Script scenes are not available in a structured format yet. Please regenerate once to review scene-wise content.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* Avatar Selection Step - Only show NEW avatar-specific content */}
            {hasReachedStep('avatar-selection') && selectedVideoStyle !== 'product-only' && selectedVideoStyle !== 'broll-only' && (
              <>
                {/* User Confirmation Message - "Looks good, let's go ahead!" - Only show if we just came from script-generated */}
                {proceedConfirmed && (
                  <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                    <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,568px)]">
                      <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(0.875rem,1.76vh,18px)] text-black text-right whitespace-pre-wrap break-words">
                        Looks good, let's go ahead!
                      </span>
                    </div>
                  </div>
                )}

                {/* Avatar Selection Question and UI - Only show NEW content for avatar selection */}

                {/* SUB-PART 1: Question Substep - Show question, disable when past question */}
                {hasReachedSubstep('avatar-selection', 'question') && (
                  <div className={cn(hasReachedSubstep('avatar-selection', 'selection') && "opacity-50 pointer-events-none")}>
                    {/* AI Question - "Would you like an avatar in the video?" */}
                    <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                      <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                        Would you like an avatar in the video?
                      </p>
                    </div>

                    {/* AI Recommendation Box - Avatar Benefits */}
                    <div className="relative w-full max-w-full sm:max-w-[459px] rounded-[24px] p-[2px] bg-gradient-to-r from-[rgba(255,211,183,1)] to-[rgba(246,166,166,1)] mt-[clamp(0.5rem,0.98vh,10px)]">
                      <div className="bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[22px] py-[clamp(0.5rem,0.78vh,8px)] px-[clamp(1rem,1.56vh,16px)] w-full flex flex-col justify-center items-start gap-[clamp(0.5rem,0.78vh,8px)]">
                        {/* AI recommendation header */}
                        <div className="flex flex-row items-center gap-[clamp(0.625rem,0.98vh,10px)] w-full">
                          <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] flex-shrink-0">
                            <Image
                              src="/assets/mingcute_ai-line-1.svg"
                              alt="AI"
                              width={16}
                              height={16}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-[clamp(1.3125rem,2.05vh,21px)] bg-gradient-to-b from-[#E86412] to-[#F12A4C] bg-clip-text text-transparent">
                            AI recommendation
                          </span>
                        </div>
                        <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1.3125rem,2.05vh,21px)] text-[#212121] w-full">
                          Avatars boost recall. People remember faces more than logos—give your brand a personality that appears in every video effortlessly.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* SUB-PART 2: Selection Substep - User "Choose from Library" Message and Avatar Selection UI */}
                {hasReachedSubstep('avatar-selection', 'selection') && avatarPreference === 'library' && (
                  <>
                    {/* User "Choose from Library" Message */}
                    <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                      <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,293px)]">
                        <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                          I'll choose from the library
                        </span>
                      </div>
                    </div>

                    {/* Avatar Upload Message - Show when avatar is uploaded */}
                    {avatarUploadMessageShown && avatarUploadSuccess && (
                      <>
                        {/* User message - "I've uploaded my avatar image" with avatar preview */}
                        <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                          <div className="flex flex-col gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,275px)]">
                            {/* Avatar Image Preview */}
                            <div className="flex flex-col gap-[clamp(0.5rem,0.98vh,10px)]">
                              <div className="flex flex-row items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white rounded-[12px]">
                                <div className="w-[clamp(4.3125rem,8.98vh,88px)] h-[clamp(5.6875rem,11.82vh,118px)] relative flex-shrink-0 rounded-[8px] overflow-hidden bg-gray-100">
                                  {pendingAvatarPreview ? (
                                    <img 
                                      src={pendingAvatarPreview} 
                                      alt="Uploaded avatar" 
                                      className="w-full h-full object-cover"
                                    />
                                  ) : selectedAvatar && (selectedAvatar.thumbnailUrl || selectedAvatar.avatarUrl || selectedAvatar.originalImageUrl) ? (
                                    (() => {
                                      const avatarImageUrl = selectedAvatar.thumbnailUrl || selectedAvatar.avatarUrl || selectedAvatar.originalImageUrl;
                                      const AI_CONTENT_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL 
                                        ? process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL.replace('/api', '')
                                        : 'http://localhost:9001';
                                      const fullImageUrl = avatarImageUrl?.startsWith('http') 
                                        ? avatarImageUrl 
                                        : avatarImageUrl 
                                          ? `${AI_CONTENT_SERVICE_BASE_URL}${avatarImageUrl}`
                                          : null;
                                      
                                      return fullImageUrl ? (
                                        <Image
                                          src={fullImageUrl}
                                          alt={selectedAvatar.name || 'Avatar'}
                                          fill
                                          className="object-cover"
                                          unoptimized
                                        />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-200">
                                          <span className="text-xs text-gray-400">No Image</span>
                                        </div>
                                      );
                                    })()
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gray-200">
                                      <span className="text-xs text-gray-400">No Image</span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-col justify-center gap-[clamp(0.25rem,0.39vh,4px)] flex-1 min-w-0">
                                  <span className="font-heading text-[clamp(1rem,1.56vh,16px)] font-normal leading-[clamp(1.3125rem,2.05vh,21px)] text-[#212121] break-words">
                                    {selectedAvatar?.name || 'Uploaded Avatar'}
                                  </span>
                                </div>
                              </div>
                              <div className="px-[clamp(0.5rem,0.78vh,8px)]">
                                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right">
                                  I've uploaded my avatar image
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* AI message - "Great! Your avatar is being created..." */}
                        {avatarCreationStarted && (
                          <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                            <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                              Great! Your avatar is being created. This will take a few minutes.
                            </p>
                          </div>
                        )}
                      </>
                    )}

                    {/* "Choose from the following Avatar options:" text */}
                    <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                      <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                        Choose from the following Avatar options:
                      </p>
                    </div>

                    {/* Avatar Selection Container with Gradient Border - Reduced width to 3/4 */}
                    <div
                      className={cn(
                        "relative w-full max-w-full sm:max-w-[750px] mt-[clamp(0.5rem,0.98vh,10px)] p-[clamp(0.75rem,1.17vh,12px)] rounded-[8px]",
                        hasReachedSubstep('avatar-selection', 'visual-style') && "opacity-50 pointer-events-none"
                      )}
                      style={{
                        background:
                          'linear-gradient(251.58deg, rgba(255, 255, 255, 0) 0.74%, rgba(255, 255, 255, 0.8) 58.96%), ' +
                          'linear-gradient(114.13deg, rgba(232, 100, 18, 0.4) 35.62%, rgba(254, 89, 191, 0.4) 48.81%, ' +
                          'rgba(231, 57, 19, 0.4) 64.75%, rgba(254, 201, 89, 0.4) 83.76%, rgba(232, 100, 18, 0.4) 93.57%)',
                      }}
                    >
                      <div className="bg-white rounded-[8px] p-[clamp(0.5rem,0.78vh,8px)] w-full">
                        {/* Tabs Container with Gradient Border */}
                        <div className="relative rounded-[28px] mb-[clamp(0.5rem,0.98vh,10px)]" style={{
                          background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)',
                          padding: '2px',
                        }}>
                          <div className="flex flex-row justify-center items-center gap-[clamp(0.25rem,0.39vh,4px)] bg-white rounded-[26px] p-[clamp(0.25rem,0.39vh,4px)]">
                            {/* Library Tab */}
                            <button
                              onClick={() => setActiveAvatarTab('library')}
                              className={cn(
                                "flex flex-row justify-center items-center gap-[clamp(0.625rem,0.98vh,10px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] rounded-[24px] flex-1 h-[clamp(2.25rem,4.69vh,36px)] transition-all duration-300 ease-in-out",
                                activeAvatarTab === 'library'
                                  ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C]"
                                  : "bg-transparent hover:bg-gray-50"
                              )}
                            >
                              <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                                <Image
                                  src="/assets/u_library.svg"
                                  alt="Library"
                                  width={20}
                                  height={19}
                                  className={cn(
                                    "w-full h-full",
                                    activeAvatarTab === 'library' ? "brightness-0 invert" : ""
                                  )}
                                />
                              </div>
                              <span className={cn(
                                "font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1rem,1.56vh,16px)]",
                                activeAvatarTab === 'library' ? "font-medium text-white" : "font-normal text-[#212121]"
                              )}>
                                Library
                              </span>
                            </button>

                            {/* Upload Tab */}
                            <button
                              onClick={() => setActiveAvatarTab('upload')}
                              className={cn(
                                "flex flex-row justify-center items-center gap-[clamp(0.625rem,0.98vh,10px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] rounded-[24px] flex-1 h-[clamp(2.25rem,4.69vh,36px)] transition-all duration-300 ease-in-out",
                                activeAvatarTab === 'upload'
                                  ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C]"
                                  : "bg-transparent hover:bg-gray-50"
                              )}
                            >
                              <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                                <Image
                                  src="/assets/u_upload.svg"
                                  alt="Upload"
                                  width={24}
                                  height={24}
                                  className={cn(
                                    "w-full h-full",
                                    activeAvatarTab === 'upload' ? "brightness-0 invert" : ""
                                  )}
                                />
                              </div>
                              <span className={cn(
                                "font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1rem,1.56vh,16px)]",
                                activeAvatarTab === 'upload' ? "font-medium text-white" : "font-normal text-[#212121]"
                              )}>
                                Upload
                              </span>
                            </button>

                            {/* Hire Tab */}
                            <button
                              onClick={() => setActiveAvatarTab('hire')}
                              className={cn(
                                "flex flex-row justify-center items-center gap-[clamp(0.625rem,0.98vh,10px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] rounded-[24px] flex-1 h-[clamp(2.25rem,4.69vh,36px)] transition-all duration-300 ease-in-out",
                                activeAvatarTab === 'hire'
                                  ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C]"
                                  : "bg-transparent hover:bg-gray-50"
                              )}
                            >
                              <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                                <Image
                                  src="/assets/u_credits.svg"
                                  alt="Hire"
                                  width={20}
                                  height={20}
                                  className={cn(
                                    "w-full h-full",
                                    activeAvatarTab === 'hire' ? "brightness-0 invert" : ""
                                  )}
                                />
                              </div>
                              <span className={cn(
                                "font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1rem,1.56vh,16px)]",
                                activeAvatarTab === 'hire' ? "font-medium text-white" : "font-normal text-[#212121]"
                              )}>
                                Hire
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Avatar Grid - Constrained height with internal scrolling (fixed height across tabs) */}
                        <div className="max-h-[clamp(12.25rem,25.39vh,392px)] min-h-[clamp(12.25rem,25.39vh,392px)] overflow-y-auto">
                          {loadingAvatars ? (
                            <div className="flex items-center justify-center py-[clamp(6.125rem,12.7vh,196px)]">
                              <div className="w-[clamp(1.5rem,2.93vh,30px)] h-[clamp(1.5rem,2.93vh,30px)] border-2 border-[#E86412] border-t-transparent rounded-full animate-spin" />
                            </div>
                          ) : activeAvatarTab === 'upload' ? (
                            // Upload tab - functional upload UI
                            <div 
                              key="avatar-upload"
                              className="flex flex-col items-center justify-center w-full"
                              style={{
                                animation: 'fadeIn 0.3s ease-in-out'
                              }}
                            >
                              {/* Upload Area */}
                              <div className="box-border flex flex-col justify-center items-start p-[clamp(1rem,1.56vh,16px)] gap-[clamp(0.75rem,1.17vh,12px)] w-full h-full bg-white border-2 border-dashed border-[#E0E0E0] rounded-[20px]">
                                {/* Best Practices Section */}
                                <div className="flex flex-row items-center gap-[clamp(0.75rem,1.17vh,12px)] w-full">
                                  <div className="flex flex-col justify-center items-center gap-[clamp(1rem,1.56vh,16px)] flex-1">
                                    {/* Best Practices Title */}
                                    <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-[clamp(0.6875rem,1.07vh,11px)] text-center text-black w-full">
                                      Best Practices:
                                    </span>

                                    {/* Best Practices Content */}
                                    <div className="flex flex-row justify-center items-center gap-[clamp(1rem,1.56vh,16px)] w-full">
                                      {/* Left Column - Icons in 2x2 grid */}
                                      <div className="grid grid-cols-2 gap-[clamp(0.75rem,1.17vh,12px)]">
                                        {/* 1:1 Ratio */}
                                        <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)]">
                                          <div className="w-[clamp(1.5rem,2.34vh,24px)] h-[clamp(1.5rem,2.34vh,24px)] flex items-center justify-center">
                                            <Image
                                              src="/assets/u_ratio-1-1.svg"
                                              alt="1:1 Ratio"
                                              width={24}
                                              height={24}
                                              className="w-full h-full"
                                            />
                                          </div>
                                          <span className="font-heading text-[clamp(0.875rem,1.37vh,14px)] font-normal leading-[clamp(0.75rem,1.17vh,12px)] text-[#212121]">
                                            1 : 1 Ratio
                                          </span>
                                        </div>

                                        {/* Smile */}
                                        <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)]">
                                          <div className="w-[clamp(1.5rem,2.34vh,24px)] h-[clamp(1.5rem,2.34vh,24px)] flex items-center justify-center">
                                            <Image
                                              src="/assets/u_smile-icon.svg"
                                              alt="Smile"
                                              width={24}
                                              height={24}
                                              className="w-full h-full"
                                            />
                                          </div>
                                          <span className="font-heading text-[clamp(0.875rem,1.37vh,14px)] font-normal leading-[clamp(0.75rem,1.17vh,12px)] text-[#212121]">
                                            Smile
                                          </span>
                                        </div>

                                        {/* 1 Person */}
                                        <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)]">
                                          <div className="w-[clamp(1.5rem,2.34vh,24px)] h-[clamp(1.5rem,2.34vh,24px)] flex items-center justify-center">
                                            <Image
                                              src="/assets/u_person-icon.svg"
                                              alt="1 Person"
                                              width={24}
                                              height={24}
                                              className="w-full h-full"
                                            />
                                          </div>
                                          <span className="font-heading text-[clamp(0.875rem,1.37vh,14px)] font-normal leading-[clamp(0.75rem,1.17vh,12px)] text-[#212121]">
                                            1 Person
                                          </span>
                                        </div>

                                        {/* Brightness */}
                                        <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)]">
                                          <div className="w-[clamp(1.5rem,2.34vh,24px)] h-[clamp(1.5rem,2.34vh,24px)] flex items-center justify-center">
                                            <Image
                                              src="/assets/u_brightness-icon.svg"
                                              alt="Brightness"
                                              width={24}
                                              height={24}
                                              className="w-full h-full"
                                            />
                                          </div>
                                          <span className="font-heading text-[clamp(0.875rem,1.37vh,14px)] font-normal leading-[clamp(0.75rem,1.17vh,12px)] text-[#212121]">
                                            Brightness
                                          </span>
                                        </div>
                                      </div>

                                      {/* Right Column - Text Guidelines */}
                                      <div className="flex-1">
                                        <p className="font-heading text-[clamp(0.875rem,1.37vh,14px)] font-normal leading-[clamp(1.1rem,1.6vh,18px)] text-center text-[#212121] whitespace-pre-line">
{`Use a clear, front-facing photo.
Use a clean, simple background.
Upload a high-quality, non-blurry image.
Avoid hats, sunglasses, or face coverings.
No filters or heavy edits.
Use a recent photo of yourself.`}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* File Input (Hidden) */}
                                  <input
                                    type="file"
                                    ref={avatarFileInputRef}
                                    onChange={handleAvatarFileSelect}
                                    accept="image/jpeg,image/jpg,image/png"
                                    className="hidden"
                                  />
                                </div>
                              </div>
                            </div>
                          ) : activeAvatarTab === 'hire' ? (
                            // Hire tab - show placeholder message
                            <div 
                              key="avatar-hire"
                              className="flex flex-col items-center justify-center py-[clamp(6.125rem,12.7vh,196px)]"
                              style={{
                                animation: 'fadeIn 0.3s ease-in-out'
                              }}
                            >
                              <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal text-[#616161]">
                                Hire feature coming soon
                              </p>
                            </div>
                          ) : avatars.length === 0 ? (
                            <div 
                              key={`empty-${activeAvatarTab}`}
                              className="flex flex-col items-center justify-center py-[clamp(6.125rem,12.7vh,196px)]"
                              style={{
                                animation: 'fadeIn 0.3s ease-in-out'
                              }}
                            >
                              <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal text-[#616161]">
                                No avatars available in library
                              </p>
                            </div>
                          ) : (
                            <div 
                              key={activeAvatarTab} 
                              className="grid grid-cols-5 gap-[clamp(0.75rem,0.98vh,12px)]"
                              style={{
                                animation: 'fadeIn 0.3s ease-in-out'
                              }}
                            >
                              {avatars.map((avatar: any) => {
                                const avatarImageUrl = avatar.thumbnailUrl || avatar.avatarUrl || avatar.originalImageUrl;
                                const AI_CONTENT_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL 
                                  ? process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL.replace('/api', '')
                                  : 'http://localhost:9001';
                                const fullImageUrl = avatarImageUrl?.startsWith('http') 
                                  ? avatarImageUrl 
                                  : avatarImageUrl 
                                    ? `${AI_CONTENT_SERVICE_BASE_URL}${avatarImageUrl}`
                                    : null;
                                const isSelected = selectedAvatarId === avatar.id;

                                return (
                                  <div
                                    key={avatar.id}
                                    className="relative w-full aspect-[149/196] rounded-[8px] cursor-pointer group"
                                    onClick={() => handlePreviewAvatar(avatar)}
                                  >
                                    {/* Avatar Image */}
                                    <div className="absolute inset-[5px] rounded-[4px] overflow-hidden bg-gray-100">
                                      <div className="relative w-full h-full">
                                        {fullImageUrl && !failedImageUrls.has(fullImageUrl) ? (
                                          <>
                                            <Image
                                              src={fullImageUrl}
                                              alt={avatar.name || 'Avatar'}
                                              fill
                                              className="object-cover"
                                              unoptimized
                                              onError={() => {
                                                // Track failed image URL
                                                setFailedImageUrls(prev => new Set(prev).add(fullImageUrl));
                                              }}
                                            />
                                            {/* Gradient overlay for selected state */}
                                            {isSelected && (
                                              <div className="absolute inset-0 bg-gradient-to-b from-[rgba(242,126,53,0.16)] to-[rgba(241,42,76,0.4)] z-10" />
                                            )}
                                          </>
                                        ) : (
                                          // Show placeholder if no image URL or image failed to load
                                          <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
                                            <span className="text-xs text-gray-400">No Image</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {/* Border - Selected state */}
                                    {isSelected && (
                                      <div className="absolute inset-0 rounded-[8px] border-2 border-[#E86412] box-border" />
                                    )}

                                    {/* X button - Only show on selected */}
                                    {isSelected && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedAvatarId(null);
                                          if (typeof window !== 'undefined') {
                                            sessionStorage.removeItem('selectedAvatarId');
                                          }
                                        }}
                                        className="absolute top-[clamp(0.5rem,0.78vh,12px)] right-[clamp(0.5rem,0.78vh,12px)] w-[clamp(1.5rem,2.34vh,24px)] h-[clamp(1.5rem,2.34vh,24px)] bg-white/60 rounded-[12px] flex items-center justify-center z-10 hover:bg-white/80 transition-colors"
                                      >
                                        <X className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] text-black" />
                                      </button>
                                    )}

                                    {/* Play button overlay - Center - COMMENTED OUT since we only have images, not videos */}
                                    {/* <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                      <div className="w-[clamp(3.5rem,7.32vh,56px)] h-[clamp(3.5rem,7.32vh,56px)] bg-[rgba(242,126,53,0.5)] rounded-[32px] flex items-center justify-center">
                                        <div className="w-[clamp(2.25rem,4.69vh,36px)] h-[clamp(2.25rem,4.69vh,36px)] border-[2.5px] border-white rounded-full flex items-center justify-center">
                                          <div className="w-0 h-0 border-l-[clamp(0.625rem,1.17vh,12px)] border-t-[clamp(0.375rem,0.59vh,6px)] border-b-[clamp(0.375rem,0.59vh,6px)] border-t-transparent border-b-transparent border-l-white ml-[clamp(0.125rem,0.2vh,2px)]" />
                                        </div>
                                      </div>
                                    </div> */}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Upload Avatar Button - Outside container, only show in upload tab before successful upload */}
                    {activeAvatarTab === 'upload' && !avatarUploadSuccess && (
                      <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                        <button
                          onClick={() => avatarFileInputRef.current?.click()}
                          disabled={avatarUploading}
                          className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                            <Image
                              src="/assets/u_upload.svg"
                              alt="Upload"
                              width={24}
                              height={24}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                            Upload Avatar
                          </span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* Avatar Selection Buttons - Only show in question substep (two options: Library or Generate with AI) */}
            {currentStep === 'avatar-selection' && avatarSubstep === 'question' && selectedVideoStyle !== 'product-only' && selectedVideoStyle !== 'broll-only' && (
            <div className="flex flex-row flex-wrap items-start gap-[clamp(0.5rem,0.98vh,10px)] w-full justify-end mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
              {/* Choose from Library */}
              <button
                onClick={() => handleAvatarSelection('library')}
                className="flex flex-row justify-center items-center px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0 w-auto"
              >
                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] whitespace-nowrap">
                  Choose from Library
                </span>
              </button>

              {/* Generate with AI */}
              <button
                onClick={() => handleAvatarSelection('generate')}
                className="flex flex-row justify-center items-center px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0 w-auto"
              >
                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] whitespace-nowrap">
                  Generate with AI
                </span>
              </button>
            </div>
            )}

            {/* Proceed Button for Avatar Selection - Show in selection substep when avatar is selected from library */}
            {currentStep === 'avatar-selection' && avatarSubstep === 'selection' && activeAvatarTab === 'library' && selectedAvatarId && (
            <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
              <button
                onClick={handleProceedWithAvatar}
                className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
              >
                <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_arrow-right.svg"
                    alt="Proceed"
                    width={12}
                    height={12}
                    className="w-fit"
                  />
                </div>
                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                  Proceed
                </span>
              </button>
            </div>
            )}

            {/* Generate with AI — cumulative user choice (stays visible like normal chat) */}
            {hasReachedSubstep('avatar-selection', 'generate-visual-style') && avatarPreference === 'generate' && (
              <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,293px)]">
                  <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                    I want to generate an avatar with AI
                  </span>
                </div>
              </div>
            )}

            {/* Generate with AI — pick visual style before describing the avatar */}
            {hasReachedSubstep('avatar-selection', 'generate-visual-style') && avatarPreference === 'generate' && (
              <div
                className={cn(
                  hasReachedSubstep('avatar-selection', 'text-generation') && 'opacity-50 pointer-events-none',
                )}
              >
                {currentStep === 'avatar-selection' && avatarSubstep === 'generate-visual-style' && (
                  <>
                    <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                      <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                        First, how should your AI avatar appear in the video? Choose a visual style:
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-[clamp(0.5rem,0.98vh,12px)] w-full max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)] pl-[clamp(0.5rem,1vw,16px)] lg:flex lg:flex-wrap">
                      {AVATAR_VISUAL_STYLE_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setSelectedAvatarVisualStyle(preset.id)}
                          className={cn(
                            'flex flex-row items-center gap-[clamp(0.5rem,0.78vh,8px)] p-[clamp(0.75rem,1.17vh,12px)] rounded-[12px] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] w-full min-w-0 lg:w-[200px] min-h-[80px] hover:opacity-90 transition-opacity text-left',
                            selectedAvatarVisualStyle === preset.id && 'ring-2 ring-[#E86412]',
                          )}
                        >
                          {'previewImage' in preset && preset.previewImage ? (
                            <div className="h-[72px] w-auto flex-shrink-0 rounded-[8px] overflow-hidden bg-gray-100">
                              <Image
                                src={preset.previewImage}
                                alt={preset.label}
                                width={72}
                                height={128}
                                className="h-full w-auto object-contain"
                              />
                            </div>
                          ) : (
                            <div className="h-[72px] w-[40px] flex-shrink-0 rounded-[8px] bg-gray-100 flex items-center justify-center overflow-hidden">
                              {'icon' in preset && preset.icon === 'original' ? (
                                <ImageIcon className="w-5 h-5 text-gray-500" />
                              ) : 'icon' in preset && preset.icon === 'random' ? (
                                <Sparkles className="w-5 h-5 text-gray-500" />
                              ) : (
                                <span className="font-heading text-[clamp(0.75rem,1.17vh,12px)] text-gray-400">Preview</span>
                              )}
                            </div>
                          )}
                          <div className="flex flex-col gap-[clamp(0.25rem,0.39vh,4px)] flex-1 min-w-0">
                            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-tight text-[#212121]">
                              {preset.label}
                            </span>
                            <span className="font-heading text-[clamp(0.75rem,1.17vh,12px)] font-normal leading-tight text-gray-600">
                              {preset.description}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                    {selectedAvatarVisualStyle && (
                      <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                        <button
                          type="button"
                          onClick={handleProceedFromGenerateVisualStyle}
                          className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
                        >
                          <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                            <Image
                              src="/assets/u_arrow-right.svg"
                              alt="Proceed"
                              width={12}
                              height={12}
                              className="w-fit"
                            />
                          </div>
                          <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                            Proceed
                          </span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Selected visual style (generate path) — stays visible in chat history */}
            {hasReachedSubstep('avatar-selection', 'text-generation') &&
              avatarPreference === 'generate' &&
              selectedAvatarVisualStyle && (
                <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                  <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,420px)]">
                    <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                      Visual style:{' '}
                      {AVATAR_VISUAL_STYLE_PRESETS.find((p) => p.id === selectedAvatarVisualStyle)?.label ||
                        selectedAvatarVisualStyle}
                    </span>
                  </div>
                </div>
              )}

            {/* Text generation — describe the avatar (after style is chosen) */}
            {currentStep === 'avatar-selection' && avatarSubstep === 'text-generation' && avatarPreference === 'generate' && (
            <>
              {/* AI Response - Describe your avatar (plain text, same as script step) */}
              <div className="flex flex-col items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px] mt-[clamp(0.5rem,0.98vh,10px)]">
                <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] max-w-full sm:max-w-[852px]">
                  Describe the avatar you'd like to create. Include details about appearance, clothing, expression, and any other characteristics.
                </p>
              </div>

              {/* Avatar Description Input - exact replica of script input bar (mic + visualizer, not cut off) */}
              <div
                className={cn(
                  "rounded-[24px] w-full max-w-full min-h-[clamp(2.5rem,6.64vh,68px)] flex-shrink-0 mt-[clamp(0.5rem,0.98vh,10px)] transition-all box-border",
                  avatarDescriptionFocused
                    ? "p-[2px]"
                    : "p-0 shadow-[0px_3px_19.5px_rgba(224,140,138,0.4)]"
                )}
                style={avatarDescriptionFocused ? {
                  background: 'linear-gradient(278.75deg, rgba(254, 89, 191, 0.4) 13.19%, rgba(231, 76, 60, 0.4) 46.27%, rgba(254, 201, 89, 0.4) 74.45%, rgba(231, 57, 19, 0.4) 96.51%)'
                } : {}}
              >
                <div
                  onFocus={() => setAvatarDescriptionFocused(true)}
                  onBlur={() => setAvatarDescriptionFocused(false)}
                  className={cn(
                    "flex flex-row items-end gap-[clamp(0.5rem,0.78vh,8px)] bg-white rounded-[24px] w-full h-full box-border min-w-0",
                    "px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)]"
                  )}
                >
                  {!avatarDescriptionRecording ? (
                    <AIChatTagAwareInput
                      value={avatarDescription}
                      onChange={setAvatarDescription}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && avatarDescription.trim() && !isGeneratingAvatarFromText) {
                          e.preventDefault();
                          handleGenerateAvatarFromText();
                        }
                      }}
                      placeholder="e.g., A professional woman in her 30s with dark hair, wearing a navy blue blazer, warm smile, confident posture..."
                      disabled={isGeneratingAvatarFromText}
                      className={cn(
                        "flex-1 min-w-0 font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1.25rem,1.95vh,20px)] text-[#616161] outline-none px-[clamp(0.25rem,0.39vh,4px)] bg-transparent border-none focus:ring-0 self-center",
                        isGeneratingAvatarFromText && "opacity-50 cursor-not-allowed"
                      )}
                    />
                  ) : (
                    <div
                      ref={avatarVisualizerContainerRef}
                      className="flex-1 flex flex-row items-center h-[clamp(2.25rem,3.51vh,36px)] min-w-0"
                    >
                      {(() => {
                        const history = avatarDescriptionVisualizerLevels;
                        const laneCount = AVATAR_VISUALIZER_HISTORY_LENGTH;
                        const paddedHistory = Array.from({ length: laneCount }, (_, laneIndex) => {
                          const emptySlots = laneCount - history.length;
                          if (laneIndex < emptySlots) return null;
                          const srcIndex = laneIndex - emptySlots;
                          return srcIndex >= 0 && srcIndex < history.length ? history[srcIndex] : null;
                        });
                        return (
                          <div className="flex flex-row items-center justify-between w-full min-w-0">
                            {paddedHistory.map((level, index) => (
                              <div key={index} className="flex items-center justify-center" style={{ width: 4 }}>
                                {level !== null && (
                                  <div
                                    className="w-[4px] rounded-full bg-[#E86412] transition-[height] duration-75"
                                    style={{
                                      height: `${Math.max(4, 4 + Math.max(0, Math.min(1, level)) * 24)}px`,
                                    }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  <button
                    onClick={avatarDescriptionRecording ? handleCancelAvatarDescriptionRecording : handleStartAvatarDescriptionRecording}
                    disabled={isGeneratingAvatarFromText}
                    className={cn(
                      "flex flex-row justify-center items-center w-[clamp(2rem,4.10vh,42px)] h-[clamp(2rem,4.10vh,42px)] rounded-full transition-all flex-shrink-0",
                      avatarDescriptionRecording ? "bg-gray-100 hover:bg-gray-200 text-gray-600" : "bg-gray-100 hover:bg-gray-200 text-[#616161]",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    {avatarDescriptionRecording ? (
                      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={avatarDescriptionRecording ? handleConfirmAvatarDescriptionRecording : () => avatarDescription.trim() && !isGeneratingAvatarFromText && handleGenerateAvatarFromText()}
                    disabled={avatarDescriptionRecording ? false : (!avatarDescription.trim() || isGeneratingAvatarFromText)}
                    className={cn(
                      "flex flex-row justify-center items-center w-[clamp(2rem,4.10vh,42px)] h-[clamp(2rem,4.10vh,42px)] rounded-full transition-all flex-shrink-0",
                      "bg-gradient-to-r from-[#E86412] to-[#F12A4C] text-white",
                      "disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                    )}
                  >
                    {isGeneratingAvatarFromText ? (
                      <div className="w-[clamp(1rem,1.95vh,20px)] h-[clamp(1rem,1.95vh,20px)] border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : avatarDescriptionRecording ? (
                      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <Image
                        src="/assets/fi_send.svg"
                        alt="Generate Avatar"
                        width={20}
                        height={20}
                        className="w-[clamp(1rem,1.95vh,20px)] h-[clamp(1rem,1.95vh,20px)]"
                      />
                    )}
                  </button>
                </div>
              </div>
              {avatarGenerationError && (
                <div className="text-red-500 text-sm mt-2">{avatarGenerationError}</div>
              )}
            </>
            )}

            {/* Visual Style Substep — library / upload only (generate-with-AI picks style earlier) */}
            {hasReachedSubstep('avatar-selection', 'visual-style') &&
              avatarPreference === 'library' &&
              (selectedAvatar || avatarUploadSuccess) && (
            <>
              {/* Selected Avatar Preview (for library selection) */}
              {selectedAvatar && (
              <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                <div className="flex flex-col gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,275px)]">
                  <div className="flex flex-col gap-[clamp(0.5rem,0.98vh,10px)]">
                    <div className="flex flex-row items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white rounded-[12px]">
                      <div className="w-[clamp(4.3125rem,8.98vh,88px)] h-[clamp(5.6875rem,11.82vh,118px)] relative flex-shrink-0 rounded-[8px] overflow-hidden bg-gray-100">
                        {(() => {
                            const avatarImageUrl = selectedAvatar.thumbnailUrl || selectedAvatar.avatarUrl || selectedAvatar.originalImageUrl;
                          const AI_CONTENT_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL 
                            ? process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL.replace('/api', '')
                            : 'http://localhost:9001';
                          const fullImageUrl = avatarImageUrl?.startsWith('http') 
                            ? avatarImageUrl 
                            : avatarImageUrl 
                              ? `${AI_CONTENT_SERVICE_BASE_URL}${avatarImageUrl}`
                              : null;
                          return fullImageUrl ? (
                            <Image
                              src={fullImageUrl}
                              alt={selectedAvatar.name || 'Avatar'}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-200">
                              <span className="text-xs text-gray-400">No Image</span>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex flex-col justify-center gap-[clamp(0.25rem,0.39vh,4px)] flex-1 min-w-0">
                        <span className="font-heading text-[clamp(1rem,1.56vh,16px)] font-normal leading-[clamp(1.3125rem,2.05vh,21px)] text-[#212121] break-words">
                          {selectedAvatar.name || 'Avatar'}
                        </span>
                      </div>
                    </div>
                    <div className="px-[clamp(0.5rem,0.78vh,8px)]">
                      <span className="font-heading text-[clamp(1rem,1.56vh,16px)] font-normal leading-[clamp(1.3125rem,2.05vh,21px)] text-[#212121]">
                        Selected Avatar
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* AI Message - "Great! Your avatar is ready. How would you like it to appear?" */}
              <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                  Great! Your avatar is ready. How would you like it to appear in the video? Choose a visual style:
                </p>
              </div>

              {/* Visual Style Preset Cards - Figma: left-to-right layout; image preview auto width, 4 per row */}
              <div className="grid grid-cols-2 gap-[clamp(0.5rem,0.98vh,12px)] w-full max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)] pl-[clamp(0.5rem,1vw,16px)] lg:flex lg:flex-wrap">
                {AVATAR_VISUAL_STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedAvatarVisualStyle(preset.id)}
                    className={cn(
                      "flex flex-row items-center gap-[clamp(0.5rem,0.78vh,8px)] p-[clamp(0.75rem,1.17vh,12px)] rounded-[12px] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] w-full min-w-0 lg:w-[200px] min-h-[80px] hover:opacity-90 transition-opacity text-left",
                      selectedAvatarVisualStyle === preset.id && "ring-2 ring-[#E86412]"
                    )}
                  >
                    {/* Left: preview - auto width when image, fixed when icon */}
                    {'previewImage' in preset && preset.previewImage ? (
                      <div className="h-[72px] w-auto flex-shrink-0 rounded-[8px] overflow-hidden bg-gray-100">
                        <Image
                          src={preset.previewImage}
                          alt={preset.label}
                          width={72}
                          height={128}
                          className="h-full w-auto object-contain"
                        />
                      </div>
                    ) : (
                      <div className="h-[72px] w-[40px] flex-shrink-0 rounded-[8px] bg-gray-100 flex items-center justify-center overflow-hidden">
                        {'icon' in preset && preset.icon === 'original' ? (
                          <ImageIcon className="w-5 h-5 text-gray-500" />
                        ) : 'icon' in preset && preset.icon === 'random' ? (
                          <Sparkles className="w-5 h-5 text-gray-500" />
                        ) : (
                          <span className="font-heading text-[clamp(0.75rem,1.17vh,12px)] text-gray-400">Preview</span>
                        )}
                      </div>
                    )}
                    {/* Right: title + description (full text wrap, no ellipsis) */}
                    <div className="flex flex-col gap-[clamp(0.25rem,0.39vh,4px)] flex-1 min-w-0">
                      <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-tight text-[#212121]">
                        {preset.label}
                      </span>
                      <span className="font-heading text-[clamp(0.75rem,1.17vh,12px)] font-normal leading-tight text-gray-600">
                        {preset.description}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Proceed Button for Visual Style */}
              {currentStep === 'avatar-selection' && avatarSubstep === 'visual-style' && selectedAvatarVisualStyle && (
                <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                  <button
                    onClick={handleProceedWithVisualStyle}
                    className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
                  >
                    <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                      <Image
                        src="/assets/u_arrow-right.svg"
                        alt="Proceed"
                        width={12}
                        height={12}
                        className="w-fit"
                      />
                    </div>
                    <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                      Proceed
                    </span>
                  </button>
                </div>
              )}
            </>
            )}

            {/* Generate path: user description stays visible before preview */}
            {hasReachedSubstep('avatar-selection', 'avatar-preview') &&
              avatarPreference === 'generate' &&
              avatarDescription.trim() && (
                <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                  <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,70vw,568px)]">
                    <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                      {avatarDescription.trim()}
                    </span>
                  </div>
                </div>
              )}

            {/* Avatar Preview Substep — library + generate paths */}
              {hasReachedSubstep('avatar-selection', 'avatar-preview') && (
                <>
                  {/* AI Message - Preview intro */}
                  <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                    <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                      {isGeneratingAvatarPreview 
                      ? 'Hold on while I generate a preview of your avatar...'
                      : "Here's a preview of how your avatar will appear in the video. Take a look and let me know if you'd like to try a different variation or proceed to voice selection."}
                    </p>
                  </div>

                  {/* Avatar Preview Image Container - fixed 240px height for reliable display across devices */}
                  <div 
                    className="flex items-center justify-center h-[240px] min-h-[240px] max-h-[240px] mt-[clamp(0.5rem,0.98vh,10px)] rounded-[12px] overflow-hidden p-[2px]"
                    style={{
                    background:
                      'linear-gradient(251.58deg, rgba(255, 255, 255, 0) 0.74%, rgba(255, 255, 255, 0.8) 58.96%), ' +
                        'linear-gradient(114.13deg, rgba(232, 100, 18, 0.4) 35.62%, rgba(254, 89, 191, 0.4) 48.81%, ' +
                        'rgba(231, 57, 19, 0.4) 64.75%, rgba(254, 201, 89, 0.4) 83.76%, rgba(232, 100, 18, 0.4) 93.57%)',
                    }}
                  >
                    <div className="relative h-[236px] min-h-[236px] max-h-[236px] w-full bg-white rounded-[10px] overflow-hidden flex items-center justify-center">
                      {isGeneratingAvatarPreview ? (
                        <div className="flex flex-col items-center justify-center gap-3">
                          <div className="w-8 h-8 border-2 border-[#E86412] border-t-transparent rounded-full animate-spin" />
                          <span className="font-heading text-[clamp(0.75rem,1.17vh,12px)] text-gray-500">
                            Generating preview...
                          </span>
                        </div>
                      ) : avatarPreviewUrl ? (
                        <img
                          src={avatarPreviewUrl}
                          alt="Avatar Preview"
                          className="h-[236px] min-h-[236px] max-h-[236px] w-auto max-w-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => {
                            setAvatarPreviewModalOpen(true);
                          }}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-3 h-[236px] min-h-[236px]">
                          <span className="font-heading text-[clamp(0.75rem,1.17vh,12px)] text-gray-500">
                            Preview not available
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Style Label */}
                  {!isGeneratingAvatarPreview && avatarPreviewUrl && selectedAvatarVisualStyle && (
                    <div className="flex flex-col items-start gap-[clamp(0.25rem,0.39vh,4px)] mt-[clamp(0.25rem,0.49vh,5px)]">
                      <span className="font-heading text-[clamp(0.75rem,1.17vh,12px)] font-normal text-gray-600">
                      Style:{' '}
                      {AVATAR_VISUAL_STYLE_PRESETS.find((p) => p.id === selectedAvatarVisualStyle)?.label ||
                        selectedAvatarVisualStyle}
                      </span>
                    </div>
                  )}

                  {/* Regenerate and Proceed Buttons */}
                  {!isGeneratingAvatarPreview && avatarPreviewUrl && (
                    <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.75rem,1.46vh,15px)] max-w-full flex-wrap">
                      <button
                        onClick={handleRegenerateAvatarPreview}
                        className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
                      >
                        <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                          <Image
                            src="/assets/u_redo.svg"
                            alt="Regenerate"
                            width={16}
                            height={16}
                            className="w-fit"
                          />
                        </div>
                        <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                          Regenerate
                        </span>
                      </button>

                      <button
                        onClick={handleProceedFromAvatarPreview}
                        className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
                      >
                        <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                          <Image
                            src="/assets/u_arrow-right.svg"
                            alt="Proceed"
                            width={16}
                            height={16}
                            className="w-fit"
                          />
                        </div>
                        <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                          Proceed
                        </span>
                      </button>
                    </div>
              )}
            </>
            )}

            {/* Voice Selection Step - Only show NEW voice-specific content */}
            {hasReachedStep('voice-selection') && (
            <>
              {/* DO NOT show selected avatar here - it's already shown in avatar-selection confirmed substep */}

              {/* SUB-PART 1: Question Substep - Show question, disable when past question */}
              {hasReachedSubstep('voice-selection', 'question') && (
                <>
                  {/* AI Message - "Amazing, your video has a face now..." */}
                  <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                    <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                      Amazing, your video has a face now, you're almost there... Want to change the voice?
                    </p>
                  </div>
                </>
              )}

              {/* SUB-PART 2: Selection Substep - User "Generate voice using AI" Message and Voice Selection UI */}
              {voiceMode !== 'MANUAL' && hasReachedSubstep('voice-selection', 'selection') && (
                <>
                  {/* User "Generate voice using AI" Message */}
                  <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                    <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,353px)]">
                      <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                        Generate voice using AI
                      </span>
                    </div>
                  </div>

                  {/* "Choose from the following Voice options:" text */}
                  <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                    <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                      Choose from the following Voice options:
                    </p>
                  </div>

                  {/* Voice Selection Container with Gradient Border */}
                  <div
                    className="relative w-full max-w-full sm:max-w-[750px] mt-[clamp(0.5rem,0.98vh,10px)] p-[clamp(0.75rem,1.17vh,12px)] rounded-[8px]"
                    style={{
                      background:
                        'linear-gradient(251.58deg, rgba(255, 255, 255, 0) 0.74%, rgba(255, 255, 255, 0.8) 58.96%), ' +
                        'linear-gradient(114.13deg, rgba(232, 100, 18, 0.4) 35.62%, rgba(254, 89, 191, 0.4) 48.81%, ' +
                        'rgba(231, 57, 19, 0.4) 64.75%, rgba(254, 201, 89, 0.4) 83.76%, rgba(232, 100, 18, 0.4) 93.57%)',
                    }}
                  >
                    <div className="bg-white rounded-[8px] p-[clamp(0.5rem,0.78vh,8px)] w-full">
                      {/* Tabs Container with Gradient Border */}
                      <div className="relative rounded-[28px] mb-[clamp(0.5rem,0.98vh,10px)]" style={{
                        background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)',
                        padding: '2px',
                      }}>
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.25rem,0.39vh,4px)] bg-white rounded-[26px] p-[clamp(0.25rem,0.39vh,4px)]">
                          {/* Library Tab */}
                          <button
                            onClick={() => setActiveVoiceTab('library')}
                            className={cn(
                              "flex flex-row justify-center items-center gap-[clamp(0.625rem,0.98vh,10px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] rounded-[24px] flex-1 h-[clamp(2.25rem,4.69vh,36px)] transition-all duration-300 ease-in-out",
                              activeVoiceTab === 'library'
                                ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C]"
                                : "bg-transparent hover:bg-gray-50"
                            )}
                          >
                            <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                              <Image
                                src="/assets/u_library.svg"
                                alt="Library"
                                width={20}
                                height={19}
                                className={cn(
                                  "w-full h-full",
                                  activeVoiceTab === 'library' ? "brightness-0 invert" : ""
                                )}
                              />
                            </div>
                            <span className={cn(
                              "font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1rem,1.56vh,16px)]",
                              activeVoiceTab === 'library' ? "font-medium text-white" : "font-normal text-[#212121]"
                            )}>
                              Library
                            </span>
                          </button>

                          {/* Upload Tab */}
                          <button
                            onClick={() => setActiveVoiceTab('upload')}
                            className={cn(
                              "flex flex-row justify-center items-center gap-[clamp(0.625rem,0.98vh,10px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] rounded-[24px] flex-1 h-[clamp(2.25rem,4.69vh,36px)] transition-all duration-300 ease-in-out",
                              activeVoiceTab === 'upload'
                                ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C]"
                                : "bg-transparent hover:bg-gray-50"
                            )}
                          >
                            <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                              <Image
                                src="/assets/u_upload.svg"
                                alt="Upload"
                                width={24}
                                height={24}
                                className={cn(
                                  "w-full h-full",
                                  activeVoiceTab === 'upload' ? "brightness-0 invert" : ""
                                )}
                              />
                            </div>
                            <span className={cn(
                              "font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1rem,1.56vh,16px)]",
                              activeVoiceTab === 'upload' ? "font-medium text-white" : "font-normal text-[#212121]"
                            )}>
                              Upload
                            </span>
                          </button>

                          {/* Record Tab */}
                          <button
                            onClick={() => setActiveVoiceTab('record')}
                            className={cn(
                              "flex flex-row justify-center items-center gap-[clamp(0.625rem,0.98vh,10px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] rounded-[24px] flex-1 h-[clamp(2.25rem,4.69vh,36px)] transition-all duration-300 ease-in-out",
                              activeVoiceTab === 'record'
                                ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C]"
                                : "bg-transparent hover:bg-gray-50"
                            )}
                          >
                            <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                              <Image
                                src="/assets/u_record.svg"
                                alt="Record"
                                width={20}
                                height={20}
                                className={cn(
                                  "w-full h-full",
                                  activeVoiceTab === 'record' ? "brightness-0 invert" : ""
                                )}
                              />
                            </div>
                            <span className={cn(
                              "font-heading text-[clamp(0.875rem,1.56vh,16px)] leading-[clamp(1rem,1.56vh,16px)]",
                              activeVoiceTab === 'record' ? "font-medium text-white" : "font-normal text-[#212121]"
                            )}>
                              Record
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Voice List - Constrained height with internal scrolling (fixed height across tabs) */}
                      <div className="max-h-[clamp(12.25rem,25.39vh,392px)] min-h-[clamp(12.25rem,25.39vh,392px)] overflow-y-auto">
                        {loadingVoices ? (
                          <div className="flex items-center justify-center py-[clamp(6.125rem,12.7vh,196px)]">
                            <div className="w-[clamp(1.5rem,2.93vh,30px)] h-[clamp(1.5rem,2.93vh,30px)] border-2 border-[#E86412] border-t-transparent rounded-full animate-spin" />
                          </div>
                        ) : activeVoiceTab === 'upload' ? (
                          // Upload tab - functional upload UI with button inside
                          <div 
                            key="voice-upload"
                            className="flex flex-col items-center justify-center w-full gap-[clamp(0.75rem,1.17vh,12px)]"
                            style={{
                              animation: 'fadeIn 0.3s ease-in-out'
                            }}
                            >
                              {/* Upload Area */}
                              <div className="box-border flex flex-col justify-center items-center p-[clamp(1rem,1.56vh,16px)] gap-[clamp(0.75rem,1.17vh,12px)] w-full bg-white border-2 border-dashed border-[#E0E0E0] rounded-[20px]">
                                {/* Best Practices Title */}
                                <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-[clamp(0.6875rem,1.07vh,11px)] text-center text-black w-full">
                                  Best Practices:
                                </span>

                                {/* Best Practices Content */}
                                <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1.1rem,1.6vh,18px)] text-center text-[#000000] w-full whitespace-pre-line">
{`Record in a quiet room.
Hold your phone steady and close.
Speak clearly at normal volume.
Don't move your head while talking.
Read everything on screen smoothly.`}
                                </p>

                                {/* File Input (Hidden) */}
                                <input
                                  type="file"
                                  ref={voiceFileInputRef}
                                  onChange={handleVoiceFileUpload}
                                  accept="audio/*"
                                  className="hidden"
                                />

                                {/* Upload Button - Inside the component */}
                                {!voiceUploadSuccess && (
                                  <button
                                    onClick={() => voiceFileInputRef.current?.click()}
                                    disabled={voiceCloning}
                                    className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(1rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[30px] h-[clamp(2.25rem,4.69vh,42px)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    <div className="w-[clamp(1rem,1.76vh,20px)] h-[clamp(1rem,1.76vh,20px)] flex items-center justify-center flex-shrink-0">
                                      <Image
                                        src="/assets/u_upload.svg"
                                        alt="Upload"
                                        width={20}
                                        height={20}
                                        className="w-full h-full brightness-0 invert"
                                      />
                                    </div>
                                    <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-[clamp(1rem,1.56vh,16px)] text-white">
                                      Upload Voice
                                    </span>
                                  </button>
                                )}

                                {/* Success message when voice is uploaded */}
                                {voiceUploadSuccess && (
                                  <div className="flex items-center gap-2 text-green-600">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium">Voice uploaded successfully!</span>
                                  </div>
                                )}
                              </div>
                          </div>
                        ) : activeVoiceTab === 'record' ? (
                          // Record tab - functional recording UI with button inside
                          <div 
                            key="voice-record"
                            className="flex flex-col items-center justify-center w-full"
                            style={{
                              animation: 'fadeIn 0.3s ease-in-out'
                            }}
                          >
                            {/* Record Card with Gradient Border */}
                            <div className="relative w-full p-[clamp(0.75rem,1.17vh,12px)] rounded-[8px]" style={{
                              background: 'linear-gradient(251.58deg, rgba(255, 255, 255, 0) 0.74%, rgba(255, 255, 255, 0.8) 58.96%), linear-gradient(114.13deg, rgba(232, 100, 18, 0.4) 35.62%, rgba(254, 89, 191, 0.4) 48.81%, rgba(231, 57, 19, 0.4) 64.75%, rgba(254, 201, 89, 0.4) 83.76%, rgba(232, 100, 18, 0.4) 93.57%)'
                            }}>
                              <div className="bg-white rounded-[8px] p-[clamp(0.5rem,0.78vh,8px)] w-full">
                                {/* Record Area */}
                                <div className="box-border flex flex-col justify-center items-center p-[clamp(1rem,1.56vh,16px)] gap-[clamp(0.75rem,1.17vh,12px)] w-full h-full bg-white border-2 border-dashed border-[#E0E0E0] rounded-[20px]">
                                  {/* Best Practices Title */}
                                  <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-[clamp(0.6875rem,1.07vh,11px)] text-center text-black w-full">
                                    Best Practices:
                                  </span>

                                  {/* Best Practices Content */}
                                  <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1.1rem,1.6vh,18px)] text-center text-[#000000] w-full whitespace-pre-line">
{`Record in a quiet room.
Hold your phone steady and close.
Speak clearly at normal volume.
Don't move your head while talking.
Read everything on screen smoothly.`}
                                  </p>

                                  {/* Record/Stop Button - Inside the component */}
                                  {voiceRecording ? (
                                    <button
                                      onClick={handleStopVoiceRecording}
                                      className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(1rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[30px] h-[clamp(2.25rem,4.69vh,42px)] hover:opacity-90 transition-opacity"
                                    >
                                      <div className="w-[clamp(0.875rem,1.37vh,16px)] h-[clamp(0.875rem,1.37vh,16px)] bg-white rounded-sm" />
                                      <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-[clamp(1rem,1.56vh,16px)] text-white">
                                        Stop Recording
                                      </span>
                                    </button>
                                  ) : pendingVoiceFile && voiceCloneMode === 'record' ? (
                                    <div className="flex items-center gap-2 text-green-600">
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium">Voice recorded successfully!</span>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={handleStartVoiceRecording}
                                      disabled={voiceCloning}
                                      className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(1rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[30px] h-[clamp(2.25rem,4.69vh,42px)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      <div className="w-[clamp(0.875rem,1.37vh,16px)] h-[clamp(0.875rem,1.37vh,16px)] bg-white rounded-full" />
                                      <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium leading-[clamp(1rem,1.56vh,16px)] text-white">
                                        Record Voice
                                      </span>
                                    </button>
                                  )}

                                </div>
                              </div>
                            </div>
                          </div>
                        ) : voices.length === 0 ? (
                          <div 
                            key={`empty-${activeVoiceTab}`}
                            className="flex flex-col items-center justify-center py-[clamp(6.125rem,12.7vh,196px)]"
                            style={{
                              animation: 'fadeIn 0.3s ease-in-out'
                            }}
                          >
                            <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal text-[#616161]">
                              No voices available in library
                            </p>
                          </div>
                        ) : (
                          <div 
                            key={activeVoiceTab} 
                            className="flex flex-col gap-[clamp(0.5rem,0.78vh,8px)]"
                            style={{
                              animation: 'fadeIn 0.3s ease-in-out'
                            }}
                          >
                            {voices.map((voice: any) => {
                              const isSelected = selectedVoiceId === voice.voice_id;
                              const gender = voice.labels?.gender || '';
                              const accent = voice.labels?.accent || '';
                              const language = voice.labels?.language || '';
                              const voiceLabel = `${gender} ${accent} ${language}`.trim() || 'Voice';
                              const duration = voice.preview_url ? '00:30' : '00:00'; // Default duration, can be updated if available

                              return (
                                <div
                                  key={voice.voice_id}
                                  className="rounded-[8px] cursor-pointer transition-all p-[2px]"
                                  style={isSelected ? {
                                    background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)'
                                  } : {}}
                                  onClick={() => {
                                    setSelectedVoiceId(voice.voice_id);
                                    if (typeof window !== 'undefined') {
                                      sessionStorage.setItem('selectedVoiceId', voice.voice_id);
                                    }
                                  }}
                                >
                                  <div className="flex flex-row justify-between items-center rounded-[6px] transition-all bg-white p-[clamp(0.5rem,0.78vh,8px)]">
                                  <div className="flex flex-col justify-center items-start gap-[clamp(0.25rem,0.39vh,4px)] flex-1 min-w-0">
                                    <div className="flex flex-row items-center gap-[clamp(0.625rem,0.98vh,10px)]">
                                      <span className="font-heading text-[clamp(1rem,1.56vh,16px)] font-medium leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                                        {voice.name}
                                      </span>
                                      <span className="font-heading text-[clamp(1rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#616161]">
                                        |
                                      </span>
                                      <span className="font-heading text-[clamp(1rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#616161]">
                                        {voiceLabel}
                                      </span>
                                    </div>
                                    <span className="font-heading text-[clamp(0.875rem,1.37vh,14px)] font-normal leading-[clamp(1.5rem,2.34vh,24px)] text-[#616161]">
                                      {duration}
                                    </span>
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePlayVoice(voice);
                                    }}
                                    className="flex flex-row justify-center items-center w-[clamp(2.5rem,3.91vh,40px)] h-[clamp(2.5rem,3.91vh,40px)] bg-[#E0E0E0] rounded-[20px] hover:opacity-80 transition-opacity flex-shrink-0"
                                  >
                                    <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] flex items-center justify-center">
                                      {playingVoiceId === voice.voice_id && isAudioPlaying ? (
                                        // Pause icon (two vertical bars)
                                        <div className="flex flex-row items-center justify-center gap-[2px] w-full h-full">
                                          <div className="w-[3px] h-[10px] bg-[#212121] rounded-sm" />
                                          <div className="w-[3px] h-[10px] bg-[#212121] rounded-sm" />
                                        </div>
                                      ) : (
                                        <Image
                                          src="/assets/u_play.svg"
                                          alt="Play"
                                          width={11}
                                          height={14}
                                          className="w-full h-full"
                                        />
                                      )}
                                    </div>
                                  </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                </>
              )}

              {/* SUB-PART 3: Manual recording UI - user records their own voice */}
              {voiceMode === 'MANUAL' && hasReachedSubstep('voice-selection', 'manual') && (
                <>
                  {/* User "Record my own voice" Message */}
                  <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                    <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(320px,55vw,380px)]">
                      <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                        Record my own voice
                      </span>
                    </div>
                  </div>

                  {/* Manual recording container with gradient border */}
                  <div
                    className="relative w-full max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.5rem,1vw,16px)]"
                  >
                    <div
                      className="relative w-full p-[clamp(0.75rem,1.17vh,12px)] rounded-[12px]"
                      style={{
                        background:
                          'linear-gradient(251.58deg, rgba(255, 255, 255, 0) 0.74%, rgba(255, 255, 255, 0.8) 58.96%), ' +
                          'linear-gradient(114.13deg, rgba(232, 100, 18, 0.4) 35.62%, rgba(254, 89, 191, 0.4) 48.81%, ' +
                          'rgba(231, 57, 19, 0.4) 64.75%, rgba(254, 201, 89, 0.4) 83.76%, rgba(232, 100, 18, 0.4) 93.57%)',
                      }}
                    >
                      <div className="bg-white rounded-[8px] p-[clamp(0.75rem,1.17vh,12px)] w-full">
                        {/* Manual recording instructions + scene counter */}
                        <div className="flex flex-row items-center justify-between gap-[clamp(0.5rem,0.78vh,8px)] w-full">
                          <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] flex-1 min-w-0">
                            Record your voice for each scene below. We&apos;ll use these recordings instead of AI-generated audio.
                          </p>
                          {(generatedScript?.scenes || generatedScript?.scene_plan || []).length > 0 && (
                            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium text-[#616161] flex-shrink-0">
                              {(() => {
                                const scenes = generatedScript.scenes || generatedScript.scene_plan || [];
                                const totalScenes = scenes.length;
                                const recordedCount = scenes.filter(
                                  (s: any, i: number) =>
                                    manualAudioByScene[s.scene_number ?? s.sceneNumber ?? i + 1]?.status === 'uploaded'
                                ).length;
                                return `${recordedCount}/${totalScenes}`;
                              })()}
                            </span>
                          )}
                        </div>

                        {/* Manual recording per scene */}
                        <div className="mt-[clamp(0.5rem,0.98vh,10px)]">
                          {(!generatedScript || (!generatedScript.scenes && !generatedScript.scene_plan)) ? (
                            <div className="p-4 bg-[#FFF5E9] border border-[#FFE0B2] rounded-[12px]">
                              <p className="font-heading text-[clamp(0.875rem,1.56vh,16px)] text-[#BF360C]">
                                Script is not available yet. Please generate the script before recording your voice.
                              </p>
                            </div>
                          ) : (
                            <div
                              className="relative w-full rounded-[12px] p-[2px]"
                              style={{ background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }}
                            >
                              <div className="bg-white rounded-[10px] py-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.5rem,0.78vh,8px)] max-h-[clamp(12.25rem,25.39vh,392px)] overflow-y-auto">
                                <div className="flex flex-col gap-[clamp(0.5rem,0.78vh,8px)] pr-1">
                              {(generatedScript.scenes || generatedScript.scene_plan || []).map((scene: any, index: number) => {
                                const sceneNumber = scene.scene_number || scene.sceneNumber || index + 1;
                                const state = manualAudioByScene[sceneNumber];
                                const isRecordingThisScene = manualRecording && manualRecordingScene === sceneNumber;
                                const hasRecording = state?.status === 'uploaded' && !!state.localUrl;
                                const statusLabel =
                                  state?.status === 'uploaded'
                                    ? 'Recorded'
                                    : state?.status === 'uploading'
                                    ? 'Uploading...'
                                    : state?.status === 'error'
                                    ? 'Error'
                                    : 'Not recorded';

                                return (
                                  <div
                                    key={sceneNumber}
                                    className="flex flex-col gap-[clamp(0.25rem,0.39vh,4px)] p-[clamp(0.5rem,0.78vh,8px)] rounded-[12px] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.12)]"
                                  >
                                    <div className="flex flex-col gap-[clamp(0.25rem,0.39vh,4px)] flex-1 min-w-0">
                                      <div className="flex flex-row items-center justify-between gap-2">
                                        <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium text-[#212121]">
                                          Scene {sceneNumber}
                                        </span>
                                        <span
                                          className={cn(
                                            'inline-flex items-center rounded-full px-2 py-[2px] text-[clamp(0.6875rem,1.05vh,11px)] font-heading',
                                            statusLabel === 'Recorded'
                                              ? 'bg-[#E8F5E9] text-[#2E7D32]'
                                              : statusLabel === 'Uploading...'
                                              ? 'bg-[#FFF3E0] text-[#E65100]'
                                              : statusLabel === 'Error'
                                              ? 'bg-[#FFEBEE] text-[#C62828]'
                                              : 'bg-[#F5F5F5] text-[#616161]',
                                          )}
                                        >
                                          {statusLabel}
                                        </span>
                                      </div>
                                      <span className="font-heading text-[clamp(0.8125rem,1.37vh,14px)] font-normal leading-[clamp(1.1rem,1.8vh,20px)] text-[#616161] whitespace-pre-wrap break-words">
                                        {scene.voiceover || scene.text || 'No dialogue text available.'}
                                      </span>
                                      {/* Controls row: upload / record / play + visualizer */}
                                      <div className="mt-[clamp(0.25rem,0.39vh,4px)] flex flex-row items-center gap-[clamp(0.5rem,0.78vh,8px)]">
                                        <div className="flex flex-row items-center gap-[clamp(0.25rem,0.39vh,4px)]">
                                          {/* Upload / Discard button */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (isRecordingThisScene) {
                                                // Cancel current recording
                                                manualSaveOnStopRef.current = false;
                                                setManualRecording(false);
                                                setManualRecordingScene(null);
                                                stopActiveManualRecording();
                                              } else if (hasRecording || state?.status === 'uploading') {
                                                // Discard existing or uploading audio
                                                if (manualPlayingScene === sceneNumber && manualPlaybackAudioRef.current) {
                                                  manualPlaybackAudioRef.current.pause();
                                                  manualPlaybackAudioRef.current = null;
                                                }
                                                setManualAudioByScene((prev) => {
                                                  const next = { ...prev };
                                                  delete next[sceneNumber];
                                                  return next;
                                                });
                                                setManualPlaybackProgress((prev) => {
                                                  const { [sceneNumber]: _discard, ...rest } = prev;
                                                  return rest;
                                                });
                                                const nextPaused = { ...manualPausedPositionBySceneRef.current };
                                                delete nextPaused[sceneNumber];
                                                manualPausedPositionBySceneRef.current = nextPaused;
                                              } else {
                                                // Trigger upload file picker
                                                manualUploadSceneRef.current = sceneNumber;
                                                manualUploadInputRef.current?.click();
                                              }
                                            }}
                                            disabled={state?.status === 'uploading'}
                                            className={cn(
                                              'flex items-center justify-center w-[clamp(2.25rem,3.51vh,34px)] h-[clamp(2.25rem,3.51vh,34px)] rounded-full border border-[#E0E0E0] bg-white text-[#212121] hover:bg-[#FFF5E9] transition-colors',
                                              state?.status === 'uploading' && 'opacity-50 cursor-not-allowed',
                                            )}
                                            aria-label={
                                              isRecordingThisScene
                                                ? 'Cancel recording'
                                                : hasRecording || state?.status === 'uploading'
                                                ? 'Discard audio for this scene'
                                                : 'Upload audio file for this scene'
                                            }
                                          >
                                            {isRecordingThisScene || hasRecording || state?.status === 'uploading' ? (
                                              <X className="w-[14px] h-[14px]" />
                                            ) : (
                                              <Upload className="w-[14px] h-[14px]" />
                                            )}
                                          </button>

                                          {/* Record / Confirm / Play-Pause button */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (isRecordingThisScene) {
                                                // Confirm and stop recording (will upload on stop)
                                                handleStopManualRecording();
                                              } else if (hasRecording) {
                                                handlePlayManualScene(sceneNumber);
                                              } else if (state?.status !== 'uploading') {
                                                handleStartManualRecording(sceneNumber);
                                              }
                                            }}
                                            disabled={state?.status === 'uploading'}
                                            className={cn(
                                              'flex items-center justify-center w-[clamp(2.25rem,3.51vh,34px)] h-[clamp(2.25rem,3.51vh,34px)] rounded-full bg-[#E86412] text-white hover:opacity-90 transition-opacity',
                                              state?.status === 'uploading' && 'opacity-50 cursor-not-allowed',
                                            )}
                                            aria-label={
                                              isRecordingThisScene
                                                ? 'Stop and save recording'
                                                : hasRecording
                                                ? manualPlayingScene === sceneNumber
                                                  ? 'Pause playback'
                                                  : 'Play recording'
                                                : 'Start recording'
                                            }
                                          >
                                            {isRecordingThisScene ? (
                                              <Check className="w-[16px] h-[16px]" />
                                            ) : hasRecording ? (
                                              manualPlayingScene === sceneNumber ? (
                                                <Pause className="w-[16px] h-[16px]" />
                                              ) : (
                                                <Play className="w-[16px] h-[16px]" />
                                              )
                                            ) : (
                                              <Mic className="w-[16px] h-[16px]" />
                                            )}
                                          </button>
                                        </div>

                                        {/* Recording visualizer OR playback progress bar - always show progress when we have audio */}
                                        {(isRecordingThisScene || hasRecording) && (
                                          <div
                                            ref={manualVisualizerContainerRef}
                                            className="flex-1 flex flex-row items-center h-[clamp(2.25rem,3.51vh,34px)] min-w-0"
                                          >
                                            {isRecordingThisScene ? (
                                              (() => {
                                                const history = manualVisualizerLevels;
                                                const laneCount = manualVisualizerLaneCount;
                                                const paddedHistory = Array.from(
                                                  { length: laneCount },
                                                  (_, laneIndex) => {
                                                    const srcIndex = history.length - 1 - laneIndex;
                                                    return srcIndex >= 0 && srcIndex < history.length
                                                      ? history[srcIndex]
                                                      : null;
                                                  },
                                                );

                                                return (
                                                  <div className="flex flex-row items-center justify-between w-full">
                                                    {paddedHistory.map((level, index) => (
                                                      // eslint-disable-next-line react/no-array-index-key
                                                      <div
                                                        key={index}
                                                        className="flex items-center justify-center"
                                                        style={{ width: 4 }}
                                                      >
                                                        {level !== null && (
                                                          <div
                                                            className="w-[4px] rounded-full bg-[#E86412] transition-[height] duration-75"
                                                            style={{
                                                              height: `${(() => {
                                                                const baseHeightPx = 4;
                                                                const maxHeightPx = 28;
                                                                const clampedLevel = Math.max(0, Math.min(1, level));
                                                                return baseHeightPx + clampedLevel * (maxHeightPx - baseHeightPx);
                                                              })()}px`,
                                                            }}
                                                          />
                                                        )}
                                                      </div>
                                                    ))}
                                                  </div>
                                                );
                                              })()
                                            ) : (
                                              <div className="w-full h-[4px] rounded-full bg-[#FFE0CC] overflow-hidden flex-shrink-0">
                                                <div
                                                  className="h-full bg-[#E86412] transition-[width] duration-100"
                                                  style={{
                                                    width: `${Math.min(100, Math.max(0, (manualPlaybackProgress[sceneNumber] ?? 0) * 100))}%`,
                                                  }}
                                                />
                                              </div>
                                            )}
                                          </div>
                                        )}

                                        {/* Playback timestamps - show whenever we have audio and duration */}
                                        {hasRecording && state?.duration !== undefined && state.duration > 0 && (
                                          <div className="flex flex-row items-center justify-between mt-[2px] flex-shrink-0">
                                            <span className="font-heading text-[clamp(0.6875rem,1.05vh,11px)] text-[#9E9E9E]">
                                              {formatTime(
                                                (manualPlaybackProgress[sceneNumber] ?? 0) * state.duration,
                                              )}{' '}
                                              / {formatTime(state.duration)}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {state?.status === 'error' && state.errorMessage && (
                                      <p className="font-heading text-[clamp(0.75rem,1.17vh,12px)] text-red-600 mt-1">
                                        {state.errorMessage}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                                </div>
                              {manualRecordingError && (
                                <p className="font-heading text-[clamp(0.75rem,1.17vh,12px)] text-red-600 mt-1">
                                  {manualRecordingError}
                                </p>
                              )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
            )}

            {/* Voice Selection Buttons - Only show in question substep */}
            {currentStep === 'voice-selection' && voiceSubstep === 'question' && (
            <div className="flex flex-row items-start gap-[clamp(0.5rem,0.98vh,10px)] w-full justify-end mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
              {/* Generate voice using AI */}
              <button
                onClick={() => handleVoiceSelection('yes')}
                className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0 w-auto"
              >
                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] whitespace-nowrap">
                  Generate voice using AI
                </span>
              </button>

              {/* Record my own voice */}
              <button
                onClick={() => handleVoiceSelection('no')}
                className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0 w-auto"
              >
                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] whitespace-nowrap">
                  Record my own voice
                </span>
              </button>
            </div>
            )}

            {/* Proceed Button for Voice Selection - Show in selection substep when voice is selected from library */}
            {currentStep === 'voice-selection' && voiceSubstep === 'selection' && activeVoiceTab === 'library' && selectedVoiceId && (
            <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
              <button
                onClick={handleProceedWithVoice}
                className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
              >
                <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_arrow-right.svg"
                    alt="Proceed"
                    width={12}
                    height={12}
                    className="w-fit"
                  />
                </div>
                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                  Proceed
                </span>
              </button>
            </div>
            )}

            {/* Voice Transformation Question - Show after all scenes are recorded, before proceed */}
            {currentStep === 'voice-selection' && voiceSubstep === 'manual' && voiceMode === 'MANUAL' && generatedScript && (generatedScript.scenes || generatedScript.scene_plan || []).length > 0 && (() => {
              const scenes = generatedScript.scenes || generatedScript.scene_plan || [];
              const totalScenes = scenes.length;
              const recordedCount = scenes.filter(
                (s: any, i: number) =>
                  manualAudioByScene[s.scene_number ?? s.sceneNumber ?? i + 1]?.status === 'uploaded'
              ).length;
              const allRecorded = recordedCount === totalScenes;
              return allRecorded ? (
                <>
                  {/* AI Message - "Your recordings are ready" */}
                  <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                    <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                      Great! Your voice recordings are ready. Would you like to transform your voice to sound like someone else?
                    </p>
                  </div>

                  {/* Transform Voice Question Buttons */}
                  <div className="flex flex-row items-start gap-[clamp(0.5rem,0.98vh,10px)] w-full justify-end mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                    {/* Yes, I need to change the voice */}
                    <button
                      onClick={() => {
                        setVoiceSubstep('voice-transform');
                      }}
                className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0 w-auto"
              >
                <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_thumbs-up.svg"
                    alt="Yes"
                    width={24}
                    height={24}
                    className="w-full h-full"
                  />
                </div>
                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] whitespace-nowrap">
                  Yes, I need to change the voice of avatar
                </span>
              </button>

              {/* No, I'd like to keep it the same */}
              <button
                      onClick={handleProceedWithManualRecordings}
                      disabled={isProcessingManualAudio}
                      className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0 w-auto disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_thumbs-down.svg"
                    alt="No"
                    width={24}
                    height={24}
                    className="w-full h-full"
                  />
                </div>
                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] whitespace-nowrap">
                        {isProcessingManualAudio ? 'Processing...' : "No, I'd like to keep it the same"}
                </span>
              </button>
            </div>
                </>
              ) : null;
            })()}

            {/* Voice Transformation UI - Show in voice-transform or scene-review substep */}
            {currentStep === 'voice-selection' && (voiceSubstep === 'voice-transform' || voiceSubstep === 'scene-review') && (
              <>
                {/* User "Yes, I need to change the voice of avatar" Message */}
                <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                  <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,353px)]">
                    <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                      Yes, I need to change the voice of avatar
                    </span>
                  </div>
                </div>

                {/* AI Message - "Select a voice to transform into" */}
                <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                  <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                    Select a target voice to transform your recordings into:
                  </p>
                </div>

                {/* Voice Transformation Container with Gradient Border */}
                <div
                  className={cn(
                    "relative w-full max-w-full sm:max-w-[750px] mt-[clamp(0.5rem,0.98vh,10px)] p-[clamp(0.75rem,1.17vh,12px)] rounded-[8px] transition-opacity duration-300",
                    voiceSubstep === 'scene-review' && "opacity-60 pointer-events-none"
                  )}
                  style={{
                    background:
                      'linear-gradient(251.58deg, rgba(255, 255, 255, 0) 0.74%, rgba(255, 255, 255, 0.8) 58.96%), ' +
                      'linear-gradient(114.13deg, rgba(232, 100, 18, 0.4) 35.62%, rgba(254, 89, 191, 0.4) 48.81%, ' +
                      'rgba(231, 57, 19, 0.4) 64.75%, rgba(254, 201, 89, 0.4) 83.76%, rgba(232, 100, 18, 0.4) 93.57%)',
                  }}
                >
                  <div className="bg-white rounded-[8px] p-[clamp(0.5rem,0.78vh,8px)] w-full">
                    {/* Voice Selection Dropdown */}
                    <div className="mb-4">
                      <h4 className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium text-[#212121] mb-2">
                        Target Voice
                      </h4>
                      <div ref={voiceDropdownRef} className="relative">
                        {/* Dropdown Trigger */}
                        <button
                          onClick={() => setIsVoiceDropdownOpen(!isVoiceDropdownOpen)}
                          className={cn(
                            "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border-2 transition-all bg-white",
                            selectedStsVoiceId 
                              ? "border-orange-500" 
                              : "border-gray-200 hover:border-gray-300"
                          )}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            {stsVoicesLoading ? (
                              <div className="flex items-center gap-2">
                                <div className="animate-spin w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full"></div>
                                <span className="text-gray-500">Loading voices...</span>
                              </div>
                            ) : selectedStsVoiceId ? (
                              <>
                                <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium text-[#212121] truncate">
                                  {stsVoices.find(v => v.voice_id === selectedStsVoiceId)?.name || 'Selected Voice'}
                                </span>
                                {stsVoices.find(v => v.voice_id === selectedStsVoiceId)?.labels && (
                                  <span className="text-sm text-gray-500 truncate">
                                    {stsVoices.find(v => v.voice_id === selectedStsVoiceId)?.labels?.gender}
                                    {stsVoices.find(v => v.voice_id === selectedStsVoiceId)?.labels?.accent && 
                                      `, ${stsVoices.find(v => v.voice_id === selectedStsVoiceId)?.labels?.accent}`}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-gray-500">Select a voice...</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {selectedStsVoiceId && stsVoices.find(v => v.voice_id === selectedStsVoiceId)?.preview_url && (
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const voice = stsVoices.find(v => v.voice_id === selectedStsVoiceId);
                                  if (voice?.preview_url) {
                                    const audio = new Audio(voice.preview_url);
                                    audio.play().catch(err => console.error('Audio playback failed:', err));
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.stopPropagation();
                                    const voice = stsVoices.find(v => v.voice_id === selectedStsVoiceId);
                                    if (voice?.preview_url) {
                                      const audio = new Audio(voice.preview_url);
                                      audio.play().catch(err => console.error('Audio playback failed:', err));
                                    }
                                  }
                                }}
                                className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
                              >
                                <Image src="/assets/u_play.svg" alt="Preview" width={16} height={16} />
                              </div>
                            )}
                            <svg 
                              className={cn("w-5 h-5 text-gray-400 transition-transform", isVoiceDropdownOpen && "rotate-180")} 
                              fill="none" 
                              stroke="currentColor" 
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>

                        {/* Dropdown Panel */}
                        {isVoiceDropdownOpen && !stsVoicesLoading && stsVoices.length > 0 && (
                          <div className="absolute z-50 mt-2 w-full bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
                            <div className="max-h-[250px] overflow-y-auto">
                              {stsVoices.slice(0, 20).map((voice: any) => (
                                <div
                                  key={voice.voice_id}
                                  onClick={() => {
                                    setSelectedStsVoiceId(voice.voice_id);
                                    setIsVoiceDropdownOpen(false);
                                    if (!voiceTransformSettings) {
                                      setVoiceTransformSettings({
                                        voiceId: voice.voice_id,
                                        stability: 0.5,
                                        similarityBoost: 0.75,
                                        style: 0,
                                        useSpeakerBoost: true,
                                        removeBackgroundNoise: false,
                                      });
                                    }
                                  }}
                                  className={cn(
                                    "flex items-center justify-between gap-3 px-4 py-3 cursor-pointer transition-all",
                                    selectedStsVoiceId === voice.voice_id
                                      ? "bg-orange-50"
                                      : "hover:bg-gray-50"
                                  )}
                                >
                                  <div className="flex-1 min-w-0">
                                    <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium text-[#212121]">
                                      {voice.name}
                                    </span>
                                    {voice.labels && (
                                      <span className="ml-2 text-sm text-gray-500">
                                        {voice.labels.gender && voice.labels.gender}
                                        {voice.labels.accent && `, ${voice.labels.accent}`}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {voice.preview_url && (
                                      <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const audio = new Audio(voice.preview_url);
                                          audio.play().catch(err => console.error('Audio playback failed:', err));
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.stopPropagation();
                                            const audio = new Audio(voice.preview_url);
                                            audio.play().catch(err => console.error('Audio playback failed:', err));
                                          }
                                        }}
                                        className="p-2 hover:bg-gray-200 rounded-full transition-colors cursor-pointer"
                                      >
                                        <Image src="/assets/u_play.svg" alt="Preview" width={14} height={14} />
                                      </div>
                                    )}
                                    {selectedStsVoiceId === voice.voice_id && (
                                      <svg className="w-5 h-5 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Voice Settings - Always visible when voice is selected */}
                    {selectedStsVoiceId && (
                      <div className="border-t pt-4 space-y-4">
                        <h4 className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium text-[#212121]">
                          Voice Settings
                        </h4>
                        
                        <div className="space-y-4">
                          {/* Stability Slider - Smooth */}
                          <div>
                            <label className="flex justify-between text-sm text-gray-600 mb-2">
                              <span>Stability</span>
                              <span className="font-medium text-[#212121]">{((voiceTransformSettings?.stability || 0.5) * 100).toFixed(0)}%</span>
                            </label>
                            <div className="relative h-2">
                              <div className="absolute inset-0 bg-gray-200 rounded-full"></div>
                              <div 
                                className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] transition-all duration-150"
                                style={{ width: `${(voiceTransformSettings?.stability || 0.5) * 100}%` }}
                              ></div>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={voiceTransformSettings?.stability || 0.5}
                                onChange={(e) => setVoiceTransformSettings(prev => ({
                                  voiceId: selectedStsVoiceId,
                                  stability: parseFloat(e.target.value),
                                  similarityBoost: prev?.similarityBoost || 0.75,
                                  style: prev?.style || 0,
                                  useSpeakerBoost: prev?.useSpeakerBoost ?? true,
                                  removeBackgroundNoise: prev?.removeBackgroundNoise ?? false,
                                }))}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                              <div 
                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-md border-2 border-orange-500 transition-all duration-150 pointer-events-none"
                                style={{ left: `calc(${(voiceTransformSettings?.stability || 0.5) * 100}% - 8px)` }}
                              ></div>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Higher = more consistent, Lower = more expressive</p>
                          </div>

                          {/* Similarity Boost Slider - Smooth */}
                          <div>
                            <label className="flex justify-between text-sm text-gray-600 mb-2">
                              <span>Similarity Boost</span>
                              <span className="font-medium text-[#212121]">{((voiceTransformSettings?.similarityBoost || 0.75) * 100).toFixed(0)}%</span>
                            </label>
                            <div className="relative h-2">
                              <div className="absolute inset-0 bg-gray-200 rounded-full"></div>
                              <div 
                                className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] transition-all duration-150"
                                style={{ width: `${(voiceTransformSettings?.similarityBoost || 0.75) * 100}%` }}
                              ></div>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={voiceTransformSettings?.similarityBoost || 0.75}
                                onChange={(e) => setVoiceTransformSettings(prev => ({
                                  voiceId: selectedStsVoiceId,
                                  stability: prev?.stability || 0.5,
                                  similarityBoost: parseFloat(e.target.value),
                                  style: prev?.style || 0,
                                  useSpeakerBoost: prev?.useSpeakerBoost ?? true,
                                  removeBackgroundNoise: prev?.removeBackgroundNoise ?? false,
                                }))}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                              <div 
                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-md border-2 border-orange-500 transition-all duration-150 pointer-events-none"
                                style={{ left: `calc(${(voiceTransformSettings?.similarityBoost || 0.75) * 100}% - 8px)` }}
                              ></div>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Higher = closer to target voice</p>
                          </div>

                          {/* Style Slider - Smooth */}
                          <div>
                            <label className="flex justify-between text-sm text-gray-600 mb-2">
                              <span>Style</span>
                              <span className="font-medium text-[#212121]">{((voiceTransformSettings?.style || 0) * 100).toFixed(0)}%</span>
                            </label>
                            <div className="relative h-2">
                              <div className="absolute inset-0 bg-gray-200 rounded-full"></div>
                              <div 
                                className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] transition-all duration-150"
                                style={{ width: `${(voiceTransformSettings?.style || 0) * 100}%` }}
                              ></div>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={voiceTransformSettings?.style || 0}
                                onChange={(e) => setVoiceTransformSettings(prev => ({
                                  voiceId: selectedStsVoiceId,
                                  stability: prev?.stability || 0.5,
                                  similarityBoost: prev?.similarityBoost || 0.75,
                                  style: parseFloat(e.target.value),
                                  useSpeakerBoost: prev?.useSpeakerBoost ?? true,
                                  removeBackgroundNoise: prev?.removeBackgroundNoise ?? false,
                                }))}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                              <div 
                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-md border-2 border-orange-500 transition-all duration-150 pointer-events-none"
                                style={{ left: `calc(${(voiceTransformSettings?.style || 0) * 100}% - 8px)` }}
                              ></div>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Higher = more stylized delivery</p>
                          </div>

                          {/* Custom Checkboxes */}
                          <div className="flex flex-wrap gap-4 pt-2">
                            <label className="flex items-center gap-3 cursor-pointer group">
                              <div 
                                onClick={() => setVoiceTransformSettings(prev => ({
                                  voiceId: selectedStsVoiceId,
                                  stability: prev?.stability || 0.5,
                                  similarityBoost: prev?.similarityBoost || 0.75,
                                  style: prev?.style || 0,
                                  useSpeakerBoost: !(prev?.useSpeakerBoost ?? true),
                                  removeBackgroundNoise: prev?.removeBackgroundNoise ?? false,
                                }))}
                                className={cn(
                                  "w-5 h-5 rounded flex items-center justify-center transition-all duration-200",
                                  voiceTransformSettings?.useSpeakerBoost ?? true
                                    ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C]"
                                    : "bg-white border-2 border-gray-300 group-hover:border-orange-400"
                                )}
                              >
                                {(voiceTransformSettings?.useSpeakerBoost ?? true) && (
                                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                              <span className="text-sm text-gray-600 group-hover:text-[#212121] transition-colors">Speaker Boost</span>
                            </label>
                            <label className="flex items-center gap-3 cursor-pointer group">
                              <div 
                                onClick={() => setVoiceTransformSettings(prev => ({
                                  voiceId: selectedStsVoiceId,
                                  stability: prev?.stability || 0.5,
                                  similarityBoost: prev?.similarityBoost || 0.75,
                                  style: prev?.style || 0,
                                  useSpeakerBoost: prev?.useSpeakerBoost ?? true,
                                  removeBackgroundNoise: !(prev?.removeBackgroundNoise ?? false),
                                }))}
                                className={cn(
                                  "w-5 h-5 rounded flex items-center justify-center transition-all duration-200",
                                  voiceTransformSettings?.removeBackgroundNoise ?? false
                                    ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C]"
                                    : "bg-white border-2 border-gray-300 group-hover:border-orange-400"
                                )}
                              >
                                {(voiceTransformSettings?.removeBackgroundNoise ?? false) && (
                                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                              <span className="text-sm text-gray-600 group-hover:text-[#212121] transition-colors">Remove Background Noise</span>
                            </label>
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                </div>


                {/* Transform / Proceed Buttons - Show only when in voice-transform substep and no action taken yet */}
                {voiceSubstep === 'voice-transform' && !transformActionMessage && (
            <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                  {/* Skip transformation - go directly to scene review */}
              <button
                    onClick={() => {
                      setTransformActionMessage('skip');
                      setVoiceSubstep('scene-review');
                    }}
                    disabled={isTransformingVoice || isProcessingManualAudio}
                    className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                      Skip & Use Original
                    </span>
                  </button>

                  {/* Review & Transform Scenes - navigate to scene-review for per-scene transformation */}
                  <button
                    onClick={() => {
                      if (!selectedStsVoiceId || !projectId) {
                        showToast('Please select a target voice', 'warning');
                        return;
                      }
                      setTransformActionMessage('transform');
                      setVoiceSubstep('scene-review');
                    }}
                    disabled={!selectedStsVoiceId || isTransformingVoice || isProcessingManualAudio}
                    className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                      Review & Transform Scenes
                    </span>
                  </button>
                </div>
                )}

                {/* User Transform Action Message Bubble - shows immediately when action is taken */}
                {transformActionMessage && (voiceSubstep === 'voice-transform' || voiceSubstep === 'scene-review') && (
                  <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                    <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,353px)]">
                      <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                        {transformActionMessage === 'transform' ? 'Review & Transform Scenes' : 'Skip & Use Original'}
                      </span>
                    </div>
                  </div>
                )}


                {/* Scene-by-Scene Transformation Review View */}
                {voiceSubstep === 'scene-review' && (
                  <div className="w-full max-w-full sm:max-w-[750px] mt-[clamp(0.5rem,0.98vh,10px)]">
                    {/* AI Message - Changes based on transformation state */}
                    <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mb-[clamp(0.5rem,0.98vh,10px)]">
                      {isTransformingVoice ? (
                        <div className="flex items-center gap-2">
                          <div className="animate-spin w-4 h-4 border-2 border-[#E86412] border-t-transparent rounded-full flex-shrink-0"></div>
                          <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                            Transforming your voice recordings... ({Object.values(transformedAudioByScene).filter(s => s.status === 'completed').length}/{Object.keys(manualAudioByScene).length})
                          </p>
                        </div>
                      ) : (
                        <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                          Review your audio for each scene. You can transform individual scenes or proceed with the current audio.
                        </p>
                      )}
                    </div>

                    {/* Scene List Container with Gradient Border */}
                    <div
                      className="relative w-full p-[clamp(0.75rem,1.17vh,12px)] rounded-[8px]"
                      style={{
                        background:
                          'linear-gradient(251.58deg, rgba(255, 255, 255, 0) 0.74%, rgba(255, 255, 255, 0.8) 58.96%), ' +
                          'linear-gradient(114.13deg, rgba(232, 100, 18, 0.4) 35.62%, rgba(254, 89, 191, 0.4) 48.81%, ' +
                          'rgba(231, 57, 19, 0.4) 64.75%, rgba(254, 201, 89, 0.4) 83.76%, rgba(232, 100, 18, 0.4) 93.57%)',
                      }}
                    >
                      <div className="bg-white rounded-[8px] p-[clamp(0.75rem,1.17vh,12px)] w-full">
                        <div className="max-h-[clamp(12.25rem,25.39vh,392px)] overflow-y-auto flex flex-col gap-[clamp(0.5rem,0.78vh,8px)] pr-1">
                          {(generatedScript?.scenes || generatedScript?.scene_plan || []).map((scene: any, index: number) => {
                            const sceneNum = scene.scene_number ?? scene.sceneNumber ?? index + 1;
                            const voiceoverText = scene.voiceover || scene.voice_over || scene.voiceOver || '';
                            const manualAudio = manualAudioByScene[sceneNum];
                            const transformedAudio = transformedAudioByScene[sceneNum];
                            const hasOriginal = manualAudio?.status === 'uploaded' && manualAudio?.localUrl;
                            const hasTransformed = transformedAudio?.status === 'completed' && transformedAudio?.transformedUrl;
                            const isTransformingThis = transformedAudio?.status === 'processing';

                            return (
                              <div
                                key={sceneNum}
                                className="flex flex-col gap-[clamp(0.25rem,0.39vh,4px)] p-[clamp(0.5rem,0.78vh,8px)] rounded-[12px] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.12)]"
                              >
                                {/* Scene Header with Re-transform button */}
                                <div className="flex flex-row items-center justify-between gap-2">
                                  <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium text-[#212121]">
                                    Scene {sceneNum}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {isTransformingThis && (
                                      <span className="inline-flex items-center rounded-full px-2 py-[2px] text-[clamp(0.6875rem,1.05vh,11px)] font-heading bg-[#FFF3E0] text-[#E65100]">
                                        Transforming...
                                      </span>
                                    )}
                                    {hasTransformed && !isTransformingThis && (
                                      <span className="inline-flex items-center rounded-full px-2 py-[2px] text-[clamp(0.6875rem,1.05vh,11px)] font-heading bg-[#E8F5E9] text-[#2E7D32]">
                                        Transformed
                                      </span>
                                    )}
                                    {hasOriginal && !hasTransformed && !isTransformingThis && (
                                      <span className="inline-flex items-center rounded-full px-2 py-[2px] text-[clamp(0.6875rem,1.05vh,11px)] font-heading bg-[#F5F5F5] text-[#616161]">
                                        Original
                                      </span>
                                    )}
                                    {/* Transform/Re-transform button - per-scene transform (all modes including MANUAL) */}
                                    {hasOriginal && !isTransformingThis && (
                                      <button
                                        onClick={() => {
                                          setPerSceneTransformModal({
                                            isOpen: true,
                                            sceneNumber: sceneNum,
                                            voiceoverText: voiceoverText,
                                          });
                                          setPerSceneSettings(voiceTransformSettings || {
                                            voiceId: selectedStsVoiceId || '',
                                            stability: 0.5,
                                            similarityBoost: 0.75,
                                            style: 0,
                                            useSpeakerBoost: true,
                                            removeBackgroundNoise: false,
                                          });
                                        }}
                                        disabled={isTransformingSingleScene}
                                        className={cn(
                                          "inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[clamp(0.6875rem,1.05vh,11px)] font-heading transition-all disabled:opacity-50",
                                          hasTransformed 
                                            ? "bg-[#FFF3E0] text-[#E65100] hover:bg-orange-200" 
                                            : "bg-[#F5F5F5] text-[#616161] hover:bg-gray-200"
                                        )}
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        {hasTransformed ? 'Re-transform' : 'Transform'}
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Voiceover Text */}
                                <span className="font-heading text-[clamp(0.8125rem,1.37vh,14px)] font-normal leading-[clamp(1.1rem,1.8vh,20px)] text-[#616161] whitespace-pre-wrap break-words">
                                  {voiceoverText || 'No voiceover text'}
                                </span>

                                {/* Audio Controls Row - Horizontal layout matching recording section */}
                                <div className="flex flex-row items-center gap-[clamp(0.5rem,0.78vh,8px)]">
                                  {/* Play Buttons with Labels */}
                                  <div className="flex flex-row items-center gap-[clamp(0.25rem,0.39vh,4px)] flex-shrink-0">
                                    {/* Original Audio Play/Pause Button */}
                                    {hasOriginal && manualAudio?.localUrl && (
                                      <button
                                        onClick={() => handleReviewAudioPlayback(
                                          sceneNum,
                                          'original',
                                          manualAudio.localUrl!,
                                          manualAudio.duration
                                        )}
                                        className={cn(
                                          "flex items-center justify-center w-[clamp(2.25rem,3.51vh,34px)] h-[clamp(2.25rem,3.51vh,34px)] rounded-full border transition-colors",
                                          reviewPlayingScene === sceneNum && reviewPlayingType === 'original'
                                            ? "bg-white border-[#E0E0E0] text-[#212121]"
                                            : "bg-white border-[#E0E0E0] text-[#212121] hover:bg-[#FFF5E9]"
                                        )}
                                        title="Play Original"
                                      >
                                        {reviewPlayingScene === sceneNum && reviewPlayingType === 'original' ? (
                                          <svg className="w-[16px] h-[16px]" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                          </svg>
                                        ) : (
                                          <svg className="w-[16px] h-[16px]" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M8 5v14l11-7z"/>
                                          </svg>
                                        )}
                                      </button>
                                    )}

                                    {/* Transformed Audio Play/Pause Button */}
                                    {hasTransformed && transformedAudio?.transformedUrl && (
                                      <button
                                        onClick={() => handleReviewAudioPlayback(
                                          sceneNum,
                                          'transformed',
                                          transformedAudio.transformedUrl!,
                                          transformedAudio.duration || manualAudio?.duration
                                        )}
                                        className="flex items-center justify-center w-[clamp(2.25rem,3.51vh,34px)] h-[clamp(2.25rem,3.51vh,34px)] rounded-full bg-[#E86412] text-white hover:opacity-90 transition-opacity"
                                        title="Play Transformed"
                                      >
                                        {reviewPlayingScene === sceneNum && reviewPlayingType === 'transformed' ? (
                                          <svg className="w-[16px] h-[16px]" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                          </svg>
                                        ) : (
                                          <svg className="w-[16px] h-[16px]" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M8 5v14l11-7z"/>
                                          </svg>
                                        )}
                                      </button>
                                    )}

                                    {/* Spinning indicator when transforming */}
                                    {isTransformingThis && (
                                      <div 
                                        className="flex items-center justify-center w-[clamp(2.25rem,3.51vh,34px)] h-[clamp(2.25rem,3.51vh,34px)] rounded-full bg-[#FFF3E0] border border-[#FFCC80]"
                                        title="Transforming..."
                                      >
                                        <div className="animate-spin w-4 h-4 border-2 border-[#E86412] border-t-transparent rounded-full"></div>
                                      </div>
                                    )}

                                    {/* Placeholder button for non-transformed */}
                                    {hasOriginal && !hasTransformed && !isTransformingThis && (
                                      <div 
                                        className="flex items-center justify-center w-[clamp(2.25rem,3.51vh,34px)] h-[clamp(2.25rem,3.51vh,34px)] rounded-full bg-gray-50 border border-dashed border-gray-300"
                                        title="Not transformed"
                                      >
                                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                        </svg>
                                      </div>
                                    )}
                                  </div>

                                  {/* Progress Bar - Always visible, takes remaining space */}
                                  <div className="flex-1 flex flex-row items-center h-[clamp(2.125rem,3.32vh,34px)] min-w-0">
                                    <div className="w-full h-[4px] rounded-full bg-[#FFE0CC] overflow-hidden">
                                      <div
                                        className={cn(
                                          "h-full transition-[width] duration-100",
                                          reviewPlayingScene === sceneNum && reviewPlayingType === 'transformed'
                                            ? "bg-[#E86412]"
                                            : reviewPlayingScene === sceneNum && reviewPlayingType === 'original'
                                            ? "bg-gray-600"
                                            : "bg-[#E86412]"
                                        )}
                                        style={{
                                          width: `${reviewPlayingScene === sceneNum 
                                            ? Math.min(100, Math.max(0, (reviewPlaybackProgress[sceneNum] ?? 0) * 100))
                                            : 0}%`,
                                        }}
                                      />
                                    </div>
                                  </div>

                                  {/* Timestamps - on the right */}
                                  {(() => {
                                    const audioDuration = hasTransformed 
                                      ? (transformedAudio?.duration || manualAudio?.duration || 0)
                                      : (manualAudio?.duration || 0);
                                    if (!audioDuration || audioDuration <= 0) return null;
                                    const currentTime = reviewPlayingScene === sceneNum 
                                      ? (reviewPlaybackProgress[sceneNum] ?? 0) * audioDuration
                                      : 0;
                                    return (
                                      <div className="flex-shrink-0">
                                        <span className="font-heading text-[clamp(0.6875rem,1.05vh,11px)] text-[#9E9E9E]">
                                          {formatTime(currentTime)} / {formatTime(audioDuration)}
                                        </span>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Final Proceed Buttons - Outside the scene list container */}
                {voiceSubstep === 'scene-review' && !isTransformingVoice && (
                  <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full flex-wrap">
                    {/* Skip & Use Original Button - Only show if there are any transformed audios */}
                    {Object.values(transformedAudioByScene).some(t => t.status === 'completed') && (
                      <button
                        onClick={async () => {
                          // Explicitly set audio preference to use original audio before proceeding
                          if (projectId) {
                            try {
                              await apiClient.setAudioPreference(projectId, false);
                              console.log('[AIChat] Audio preference set to use original audio');
                            } catch (err) {
                              console.error('Failed to set audio preference:', err);
                            }
                          }
                          // Clear transformed audio state and proceed with originals
                          setTransformedAudioByScene({});
                          setTransformActionMessage('skip');
                          handleProceedWithManualRecordings();
                        }}
                        disabled={isProcessingManualAudio}
                        className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white border border-gray-200 shadow-[0px_1px_7px_rgba(87,73,119,0.12)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#666666]">
                          Skip & Use Original
                        </span>
                      </button>
                    )}
                    
                    {/* Proceed with Transformed Button */}
                    <button
                      onClick={() => {
                        handleProceedWithManualRecordings();
                      }}
                      disabled={isProcessingManualAudio}
                      className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_arrow-right.svg"
                    alt="Proceed"
                    width={12}
                    height={12}
                    className="w-fit"
                  />
                </div>
                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                        {isProcessingManualAudio ? 'Processing...' : (
                          Object.values(transformedAudioByScene).some(t => t.status === 'completed')
                            ? 'Use Transformed Audio'
                            : 'Proceed'
                        )}
                </span>
              </button>
            </div>
                )}
              </>
            )}

            {/* Voice Preview - Show in confirmed substep */}
            {hasReachedSubstep('voice-selection', 'confirmed') && selectedVoiceId && (() => {
            const selectedVoice = voices.find(v => v.voice_id === selectedVoiceId);
            if (!selectedVoice) return null;
            
            const voiceLabel = selectedVoice.labels?.gender 
              ? `${selectedVoice.labels.gender.charAt(0).toUpperCase() + selectedVoice.labels.gender.slice(1)}${selectedVoice.labels.accent ? `, ${selectedVoice.labels.accent}` : ''}${selectedVoice.labels.age ? `, ${selectedVoice.labels.age}` : ''}`
              : 'Voice';
            const duration = selectedVoice.preview_url 
              ? formatDuration(30) // Default duration, can be extracted from voice data if available
              : '';
            
            return (
              <>
                {/* Selected Voice Preview */}
                <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                  <div className="flex flex-col gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,400px)]">
                    {/* Selected Voice Info */}
                    <div className="flex flex-col gap-[clamp(0.5rem,0.98vh,10px)]">
                      <div className="flex flex-row items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white rounded-[12px]">
                        <div className="flex flex-col justify-center gap-[clamp(0.25rem,0.39vh,4px)] flex-1 min-w-0">
                          <div className="flex flex-row items-center gap-[clamp(0.625rem,0.98vh,10px)]">
                            <span className="font-heading text-[clamp(1rem,1.56vh,16px)] font-medium leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                              {selectedVoice.name}
                            </span>
                            <span className="font-heading text-[clamp(1rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#616161]">
                              |
                            </span>
                            <span className="font-heading text-[clamp(1rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#616161]">
                              {voiceLabel}
                            </span>
                          </div>
                          {duration && (
                            <span className="font-heading text-[clamp(0.875rem,1.37vh,14px)] font-normal leading-[clamp(1.5rem,2.34vh,24px)] text-[#616161]">
                              {duration}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="px-[clamp(0.5rem,0.78vh,8px)]">
                        <span className="font-heading text-[clamp(1rem,1.56vh,16px)] font-normal leading-[clamp(1.3125rem,2.05vh,21px)] text-[#212121]">
                          Selected Voice
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* B-Roll Source Selection - Show after voice is confirmed, for non-avatar-only styles */}
                {(() => {
                  const styleToCheck = selectedVideoStyle || 
                    (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
                  const isAvatarOnlyStyle = styleToCheck === 'avatar-only' || styleToCheck === 'AVATAR_ONLY' || 
                                             styleToCheck === 'animated-avatar' || styleToCheck === 'ANIMATED_AVATAR';
                  
                  // For avatar-only styles, skip B-roll choice and show ready message
                  if (isAvatarOnlyStyle) {
                    return (
                      <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                        <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                          Perfect! Your video is ready to be created.
                        </p>
                      </div>
                    );
                  }
                  
                  // For non-avatar-only styles, show B-roll source choice
                  if (!brollSourceConfirmed) {
                    return (
                      <>
                        {/* AI Message - B-roll source question */}
                        <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                          <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                            How would you like to create your visuals?
                          </p>
                        </div>

                        {/* B-Roll Source Selection Buttons - text only, centered */}
                        {!brollSourcePreference && (
                          <div className="flex flex-row items-start gap-[clamp(0.5rem,0.98vh,10px)] w-full justify-end mt-[clamp(0.5rem,0.98vh,10px)] max-w-full flex-wrap">
                            {/* AI-Generated Option */}
                            <button
                              onClick={() => handleBrollSourceSelection('ai')}
                              className="flex flex-row justify-center items-center px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0"
                            >
                              <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] whitespace-nowrap">
                                Use AI-generated visuals
                              </span>
                            </button>

                            {/* Stock Selection Option - Opens modal with stock tabs only */}
                            <button
                              onClick={() => handleBrollSourceSelection('stock')}
                              className="flex flex-row justify-center items-center px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0"
                            >
                              <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] whitespace-nowrap">
                                Use stock visuals
                              </span>
                            </button>

                            {/* Upload Option - Opens modal with upload tab only */}
                            <button
                              onClick={() => handleBrollSourceSelection('upload')}
                              className="flex flex-row justify-center items-center px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0"
                            >
                              <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] whitespace-nowrap">
                                Upload my own visuals
                              </span>
                            </button>
                          </div>
                        )}

                        {/* Stock/Upload Manual Selection: Scene Cards Grid */}
                        {(brollSourcePreference === 'stock' || brollSourcePreference === 'upload') && (
                          <>
                            {/* User Selection Message */}
                            <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                              <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,353px)]">
                                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                                  {brollSourcePreference === 'stock' ? 'Use stock visuals' : 'Upload my own visuals'}
                                </span>
                              </div>
                            </div>

                            {/* AI Message - Instructions */}
                            <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                              <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                                {brollSourcePreference === 'stock' 
                                  ? 'Select stock visuals for each scene below. Scenes without selections will use AI-generated visuals.'
                                  : 'Upload your own visuals for each scene below. Scenes without uploads will use AI-generated visuals.'}
                              </p>
                            </div>

                            {/* Scene Cards Container */}
                            <div className="relative w-full max-w-full sm:max-w-[850px] mt-[clamp(0.5rem,0.98vh,10px)]">
                              <div className="flex flex-row flex-wrap gap-[clamp(0.75rem,1.56vh,16px)] w-full">
                                {generatedScript && (generatedScript.scenes || generatedScript.scene_plan || []).map((scene: any, index: number) => {
                                  const sceneNumber = scene.scene_number || scene.sceneNumber || (index + 1);
                                  const manualSelection = manualBrollByScene[sceneNumber];
                                  const voiceoverText = scene.voiceover || scene.script || scene.text || '';
                                  const truncatedVoiceover = voiceoverText.length > 60 
                                    ? voiceoverText.substring(0, 60) + '...' 
                                    : voiceoverText;
                                  
                                  return (
                                    <div
                                      key={sceneNumber}
                                      className={cn(
                                        "flex-none rounded-[12px] p-[2px] transition-all",
                                        manualSelection && "bg-gradient-to-b from-[#E86412] to-[#F12A4C]"
                                      )}
                                      style={manualSelection ? undefined : { background: 'transparent' }}
                                    >
                                      <div className="flex flex-col gap-[clamp(0.375rem,0.59vh,6px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[12px] p-[clamp(0.5rem,0.78vh,8px)] w-[clamp(120px,11vw,152px)] min-w-0">
                                        {/* Thumbnail */}
                                        <div 
                                          className="relative w-full aspect-[9/16] bg-gray-100 rounded-[8px] overflow-hidden flex items-center justify-center cursor-pointer"
                                          onClick={() => {
                                            setBrollModalSceneNumber(sceneNumber);
                                            setBrollModalOpen(true);
                                          }}
                                        >
                                          {manualSelection ? (
                                            manualSelection.type.includes('video') ? (
                                              <video
                                                src={manualSelection.url}
                                                className="w-full h-full object-cover"
                                                muted
                                                loop
                                                playsInline
                                                onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                                                onMouseLeave={(e) => {
                                                  const video = e.target as HTMLVideoElement;
                                                  video.pause();
                                                  video.currentTime = 0;
                                                }}
                                              />
                                            ) : (
                                              <img
                                                src={manualSelection.thumbnailUrl || manualSelection.url}
                                                alt={`Scene ${sceneNumber}`}
                                                className="w-full h-full object-cover"
                                              />
                                            )
                                          ) : (
                                            <div className="flex flex-col items-center justify-center gap-1 text-gray-400">
                                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                                {brollSourcePreference === 'upload' ? (
                                                  <>
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                    <polyline points="17 8 12 3 7 8" />
                                                    <line x1="12" y1="3" x2="12" y2="15" />
                                                  </>
                                                ) : (
                                                  <>
                                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                                    <circle cx="8.5" cy="8.5" r="1.5"/>
                                                    <polyline points="21 15 16 10 5 21"/>
                                                  </>
                                                )}
                                              </svg>
                                              <span className="text-[10px]">{brollSourcePreference === 'upload' ? 'Upload' : 'Select'}</span>
                                            </div>
                                          )}
                                          {manualSelection && (
                                            <div className="absolute top-1 right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                                              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12"/>
                                              </svg>
                                            </div>
                                          )}
                                        </div>
                                        <span className="font-heading text-[clamp(0.75rem,1.37vh,14px)] font-medium text-[#212121]">
                                          Scene {sceneNumber}
                                        </span>
                                        <span className="font-heading text-[clamp(0.625rem,1.17vh,12px)] text-gray-500 line-clamp-1 min-w-0">
                                          {truncatedVoiceover}
                                        </span>
                                        <button
                                          onClick={() => {
                                            setBrollModalSceneNumber(sceneNumber);
                                            setBrollModalOpen(true);
                                          }}
                                          className="flex items-center justify-center gap-1 w-full py-1.5 px-2 bg-white border border-gray-200 rounded-[8px] hover:bg-gray-50 transition-colors text-[clamp(0.625rem,1.17vh,12px)] font-medium text-[#212121] font-heading"
                                        >
                                          {manualSelection ? 'Change' : (brollSourcePreference === 'upload' ? 'Upload' : 'Select')}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Summary and Proceed */}
                              <div className="flex flex-row justify-between items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <span className="font-heading text-sm text-gray-500">
                                    {Object.keys(manualBrollByScene).filter(k => manualBrollByScene[parseInt(k)]).length} of {(generatedScript?.scenes || generatedScript?.scene_plan || []).length} scenes selected
                                  </span>
                                  <span className="font-heading text-xs text-gray-400">
                                    Unselected scenes will use AI-generated visuals
                                  </span>
                                </div>
                                <button
                                  onClick={handleProceedWithManualBroll}
                                  className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
                                >
                                  <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                                    <Image
                                      src="/assets/u_arrow-right.svg"
                                      alt="Proceed"
                                      width={12}
                                      height={12}
                                      className="w-fit"
                                    />
                                  </div>
                                  <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                                    Proceed
                                  </span>
                                </button>
                              </div>
                            </div>
                          </>
                        )}

                        {/* Legacy Stock-Auto Loading State (kept for backwards compatibility) */}
                        {brollSourcePreference === 'stock-auto' && isAutoSelectingStock && (
                          <>
                            {/* User Selection Message */}
                            <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                              <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,353px)]">
                                <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                                  Use stock visuals
                                </span>
                              </div>
                            </div>

                            {/* Loading Indicator for Stock Auto-Selection */}
                            <div className="flex flex-col items-center gap-4 w-full max-w-full sm:max-w-[852px] mt-[clamp(1rem,2vh,24px)] p-8 bg-white rounded-[16px] shadow-[0px_1px_7px_rgba(87,73,119,0.15)]">
                              <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 border-t-[#E86412]"></div>
                              <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal text-[#212121] text-center">
                                Searching and downloading stock videos for your scenes...
                              </p>
                              <div className="w-full max-w-[300px] h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] transition-all duration-300"
                                  style={{ width: `${stockDownloadProgress}%` }}
                                />
                              </div>
                              <p className="font-heading text-[clamp(0.75rem,1.37vh,14px)] text-gray-500">
                                {stockDownloadProgress}% complete
                              </p>
                            </div>
                          </>
                        )}

                      </>
                    );
                  }
                  
                  // B-roll source is confirmed, show ready message
                  return (
                    <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                      <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                        Perfect! Your video is ready to be created.
                      </p>
                    </div>
                  );
                })()}
              </>
            );
          })()}

          {/* Video Generation Step */}
          {hasReachedStep('audio-image-generation') && (
            <>
              {/* Generating state with loader */}
              {currentStep === 'audio-image-generation' && !finalVideoUrl && (
                <>
                  {/* AI message - different for avatar-only vs b-roll styles */}
                  <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                    <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] text-center w-full">
                      {(() => {
                        const styleToCheck = selectedVideoStyle || 
                          (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
                        const isAvatarOnlyStyle = styleToCheck === 'avatar-only' || styleToCheck === 'AVATAR_ONLY' || 
                                                   styleToCheck === 'animated-avatar' || styleToCheck === 'ANIMATED_AVATAR';
                        
                        if (isAvatarOnlyStyle) {
                          if (isRenderingVideo) {
                            return "Perfect! We're bringing your avatar to life with your voice. Sit tight for a moment... Your video is being crafted!";
                          }
                          return "Perfect! Preparing your audio... Your video is on its way!";
                        }
                        return "Perfect! We're stitching everything together — scenes, voice, avatar, effects… the whole magic potion. Sit tight for a moment... Your video is being crafted!";
                      })()}
                    </p>
                  </div>

                  {/* Progress loader */}
                  <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                    <div className="flex flex-col items-start w-full px-[clamp(0.25rem,0.39vh,4px)] py-[clamp(0.25rem,0.39vh,4px)] bg-[#F6F6F6] rounded-[18px]">
                      <div 
                        className="flex flex-col justify-center items-center py-[clamp(0.25rem,0.39vh,4px)] px-[clamp(0.5rem,0.78vh,8px)] bg-[#E86412] rounded-[20px] transition-all duration-300"
                        style={{ width: `${Math.max(generationProgress, 5)}%` }}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Final video display for avatar-only styles */}
              {finalVideoUrl && (
                <>
                  {/* Success message */}
                  <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                    <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                      Your video is ready! Here's the final result.
                    </p>
                  </div>

                  {/* Video Player — watermarked preview only (never clean final) */}
                  <div
                    className="relative w-full max-w-[400px] mt-[clamp(0.5rem,0.98vh,10px)] rounded-[12px] overflow-hidden bg-black flex items-center justify-center"
                    style={{ aspectRatio: '9/16' }}
                  >
                    {previewPlaybackUrl ? (
                      <video
                        src={previewPlaybackUrl}
                        controls
                        controlsList="nodownload noremoteplayback"
                        disablePictureInPicture
                        onContextMenu={(e) => e.preventDefault()}
                        className="w-full h-full object-contain"
                        playsInline
                      />
                    ) : previewGenerationError ? (
                      <div className="text-center text-white/90 px-4 text-sm">
                        <p>Preview could not be prepared.</p>
                        <p className="text-xs text-white/60 mt-2">{previewGenerationError}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-white/90">
                        <Loader2 className="w-10 h-10 animate-spin" />
                        <p className="text-sm">Preparing preview…</p>
                      </div>
                    )}
                  </div>

                  {/* Download and Share Buttons */}
                  <div className="flex flex-row justify-start items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.75rem,1.46vh,15px)] max-w-full flex-wrap">
                    {/* Download Button */}
                    <button
                      type="button"
                      onClick={() => void downloadFinalVideo()}
                      disabled={!finalVideoUrl || isDownloadingFinal}
                      className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </div>
                      <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                        Download
                      </span>
                    </button>

                    {/* Share Button */}
                    <button
                      type="button"
                      onClick={() => {
                        const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
                        if (navigator.share) {
                          void navigator.share({
                            title: 'My Generated Video',
                            url: shareUrl,
                          }).catch(console.error);
                        } else {
                          void navigator.clipboard.writeText(shareUrl);
                          showToast('Link copied to clipboard!', 'success');
                        }
                      }}
                      className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
                    >
                      <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="18" cy="5" r="3" />
                          <circle cx="6" cy="12" r="3" />
                          <circle cx="18" cy="19" r="3" />
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                        </svg>
                      </div>
                      <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                        Share
                      </span>
                    </button>

                    {/* Go to Workspace Button */}
                    <button
                      onClick={() => {
                        if (projectId) {
                          router.push(`/create-video/workspace?projectId=${projectId}`);
                        }
                      }}
                      className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
                    >
                      <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                        <Image
                          src="/assets/u_arrow-right.svg"
                          alt="Workspace"
                          width={16}
                          height={16}
                          className="w-fit"
                        />
                      </div>
                      <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                        Go to Workspace
                      </span>
                    </button>
                  </div>
                </>
              )}
            </>
          )}

            <div ref={chatBottomSentinelRef} className="h-px w-full shrink-0" aria-hidden />

          </div>

          {/* Regenerate and Proceed Buttons - Outside scrollable container to ensure visibility */}
          {currentStep === 'script-generated' && normalizedSceneList.length > 0 && !proceedConfirmed && (
            <div className="flex flex-col gap-[clamp(0.5rem,0.98vh,10px)] w-full flex-shrink-0 mt-auto">
              <div className="flex flex-row justify-end items-center gap-[clamp(0.625rem,0.98vh,10px)] w-full">
                {/* Regenerate Button */}
                <button
                  onClick={handleRegenerateScript}
                  disabled={isGeneratingScript}
                  className={cn(
                    "flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.625rem,1.17vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity",
                    isGeneratingScript && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                    <Image
                      src="/assets/u_redo.svg"
                      alt="Regenerate"
                      width={24}
                      height={24}
                      className="w-full h-full"
                    />
                  </div>
                  <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                    Regenerate
                  </span>
                </button>

                {/* Proceed Button */}
                <button
                  onClick={handleProceedToAvatarSelection}
                  className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.625rem,1.17vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
                >
                  <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] flex items-center justify-center flex-shrink-0">
                    <Image
                      src="/assets/mingcute_ai-line-1.svg"
                      alt="Proceed"
                      width={24}
                      height={24}
                      className="w-fit"
                    />
                  </div>
                  <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                    Proceed
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Add Assets Input Bar - Figma: height: 68px, padding: 8px 12px, gap: 16px, border-radius: 30px */}
          {currentStep === 'asset-upload' && (
            <div className="flex flex-row justify-center items-center gap-[clamp(0.75rem,1.56vh,16px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] w-full h-[clamp(2.5rem,6.64vh,68px)] flex-shrink-0 mt-auto mb-0">
              {/* Add Assets Button - Always show gradient border */}
              <div
                className="rounded-[24px] h-[clamp(2rem,4.3vh,44px)] flex-shrink-0 p-[2px]"
                style={{
                  background: 'linear-gradient(180deg, #FFD3B7 0%, #F6A6A6 100%)'
                }}
              >
                <button
                  onClick={handleAddAssets}
                  className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(1rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white rounded-[24px] h-full w-full hover:opacity-90 transition-opacity"
                >
                  {/* Plus Icon - Figma: 24px x 24px */}
                  <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)]">
                    <Image
                      src="/assets/u_plus-circle.svg"
                      alt="Add"
                      width={24}
                      height={24}
                      className="w-full h-full"
                    />
                  </div>
                  {/* Font size consistent with other chat elements */}
                  <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">Add Assets</span>
                </button>
              </div>
              
              {/* Display pending assets as chips (assets attached from modal, waiting to be sent) - ROW VIEW ONLY */}
              {pendingAssets.length > 0 ? (
                <div className="flex flex-row items-center gap-2 flex-1 min-w-0 flex-nowrap overflow-x-auto">
                  {(() => {
                    // Separate assets by type for proper display
                    const logo = pendingAssets.find(a => a.id.startsWith('logo-'));
                    const productImages = pendingAssets.filter(a => a.id.startsWith('product-'));
                    const url = pendingAssets.find(a => a.id.startsWith('url-'));
                    
                    return (
                      <>
                        {/* Logo - Always show if exists */}
                        {logo && (
                          <div className="flex flex-row items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.375rem,0.59vh,6px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] flex-shrink-0 whitespace-nowrap">
                            <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] relative flex-shrink-0">
                              {logo.preview ? (
                                <img src={logo.preview} alt={logo.name} className="w-full h-full object-cover rounded" />
                              ) : (
                                <Image src="/assets/u_paperclip.svg" alt="Logo" width={16} height={16} className="w-full h-full" />
                              )}
                            </div>
                            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-black truncate max-w-[140px]">
                              {logo.name}
                            </span>
                            <button 
                              onClick={() => removePendingAsset(logo.id)} 
                              className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0"
                            >
                              <X className="w-full h-full text-[#212121]" strokeWidth={1.5} />
                            </button>
                          </div>
                        )}
                        
                        {/* First Product Image - Always show if exists */}
                        {productImages.length > 0 && (
                          <div className="flex flex-row items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.375rem,0.59vh,6px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] flex-shrink-0 whitespace-nowrap">
                            <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] relative flex-shrink-0">
                              {productImages[0].preview ? (
                                <img src={productImages[0].preview} alt={productImages[0].name} className="w-full h-full object-cover rounded" />
                              ) : (
                                <Image src="/assets/u_paperclip.svg" alt="Product" width={16} height={16} className="w-full h-full" />
                              )}
                            </div>
                            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-black truncate max-w-[140px]">
                              {productImages[0].name}
                            </span>
                            <button 
                              onClick={() => removePendingAsset(productImages[0].id)} 
                              className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0"
                            >
                              <X className="w-full h-full text-[#212121]" strokeWidth={1.5} />
                            </button>
                          </div>
                        )}
                        
                        {/* +N indicator - Only for additional product images beyond the first */}
                        {productImages.length > 1 && (
                          <div className="flex flex-row items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.375rem,0.59vh,6px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] flex-shrink-0 whitespace-nowrap">
                            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-black">
                              +{productImages.length - 1}
                            </span>
                          </div>
                        )}
                        
                        {/* URL - Always show if exists */}
                        {url && (
                          <div className="flex flex-row items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.375rem,0.59vh,6px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] flex-shrink-0 whitespace-nowrap">
                            <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] relative flex-shrink-0">
                              <Image src="/assets/u_link.svg" alt="URL" width={16} height={16} className="w-full h-full" />
                            </div>
                            <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-black truncate max-w-[194px]">
                              {url.name}
                            </span>
                            <button 
                              onClick={() => removePendingAsset(url.id)} 
                              className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0"
                            >
                              <X className="w-full h-full text-[#212121]" strokeWidth={1.5} />
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : (
                /* File type hint - Only show when no assets are selected */
                <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] flex-1 hidden md:block">
                  Supports files type .png & .jpg only of max 5 MB each.
                </span>
              )}
              
              {/* Send button - only enabled when pending assets exist */}
              <button
                onClick={handleSendAssets}
                disabled={pendingAssets.length === 0}
                className="flex flex-row justify-center items-center w-[clamp(2rem,5.08vh,52px)] h-[clamp(2rem,5.08vh,52px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[26px] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex-shrink-0"
              >
                <Image
                  src="/assets/fi_send.svg"
                  alt="Send"
                  width={24}
                  height={24}
                  className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)]"
                />
              </button>
            </div>
          )}

          {/* Avatar Upload Input Bar - Show when upload tab is active and file is selected */}
          {currentStep === 'avatar-selection' && activeAvatarTab === 'upload' && pendingAvatarFile && (
            <div className="flex flex-row justify-between items-center gap-[clamp(0.75rem,1.56vh,16px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] w-full h-[clamp(2.5rem,6.64vh,68px)] flex-shrink-0 mt-auto mb-0">
              {/* Display pending avatar file as chip - LEFT SIDE */}
              {pendingAvatarFile && (
                <div className="flex flex-row items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.375rem,0.59vh,6px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] flex-shrink-0 whitespace-nowrap">
                  <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] relative flex-shrink-0">
                    {pendingAvatarPreview ? (
                      <img src={pendingAvatarPreview} alt={pendingAvatarFile.name} className="w-full h-full object-cover rounded" />
                    ) : (
                      <Image src="/assets/u_paperclip.svg" alt="Avatar" width={16} height={16} className="w-full h-full" />
                    )}
                  </div>
                  <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-black truncate max-w-[140px]">
                    {pendingAvatarFile.name}
                  </span>
                  <button 
                    onClick={removePendingAvatarFile} 
                    className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0"
                  >
                    <X className="w-full h-full text-[#212121]" strokeWidth={1.5} />
                  </button>
                </div>
              )}
              
              {/* Send button - RIGHT SIDE */}
              <button
                onClick={handleSendAvatarFile}
                disabled={!pendingAvatarFile || avatarUploading}
                className="flex flex-row justify-center items-center w-[clamp(2rem,5.08vh,52px)] h-[clamp(2rem,5.08vh,52px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[26px] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex-shrink-0"
              >
                {avatarUploading ? (
                  <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Image
                    src="/assets/fi_send.svg"
                    alt="Send"
                    width={24}
                    height={24}
                    className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)]"
                  />
                )}
              </button>
            </div>
          )}

          {/* Voice Upload/Record Input Bar - Show when upload/record tab is active and file is selected */}
          {currentStep === 'voice-selection' && (activeVoiceTab === 'upload' || activeVoiceTab === 'record') && pendingVoiceFile && (
            <div className="flex flex-row justify-between items-center gap-[clamp(0.75rem,1.56vh,16px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] w-full h-[clamp(2.5rem,6.64vh,68px)] flex-shrink-0 mt-auto mb-0">
              {/* File chip and name input on LEFT */}
              <div className="flex flex-row items-center gap-[clamp(0.5rem,0.98vh,10px)] flex-1 min-w-0">
                {/* Display pending voice file as chip */}
                {pendingVoiceFile && (
                  <div className="flex flex-row items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.375rem,0.59vh,6px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] flex-shrink-0 whitespace-nowrap">
                    <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] relative flex-shrink-0">
                      <Image src="/assets/u_paperclip.svg" alt="Voice" width={16} height={16} className="w-full h-full" />
                    </div>
                    <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-black truncate max-w-[140px]">
                      {pendingVoiceFile.name}
                    </span>
                    <button 
                      onClick={removePendingVoiceFile} 
                      className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0"
                    >
                      <X className="w-full h-full text-[#212121]" strokeWidth={1.5} />
                    </button>
                  </div>
                )}
                
                {/* Name input field */}
                <input
                  type="text"
                  value={pendingVoiceName}
                  onChange={(e) => setPendingVoiceName(e.target.value)}
                  placeholder="Enter voice name"
                  className="flex-1 font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] outline-none px-[clamp(0.5rem,0.98vh,10px)] bg-transparent border-none focus:ring-0 placeholder:text-[#616161] min-w-0"
                />
              </div>
              
              {/* Send button - RIGHT SIDE */}
              <button
                onClick={handleSendVoiceFile}
                disabled={!pendingVoiceFile || !pendingVoiceName.trim() || voiceCloning}
                className="flex flex-row justify-center items-center w-[clamp(2rem,5.08vh,52px)] h-[clamp(2rem,5.08vh,52px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[26px] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex-shrink-0"
              >
                {voiceCloning ? (
                  <div className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)] border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Image
                    src="/assets/fi_send.svg"
                    alt="Send"
                    width={24}
                    height={24}
                    className="w-[clamp(1.25rem,2.34vh,24px)] h-[clamp(1.25rem,2.34vh,24px)]"
                  />
                )}
              </button>
            </div>
          )}

          {/* Script duration options — bottom row (RTL), white pills; shown only while duration substep is active */}
          {currentStep === 'assets-attached' &&
            scriptSubstep === 'duration' &&
            !hasReachedStep('script-input') &&
            selectedLanguage && (
              <div className="flex flex-row-reverse flex-wrap justify-end items-center gap-x-[clamp(0.5rem,0.98vh,10px)] gap-y-2 w-full flex-shrink-0 mt-auto mb-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.17vh,12px)]">
                {VIDEO_DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleDurationSelection(opt.value)}
                    className="flex flex-row justify-center items-center px-[clamp(1rem,2vh,24px)] py-[clamp(0.5rem,1vh,12px)] rounded-[20px] transition-all duration-200 bg-white border border-[#E0E0E0] text-[#212121] hover:border-[#E86412] hover:text-[#E86412]"
                  >
                    <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium">{opt.label}</span>
                  </button>
                ))}
            </div>
          )}

          {/* Script Input Bar - Show when language is selected and assets are attached or script-input step */}
          {((currentStep === 'assets-attached' && scriptSubstep === 'input') || currentStep === 'script-input') && (
            <div 
              className={cn(
                "rounded-[24px] w-full min-h-[clamp(2.5rem,6.64vh,68px)] flex-shrink-0 mt-auto mb-0 transition-all box-border",
                inputFocused 
                  ? "p-[2px]"
                  : "p-0 shadow-[0px_3px_19.5px_rgba(224,140,138,0.4)]"
              )}
              style={inputFocused ? {
                background: 'linear-gradient(278.75deg, rgba(254, 89, 191, 0.4) 13.19%, rgba(231, 76, 60, 0.4) 46.27%, rgba(254, 201, 89, 0.4) 74.45%, rgba(231, 57, 19, 0.4) 96.51%)'
              } : {}}
            >
              <div className={cn(
                "flex flex-row items-end gap-[clamp(0.5rem,0.78vh,8px)] bg-white rounded-[24px] w-full h-full box-border",
                inputFocused ? "px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)]" : "px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)]"
              )}>
                {/* Textarea or Recording Visualizer */}
                {!isInputRecording ? (
                <AIChatTagAwareInput
                  value={scriptInput}
                  onChange={setScriptInput}
                  onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && scriptInput.trim() && !isGeneratingScript && selectedLanguage) {
                        e.preventDefault();
                      handleSendScript();
                    }
                  }}
                  placeholder={selectedLanguage 
                      ? "Share your ideas here..." 
                    : "Please select a language first"}
                    disabled={isGeneratingScript || !selectedLanguage || isTranscribing}
                  className={cn(
                      "flex-1 font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1.25rem,1.95vh,20px)] text-[#616161] outline-none px-[clamp(0.25rem,0.39vh,4px)] bg-transparent border-none focus:ring-0 self-center",
                      (isGeneratingScript || !selectedLanguage || isTranscribing) && "opacity-50 cursor-not-allowed"
                    )}
                  />
                ) : (
                  /* Recording Visualizer - flows right-to-left (newer bars on right, near buttons) */
                  <div 
                    ref={inputVisualizerContainerRef}
                    className="flex-1 flex flex-row items-center h-[clamp(2.25rem,3.51vh,36px)] min-w-0"
                  >
                    {(() => {
                      const history = inputVisualizerLevels;
                      const laneCount = inputVisualizerLaneCount;
                      // Build padded history: newest bars on the RIGHT side
                      // Index 0 = leftmost (oldest/empty), index laneCount-1 = rightmost (newest)
                      const paddedHistory = Array.from(
                        { length: laneCount },
                        (_, laneIndex) => {
                          // Calculate how many empty slots we need on the left
                          const emptySlots = laneCount - history.length;
                          if (laneIndex < emptySlots) {
                            return null; // Empty slot on the left
                          }
                          // Map to history array (oldest to newest, left to right)
                          const srcIndex = laneIndex - emptySlots;
                          return srcIndex >= 0 && srcIndex < history.length
                            ? history[srcIndex]
                            : null;
                        },
                      );

                      return (
                        <div className="flex flex-row items-center justify-between w-full">
                          {paddedHistory.map((level, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-center"
                              style={{ width: 4 }}
                            >
                              {level !== null && (
                                <div
                                  className="w-[4px] rounded-full bg-[#E86412] transition-[height] duration-75"
                                  style={{
                                    height: `${(() => {
                                      const baseHeightPx = 4;
                                      const maxHeightPx = 28;
                                      const clampedLevel = Math.max(0, Math.min(1, level));
                                      return baseHeightPx + clampedLevel * (maxHeightPx - baseHeightPx);
                                    })()}px`,
                                  }}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Mic/Cancel Button */}
                <button
                  onClick={isInputRecording ? handleCancelInputRecording : handleStartInputRecording}
                  disabled={isGeneratingScript || !selectedLanguage || isTranscribing}
                  className={cn(
                    "flex flex-row justify-center items-center w-[clamp(2rem,4.10vh,42px)] h-[clamp(2rem,4.10vh,42px)] rounded-full transition-all flex-shrink-0",
                    isInputRecording 
                      ? "bg-gray-100 hover:bg-gray-200 text-gray-600" 
                      : "bg-gray-100 hover:bg-gray-200 text-[#616161]",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {isInputRecording ? (
                    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                  )}
                </button>
                
                {/* Send/Confirm button */}
                <button
                  onClick={isInputRecording 
                    ? handleConfirmInputRecording 
                    : () => scriptInput.trim() && !isGeneratingScript && selectedLanguage && handleSendScript()
                  }
                  disabled={isInputRecording ? false : (!scriptInput.trim() || isGeneratingScript || !selectedLanguage)}
                  className={cn(
                    "flex flex-row justify-center items-center w-[clamp(2rem,4.10vh,42px)] h-[clamp(2rem,4.10vh,42px)] rounded-full transition-all flex-shrink-0",
                    "bg-gradient-to-r from-[#E86412] to-[#F12A4C] text-white",
                    "disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                  )}
                >
                  {isTranscribing ? (
                    <div className="w-[clamp(1rem,1.95vh,20px)] h-[clamp(1rem,1.95vh,20px)] border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : isGeneratingScript ? (
                    <div className="w-[clamp(1rem,1.95vh,20px)] h-[clamp(1rem,1.95vh,20px)] border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : isInputRecording ? (
                    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <Image
                      src="/assets/fi_send.svg"
                      alt="Send"
                      width={20}
                      height={20}
                      className="w-[clamp(1rem,1.95vh,20px)] h-[clamp(1rem,1.95vh,20px)]"
                    />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Suggested Actions - Only show on welcome step - Height responsive */}
          {currentStep === 'welcome' && (
            <div className="flex flex-row items-start gap-[clamp(0.25rem,0.5vh,8px)] w-full h-[clamp(2rem,4.2vh,42px)] flex-wrap md:flex-nowrap flex-shrink-0 mt-auto">
              {/* Create an ad */}
              <button
                onClick={() => handleOptionClick('ad')}
                className="flex flex-row justify-center items-center gap-[clamp(0.25rem,0.5vh,8px)] px-[clamp(0.5rem,1vh,12px)] py-[clamp(0.25rem,0.5vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[clamp(18px,2.34vh,30px)] flex-1 h-[clamp(2rem,4.2vh,42px)] hover:opacity-80 transition-opacity min-w-0"
              >
                <div className="w-[clamp(0.875rem,1.56vh,16px)] h-[clamp(0.875rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_money-bill.svg"
                    alt="Money"
                    width={24}
                    height={24}
                    className="w-full h-full"
                  />
                </div>
                <span className="font-heading text-[clamp(0.75rem,1.37vh,14px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] truncate">Create an ad</span>
              </button>

              {/* Create a promo video */}
              <button
                onClick={() => handleOptionClick('promo')}
                className="flex flex-row justify-center items-center gap-[clamp(0.25rem,0.5vh,8px)] px-[clamp(0.5rem,1vh,12px)] py-[clamp(0.25rem,0.5vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[clamp(18px,2.34vh,30px)] flex-1 h-[clamp(2rem,4.2vh,42px)] hover:opacity-80 transition-opacity min-w-0"
              >
                <div className="w-[clamp(0.875rem,1.56vh,16px)] h-[clamp(0.875rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_megaphone.svg"
                    alt="Megaphone"
                    width={24}
                    height={24}
                    className="w-full h-full"
                  />
                </div>
                <span className="font-heading text-[clamp(0.75rem,1.37vh,14px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] truncate">Create a promo video</span>
              </button>

              {/* Create a tutorial */}
              <button
                onClick={() => handleOptionClick('tutorial')}
                className="flex flex-row justify-center items-center gap-[clamp(0.25rem,0.5vh,8px)] px-[clamp(0.5rem,1vh,12px)] py-[clamp(0.25rem,0.5vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[clamp(18px,2.34vh,30px)] flex-1 h-[clamp(2rem,4.2vh,42px)] hover:opacity-80 transition-opacity min-w-0"
              >
                <div className="w-[clamp(0.875rem,1.56vh,16px)] h-[clamp(0.875rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/u_lightbulb-alt.svg"
                    alt="Lightbulb"
                    width={24}
                    height={24}
                    className="w-full h-full"
                  />
                </div>
                <span className="font-heading text-[clamp(0.75rem,1.37vh,14px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] truncate">Create a tutorial</span>
              </button>

              {/* Create an AI clip */}
              <button
                onClick={() => handleOptionClick('ai-clip')}
                className="flex flex-row justify-center items-center gap-[clamp(0.25rem,0.5vh,8px)] px-[clamp(0.5rem,1vh,12px)] py-[clamp(0.25rem,0.5vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[clamp(18px,2.34vh,30px)] flex-1 h-[clamp(2rem,4.2vh,42px)] hover:opacity-80 transition-opacity min-w-0"
              >
                <div className="w-[clamp(0.875rem,1.56vh,16px)] h-[clamp(0.875rem,1.56vh,16px)] flex items-center justify-center flex-shrink-0">
                  <Image
                    src="/assets/mingcute_ai-line-1.svg"
                    alt="AI"
                    width={24}
                    height={24}
                    className="w-full h-full"
                  />
                </div>
                <span className="font-heading text-[clamp(0.75rem,1.37vh,14px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] truncate">Create an AI clip</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add Assets Modal - Desktop 164 */}
      {showAddAssetsModal && (
        <>
          {/* Overlay */}
          <div 
            className="fixed inset-0 bg-gradient-to-br from-[rgba(191,143,100,0.5)] to-[rgba(179,104,56,0.5)] opacity-90 z-40"
            onClick={handleCloseModal}
          />
          
          {/* Modal */}
          <div className="fixed inset-0 flex items-center justify-center z-[150] p-4 overflow-y-auto">
            <div className="bg-white shadow-[0px_4px_22px_rgba(242,126,53,0.3)] rounded-xl p-10 w-full max-w-[546px] flex flex-col gap-5 my-auto">
              {/* Modal Header */}
              <div className="flex flex-row items-center justify-between w-full flex-shrink-0">
                <h2 className="font-heading text-[28px] font-normal leading-7 text-[#212121] flex-1 pr-4">Add Assets</h2>
                <button
                  onClick={handleCloseModal}
                  className="w-8 h-8 flex items-center justify-center flex-shrink-0 hover:opacity-70"
                >
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 8L24 24M24 8L8 24" stroke="#212121" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {/* Form Fields */}
              <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
                {/* Attach Logo - Single Image */}
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <div className="flex flex-row items-center gap-2.5 px-4 py-3 border-2 border-[#E0E0E0] rounded-xl min-h-[52px] w-full">
                    {/* Preview or Placeholder */}
                    {modalLogoAsset ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="w-6 h-6 relative flex-shrink-0">
                          {modalLogoAsset.preview ? (
                            <img 
                              src={modalLogoAsset.preview} 
                              alt={modalLogoAsset.name}
                              className="w-full h-full object-cover rounded"
                            />
                          ) : (
                            <Image src="/assets/u_paperclip.svg" alt="Image" width={24} height={24} className="w-6 h-6" />
                          )}
                        </div>
                        <span className="flex-1 font-heading text-base font-normal leading-5 text-[#212121] truncate min-w-0">
                          {modalLogoAsset.name}
                        </span>
                        <button
                          onClick={removeModalLogo}
                          className="w-6 h-6 flex items-center justify-center flex-shrink-0 hover:opacity-70"
                        >
                          <X className="w-5 h-5 text-[#212121]" strokeWidth={2} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          type="text"
                          placeholder="Attach Logo"
                          readOnly
                          className="flex-1 font-heading text-base font-normal leading-5 text-[#616161] outline-none cursor-pointer min-w-0"
                          onClick={() => logoFileInputRef.current?.click()}
                        />
                        {/* Hidden file input */}
                        <input
                          ref={logoFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/jpg"
                          onChange={handleLogoUpload}
                          className="hidden"
                        />
                        {/* Paperclip icon - clickable when no asset */}
                        <button
                          onClick={() => logoFileInputRef.current?.click()}
                          className="w-6 h-6 flex items-center justify-center cursor-pointer hover:opacity-70 flex-shrink-0"
                        >
                          <Image
                            src="/assets/u_paperclip.svg"
                            alt="Attach"
                            width={24}
                            height={24}
                            className="w-6 h-6"
                          />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Product Images - Multiple Images */}
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <div className="flex flex-row items-center gap-2 px-4 py-3 border-2 border-[#E0E0E0] rounded-xl min-h-[52px] w-full flex-wrap">
                    {/* Display selected images as chips - show first 3 */}
                    {modalProductImages.slice(0, 3).map((asset) => (
                      <div key={asset.id} className="flex items-center gap-2 px-2 py-1 bg-gray-100 rounded-lg flex-shrink-0">
                        <div className="w-4 h-4 relative flex-shrink-0">
                          {asset.preview ? (
                            <img 
                              src={asset.preview} 
                              alt={asset.name}
                              className="w-full h-full object-cover rounded"
                            />
                          ) : (
                            <Image src="/assets/u_paperclip.svg" alt="Image" width={16} height={16} className="w-4 h-4" />
                          )}
                        </div>
                        <span className="text-sm font-heading text-[#212121] truncate max-w-[100px]">
                          {asset.name}
                        </span>
                        <button
                          onClick={() => removeModalProductImage(asset.id)}
                          className="w-4 h-4 flex items-center justify-center hover:opacity-70 flex-shrink-0"
                        >
                          <X className="w-3 h-3 text-[#212121]" strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                    
                    {/* Show +N indicator if more than 3 images */}
                    {modalProductImages.length > 3 && (
                      <div className="flex items-center gap-2 px-2 py-1 bg-gray-100 rounded-lg flex-shrink-0">
                        <span className="text-sm font-heading text-[#212121]">
                          +{modalProductImages.length - 3}
                        </span>
                      </div>
                    )}
                    
                    {/* Input area or add button */}
                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                      <input
                        type="text"
                        placeholder={modalProductImages.length > 0 ? "Add more images..." : "Product Images"}
                        readOnly
                        className="flex-1 font-heading text-base font-normal leading-5 text-[#616161] outline-none cursor-pointer min-w-0"
                        onClick={() => productImagesInputRef.current?.click()}
                      />
                      
                      <input
                        ref={productImagesInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg"
                        multiple
                        onChange={handleProductImagesUpload}
                        className="hidden"
                      />
                      
                      <button
                        onClick={() => productImagesInputRef.current?.click()}
                        className="w-6 h-6 flex items-center justify-center cursor-pointer hover:opacity-70 flex-shrink-0"
                      >
                        <Image
                          src="/assets/u_paperclip.svg"
                          alt="Attach"
                          width={24}
                          height={24}
                          className="w-6 h-6"
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Company URL - Text input (no file upload) */}
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <div className="flex flex-row items-center gap-2.5 px-4 py-3 border-2 border-[#E0E0E0] rounded-xl h-[52px] w-full">
                    <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                      <Image
                        src="/assets/u_link.svg"
                        alt="Link"
                        width={24}
                        height={24}
                        className="w-6 h-6"
                      />
                    </div>
                    <input
                      type="url"
                      placeholder="Type URL (e.g., https://www.companywebsite.com)"
                      value={modalCompanyUrl}
                      onChange={handleCompanyUrlChange}
                      className="flex-1 font-heading text-base font-normal leading-5 text-[#616161] outline-none min-w-0"
                    />
                  </div>
                </div>
              </div>

              {/* Attach Button - Fixed at bottom */}
              <div className="flex-shrink-0 pt-2">
                <button
                  onClick={handleAttachAssets}
                  disabled={!hasModalAssets}
                  className={cn(
                    "w-full flex flex-row justify-center items-center px-5 py-4 rounded-[26px] h-[52px] transition-all",
                    !hasModalAssets
                      ? "bg-gray-200 opacity-50 cursor-not-allowed"
                      : "bg-gradient-to-r from-[#E86412] to-[#F12A4C] hover:opacity-90 cursor-pointer active:opacity-80"
                  )}
                >
                  <span className={cn(
                    "font-heading text-base font-semibold leading-4",
                    !hasModalAssets ? "text-[#616161]" : "text-white"
                  )}>Attach</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Avatar Preview Modal */}
      {showAvatarPreview && previewAvatar && (
        <>
          {/* Overlay - backdrop only (translucent), card/image stay fully opaque */}
          <div
            className="fixed inset-0 z-[150] flex items-center justify-center"
            style={{
              background: 'linear-gradient(116.46deg, rgba(191, 143, 100, 0.7) 17.88%, rgba(179, 104, 56, 0.7) 89.93%)',
            }}
            onClick={() => setShowAvatarPreview(false)}
          >
            {/* Modal Content - reduced padding for thinner border */}
            <div
              className="relative w-[clamp(17rem,35.42vh,340px)] rounded-[8px] p-[2px] bg-white"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Avatar Image - Wrapper to center image without cropping */}
              <div className="relative w-full rounded-[10px] overflow-hidden flex items-center justify-center bg-white" style={{ minHeight: 'clamp(21.875rem,43.65vh,447px)' }}>
                {(() => {
                  const avatarImageUrl = previewAvatar.thumbnailUrl || previewAvatar.avatarUrl || previewAvatar.originalImageUrl;
                  const AI_CONTENT_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL 
                    ? process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL.replace('/api', '')
                    : 'http://localhost:9001';
                  const fullImageUrl = avatarImageUrl?.startsWith('http') 
                    ? avatarImageUrl 
                    : avatarImageUrl 
                      ? `${AI_CONTENT_SERVICE_BASE_URL}${avatarImageUrl}`
                      : null;
                  
                  return (
                    <div className="relative w-full h-full flex items-center justify-center p-2 bg-white">
                      {fullImageUrl && !previewImageFailed ? (
                        <Image
                          src={fullImageUrl}
                          alt={previewAvatar.name || 'Avatar'}
                          width={300}
                          height={400}
                          className="object-contain max-w-full max-h-full opacity-100"
                          unoptimized
                          onError={() => {
                            setPreviewImageFailed(true);
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gray-100">
                          <span className="text-sm text-gray-400">No Image Available</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Close Button - Updated positioning to match Figma */}
                <button
                  onClick={() => setShowAvatarPreview(false)}
                  className="absolute top-[clamp(0.75rem,1.17vh,12px)] right-[clamp(0.75rem,1.17vh,12px)] w-[clamp(2.25rem,3.52vh,36px)] h-[clamp(2.25rem,3.52vh,36px)] bg-white/60 rounded-[32px] flex items-center justify-center hover:bg-white/80 transition-colors z-10"
                >
                  <X className="w-[clamp(1.5rem,2.34vh,24px)] h-[clamp(1.5rem,2.34vh,24px)] text-[#212121]" strokeWidth={1.5} />
                </button>

                {/* Play Button - Center - COMMENTED OUT since we only have images, not videos */}
                {/* <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-[clamp(4.875rem,9.77vh,78px)] h-[clamp(4.875rem,9.77vh,78px)] bg-[rgba(242,126,53,0.5)] rounded-[48px] flex items-center justify-center">
                    <div className="w-[clamp(2.25rem,4.69vh,36px)] h-[clamp(2.25rem,4.69vh,36px)] border-[2.5px] border-white rounded-full flex items-center justify-center">
                      <div className="w-0 h-0 border-l-[clamp(0.625rem,1.17vh,12px)] border-t-[clamp(0.375rem,0.59vh,6px)] border-b-[clamp(0.375rem,0.59vh,6px)] border-t-transparent border-b-transparent border-l-white ml-[clamp(0.125rem,0.2vh,2px)]" />
                    </div>
                  </div>
                </div> */}

                {/* Video Controls Bar - Bottom - COMMENTED OUT since we only have images, not videos */}
                {/* <div className="absolute bottom-[clamp(0.5rem,0.78vh,8px)] left-[clamp(0.5rem,0.78vh,8px)] right-[clamp(0.5rem,0.78vh,8px)] bg-white/60 rounded-[8px] p-[clamp(0.25rem,0.39vh,4px)]">
                  <div className="flex flex-col gap-[clamp(0.5rem,0.78vh,8px)]">
                    <div className="flex flex-row justify-between items-center px-[clamp(0.5rem,0.78vh,8px)]">
                      <span className="font-heading text-[clamp(0.75rem,1.17vh,12px)] font-normal leading-[clamp(1.5rem,2.34vh,24px)] text-[#212121]">
                        00:30
                      </span>
                      <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] flex items-center justify-center">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8 2.5V8.5M6 4.5L4 6.5H2V9.5H4L6 11.5V4.5ZM10 5.5L12 7.5M12 7.5L14 5.5M12 7.5L14 9.5M12 7.5L10 9.5" stroke="#212121" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                    <div className="relative w-full h-[clamp(0.625rem,0.98vh,10px)] bg-white rounded-[18px] px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.25rem,0.39vh,4px)]">
                      <div className="w-full h-[2px] bg-[#E0E0E0] rounded-full" />
                      <div className="absolute left-[clamp(0.0625rem,0.1vh,1px)] top-1/2 -translate-y-1/2 w-[clamp(0.5rem,0.78vh,8px)] h-[clamp(0.5rem,0.78vh,8px)] bg-white border-2 border-[#E86412] rounded-full" />
                    </div>
                  </div>
                </div> */}
              </div>
            </div>

            {/* Select Avatar Button - Updated positioning and icon to match Figma */}
            <button
              onClick={() => {
                handleSelectAvatar(previewAvatar);
                setShowAvatarPreview(false);
              }}
              className="absolute bottom-[clamp(1.5rem,2.93vh,30px)] left-1/2 -translate-x-1/2 flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.17vh,12px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[24px] h-[clamp(2.75rem,5.47vh,44px)] hover:opacity-90 transition-opacity z-10"
            >
              <div className="w-[clamp(1.5rem,2.34vh,24px)] h-[clamp(1.5rem,2.34vh,24px)] flex items-center justify-center">
                <Image
                  src="/assets/u_check.svg"
                  alt="Select"
                  width={24}
                  height={24}
                  className="w-full h-full"
                />
              </div>
              <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1.75rem,3.42vh,28px)] text-[#212121]">
                Select Avatar
              </span>
            </button>
          </div>
        </>
      )}

      {/* Per-Scene Transform Modal */}
      {perSceneTransformModal.isOpen && (
        <>
          {/* Overlay */}
          <div 
            className="fixed inset-0 bg-gradient-to-br from-[rgba(191,143,100,0.5)] to-[rgba(179,104,56,0.5)] opacity-90 z-40"
            onClick={() => {
              setPerSceneTransformModal({ isOpen: false, sceneNumber: null, voiceoverText: '' });
              setIsModalVoiceDropdownOpen(false);
            }}
          />
          
          {/* Modal */}
          <div className="fixed inset-0 flex items-center justify-center z-[150] p-4 overflow-y-auto">
            <div className="bg-white shadow-[0px_4px_22px_rgba(242,126,53,0.3)] rounded-xl p-6 w-full max-w-[500px] flex flex-col gap-4 my-auto">
              {/* Modal Header */}
              <div className="flex flex-row items-center justify-between w-full">
                <h2 className="font-heading text-xl font-medium text-[#212121]">
                  Transform Scene {perSceneTransformModal.sceneNumber}
                </h2>
                <button
                  onClick={() => {
                    setPerSceneTransformModal({ isOpen: false, sceneNumber: null, voiceoverText: '' });
                    setIsModalVoiceDropdownOpen(false);
                  }}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
    </div>

              {/* Voiceover Text Preview */}
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 line-clamp-3">
                  {perSceneTransformModal.voiceoverText || 'No voiceover text'}
                </p>
              </div>

              {/* Voice Selection Dropdown for Per-Scene - Custom Dropdown matching main section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Target Voice</label>
                <div ref={modalVoiceDropdownRef} className="relative">
                  {/* Dropdown Trigger */}
                  <button
                    type="button"
                    onClick={() => setIsModalVoiceDropdownOpen(!isModalVoiceDropdownOpen)}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border-2 transition-all bg-white",
                      perSceneSettings?.voiceId 
                        ? "border-orange-500" 
                        : "border-gray-200 hover:border-gray-300"
                    )}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {stsVoicesLoading ? (
                        <div className="flex items-center gap-2">
                          <div className="animate-spin w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full"></div>
                          <span className="text-gray-500">Loading voices...</span>
                        </div>
                      ) : perSceneSettings?.voiceId ? (
                        <>
                          <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium text-[#212121] truncate">
                            {stsVoices.find(v => v.voice_id === perSceneSettings.voiceId)?.name || 'Selected Voice'}
                          </span>
                          {stsVoices.find(v => v.voice_id === perSceneSettings.voiceId)?.labels && (
                            <span className="text-sm text-gray-500 truncate">
                              {stsVoices.find(v => v.voice_id === perSceneSettings.voiceId)?.labels?.gender}
                              {stsVoices.find(v => v.voice_id === perSceneSettings.voiceId)?.labels?.accent && 
                                `, ${stsVoices.find(v => v.voice_id === perSceneSettings.voiceId)?.labels?.accent}`}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-500">Select a voice...</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {perSceneSettings?.voiceId && stsVoices.find(v => v.voice_id === perSceneSettings.voiceId)?.preview_url && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            const voice = stsVoices.find(v => v.voice_id === perSceneSettings.voiceId);
                            if (voice?.preview_url) {
                              const audio = new Audio(voice.preview_url);
                              audio.play().catch(err => console.error('Audio playback failed:', err));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                              const voice = stsVoices.find(v => v.voice_id === perSceneSettings.voiceId);
                              if (voice?.preview_url) {
                                const audio = new Audio(voice.preview_url);
                                audio.play().catch(err => console.error('Audio playback failed:', err));
                              }
                            }
                          }}
                          className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
                        >
                          <Image src="/assets/u_play.svg" alt="Preview" width={16} height={16} />
                        </div>
                      )}
                      <svg 
                        className={cn("w-5 h-5 text-gray-400 transition-transform", isModalVoiceDropdownOpen && "rotate-180")} 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Dropdown Panel */}
                  {isModalVoiceDropdownOpen && !stsVoicesLoading && stsVoices.length > 0 && (
                    <div className="absolute z-50 mt-2 w-full bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
                      <div className="max-h-[200px] overflow-y-auto">
                        {stsVoices.slice(0, 20).map((voice: any) => (
                          <div
                            key={voice.voice_id}
                            onClick={() => {
                              setPerSceneSettings(prev => ({
                                voiceId: voice.voice_id,
                                stability: prev?.stability || 0.5,
                                similarityBoost: prev?.similarityBoost || 0.75,
                                style: prev?.style || 0,
                                useSpeakerBoost: prev?.useSpeakerBoost ?? true,
                                removeBackgroundNoise: prev?.removeBackgroundNoise ?? false,
                              }));
                              setIsModalVoiceDropdownOpen(false);
                            }}
                            className={cn(
                              "flex items-center justify-between gap-3 px-4 py-3 cursor-pointer transition-all",
                              perSceneSettings?.voiceId === voice.voice_id
                                ? "bg-orange-50"
                                : "hover:bg-gray-50"
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <span className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-medium text-[#212121]">
                                {voice.name}
                              </span>
                              {voice.labels && (
                                <span className="ml-2 text-sm text-gray-500">
                                  {voice.labels.gender && voice.labels.gender}
                                  {voice.labels.accent && `, ${voice.labels.accent}`}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {voice.preview_url && (
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const audio = new Audio(voice.preview_url);
                                    audio.play().catch(err => console.error('Audio playback failed:', err));
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.stopPropagation();
                                      const audio = new Audio(voice.preview_url);
                                      audio.play().catch(err => console.error('Audio playback failed:', err));
                                    }
                                  }}
                                  className="p-1.5 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
                                >
                                  <Image src="/assets/u_play.svg" alt="Preview" width={14} height={14} />
                                </div>
                              )}
                              {perSceneSettings?.voiceId === voice.voice_id && (
                                <svg className="w-4 h-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Settings */}
              <div className="space-y-3">
                {/* Stability Slider */}
                <div>
                  <label className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>Stability</span>
                    <span className="font-medium">{((perSceneSettings?.stability || 0.5) * 100).toFixed(0)}%</span>
                  </label>
                  <div className="relative h-2">
                    <div className="absolute inset-0 bg-gray-200 rounded-full"></div>
                    <div 
                      className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] transition-all duration-150"
                      style={{ width: `${(perSceneSettings?.stability || 0.5) * 100}%` }}
                    ></div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={perSceneSettings?.stability || 0.5}
                      onChange={(e) => setPerSceneSettings(prev => ({
                        voiceId: prev?.voiceId || '',
                        stability: parseFloat(e.target.value),
                        similarityBoost: prev?.similarityBoost || 0.75,
                        style: prev?.style || 0,
                        useSpeakerBoost: prev?.useSpeakerBoost ?? true,
                        removeBackgroundNoise: prev?.removeBackgroundNoise ?? false,
                      }))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md border-2 border-orange-500 transition-all duration-150 pointer-events-none"
                      style={{ left: `calc(${(perSceneSettings?.stability || 0.5) * 100}% - 6px)` }}
                    ></div>
                  </div>
                </div>

                {/* Similarity Boost Slider */}
                <div>
                  <label className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>Similarity Boost</span>
                    <span className="font-medium">{((perSceneSettings?.similarityBoost || 0.75) * 100).toFixed(0)}%</span>
                  </label>
                  <div className="relative h-2">
                    <div className="absolute inset-0 bg-gray-200 rounded-full"></div>
                    <div 
                      className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] transition-all duration-150"
                      style={{ width: `${(perSceneSettings?.similarityBoost || 0.75) * 100}%` }}
                    ></div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={perSceneSettings?.similarityBoost || 0.75}
                      onChange={(e) => setPerSceneSettings(prev => ({
                        voiceId: prev?.voiceId || '',
                        stability: prev?.stability || 0.5,
                        similarityBoost: parseFloat(e.target.value),
                        style: prev?.style || 0,
                        useSpeakerBoost: prev?.useSpeakerBoost ?? true,
                        removeBackgroundNoise: prev?.removeBackgroundNoise ?? false,
                      }))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md border-2 border-orange-500 transition-all duration-150 pointer-events-none"
                      style={{ left: `calc(${(perSceneSettings?.similarityBoost || 0.75) * 100}% - 6px)` }}
                    ></div>
                  </div>
                </div>

                {/* Style Slider */}
                <div>
                  <label className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>Style</span>
                    <span className="font-medium">{((perSceneSettings?.style || 0) * 100).toFixed(0)}%</span>
                  </label>
                  <div className="relative h-2">
                    <div className="absolute inset-0 bg-gray-200 rounded-full"></div>
                    <div 
                      className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-[#E86412] to-[#F12A4C] transition-all duration-150"
                      style={{ width: `${(perSceneSettings?.style || 0) * 100}%` }}
                    ></div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={perSceneSettings?.style || 0}
                      onChange={(e) => setPerSceneSettings(prev => ({
                        voiceId: prev?.voiceId || '',
                        stability: prev?.stability || 0.5,
                        similarityBoost: prev?.similarityBoost || 0.75,
                        style: parseFloat(e.target.value),
                        useSpeakerBoost: prev?.useSpeakerBoost ?? true,
                        removeBackgroundNoise: prev?.removeBackgroundNoise ?? false,
                      }))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md border-2 border-orange-500 transition-all duration-150 pointer-events-none"
                      style={{ left: `calc(${(perSceneSettings?.style || 0) * 100}% - 6px)` }}
                    ></div>
                  </div>
                </div>

                {/* Checkboxes */}
                <div className="flex flex-wrap gap-4 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div 
                      onClick={() => setPerSceneSettings(prev => ({
                        voiceId: prev?.voiceId || '',
                        stability: prev?.stability || 0.5,
                        similarityBoost: prev?.similarityBoost || 0.75,
                        style: prev?.style || 0,
                        useSpeakerBoost: !(prev?.useSpeakerBoost ?? true),
                        removeBackgroundNoise: prev?.removeBackgroundNoise ?? false,
                      }))}
                      className={cn(
                        "w-4 h-4 rounded flex items-center justify-center transition-all duration-200",
                        perSceneSettings?.useSpeakerBoost ?? true
                          ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C]"
                          : "bg-white border-2 border-gray-300 group-hover:border-orange-400"
                      )}
                    >
                      {(perSceneSettings?.useSpeakerBoost ?? true) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-gray-600">Speaker Boost</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div 
                      onClick={() => setPerSceneSettings(prev => ({
                        voiceId: prev?.voiceId || '',
                        stability: prev?.stability || 0.5,
                        similarityBoost: prev?.similarityBoost || 0.75,
                        style: prev?.style || 0,
                        useSpeakerBoost: prev?.useSpeakerBoost ?? true,
                        removeBackgroundNoise: !(prev?.removeBackgroundNoise ?? false),
                      }))}
                      className={cn(
                        "w-4 h-4 rounded flex items-center justify-center transition-all duration-200",
                        perSceneSettings?.removeBackgroundNoise ?? false
                          ? "bg-gradient-to-r from-[#E86412] to-[#F12A4C]"
                          : "bg-white border-2 border-gray-300 group-hover:border-orange-400"
                      )}
                    >
                      {(perSceneSettings?.removeBackgroundNoise ?? false) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-gray-600">Remove Background Noise</span>
                  </label>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    setPerSceneTransformModal({ isOpen: false, sceneNumber: null, voiceoverText: '' });
                    setIsModalVoiceDropdownOpen(false);
                  }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!perSceneSettings?.voiceId || !projectId || perSceneTransformModal.sceneNumber === null) {
                      showToast('Please select a target voice', 'warning');
                      return;
                    }

                    setIsTransformingSingleScene(true);
                    const sceneNum = perSceneTransformModal.sceneNumber;

                    try {
                      const response = await apiClient.transformAllSceneAudio(
                        projectId,
                        perSceneSettings.voiceId,
                        {
                          stability: perSceneSettings.stability,
                          similarityBoost: perSceneSettings.similarityBoost,
                          style: perSceneSettings.style,
                          useSpeakerBoost: perSceneSettings.useSpeakerBoost,
                          removeBackgroundNoise: perSceneSettings.removeBackgroundNoise,
                        },
                        [sceneNum]
                      );

                      if (response.success && response.data?.results?.length) {
                        const result = response.data.results[0];
                        if (result.status === 'success' && result.transformedUrl) {
                          setTransformedAudioByScene(prev => ({
                            ...prev,
                            [sceneNum]: {
                              status: 'completed',
                              originalUrl: result.originalUrl,
                              transformedUrl: result.transformedUrl,
                              duration: result.duration,
                              settings: perSceneSettings,
                            },
                          }));
                          showToast(`Scene ${sceneNum} transformed successfully`, 'success');
                          setPerSceneTransformModal({ isOpen: false, sceneNumber: null, voiceoverText: '' });
                          setIsModalVoiceDropdownOpen(false);
                        } else {
                          showToast(result.error || response.message || 'Transformation failed', 'error');
                        }
                      } else {
                        showToast(response.message || 'Transformation failed', 'error');
                      }
                    } catch (e: any) {
                      showToast(e.message || 'Transformation failed', 'error');
                    } finally {
                      setIsTransformingSingleScene(false);
                    }
                  }}
                  disabled={!perSceneSettings?.voiceId || isTransformingSingleScene}
                  className="flex items-center gap-2 px-4 py-2 bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[20px] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isTransformingSingleScene ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full"></div>
                      <span className="text-sm text-[#212121]">Transforming...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className="text-sm text-[#212121]">Transform Scene</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Avatar Preview Modal - full-screen image on click */}
      <ImagePreview
        imageUrl={avatarPreviewUrl || ''}
        isOpen={avatarPreviewModalOpen}
        onClose={() => setAvatarPreviewModalOpen(false)}
        alt="Avatar Preview"
      />

      {/* B-Roll Selection Modal - for manual B-roll selection */}
      <BRollSelectionModal
        isOpen={brollModalOpen}
        onClose={() => setBrollModalOpen(false)}
        onSelect={handleBrollSelection}
        sceneNumber={brollModalSceneNumber}
        defaultSearchTerm={
          generatedScript?.scenes?.[brollModalSceneNumber - 1]?.stock_search_term ||
          generatedScript?.scene_plan?.[brollModalSceneNumber - 1]?.stock_search_term ||
          ''
        }
        allowedTabs={
          brollSourcePreference === 'upload' 
            ? ['upload'] 
            : brollSourcePreference === 'stock' 
              ? ['images', 'videos'] 
              : ['images', 'videos', 'upload']
        }
        targetAspectRatio="9:16"
      />
    </div>
  );
}

export default function AIChatPage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-[#FFFCF8] flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    }>
      <AIChatPageContent />
    </Suspense>
  );
}

