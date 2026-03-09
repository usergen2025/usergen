'use client';

import { useState, useEffect, useRef, Suspense, ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Mic, Play, X, Loader2, Pause, CheckCircle2, Upload } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/layout/ProgressBar';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { useVideoStepNavigation } from '@/hooks/useVideoStepNavigation';

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string> | null;
  preview_url?: string | null;
}

function VoicePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const projectIdFromUrl = searchParams.get('projectId');
  
  const [projectId, setProjectId] = useState<string | null>(projectIdFromUrl);
  const [project, setProject] = useState<any>(null);
  const { goToPreviousStep } = useVideoStepNavigation(projectId, project?.currentStep);
  const [selectedOption, setSelectedOption] = useState<'clone' | 'library' | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<ElevenLabsVoice | null>(null);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  const [cloneMode, setCloneMode] = useState<'record' | 'upload' | null>(null);
  const [cloneVoiceName, setCloneVoiceName] = useState('');
  const [cloneAudioFile, setCloneAudioFile] = useState<File | null>(null);
  const [cloneAudioUrl, setCloneAudioUrl] = useState<string | null>(null);
  const [removeBackgroundNoise, setRemoveBackgroundNoise] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [requiresVerification, setRequiresVerification] = useState<boolean | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const cloneAudioElementRef = useRef<HTMLAudioElement | null>(null);

  const MAX_CLONE_FILE_SIZE = 15 * 1024 * 1024; // 15MB

  const applyCloneAudioFile = (file: File, mode?: 'record' | 'upload') => {
    if (cloneAudioElementRef.current) {
      try {
        cloneAudioElementRef.current.pause();
        cloneAudioElementRef.current.currentTime = 0;
      } catch (err) {
        // ignore pause errors
      }
    }
    if (cloneAudioUrl) {
      URL.revokeObjectURL(cloneAudioUrl);
    }
    const objectUrl = URL.createObjectURL(file);
    setCloneAudioFile(file);
    setCloneAudioUrl(objectUrl);
    setSelectedVoice(null);
    setRequiresVerification(null);
    if (mode) {
      setCloneMode(mode);
    }
    setSelectedOption('clone');
    
    // Force load metadata after state update to ensure duration displays immediately
    // Use setTimeout to ensure the audio element has been updated with the new URL
    setTimeout(() => {
      if (cloneAudioElementRef.current && cloneAudioElementRef.current.src === objectUrl) {
        cloneAudioElementRef.current.load();
      }
    }, 50);
  };

  const resetCloneAudio = () => {
    if (cloneAudioElementRef.current) {
      try {
        cloneAudioElementRef.current.pause();
        cloneAudioElementRef.current.currentTime = 0;
      } catch (err) {
        // ignore
      }
      cloneAudioElementRef.current = null;
    }
    if (cloneAudioUrl) {
      URL.revokeObjectURL(cloneAudioUrl);
    }
    setCloneAudioUrl(null);
    setCloneAudioFile(null);
    setRemoveBackgroundNoise(false);
    setRequiresVerification(null);
  };

  const stopActiveRecording = () => {
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

  // Update projectId from URL when it changes
  useEffect(() => {
    if (projectIdFromUrl && projectIdFromUrl !== projectId) {
      setProjectId(projectIdFromUrl);
    }
  }, [projectIdFromUrl, projectId]);

  useEffect(() => {
    if (selectedOption === 'clone' && !cloneMode) {
      setCloneMode('record');
    }
  }, [selectedOption, cloneMode]);

  useEffect(() => {
    return () => {
      if (cloneAudioUrl) {
        URL.revokeObjectURL(cloneAudioUrl);
      }
    };
  }, [cloneAudioUrl]);

  useEffect(() => {
    return () => {
      stopActiveRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load or create project if projectId is missing
  useEffect(() => {
    const loadOrCreateProject = async () => {
      if (!isAuthenticated || authLoading) return;
      
      // If projectId is already set, skip
      if (projectId) return;
      
      try {
        // Try to get active project
        const activeResponse = await apiClient.getActiveVideoProject();
        if (activeResponse.success && activeResponse.data) {
          setProjectId(activeResponse.data.id);
          // Update URL with projectId
          router.replace(`/create-video/voice?projectId=${activeResponse.data.id}`);
        }
      } catch (error: any) {
        console.error('Failed to load/create project:', error);
        if (error.response?.status === 401) {
          showToast('Session expired. Please log in again.', 'error');
          // AuthExpiryProvider handles 401 via auth:session-expired
        }
      }
    };

    loadOrCreateProject();
  }, [isAuthenticated, authLoading, projectId, router, showToast]);

  // Extract language from script
  const extractLanguageFromScript = (script: any): 'english' | 'hindi' | 'hinglish' | null => {
    if (!script) return null;
    
    try {
      const scriptData = typeof script === 'string' ? JSON.parse(script) : script;
      // Language might be stored in script metadata
      if (scriptData.language) {
        return scriptData.language;
      }
      // Check if script contains Hindi characters to infer language
      const scriptText = JSON.stringify(scriptData);
      const hasHindi = /[\u0900-\u097F]/.test(scriptText);
      const hasEnglish = /[a-zA-Z]/.test(scriptText);
      
      if (hasHindi && hasEnglish) return 'hinglish';
      if (hasHindi) return 'hindi';
      if (hasEnglish) return 'english';
    } catch (e) {
      // If parsing fails, return null
    }
    
    return null;
  };

  // Load ElevenLabs voices immediately when page loads (not just when library is selected)
  // This ensures voices are available when restoring selection
  // Filter voices by language if available from script
  useEffect(() => {
    const loadVoices = async () => {
      if (voices.length === 0 && projectId) {
        setLoading(true);
        try {
          // Extract language from project script if available
          let language: 'english' | 'hindi' | 'hinglish' | undefined = undefined;
          if (project?.script) {
            const extractedLanguage = extractLanguageFromScript(project.script);
            if (extractedLanguage) {
              language = extractedLanguage;
            }
          }
          
          const response = await apiClient.getElevenLabsVoices(undefined, undefined, language);
          if (response.success && response.data) {
            setVoices(response.data);
          } else {
            showToast('Failed to load voices', 'error');
          }
        } catch (error: any) {
          console.error('Failed to load voices:', error);
          showToast(error.message || 'Failed to load voices from ElevenLabs', 'error');
        } finally {
          setLoading(false);
        }
      }
    };

    loadVoices();
  }, [projectId, project?.script, showToast]); // Load voices when projectId or script changes

  // Load and restore project state (runs after voices might be loaded)
  useEffect(() => {
    const loadProject = async () => {
      if (!projectId) return;
      
      try {
        const response = await apiClient.getVideoProject(projectId);
        if (response.success && response.data) {
          setProject(response.data);
          const projectData = response.data;
          
          // Check for library voice (SYNTHETIC type)
          if (projectData.voiceId && projectData.voiceType === 'SYNTHETIC') {
            // Find voice in loaded voices array
            const voice = voices.find(v => v.voice_id === projectData.voiceId);
            if (voice) {
              setSelectedVoice(voice);
              setSelectedOption('library'); // This will auto-open the library section
              console.log('[VoicePage] Restored library voice selection:', voice.name);
            } else if (voices.length > 0) {
              // Voices are loaded but voice not found - might be a different voice or removed
              console.warn('[VoicePage] Voice not found in library:', projectData.voiceId);
              // Still set the option to library so user can see it was selected
              setSelectedOption('library');
            }
            // If voices not loaded yet, this useEffect will re-run when voices load
          }
          
          // Check for cloned voice (CLONED type)
          if (projectData.voiceType === 'CLONED' && projectData.clonedVoiceId) {
            setSelectedOption('clone');
            setCloneMode('upload'); // Cloned voices are uploaded
            // Note: We can't restore the actual audio file, but we can show the clone option is selected
            // The cloned voice ID is stored, but we'd need to fetch voice details to show the name
            console.log('[VoicePage] Restored cloned voice selection:', projectData.clonedVoiceId);
          }
        }
      } catch (error: any) {
        console.error('Failed to load project:', error);
      }
    };

    if (projectId) {
      loadProject();
    }
  }, [projectId, voices]); // Re-run when voices are loaded to find the voice

  // Force audio element to load metadata when URL changes to display duration immediately
  useEffect(() => {
    if (!cloneAudioUrl) return;
    
    let handleLoadedMetadata: (() => void) | null = null;
    let audioElement: HTMLAudioElement | null = null;
    
    // Use requestAnimationFrame to ensure DOM is fully updated before loading
    const loadMetadata = () => {
      if (cloneAudioElementRef.current && cloneAudioUrl) {
        audioElement = cloneAudioElementRef.current;
        
        // Ensure src is set (should be via prop, but verify)
        if (audioElement.src !== cloneAudioUrl) {
          audioElement.src = cloneAudioUrl;
        }
        
        // Set preload to metadata to ensure browser loads it
        audioElement.preload = 'metadata';
        
        // Explicitly load metadata to get duration
        // This ensures the duration is displayed without needing to click play
        audioElement.load();
        
        // Add event listener to log when metadata loads
        handleLoadedMetadata = () => {
          if (audioElement && audioElement.duration && !isNaN(audioElement.duration) && isFinite(audioElement.duration)) {
            console.log('[Audio] Duration loaded via useEffect:', audioElement.duration, 'seconds');
          }
        };
        
        audioElement.addEventListener('loadedmetadata', handleLoadedMetadata);
        
        // Also check if metadata is already loaded
        if (audioElement.readyState >= 1) {
          handleLoadedMetadata();
        }
      }
    };
    
    // Use double requestAnimationFrame to ensure DOM is ready
    // First frame: browser has updated the DOM
    // Second frame: browser has painted the changes
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        loadMetadata();
      });
    });
    
    // Cleanup function
    return () => {
      if (audioElement && handleLoadedMetadata) {
        audioElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      }
    };
  }, [cloneAudioUrl]);

  const toggleCloneOption = () => {
    if (isRecording) {
      showToast('Please stop recording before switching options', 'warning');
      return;
    }
    if (isCloning) return;
    if (selectedOption === 'clone') {
      setSelectedOption(null);
      setCloneMode(null);
    } else {
      setSelectedOption('clone');
      setCloneMode((mode) => mode || 'record');
    }
  };

  const toggleLibraryOption = () => {
    if (isRecording) {
      showToast('Please stop recording before switching options', 'warning');
      return;
    }
    if (isCloning) return;
    if (selectedOption === 'library') {
      setSelectedOption(null);
    } else {
      setSelectedOption('library');
    }
  };

  const handlePlayPreview = (voice: ElevenLabsVoice) => {
    if (!voice.preview_url) {
      showToast('No preview available for this voice', 'warning');
      return;
    }

    // Stop current audio if playing
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }

    // If clicking the same voice that's playing, stop it
    if (playingVoiceId === voice.voice_id) {
      setPlayingVoiceId(null);
      setAudioElement(null);
      return;
    }

    // Play new preview
    const audio = new Audio(voice.preview_url);
    audio.play();
    setAudioElement(audio);
    setPlayingVoiceId(voice.voice_id);

    audio.onended = () => {
      setPlayingVoiceId(null);
      setAudioElement(null);
    };

    audio.onerror = () => {
      showToast('Failed to play preview', 'error');
      setPlayingVoiceId(null);
      setAudioElement(null);
    };
  };

  const handleVoiceSelect = async (voice: ElevenLabsVoice) => {
    if (cloneAudioFile || cloneAudioUrl) {
      resetCloneAudio();
    }
    setSelectedVoice(voice);
    setSelectedOption('library');
    setCloneMode(null);
    
    // Save to project
    if (projectId) {
      try {
        await apiClient.updateVideoProject(projectId, {
          voiceId: voice.voice_id,
          voiceType: 'SYNTHETIC',
        });
      } catch (error: any) {
        console.error('Failed to save voice selection:', error);
        showToast('Failed to save voice selection', 'error');
      }
    }
  };

  const handleUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      showToast('Please upload a valid audio file', 'warning');
      return;
    }

    if (file.size > MAX_CLONE_FILE_SIZE) {
      showToast('Audio file is too large. Maximum size is 15MB.', 'warning');
      return;
    }

    applyCloneAudioFile(file, 'upload');
  };

  const handleRemoveCloneAudio = () => {
    if (isRecording) {
      showToast('Stop recording before removing audio', 'warning');
      return;
    }
    resetCloneAudio();
  };

  const handleStartRecording = async () => {
    if (isRecording || isCloning) return;
    if (!cloneVoiceName.trim()) {
      showToast('Please enter a voice name before recording', 'warning');
      return;
    }
    setRecordingError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showToast('Recording is not supported in this browser.', 'error');
      return;
    }

    try {
      // Request audio with optimal settings for voice recording
      // Use ideal constraints to get the best quality without being too strict
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          sampleRate: { ideal: 44100 },
          channelCount: { ideal: 1 }, // Mono is sufficient for voice
        } 
      });
      
      // Verify we got an audio track
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track available from microphone');
      }
      
      console.log('[Recording] Audio track info:', {
        label: audioTracks[0].label,
        enabled: audioTracks[0].enabled,
        muted: audioTracks[0].muted,
        settings: audioTracks[0].getSettings(),
      });
      
      recordingStreamRef.current = stream;
      
      // Try to find the best supported codec for quality recording
      const codecs = [
        'audio/webm;codecs=opus',  // Best quality, widely supported
        'audio/webm;codecs=pcm',   // Alternative
        'audio/webm',               // Fallback
      ];
      
      let selectedMimeType = '';
      for (const codec of codecs) {
        if (MediaRecorder.isTypeSupported(codec)) {
          selectedMimeType = codec;
          console.log('[Recording] Using codec:', codec);
          break;
        }
      }
      
      if (!selectedMimeType) {
        console.warn('[Recording] No preferred codec found, using default');
      }
      
      const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          console.log(`[Recording] Data chunk received: ${event.data.size} bytes, total chunks: ${audioChunksRef.current.length}`);
        }
      };

      mediaRecorder.onerror = (event: any) => {
        console.error('[Recording] MediaRecorder error:', event);
        setRecordingError(event.error?.message || 'Recording error occurred');
        showToast('Recording error occurred. Please try again.', 'error');
        stopActiveRecording();
        setIsRecording(false);
      };

      mediaRecorder.onstop = () => {
        console.log(`[Recording] Stopped. Total chunks: ${audioChunksRef.current.length}, total size: ${audioChunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0)} bytes`);
        
        // Use the same MIME type that was used for recording
        const blobType = selectedMimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: blobType });
        
        if (blob.size === 0) {
          console.error('[Recording] No audio data recorded');
          setRecordingError('No audio was recorded. Please try again.');
          showToast('No audio was recorded. Please try again.', 'error');
          setIsRecording(false);
          return;
        }
        
        console.log('[Recording] Created blob:', {
          size: blob.size,
          type: blob.type,
        });
        
        const filenameBase = cloneVoiceName.trim().length > 0 ? cloneVoiceName.trim().replace(/\s+/g, '_') : 'recording';
        const fileExtension = blobType.includes('opus') || blobType.includes('webm') ? 'webm' : 'webm';
        const file = new File([blob], `${filenameBase}_${Date.now()}.${fileExtension}`, { type: blobType });
        applyCloneAudioFile(file, 'record');
        stopActiveRecording();
        setIsRecording(false);
      };

      // Start recording with timeslice to periodically collect data (every 1 second)
      // This ensures data is collected even if recording stops unexpectedly
      mediaRecorder.start(1000);
      console.log('[Recording] Started recording');
      setSelectedOption('clone');
      setCloneMode('record');
      setIsRecording(true);
    } catch (error: any) {
      console.error('Failed to access microphone:', error);
      setRecordingError(error?.message || 'Failed to access microphone');
      showToast(error?.message || 'Failed to access microphone', 'error');
      stopActiveRecording();
      setIsRecording(false);
    }
  };

  const handleStopRecording = () => {
    if (!isRecording) return;
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      setIsRecording(false);
    }
  };

  const handleNext = async () => {
    if (!projectId) {
      showToast('Project ID missing. Please try again.', 'error');
      return;
    }

    const hasCloneSelection =
      !!cloneAudioFile && cloneVoiceName.trim().length > 0 && !isRecording;
    const hasLibrarySelection = !!selectedVoice;

    if (!hasCloneSelection && !hasLibrarySelection) {
      showToast('Please choose a voice from the library or clone your voice first', 'warning');
      return;
    }

    if (hasCloneSelection) {
      if (isRecording) {
        showToast('Please stop the recording before continuing', 'warning');
        return;
      }

      setIsCloning(true);
      try {
        const cloneResponse = await apiClient.cloneVoice({
          name: cloneVoiceName.trim(),
          audioFile: cloneAudioFile!,
          removeBackgroundNoise,
        });

        if (!cloneResponse.success || !cloneResponse.data?.voiceId) {
          throw new Error(cloneResponse.message || 'Failed to clone voice');
        }

        const voiceId = cloneResponse.data.voiceId;
        setRequiresVerification(cloneResponse.data.requiresVerification ?? null);
        setSelectedVoice(null);

        await apiClient.updateVideoProject(projectId, {
          voiceId,
          clonedVoiceId: voiceId,
          voiceType: 'CLONED',
          voiceSettings: {
            removeBackgroundNoise,
            source: 'CLONED',
          },
          currentStep: 'VOICE',
        });

        showToast(
          cloneResponse.data.requiresVerification
            ? 'Voice cloned. Verification may be required before use.'
            : 'Voice cloned successfully!',
          cloneResponse.data.requiresVerification ? 'warning' : 'success'
        );

        // Check if audio needs regeneration (cloned voice is always new, so always regenerate)
        setIsCloning(false);
        setIsGeneratingAudio(true);
        try {
          // For cloned voices, always regenerate since it's a new voice
          const audioResponse = await apiClient.generateAudio(projectId);
          if (audioResponse.success) {
            // Check if job was queued or if existing audio was returned
            if (audioResponse.data?.jobId) {
              showToast('Audio generation started', 'info');
            } else if (audioResponse.data?.existing) {
              showToast('Using existing audio', 'info');
            }
            router.push(`/create-video/broll-images?projectId=${projectId}`);
          } else {
            showToast('Failed to start audio generation', 'error');
            setIsGeneratingAudio(false);
          }
        } catch (error: any) {
          console.error('Failed to queue audio generation:', error);
          showToast(error.response?.data?.message || error.message || 'Failed to start audio generation', 'error');
          setIsGeneratingAudio(false);
        }
      } catch (error: any) {
        console.error('Failed to clone voice:', error);
        showToast(error.response?.data?.message || error.message || 'Failed to clone voice', 'error');
        setIsCloning(false);
      }
      return;
    }

    if (hasLibrarySelection && selectedVoice) {
      try {
        // Check if voice changed or audio needs regeneration
        const currentVoiceId = project?.voiceId;
        const newVoiceId = selectedVoice.voice_id;
        const existingAudioFiles = project?.audioFiles;
        const audioConfig = project?.audioGenerationConfig;

        // Check if regeneration is needed
        const voiceChanged = currentVoiceId !== newVoiceId;
        const hasExistingAudio = existingAudioFiles && Array.isArray(existingAudioFiles) && existingAudioFiles.length > 0;
        const needsRegeneration = voiceChanged || !hasExistingAudio;

        // Update project with new voice selection
        await apiClient.updateVideoProject(projectId, {
          voiceId: newVoiceId,
          voiceType: 'SYNTHETIC',
          currentStep: 'VOICE',
        });

        // Only generate audio if voice changed or no audio exists
        if (needsRegeneration) {
          try {
            const audioResponse = await apiClient.generateAudio(projectId);
            if (audioResponse.success && audioResponse.data?.jobId) {
              showToast('Audio generation started', 'info');
              router.push(`/create-video/broll-images?projectId=${projectId}`);
            } else {
              showToast('Failed to start audio generation', 'error');
            }
          } catch (error: any) {
            console.error('Failed to queue audio generation:', error);
            showToast('Failed to start audio generation', 'error');
          }
        } else {
          // Voice and config match, skip regeneration and navigate
          console.log('[VoicePage] Audio already generated with matching config, skipping regeneration');
          router.push(`/create-video/broll-images?projectId=${projectId}`);
        }
      } catch (error: any) {
        console.error('Failed to save progress:', error);
        showToast(error.response?.data?.message || error.message || 'Failed to save progress', 'error');
      }
    }
  };

  const hasCloneSelection =
    !!cloneAudioFile && cloneVoiceName.trim().length > 0 && !isRecording && !isCloning;
  const hasLibrarySelection = !!selectedVoice;
  const canProceed = (hasCloneSelection || hasLibrarySelection) && !isCloning && !isRecording && !isGeneratingAudio;

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={goToPreviousStep}
            className="mb-6 flex items-center gap-2 text-text-primary hover:text-text-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back</span>
          </button>

          <h1 className={cn(typography.heading.h2, "mb-8")}>Add Voice</h1>

          <div className="space-y-6">
            {/* Clone Voice Section */}
            <Card className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className={cn(typography.heading.h5, "mb-2")}>Clone your Voice</h3>
                  <p className={cn(typography.body.small, "text-text-secondary")}>
                    Upload a voice sample to create custom voice
                  </p>
                </div>
                <button
                  onClick={toggleCloneOption}
                  className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                    selectedOption === 'clone' ? 'bg-primary border-primary' : 'border-border'
                  )}
                >
                  {selectedOption === 'clone' && <span className="text-secondary text-xs">✓</span>}
                </button>
              </div>

              {selectedOption === 'clone' && (
                <div className="mt-6 space-y-5">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-text-secondary" htmlFor="clone-voice-name">
                      Voice name
                    </label>
                    <input
                      id="clone-voice-name"
                      type="text"
                      value={cloneVoiceName}
                      onChange={(event) => setCloneVoiceName(event.target.value)}
                      placeholder="Give your cloned voice a name"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant={cloneMode === 'record' ? 'primary' : 'outline'}
                      onClick={() => {
                        if (isCloning) return;
                        if (isRecording) return;
                        setCloneMode('record');
                        setSelectedOption('clone');
                      }}
                      disabled={isCloning}
                    >
                      Record yourself
                    </Button>
                    <Button
                      variant={cloneMode === 'upload' ? 'primary' : 'outline'}
                      onClick={() => {
                        if (isCloning) return;
                        if (isRecording) {
                          showToast('Stop recording before switching mode', 'warning');
                          return;
                        }
                        setCloneMode('upload');
                        setSelectedOption('clone');
                      }}
                      disabled={isCloning}
                    >
                      Upload your audio
                    </Button>
                  </div>

                  {cloneMode === 'record' && (
                    <div className="space-y-4">
                  <div>
                    <p className="font-medium mb-2">Read this while recording</p>
                    <p className="text-text-secondary italic">
                      &quot;The quick brown fox jumps over the lazy dog&quot;
                    </p>
                  </div>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <Button
                          variant={isRecording ? 'secondary' : 'primary'}
                          icon={<Mic className="w-5 h-5" />}
                          onClick={isRecording ? handleStopRecording : handleStartRecording}
                          disabled={isCloning || (isRecording ? false : !cloneVoiceName.trim())}
                        >
                          {isRecording ? 'Stop recording' : 'Start recording'}
                        </Button>
                        <div className="flex-1 h-12 bg-primary-light rounded flex items-center gap-1 px-2 overflow-hidden">
                          {Array.from({ length: 24 }).map((_, index) => (
                            <span
                              key={index}
                          className={cn(
                                'flex-1 rounded bg-primary transition-all duration-200 ease-in-out',
                                isRecording ? 'animate-pulse' : 'opacity-40'
                          )}
                          style={{ height: `${Math.random() * 60 + 20}%` }}
                        />
                      ))}
                    </div>
                  </div>
                      {!cloneVoiceName.trim() && (
                        <p className="text-xs text-text-secondary">
                          Enter a voice name before recording so we can save it for you.
                        </p>
                      )}
                      {recordingError && <p className="text-sm text-red-500">{recordingError}</p>}
                    </div>
                  )}

                  {cloneMode === 'upload' && (
                    <div className="space-y-3">
                      <label className="inline-flex items-center justify-center px-4 py-3 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary transition-colors bg-primary-light/20">
                        <input
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={handleUploadChange}
                          disabled={isCloning}
                        />
                        <div className="flex items-center gap-2 text-primary">
                          <Upload className="w-5 h-5" />
                          <span>Upload audio file</span>
                        </div>
                      </label>
                      <p className="text-xs text-text-secondary">
                        Supported formats: MP3, WAV, M4A, WEBM • Max 15MB
                      </p>
                    </div>
                  )}

                  {cloneAudioFile && (
                    <div className="border border-border rounded-lg p-4 space-y-3 bg-primary-light/30">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium text-text-primary">{cloneAudioFile.name}</p>
                          <p className="text-sm text-text-secondary">
                            {(cloneAudioFile.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                        <button
                          onClick={handleRemoveCloneAudio}
                          className="p-2 rounded-full border border-border hover:bg-primary-light transition-colors"
                          title="Remove audio"
                          type="button"
                          disabled={isCloning}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <audio
                        controls
                        src={cloneAudioUrl || undefined}
                        preload="metadata"
                        ref={(element) => {
                          cloneAudioElementRef.current = element;
                          // Also trigger load when ref is set with a new URL
                          // This provides a fallback if useEffect timing is off
                          if (element && cloneAudioUrl) {
                            // Use setTimeout to ensure element is fully initialized
                            setTimeout(() => {
                              if (element && element.src === cloneAudioUrl) {
                                element.preload = 'metadata';
                                element.load();
                              }
                            }, 0);
                          }
                        }}
                        className="w-full"
                        onError={(e) => {
                          console.error('[Audio] Error loading audio:', e);
                          showToast('Failed to load audio preview. The file may be corrupted or in an unsupported format.', 'error');
                        }}
                        onLoadedMetadata={() => {
                          // This ensures the duration is displayed correctly
                          if (cloneAudioElementRef.current) {
                            console.log('[Audio] Metadata loaded, duration:', cloneAudioElementRef.current.duration);
                          }
                        }}
                      />
                      <label className="inline-flex items-center gap-2 text-sm text-text-primary">
                        <input
                          type="checkbox"
                          checked={removeBackgroundNoise}
                          onChange={(event) => setRemoveBackgroundNoise(event.target.checked)}
                          disabled={isCloning}
                        />
                        <span>Remove background noise</span>
                      </label>
                      {requiresVerification !== null && (
                        <p className="text-xs text-text-secondary">
                          {requiresVerification
                            ? 'This voice may require verification in ElevenLabs before it can be used.'
                            : 'Voice cloned successfully and ready to use.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Select from Library Section */}
            <Card className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className={cn(typography.heading.h5, "mb-2")}>Select from Library</h3>
                  <p className={cn(typography.body.small, "text-text-secondary")}>
                    Create videos with text, voiceover and video clips only
                  </p>
                </div>
                <button
                  onClick={toggleLibraryOption}
                  className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                    selectedOption === 'library' ? 'bg-primary border-primary' : 'border-border'
                  )}
                >
                  {selectedOption === 'library' && <span className="text-secondary text-xs">✓</span>}
                </button>
              </div>

              {selectedOption === 'library' && (
                <div className="mt-6">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      <span className="ml-3 text-text-secondary">Loading voices...</span>
                    </div>
                  ) : voices.length === 0 ? (
                    <div className="text-center py-8 text-text-secondary">
                      <p>No voices found</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto">
                      {voices.map((voice) => {
                        const isSelected = selectedVoice?.voice_id === voice.voice_id;
                        return (
                          <div
                            key={voice.voice_id}
                            onClick={() => handleVoiceSelect(voice)}
                      className={cn(
                              'w-full flex items-center justify-between p-4 rounded-lg border-2 transition-all duration-200 cursor-pointer relative',
                              isSelected
                                ? 'border-primary bg-primary/10 shadow-lg ring-2 ring-primary/20'
                                : 'border-border hover:bg-primary-light/50 hover:border-primary/50'
                            )}
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                                {isSelected && (
                                  <CheckCircle2 className="w-6 h-6 text-primary" fill="currentColor" />
                                )}
                              </div>
                              <div className="flex-1 text-left">
                                <p className={cn(
                                  'font-medium',
                                  isSelected ? 'text-primary' : 'text-text-primary'
                                )}>
                                  {voice.name}
                                </p>
                                <p className="text-sm text-text-secondary mt-1">
                                  {voice.labels?.accent || voice.labels?.gender || voice.category || 'Voice'}
                                  {voice.labels?.age && ` • ${voice.labels.age}`}
                                </p>
                                {voice.description && (
                                  <p className="text-xs text-text-secondary mt-1 line-clamp-1">
                                    {voice.description}
                                  </p>
                                )}
                              </div>
                      </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlayPreview(voice);
                              }}
                              className={cn(
                                'ml-4 p-2 rounded-full transition-all duration-200 flex-shrink-0',
                                playingVoiceId === voice.voice_id
                                  ? 'bg-primary text-white hover:bg-primary-dark'
                                  : 'bg-background border border-border text-text-primary hover:bg-primary-light hover:border-primary hover:text-primary'
                              )}
                              disabled={!voice.preview_url}
                              title={voice.preview_url ? 'Play preview' : 'No preview available'}
                            >
                              {playingVoiceId === voice.voice_id ? (
                                <Pause className="w-5 h-5" />
                              ) : (
                                <Play className="w-5 h-5 fill-current" />
                              )}
                    </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      {(isCloning || isGeneratingAudio) && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-40">
          <div className="bg-secondary text-primary px-6 py-4 rounded-lg shadow-lg flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>
              {isCloning 
                ? 'Cloning voice… This may take a moment.' 
                : 'Starting audio generation…'}
            </span>
          </div>
        </div>
      )}

      <ProgressBar
        progress={canProceed ? 60 : 40}
        message={canProceed ? "Yay you got a voice now!" : "Keep going, your story is shaping up."}
        onNext={handleNext}
        disabled={!canProceed || isRecording || isCloning || isGeneratingAudio}
      />
    </div>
  );
}

export default function VoicePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <VoicePageContent />
    </Suspense>
  );
}

