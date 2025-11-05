'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Mic, Play, X, Loader2, Pause, CheckCircle2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/layout/ProgressBar';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string> | null;
  preview_url?: string | null;
}

export default function VoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const projectIdFromUrl = searchParams.get('projectId');
  
  const [projectId, setProjectId] = useState<string | null>(projectIdFromUrl);
  const [selectedOption, setSelectedOption] = useState<'clone' | 'library' | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<ElevenLabsVoice | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  // Update projectId from URL when it changes
  useEffect(() => {
    if (projectIdFromUrl && projectIdFromUrl !== projectId) {
      setProjectId(projectIdFromUrl);
    }
  }, [projectIdFromUrl, projectId]);

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
          showToast('Authentication failed. Please login again', 'error');
          router.push('/login');
        }
      }
    };

    loadOrCreateProject();
  }, [isAuthenticated, authLoading, projectId, router, showToast]);

  // Load ElevenLabs voices when "Select from Library" is selected
  useEffect(() => {
    const loadVoices = async () => {
      if (selectedOption === 'library' && voices.length === 0) {
        setLoading(true);
        try {
          const response = await apiClient.getElevenLabsVoices();
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
  }, [selectedOption, showToast]);

  // Load existing project data
  useEffect(() => {
    const loadProject = async () => {
      if (!projectId) return;
      
      try {
        const response = await apiClient.getVideoProject(projectId);
        if (response.success && response.data) {
          if (response.data.voiceId) {
            // If voice is already selected, find it from the loaded voices
            const voice = voices.find(v => v.voice_id === response.data.voiceId);
            if (voice) {
              setSelectedVoice(voice);
              setSelectedOption('library');
            }
          }
        }
      } catch (error: any) {
        console.error('Failed to load project:', error);
      }
    };

    if (projectId && voices.length > 0) {
      loadProject();
    }
  }, [projectId, voices]);

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
    setSelectedVoice(voice);
    
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

  const handleNext = async () => {
    // Validate selection based on option
    if (selectedOption === 'library') {
      if (!selectedVoice) {
        showToast('Please select a voice from the library', 'warning');
        return;
      }
      if (!projectId) {
        showToast('Project ID missing. Please try again.', 'error');
        return;
      }
      
      try {
        // Update project with voice selection
        await apiClient.updateVideoProject(projectId, {
          voiceId: selectedVoice.voice_id,
          voiceType: 'SYNTHETIC',
          currentStep: 'VOICE',
        });

        // Queue audio generation
        try {
          const audioResponse = await apiClient.generateAudio(projectId);
          if (audioResponse.success && audioResponse.data?.jobId) {
            showToast('Audio generation started', 'info');
            // Navigate to B-roll images page (audio will generate in background via queue)
            router.push(`/create-video/broll-images?projectId=${projectId}`);
          } else {
            showToast('Failed to start audio generation', 'error');
          }
        } catch (error: any) {
          console.error('Failed to queue audio generation:', error);
          showToast('Failed to start audio generation', 'error');
        }
      } catch (error: any) {
        console.error('Failed to save progress:', error);
        showToast(error.response?.data?.message || error.message || 'Failed to save progress', 'error');
      }
    } else if (selectedOption === 'clone') {
      // Voice cloning not implemented yet
      showToast('Voice cloning will be available soon', 'info');
    } else {
      showToast('Please select a voice option first', 'warning');
    }
  };


  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => router.back()}
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
                  onClick={() => setSelectedOption(selectedOption === 'clone' ? null : 'clone')}
                  className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                    selectedOption === 'clone' ? 'bg-primary border-primary' : 'border-border'
                  )}
                >
                  {selectedOption === 'clone' && <span className="text-secondary text-xs">✓</span>}
                </button>
              </div>

              {selectedOption === 'clone' && (
                <div className="mt-6 space-y-4">
                  <div>
                    <p className="font-medium mb-2">Read this while recording</p>
                    <p className="text-text-secondary italic">
                      &quot;The quick brown fox jumps over the lazy dog&quot;
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => setIsRecording(!isRecording)}
                      className={cn(
                        'w-16 h-16 rounded-lg flex items-center justify-center',
                        isRecording ? 'bg-red-500' : 'bg-primary'
                      )}
                    >
                      {isRecording ? (
                        <X className="w-8 h-8 text-secondary" />
                      ) : (
                        <Mic className="w-8 h-8 text-secondary" />
                      )}
                    </button>
                    <div className="flex-1 h-12 bg-primary-light rounded flex items-center gap-1 px-2">
                      {[...Array(10)].map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            'flex-1 rounded',
                            isRecording ? 'bg-primary' : 'bg-gray-300'
                          )}
                          style={{ height: `${Math.random() * 60 + 20}%` }}
                        />
                      ))}
                    </div>
                  </div>
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
                  onClick={() => setSelectedOption(selectedOption === 'library' ? null : 'library')}
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

      <ProgressBar
        progress={(selectedOption && (selectedOption === 'library' ? selectedVoice : true)) ? 60 : 40}
        message={(selectedOption && (selectedOption === 'library' ? selectedVoice : true)) ? "Yay you got a voice now!" : "Keep going, your story is shaping up."}
        onNext={handleNext}
        disabled={!(selectedOption && (selectedOption === 'library' ? selectedVoice : true))}
      />
    </div>
  );
}

