'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, X, Image as ImageIcon, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';
import { apiClient, User } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import { useToast } from '@/lib/toast/toast';
import { useWebSocket } from '@/hooks/useWebSocket';
import { VideoStyle } from '@/types';
import AIChatTagAwareInput from '@/components/ui/AIChatTagAwareInput';
import { AVATAR_VISUAL_STYLE_PRESETS, type AvatarVisualStylePresetId } from '@/lib/config/avatar-visual-style-presets';

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

// Define chat flow steps
type ChatStep = 'welcome' | 'option-selected' | 'style-selection' | 'asset-upload' | 'assets-attached' | 'script-input' | 'script-generated' | 'avatar-selection' | 'voice-selection' | 'audio-image-generation' | 'workspace';

// Define substeps for multi-stage steps
type AvatarSubstep = 'question' | 'selection' | 'visual-style';
type VoiceSubstep = 'question' | 'selection' | 'confirmed';
type StyleSubstep = 'selection' | 'confirmed';
type ScriptSubstep = 'language' | 'input';

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
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [userScriptMessage, setUserScriptMessage] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [proceedConfirmed, setProceedConfirmed] = useState<boolean>(false);
  const [avatarPreference, setAvatarPreference] = useState<'yes' | 'no' | null>(null);
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
  // Voice selection state
  const [voicePreference, setVoicePreference] = useState<'yes' | 'no' | null>(null);
  const [voiceYesMessage, setVoiceYesMessage] = useState<boolean>(false);
  const [voiceConfirmed, setVoiceConfirmed] = useState<boolean>(false); // Track if voice is confirmed and ready to proceed
  const [voiceSubstep, setVoiceSubstep] = useState<VoiceSubstep>('question'); // Track voice selection substep
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
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const productImagesInputRef = useRef<HTMLInputElement>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const voiceFileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Style selection state
  const [selectedVideoStyle, setSelectedVideoStyle] = useState<VideoStyle | null>(null);
  const [styleSubstep, setStyleSubstep] = useState<StyleSubstep>('selection');
  // Script/Language selection state
  const [selectedLanguage, setSelectedLanguage] = useState<'english' | 'hindi' | 'hinglish' | null>(null);
  const [scriptSubstep, setScriptSubstep] = useState<ScriptSubstep>('language');
  const [extractedTags, setExtractedTags] = useState<string[]>([]);
  // Generation tracking state
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [isGeneratingBroll, setIsGeneratingBroll] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const audioJobIdRef = useRef<string | null>(null); // Use ref instead of state to avoid closure issues
  const imageJobIdsRef = useRef<Set<string>>(new Set());

  // Fetch user profile when authenticated
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
    const projectIdParam = searchParams.get('projectId');
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

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      sessionStorage.setItem('pendingRedirect', '/create-video/ai-chat');
      router.replace('/login?redirect=/create-video/ai-chat');
    }
  }, [isAuthenticated, isLoading, router]);

  // Load project if projectId exists in URL (resume functionality)
  useEffect(() => {
    const loadProject = async () => {
      const projectIdParam = searchParams.get('projectId');
      if (!projectIdParam || !isAuthenticated || isLoading) return;
      
      // Don't reload if we already have this projectId loaded
      if (projectId === projectIdParam) return;
      
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
              setAvatarPreference('yes');
              setAvatarYesMessage(true);
            }
            
            // Restore voice
            if (project.voiceId) {
              setSelectedVoiceId(project.voiceId);
              setVoicePreference('yes');
              setVoiceYesMessage(true);
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
                  };
                  return styleMap[project.style];
                })() : null);
              
              if (restoredStep === 'avatar-selection' && restoredStyle === 'product-only') {
                restoredStep = 'voice-selection';
                // Set avatar preference to 'no' for product-only
                setAvatarPreference('no');
                if (typeof window !== 'undefined') {
                  sessionStorage.setItem('avatarPreference', 'no');
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
            if (project.metadata?.avatarVisualStylePreset) {
              setSelectedAvatarVisualStyle(project.metadata.avatarVisualStylePreset as AvatarVisualStylePresetId);
            }
            if (project.metadata?.aiChatVoiceSubstep) {
              setVoiceSubstep(project.metadata.aiChatVoiceSubstep as VoiceSubstep);
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
              // If language was selected, script substep should be 'input'
              if (!project.metadata?.aiChatScriptSubstep) {
                setScriptSubstep('input');
              }
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
            // Not an AI chat project, redirect to old flow
            showToast('This project uses the classic flow. Redirecting...', 'info');
            router.push(`/create-video?projectId=${project.id}`);
          }
        }
      } catch (error: any) {
        console.error('Failed to load project:', error);
        showToast('Failed to load project', 'error');
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
    if (chatContainerRef.current) {
      // Use setTimeout to ensure DOM is updated before scrolling
      setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 150);
    }
  }, [currentStep, selectedOption, attachedAssets, pendingAssets, generatedScript, formattedScript, proceedConfirmed, avatarYesMessage, avatars, selectedAvatarId, selectedAvatar, avatarConfirmed, avatarSubstep, selectedAvatarVisualStyle, voiceYesMessage, voices, selectedVoiceId, voiceConfirmed, voiceSubstep, selectedVideoStyle, styleSubstep]);

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
          setGenerationProgress(prev => Math.min(prev + 50, 100));
          if (audioJobIdRef.current) {
            unsubscribeFromJob(audioJobIdRef.current);
            audioJobIdRef.current = null;
          }
        } else if (update.state === 'failed') {
          setIsGeneratingVoice(false);
          showToast('Voice generation failed', 'error');
          if (audioJobIdRef.current) {
            unsubscribeFromJob(audioJobIdRef.current);
            audioJobIdRef.current = null;
          }
        } else if (update.progress !== undefined) {
          // Update progress for voice (0-50% range)
          setGenerationProgress(update.progress * 0.5);
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
                console.log('[AIChat] All generation complete, navigating to workspace');
                router.push(`/create-video/workspace?projectId=${projectId}`);
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
    setIsGeneratingScript(true);
    setScriptError(null);
    
    // Advance to script-input step to show user message
    setCurrentStep('script-input');
    
    try {
      // Extract duration from input if present, otherwise default to 30 seconds
      let duration = '30 seconds';
      const durationMatch = userMessage.match(/(\d+)\s*(second|sec|minute|min)/i);
      if (durationMatch) {
        const num = parseInt(durationMatch[1]);
        const unit = durationMatch[2].toLowerCase().startsWith('min') ? 'minutes' : 'seconds';
        duration = `${num} ${unit}`;
      }
      
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
      const hasAvatar = styleToUse === 'product-only' 
        ? false 
        : (avatarPreference === 'yes' && selectedAvatar !== null);
      
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
        
        // Clear script input
        setScriptInput('');
        
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
      // Extract duration from original message
      let duration = '30 seconds';
      const durationMatch = userScriptMessage.match(/(\d+)\s*(second|sec|minute|min)/i);
      if (durationMatch) {
        const num = parseInt(durationMatch[1]);
        const unit = durationMatch[2].toLowerCase().startsWith('min') ? 'minutes' : 'seconds';
        duration = `${num} ${unit}`;
      }
      
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
      const hasAvatar = styleToUse === 'product-only' 
        ? false 
        : (avatarPreference === 'yes' && selectedAvatar !== null);
      
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

  const handleAvatarSelection = (preference: 'yes' | 'no') => {
    setAvatarPreference(preference);
    // Save preference to sessionStorage for later use
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('avatarPreference', preference);
    }
    
    if (preference === 'yes') {
      // Move to selection substep
      setAvatarYesMessage(true);
      setAvatarSubstep('selection');
      // Load avatars for the active tab
      loadAvatars(activeAvatarTab);
    } else {
      // Skip avatar selection and move to voice selection
      setAvatarSubstep('question'); // Reset substep
      setCurrentStep('voice-selection');
    }
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
      setVoiceYesMessage(true);
      setVoiceSubstep('selection'); // Move to selection substep
      loadVoices(activeVoiceTab);
    } else {
      // Navigate to style selection
      setVoiceSubstep('question'); // Reset substep
      router.push('/create-video/style');
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
      
      // After 1.5 seconds, move to audio-image-generation step
      setTimeout(async () => {
        setCurrentStep('audio-image-generation');
        setGenerationProgress(0);
        
        // Start voice generation
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
            setGenerationProgress(50);
          } else {
            throw new Error('Failed to start voice generation');
          }
        } catch (error: any) {
          console.error('Failed to generate audio:', error);
          setIsGeneratingVoice(false);
          showToast('Failed to start voice generation', 'error');
        }

        // Start broll image generation for all scenes
        if (generatedScript && (generatedScript.scenes || generatedScript.scene_plan)) {
          try {
            setIsGeneratingBroll(true);
            const scenes = generatedScript.scenes || generatedScript.scene_plan || [];
            
            // Extract product image URL and avatar info for avatar-product style
            const productImageUrl = attachedAssets.find(asset => 
              asset.type === 'image' && asset.id.startsWith('product-')
            )?.url || null;
            
            const styleToUse = selectedVideoStyle || 
              (typeof window !== 'undefined' ? sessionStorage.getItem('selectedVideoStyle') : null);
            
            // Get avatar image key if avatar is selected (for avatar-product style)
            let avatarImageKey: string | undefined = undefined;
            if (styleToUse === 'avatar-product' && selectedAvatar) {
              // Avatar image key will be retrieved from backend based on avatarId
              // We'll pass avatarId and let backend handle it
            }
            
            const promises = scenes.map(async (scene: any, index: number) => {
              const sceneNumber = scene.scene_number || (index + 1);
              
              // For ALTERNATE style, ALL scenes need b-roll images (odd: full 9:16, even: 3:4 for top half)
              // So we need to handle cases where avatar-type scenes might not have broll_image_prompt
              let prompt = scene.broll_image_prompt || scene.broll_visual_description || scene.broll || scene.prompt || '';
              
              // For ALTERNATE style, if prompt is empty, generate fallback based on scene number
              if (!prompt && (styleToUse === 'alternate' || styleToUse === 'ALTERNATE')) {
                if (sceneNumber % 2 === 1) {
                  // Odd scene: Full 9:16 b-roll image
                  // Use broll_visual_description, voiceover context, or generate fallback
                  prompt = scene.broll_visual_description || 
                           (scene.voiceover ? `B-roll supporting: ${scene.voiceover.substring(0, 100)}` : '') ||
                           `Scene ${sceneNumber} full-screen b-roll for ALTERNATE style`;
                } else {
                  // Even scene: 3:4 b-roll image for top half (half-n-half composition)
                  prompt = scene.broll_visual_description || 
                           (scene.voiceover ? `B-roll supporting: ${scene.voiceover.substring(0, 100)}` : '') ||
                           `Scene ${sceneNumber} b-roll for half-n-half composition (top half)`;
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
      }, 1500);
    } else {
      showToast('Please select a voice first', 'warning');
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
      const videoType = avatarPreference === 'yes' ? 'WITH_AVATAR' : 'WITHOUT_AVATAR';
      
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
      };
      
      // Determine next step based on style
      const shouldSkipAvatarSelection = styleToUse === 'product-only';
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
          // Set avatar preference to 'no' since product-only doesn't use avatars
          setAvatarPreference('no');
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('avatarPreference', 'no');
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
    setScriptSubstep('input');
    
    // Store language in sessionStorage
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('selectedScriptLanguage', language);
    }
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
      }
      if (currentStep === 'voice-selection') {
        metadataUpdate.aiChatVoiceSubstep = voiceSubstep;
      }
      if (currentStep === 'style-selection') {
        metadataUpdate.aiChatStyleSubstep = styleSubstep;
      }
      
      apiClient.updateVideoProject(projectId, {
        metadata: metadataUpdate,
      }).catch(err => console.error('Failed to save step progress:', err));
    }
  }, [projectId, currentStep, avatarSubstep, voiceSubstep, styleSubstep, selectedAvatarVisualStyle]);

  // Auto-save language and tags selection to project metadata
  useEffect(() => {
    if (projectId && selectedLanguage) {
      apiClient.updateVideoProject(projectId, {
        metadata: {
          selectedLanguage: selectedLanguage,
          aiChatScriptSubstep: scriptSubstep,
          extractedTags: extractedTags,
        },
      }).catch(err => console.error('Failed to save language/tags:', err));
    }
  }, [projectId, selectedLanguage, scriptSubstep, extractedTags]);

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

  // Handle proceed with visual style - PATCH project and advance to voice-selection
  const handleProceedWithVisualStyle = async () => {
    if (!selectedAvatarVisualStyle) {
      showToast('Please select a visual style first', 'warning');
      return;
    }
    if (!projectId) {
      showToast('Project not found. Please try again.', 'error');
      return;
    }
    try {
      await apiClient.updateVideoProject(projectId, {
        metadata: {
          avatarVisualStylePreset: selectedAvatarVisualStyle,
          aiChatAvatarSubstep: 'visual-style',
        },
      });
      setCurrentStep('voice-selection');
      setVoiceSubstep('question');
      setVoiceYesMessage(false);
      setSelectedVoiceId(null);
      setVoiceUploadSuccess(false);
    } catch (err: any) {
      showToast(err.message || 'Failed to save visual style', 'error');
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
      if (avatarSubstep === 'visual-style') {
        setAvatarSubstep('selection');
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
      // Navigate back through substeps
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
      } else {
        // Go back to avatar-selection step
        setCurrentStep('avatar-selection');
        setVoiceSubstep('question'); // Reset substep
        // Re-enable avatar upload controls when returning from voice
        setAvatarUploadSuccess(false);
        setAvatarUploadMessageShown(false);
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
    } else if (currentStep === 'assets-attached' || currentStep === 'script-input' || currentStep === 'script-generated') {
      // Clear attached assets and script data, go back to asset-upload
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
        const substepOrder: AvatarSubstep[] = ['question', 'selection', 'visual-style'];
        const targetIndex = substepOrder.indexOf(substep as AvatarSubstep);
        const currentIndex = substepOrder.indexOf(avatarSubstep);
        return targetIndex !== -1 && currentIndex >= targetIndex;
      }
      case 'voice-selection': {
        const substepOrder: VoiceSubstep[] = ['question', 'selection', 'confirmed'];
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
      <div className="h-screen bg-[#FFFCF8] flex items-center justify-center">
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

  return (
    <div className="relative h-full bg-[#FFFCF8] overflow-hidden flex flex-col">
      {/* Gradient Ellipses Background - Exact Figma positions */}
      <div className="absolute w-[1146px] h-[1146px] left-[calc(50%+720px)] top-[calc(50%-512px)] bg-[#E86512] opacity-10 blur-[200px] pointer-events-none" />
      <div className="absolute w-[1146px] h-[1146px] left-[calc(50%-720px)] top-[calc(50%+512px)] bg-[#E86512] opacity-10 blur-[200px] pointer-events-none" />

      {/* Main Container - Figma: width: 1248px, left: 96px, top: 43px */}
      <div className="relative max-w-[1248px] w-full mx-auto px-3 sm:px-6 md:px-[96px] pt-0 sm:pt-2 md:pt-[43px] pb-0 sm:pb-2 md:pb-[43px] flex flex-col flex-1 min-h-0">
        {/* Navigation Bar - Figma: height: 34px, gap: 20px between back arrow and "AI Chat" */}
        <div className="flex flex-row justify-between items-center mb-0 sm:mb-2 md:mb-[24px] h-[clamp(20px,3.3vh,34px)] flex-shrink-0">
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
          <div className="flex flex-row items-center gap-0 pl-1 sm:pl-2 md:pl-2 max-w-[200px] sm:max-w-[300px] md:max-w-[400px] lg:max-w-[448px] w-full">
            <div className="flex flex-col justify-between items-start gap-0.5 sm:gap-1 md:gap-1 w-full max-w-[180px] sm:max-w-[280px] md:max-w-[380px] lg:max-w-[440px] h-[clamp(20px,3.3vh,34px)]">
              {/* Figma: height: 24px, gap: 10px, font: 14px, line-height: 24px */}
              <div className="flex flex-row justify-between items-center gap-[clamp(0.5rem,1vh,10px)] w-full h-[clamp(18px,2.34vh,24px)]">
                <span className="font-heading text-[clamp(10px,1.37vh,14px)] font-normal leading-[clamp(18px,2.34vh,24px)] text-black truncate">
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
        <div className="bg-white shadow-[0px_4px_22px_rgba(102,118,108,0.12)] rounded-xl py-[clamp(1rem,5.1vh,52px)] px-[clamp(0.75rem,5.5vh,56px)] flex flex-col justify-start items-start gap-[clamp(0.5rem,1.95vh,20px)] flex-1 min-h-0 overflow-hidden">
          {/* Chat Content Container - Figma: gap: 18px, justify-content: flex-end */}
          <div 
            ref={chatContainerRef}
            className="flex flex-col justify-start items-start gap-[clamp(0.5rem,1.76vh,18px)] w-full flex-1 min-h-0 overflow-y-auto scroll-smooth pb-[clamp(1rem,3vh,60px)] pr-[clamp(0.5rem,1vw,16px)]"
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
                      className={cn(
                        "relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] transition-all",
                        selectedVideoStyle === 'half-n-half' ? "p-[2px]" : "p-0"
                      )}
                      style={selectedVideoStyle === 'half-n-half' ? {
                        background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)'
                      } : {}}
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
                      className={cn(
                        "relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] transition-all",
                        selectedVideoStyle === 'avatar-only' ? "p-[2px]" : "p-0"
                      )}
                      style={selectedVideoStyle === 'avatar-only' ? {
                        background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)'
                      } : {}}
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
                      className={cn(
                        "relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] transition-all",
                        selectedVideoStyle === 'avatar-cutout' ? "p-[2px]" : "p-0"
                      )}
                      style={selectedVideoStyle === 'avatar-cutout' ? {
                        background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)'
                      } : {}}
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
                      className={cn(
                        "relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] transition-all",
                        selectedVideoStyle === 'alternate' ? "p-[2px]" : "p-0"
                      )}
                      style={selectedVideoStyle === 'alternate' ? {
                        background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)'
                      } : {}}
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
                      className={cn(
                        "relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] transition-all",
                        selectedVideoStyle === 'product-only' ? "p-[2px]" : "p-0"
                      )}
                      style={selectedVideoStyle === 'product-only' ? {
                        background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)'
                      } : {}}
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

                    {/* Avatar with Product Card */}
                    <button
                      onClick={() => setSelectedVideoStyle('avatar-product')}
                      className={cn(
                        "relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] transition-all",
                        selectedVideoStyle === 'avatar-product' ? "p-[2px]" : "p-0"
                      )}
                      style={selectedVideoStyle === 'avatar-product' ? {
                        background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)'
                      } : {}}
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
                      className={cn(
                        "relative flex flex-col items-center rounded-[12px] flex-none w-[clamp(120px,11vw,152px)] transition-all",
                        selectedVideoStyle === 'animated-avatar' ? "p-[2px]" : "p-0"
                      )}
                      style={selectedVideoStyle === 'animated-avatar' ? {
                        background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)'
                      } : {}}
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
                          <div className="flex flex-col gap-[clamp(0.25rem,0.39vh,4px)]">
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
                    
                    {/* AI Response - Language selection prompt after assets attached */}
                    {currentStep === 'assets-attached' && !hasReachedStep('script-input') && scriptSubstep === 'language' && (
                      <div className="flex flex-col items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px] mt-[clamp(0.5rem,0.98vh,10px)]">
                        <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] max-w-full sm:max-w-[852px]">
                          Perfect! Before we shape your script, what language would you like your video to be in?
                        </p>
                        
                        {/* Language Selection Buttons */}
                        <div className="flex flex-row flex-wrap gap-[clamp(0.5rem,0.98vh,10px)] mt-[clamp(0.25rem,0.5vh,6px)]">
                          <button
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

                    {/* User language selection response */}
                    {currentStep === 'assets-attached' && scriptSubstep === 'input' && selectedLanguage && !hasReachedStep('script-input') && (
                      <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                        <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px]">
                          <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(0.875rem,1.76vh,18px)] text-black text-right">
                            {selectedLanguage === 'english' ? '🇬🇧 English' : selectedLanguage === 'hindi' ? '🇮🇳 Hindi' : '🇮🇳 Hinglish'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* AI Response - Script prompt after language selected */}
                    {currentStep === 'assets-attached' && scriptSubstep === 'input' && !hasReachedStep('script-input') && (
                      <div className="flex flex-col items-start gap-[clamp(0.5rem,0.98vh,10px)] max-w-full sm:max-w-[597px] mt-[clamp(0.5rem,0.98vh,10px)]">
                        <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] max-w-full sm:max-w-[852px]">
                          Great choice! Now tell me your video idea, or paste your script if you already have one. You can use @tags for themes (e.g., @technology @professional).
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
                    {hasReachedStep('script-generated') && formattedScript && (
                      <>
                        {/* AI Response - "Here's your script!" */}
                        <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                          <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                            Here's your script!
                          </p>
                        </div>

                        {/* Formatted Script Box */}
                        <div className="relative max-w-full sm:max-w-[637px] mt-[clamp(0.5rem,0.78vh,8px)] p-[clamp(0.5rem,0.75vh,12px)] rounded-[8px]" style={{
                          background: 'linear-gradient(251.58deg, rgba(255, 255, 255, 0) 0.74%, rgba(255, 255, 255, 0.8) 58.96%), linear-gradient(114.13deg, rgba(232, 100, 18, 0.4) 35.62%, rgba(254, 89, 191, 0.4) 48.81%, rgba(231, 57, 19, 0.4) 64.75%, rgba(254, 201, 89, 0.4) 83.76%, rgba(232, 100, 18, 0.4) 93.57%)'
                        }}>
                          <div className="bg-white rounded-[8px] p-[clamp(0.5rem,0.78vh,8px)] w-full">
                            <pre className="font-heading text-[clamp(0.875rem,1.56vh,16px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#000000] whitespace-pre-wrap break-words">
                              {formattedScript}
                            </pre>
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
                  </>
                )}
              </>
            )}

            {/* Avatar Selection Step - Only show NEW avatar-specific content */}
            {hasReachedStep('avatar-selection') && selectedVideoStyle !== 'product-only' && (
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

                {/* SUB-PART 2: Selection Substep - User "Yes" Message and Avatar Selection UI */}
                {hasReachedSubstep('avatar-selection', 'selection') && (
                  <>
                    {/* User "Yes" Message - "Yes, I need an avatar in the video" */}
                    <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                      <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,293px)]">
                        <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                          Yes, I need an avatar in the video
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

            {/* Avatar Selection Buttons - Only show in question substep */}
            {currentStep === 'avatar-selection' && avatarSubstep === 'question' && selectedVideoStyle !== 'product-only' && (
            <div className="flex flex-row items-start gap-[clamp(0.5rem,0.98vh,10px)] w-full justify-end mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
              {/* Yes, I need an avatar */}
              <button
                onClick={() => handleAvatarSelection('yes')}
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
                  Yes, I need an avatar in the video
                </span>
              </button>

              {/* No, I'd like to keep it simple */}
              <button
                onClick={() => handleAvatarSelection('no')}
                className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0 w-auto"
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
                  No, I'd like to keep it simple
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

            {/* Visual Style Substep - Show after avatar selection */}
            {hasReachedSubstep('avatar-selection', 'visual-style') && (selectedAvatar || avatarUploadSuccess) && (
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
              <div className="flex flex-wrap gap-[clamp(0.5rem,0.98vh,12px)] w-full max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)] pl-[clamp(0.5rem,1vw,16px)]">
                {AVATAR_VISUAL_STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedAvatarVisualStyle(preset.id)}
                    className={cn(
                      "flex flex-row items-center gap-[clamp(0.5rem,0.78vh,8px)] p-[clamp(0.75rem,1.17vh,12px)] rounded-[12px] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] w-[200px] min-h-[80px] hover:opacity-90 transition-opacity text-left",
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

              {/* SUB-PART 2: Selection Substep - User "Yes" Message and Voice Selection UI */}
              {hasReachedSubstep('voice-selection', 'selection') && (
                <>
                  {/* User "Yes" Message */}
                  <div className="flex flex-col justify-center items-end gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)]">
                    <div className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-gradient-to-r from-[rgba(255,211,183,0.4)] to-[rgba(246,166,166,0.4)] rounded-[20px] max-w-[clamp(300px,50vw,353px)]">
                      <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121] text-right whitespace-pre-wrap break-words">
                        Yes, I need to change the voice of avatar
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
                          // Upload tab - functional upload UI
                          <div 
                            key="voice-upload"
                            className="flex flex-col items-center justify-center w-full"
                            style={{
                              animation: 'fadeIn 0.3s ease-in-out'
                            }}
                            >
                              {/* Upload Area */}
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

                                {/* File Input (Hidden) */}
                                <input
                                  type="file"
                                  ref={voiceFileInputRef}
                                  onChange={handleVoiceFileUpload}
                                  accept="audio/*"
                                  className="hidden"
                                />
                              </div>
                          </div>
                        ) : activeVoiceTab === 'record' ? (
                          // Record tab - functional recording UI
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
                                  className={cn(
                                    "rounded-[8px] cursor-pointer transition-all",
                                    isSelected ? "p-[2px]" : "p-0"
                                  )}
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
                                  <div className={cn(
                                    "flex flex-row justify-between items-center rounded-[6px] transition-all",
                                    isSelected ? "p-[clamp(0.375rem,0.59vh,6px)] bg-white" : "p-[clamp(0.5rem,0.78vh,8px)]"
                                  )}>
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

                  {/* Upload/Record Voice Buttons - Outside container, only show in upload/record tabs */}
                  {activeVoiceTab === 'upload' && !voiceUploadSuccess && (
                    <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                      <button
                        onClick={() => voiceFileInputRef.current?.click()}
                        disabled={voiceCloning}
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
                          Upload Voice
                        </span>
                      </button>
                    </div>
                  )}

                  {activeVoiceTab === 'record' && (
                    <div className="flex flex-row justify-end items-center gap-[clamp(0.5rem,0.98vh,10px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                      {voiceRecording ? (
                        <button
                          onClick={handleStopVoiceRecording}
                          className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity"
                        >
                          <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] bg-[#F12A4C] rounded-sm" />
                          <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                            Stop Recording
                          </span>
                        </button>
                      ) : (
                        <button
                          onClick={handleStartVoiceRecording}
                          disabled={voiceCloning}
                          className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.78vh,8px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.5rem,0.78vh,8px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,5.27vh,54px)] flex-shrink-0 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className="w-[clamp(1rem,1.56vh,16px)] h-[clamp(1rem,1.56vh,16px)] bg-[#E86412] rounded-full" />
                          <span className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,1.56vh,16px)] text-[#212121]">
                            Record Voice
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
            )}

            {/* Voice Selection Buttons - Only show in question substep */}
            {currentStep === 'voice-selection' && voiceSubstep === 'question' && (
            <div className="flex flex-row items-start gap-[clamp(0.5rem,0.98vh,10px)] w-full justify-end mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
              {/* Yes, I need to change the voice */}
              <button
                onClick={() => handleVoiceSelection('yes')}
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
                onClick={() => handleVoiceSelection('no')}
                className="flex flex-row justify-center items-center gap-[clamp(0.5rem,0.98vh,10px)] px-[clamp(0.75rem,1.56vh,16px)] py-[clamp(0.75rem,1.17vh,12px)] bg-white shadow-[0px_1px_7px_rgba(87,73,119,0.23)] rounded-[30px] h-[clamp(2.5rem,4.2vh,42px)] hover:opacity-90 transition-opacity flex-shrink-0 w-auto"
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
                  No, I'd like to keep it the same
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

                {/* AI Message - "Perfect! Your video is ready..." */}
                <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                  <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121]">
                    Perfect! Your video is ready to be created.
                  </p>
                </div>
              </>
            );
          })()}

          {/* Video Generation Step */}
          {hasReachedStep('audio-image-generation') && (
            <>
              {/* Generating state with loader */}
              {currentStep === 'audio-image-generation' && (
                <>
                  {/* AI message */}
                  <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] max-w-full sm:max-w-[852px] mt-[clamp(0.5rem,0.98vh,10px)]">
                    <p className="font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#212121] text-center w-full">
                      Perfect! We're stitching everything together — scenes, voice, avatar, effects… the whole magic potion. Sit tight for a moment... Your video is being crafted!
                    </p>
                  </div>

                  {/* Progress loader */}
                  <div className="flex flex-col items-start gap-[clamp(0.5rem,0.78vh,8px)] w-full mt-[clamp(0.5rem,0.98vh,10px)] max-w-full">
                    <div className="flex flex-col items-start w-full px-[clamp(0.25rem,0.39vh,4px)] py-[clamp(0.25rem,0.39vh,4px)] bg-[#F6F6F6] rounded-[18px]">
                      <div 
                        className="flex flex-col justify-center items-center py-[clamp(0.25rem,0.39vh,4px)] px-[clamp(0.5rem,0.78vh,8px)] bg-[#E86412] rounded-[20px] transition-all duration-300"
                        style={{ width: `${generationProgress}%` }}
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          </div>

          {/* Regenerate and Proceed Buttons - Outside scrollable container to ensure visibility */}
          {currentStep === 'script-generated' && formattedScript && !proceedConfirmed && (
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

          {/* Script Input Bar - Show when language is selected and assets are attached or script-input step */}
          {((currentStep === 'assets-attached' && scriptSubstep === 'input') || currentStep === 'script-input') && (
            <div 
              className={cn(
                "rounded-[40px] w-full h-[clamp(2.5rem,6.64vh,68px)] flex-shrink-0 mt-auto mb-0 transition-all box-border",
                inputFocused 
                  ? "p-[2px]"
                  : "p-0 shadow-[0px_3px_19.5px_rgba(224,140,138,0.4)]"
              )}
              style={inputFocused ? {
                background: 'linear-gradient(278.75deg, rgba(254, 89, 191, 0.4) 13.19%, rgba(231, 76, 60, 0.4) 46.27%, rgba(254, 201, 89, 0.4) 74.45%, rgba(231, 57, 19, 0.4) 96.51%)'
              } : {}}
            >
              <div className={cn(
                "flex flex-row justify-center items-center gap-[clamp(0.75rem,1.56vh,16px)] bg-white rounded-[40px] w-full h-full box-border",
                inputFocused ? "px-[clamp(0.375rem,0.59vh,6px)] py-[clamp(0.375rem,0.59vh,6px)]" : "px-[clamp(0.5rem,0.78vh,8px)] py-[clamp(0.5rem,0.78vh,8px)]"
              )}>
                <AIChatTagAwareInput
                  value={scriptInput}
                  onChange={setScriptInput}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && scriptInput.trim() && !isGeneratingScript && selectedLanguage) {
                      handleSendScript();
                    }
                  }}
                  placeholder={selectedLanguage 
                    ? "Share your ideas here... Use @tags for themes (e.g., @technology @professional)" 
                    : "Please select a language first"}
                  disabled={isGeneratingScript || !selectedLanguage}
                  className={cn(
                    "flex-1 font-heading text-[clamp(0.875rem,1.76vh,18px)] font-normal leading-[clamp(1rem,2.05vh,21px)] text-[#616161] outline-none px-[clamp(0.5rem,0.98vh,10px)] bg-transparent border-none focus:ring-0",
                    (isGeneratingScript || !selectedLanguage) && "opacity-50 cursor-not-allowed"
                  )}
                />
                
                {/* Send button */}
                <button
                  onClick={() => scriptInput.trim() && !isGeneratingScript && selectedLanguage && handleSendScript()}
                  disabled={!scriptInput.trim() || isGeneratingScript || !selectedLanguage}
                  className="flex flex-row justify-center items-center w-[clamp(2rem,5.08vh,52px)] h-[clamp(2rem,5.08vh,52px)] bg-gradient-to-r from-[#E86412] to-[#F12A4C] rounded-[26px] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex-shrink-0"
                >
                  {isGeneratingScript ? (
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
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 overflow-y-auto">
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
          {/* Overlay */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{
              background: 'linear-gradient(116.46deg, rgba(191, 143, 100, 0.5) 17.88%, rgba(179, 104, 56, 0.5) 89.93%)',
              opacity: 0.9,
            }}
            onClick={() => setShowAvatarPreview(false)}
          >
            {/* Modal Content */}
            <div
              className="relative w-[clamp(17rem,35.42vh,340px)] rounded-[8px] p-[clamp(0.3125rem,0.49vh,5px)] bg-white"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Avatar Image - Wrapper to center image without cropping */}
              <div className="relative w-full rounded-[12px] overflow-hidden flex items-center justify-center bg-gray-50" style={{ minHeight: 'clamp(21.875rem,43.65vh,447px)' }}>
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
                    <div className="relative w-full h-full flex items-center justify-center p-4">
                      {fullImageUrl && !previewImageFailed ? (
                        <Image
                          src={fullImageUrl}
                          alt={previewAvatar.name || 'Avatar'}
                          width={300}
                          height={400}
                          className="object-contain max-w-full max-h-full"
                          unoptimized
                          onError={() => {
                            setPreviewImageFailed(true);
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gray-200">
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

