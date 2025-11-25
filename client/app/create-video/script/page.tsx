'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, X, Send, Loader2, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/layout/ProgressBar';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useVideoStepNavigation } from '@/hooks/useVideoStepNavigation';

function ScriptPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const projectIdFromUrl = searchParams.get('projectId');
  const [projectId, setProjectId] = useState<string | null>(projectIdFromUrl);
  const [project, setProject] = useState<any>(null);
  const { goToPreviousStep } = useVideoStepNavigation(projectId, project?.currentStep);
  
  const [script, setScript] = useState<any>(null);
  const [scriptFormatted, setScriptFormatted] = useState<string>('');
  const [showChat, setShowChat] = useState(true);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'ai'; content: string }>>([
    { role: 'ai', content: "Hey there! Tell me about your video." }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedOption, setSelectedOption] = useState<'own-script' | 'generate-ai' | null>(null);
  const [videoStyle, setVideoStyle] = useState<'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT' | null>(null);
  const [lastUserPrompt, setLastUserPrompt] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState(false);

  // Reset state on mount or when projectId changes
  useEffect(() => {
    // Reset all state when projectId changes
    setScript(null);
    setScriptFormatted('');
    setChatMessages([{ role: 'ai', content: "Hey there! Tell me about your video." }]);
    setChatInput('');
    setIsGenerating(false);
    setSelectedOption(null);
    setVideoStyle(null);
    setLastUserPrompt('');
    setProjectId(projectIdFromUrl);
    setIsInitialized(false);
  }, [projectIdFromUrl]);

  // Load project info to get video style - only load if projectId is in URL
  useEffect(() => {
    const loadProject = async () => {
      // Only load if projectId is explicitly in URL (editing existing project)
      if (!projectIdFromUrl || isInitialized) {
        setIsInitialized(true);
        return;
      }
      
      try {
        const response = await apiClient.getVideoProject(projectIdFromUrl);
        if (response.success && response.data) {
          // Double-check the project ID matches
          if (response.data.id !== projectIdFromUrl) {
            console.warn('Project ID mismatch, ignoring loaded data');
            setIsInitialized(true);
            return;
          }
          
          if (response.data.style) {
            setVideoStyle(response.data.style);
          }
          
          // Only load script if it exists AND belongs to this project
          if (response.data.script && response.data.id === projectIdFromUrl) {
            try {
              const scriptData = typeof response.data.script === 'string' 
                ? JSON.parse(response.data.script) 
                : response.data.script;
              setScript(scriptData);
              // Format existing script for display
              setScriptFormatted(formatScriptForDisplay(scriptData));
            } catch (e) {
              // If script is already a formatted string
              setScriptFormatted(response.data.script);
            }
          }
          
          setIsInitialized(true);
        }
      } catch (error: any) {
        console.error('Failed to load project:', error);
        setIsInitialized(true);
        if (error.response?.status === 401) {
          showToast('Authentication failed. Please login again', 'error');
          router.push('/login');
        }
      }
    };

    if (projectIdFromUrl && !isInitialized) {
      loadProject();
    } else if (!projectIdFromUrl) {
      // No projectId in URL - this is a new flow
      setIsInitialized(true);
    }
  }, [projectIdFromUrl, isInitialized, router, showToast]);

  const formatScriptForDisplay = (scriptData: any): string => {
    let formatted = '';
    
    if (scriptData.video_type) {
      formatted += `📹 **Video Type:** ${scriptData.video_type}\n\n`;
    }
    
    if (scriptData.duration) {
      formatted += `⏱️  **Duration:** ${scriptData.duration}\n\n`;
    }

    const scenes = scriptData.scenes || scriptData.scene_plan || [];
    
    scenes.forEach((scene: any, index: number) => {
      formatted += `🎬 **Scene ${scene.scene_number || index + 1}** (${scene.time_range || 'N/A'})\n`;
      
      if (scene.type) {
        formatted += `   **Type:** ${scene.type}\n`;
      }
      
      if (scene.voiceover) {
        formatted += `   💬 **Voiceover:** "${scene.voiceover}"\n`;
      }
      
      if (scene.broll_visual_description) {
        formatted += `   🎥 **B-Roll:** ${scene.broll_visual_description}\n`;
      }
      
      if (scene.avatar_action) {
        formatted += `   👤 **Avatar:** ${scene.avatar_action}\n`;
      }
      
      if (scene.avatar_cutout_position) {
        formatted += `   📍 **Position:** ${scene.avatar_cutout_position}\n`;
      }
      
      formatted += '\n';
    });

    if (scriptData.notes) {
      formatted += `📝 **Notes:**\n`;
      if (typeof scriptData.notes === 'string') {
        formatted += `   ${scriptData.notes}\n`;
      } else {
        Object.entries(scriptData.notes).forEach(([key, value]: [string, any]) => {
          formatted += `   **${key}:** ${value}\n`;
        });
      }
    }

    return formatted;
  };

  const handleOptionSelect = (option: 'own-script' | 'generate-ai') => {
    // Prevent switching once an option is already selected
    if (selectedOption !== null) {
      return;
    }
    
    setSelectedOption(option);
    
    // Add the selected option as a user message
    const optionText = option === 'own-script' ? 'Have your own script' : 'Generate with AI';
    setChatMessages(prev => [...prev, { role: 'user' as const, content: optionText }]);
    
    // If "Have your own script" is selected, we can implement manual script entry later
    // For now, we focus on AI generation
  };

  const handleChatSubmit = async () => {
    if (!chatInput.trim() || !selectedOption) return;
    
    const userMessage = chatInput.trim();
    setLastUserPrompt(userMessage);
    
    // Add user message to chat
    const newMessages = [...chatMessages, { role: 'user' as const, content: userMessage }];
    setChatMessages(newMessages);
    setChatInput('');
    setIsGenerating(true);

    // Get current projectId - create if doesn't exist
    let currentProjectId = projectId || projectIdFromUrl;
    
    // If no project exists yet, create one now (when user starts generating script)
    // We need videoStyle from the project or sessionStorage
    let styleToUse = videoStyle;
    if (!styleToUse && typeof window !== 'undefined') {
      // Try to get style from sessionStorage (from style page)
      const savedStyle = sessionStorage.getItem('videoCreationStyle');
      if (savedStyle) {
        // Map frontend style to backend style
        const styleMap: Record<string, string> = {
          'half-n-half': 'HALF_N_HALF',
          'alternate': 'ALTERNATE',
          'avatar-cutout': 'AVATAR_CUTOUT',
        };
        styleToUse = styleMap[savedStyle] as any;
      }
    }
    
    if (!currentProjectId && selectedOption === 'generate-ai' && styleToUse) {
      try {
        const createResponse = await apiClient.createVideoProject({
          videoType: 'WITHOUT_AVATAR', // Default, will be updated later
          currentStep: 'SCRIPT',
          style: styleToUse,
        });
        
        if (createResponse.success && createResponse.data) {
          currentProjectId = createResponse.data.id;
          setProjectId(currentProjectId);
          setVideoStyle(styleToUse);
          // Update URL with new projectId
          router.replace(`/create-video/script?projectId=${currentProjectId}`);
        } else {
          showToast('Failed to create project. Please try again.', 'error');
          setIsGenerating(false);
          return;
        }
      } catch (error: any) {
        console.error('Failed to create project:', error);
        showToast('Failed to create project. Please try again.', 'error');
        setIsGenerating(false);
        return;
      }
    }

    // Only generate script if "Generate with AI" is selected
    if (selectedOption === 'generate-ai' && styleToUse) {
      if (!currentProjectId) {
        showToast('Project not found. Please try again.', 'error');
        setIsGenerating(false);
        return;
      }
      
      try {
        const response = await apiClient.generateVideoScript({
          userPrompt: userMessage,
          videoStyle: styleToUse || videoStyle,
          projectId: currentProjectId,
        });

        if (response.success && response.data) {
          const { script: scriptData, formattedScript } = response.data;
          
          // Double-check we're still working with the same project
          if ((projectId || projectIdFromUrl) !== currentProjectId) {
            console.warn('Project changed during generation, ignoring result');
            setIsGenerating(false);
            return;
          }
          
          // Save script to database
          if (currentProjectId) {
            try {
              await apiClient.updateVideoProject(currentProjectId, {
                script: JSON.stringify(scriptData),
                scriptGenerated: true,
              });
            } catch (error) {
              console.error('Failed to save script to project:', error);
            }
          }

          setScript(scriptData);
          setScriptFormatted(formattedScript);
          
          // Add AI response to chat
          setChatMessages(prev => [...prev, { 
            role: 'ai', 
            content: 'Here\'s your video script! You can regenerate it if you\'d like to see different variations.' 
          }]);
          
          showToast('Script generated successfully! Your video script is ready!', 'success');
        } else {
          throw new Error(response.message || 'Failed to generate script');
        }
      } catch (error: any) {
        console.error('Failed to generate script:', error);
        showToast(error.response?.data?.message || error.message || 'Failed to generate script. An error occurred', 'error');
        
        // Double-check we're still working with the same project before adding error message
        if ((projectId || projectIdFromUrl) === currentProjectId) {
          // Add error message to chat
          setChatMessages(prev => [...prev, { 
            role: 'ai', 
            content: 'Sorry, I encountered an error while generating your script. Please try again.' 
          }]);
        }
      } finally {
        setIsGenerating(false);
      }
    } else if (selectedOption === 'own-script') {
      // For "Have your own script", we'll implement manual entry later
      setChatMessages(prev => [...prev, { 
        role: 'ai', 
        content: 'Manual script entry will be available soon. For now, please use "Generate with AI" to create your script.' 
      }]);
      setIsGenerating(false);
    } else {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    if (!lastUserPrompt) return;
    
    // Get current projectId to ensure we're working with the right project
    const currentProjectId = projectId || projectIdFromUrl;
    if (!currentProjectId) {
      showToast('Project not found. Please start again.', 'error');
      return;
    }
    
    // Get videoStyle from state or project
    let styleToUse = videoStyle;
    if (!styleToUse && typeof window !== 'undefined') {
      // Try to get style from sessionStorage (from style page)
      const savedStyle = sessionStorage.getItem('videoCreationStyle');
      if (savedStyle) {
        // Map frontend style to backend style
        const styleMap: Record<string, string> = {
          'half-n-half': 'HALF_N_HALF',
          'alternate': 'ALTERNATE',
          'avatar-cutout': 'AVATAR_CUTOUT',
        };
        styleToUse = styleMap[savedStyle] as any;
      }
    }
    
    if (!styleToUse) {
      showToast('Video style not found. Please start again.', 'error');
      return;
    }
    
    setIsGenerating(true);
    try {
      const response = await apiClient.generateVideoScript({
        userPrompt: lastUserPrompt,
        videoStyle: styleToUse,
        projectId: currentProjectId,
      });

      if (response.success && response.data) {
        // Double-check we're still working with the same project
        if ((projectId || projectIdFromUrl) !== currentProjectId) {
          console.warn('Project changed during regeneration, ignoring result');
          setIsGenerating(false);
          return;
        }
        
        const { script: scriptData, formattedScript } = response.data;
        
        // Save script to database (replace previous)
        if (currentProjectId) {
          try {
            await apiClient.updateVideoProject(currentProjectId, {
              script: JSON.stringify(scriptData),
              scriptGenerated: true,
            });
          } catch (error) {
            console.error('Failed to save script to project:', error);
          }
        }

        setScript(scriptData);
        setScriptFormatted(formattedScript);
        
        showToast('Script regenerated! A new version of your script has been generated.', 'success');
      } else {
        throw new Error(response.message || 'Failed to regenerate script');
      }
    } catch (error: any) {
      console.error('Failed to regenerate script:', error);
      showToast(error.response?.data?.message || error.message || 'Failed to regenerate script. An error occurred', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleNext = () => {
    // Only proceed if we have a script
    if (!script) {
      showToast('Please generate a script first', 'warning');
      return;
    }
    
    const currentProjectId = projectId || projectIdFromUrl;
    if (currentProjectId) {
      router.push(`/create-video/voice?projectId=${currentProjectId}`);
    } else {
    router.push('/create-video/voice');
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <button
            onClick={goToPreviousStep}
            className="mb-6 flex items-center gap-2 text-text-primary hover:text-text-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back</span>
          </button>

          <h1 className={cn(typography.heading.h2, "mb-8")}>Add Script</h1>

          {/* AI Chat - Full Width */}
          <div className="max-w-4xl mx-auto">
            <Card className="p-6 space-y-4 h-[600px] flex flex-col">
                  <div className="flex items-center justify-between">
                    <h3 className={cn(typography.heading.h5)}>Chat with AI</h3>
                    <button
                      onClick={() => {
                      // Reset chat state - clear messages except initial, clear options, clear input
                      setChatMessages([{ role: 'ai', content: "Hey there! Tell me about your video." }]);
                      setSelectedOption(null);
                      setChatInput('');
                      setScript(null);
                      setScriptFormatted('');
                      setLastUserPrompt('');
                      setIsGenerating(false);
                      }}
                      className="p-1 hover:bg-primary-light rounded"
                    title="Reset chat"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-4">
                  {chatMessages.map((msg, idx) => {
                    const isFirstMessage = idx === 0 && msg.role === 'ai';
                    return (
                      <div key={idx} className="space-y-3">
                      <div
                        className={cn(
                          'p-3 rounded-lg',
                          msg.role === 'user' 
                              ? 'bg-primary ml-auto max-w-[80%]' 
                            : 'bg-secondary border border-border mr-auto max-w-[80%]'
                        )}
                      >
                          <p className={cn(
                            typography.body.small,
                            msg.role === 'user' && 'text-white'
                          )}>{msg.content}</p>
                      </div>
                        
                        {/* Show options below first AI message */}
                        {isFirstMessage && (
                          <div className="flex flex-row gap-3 mr-auto max-w-[80%]">
                          <Button
                              variant={selectedOption === 'own-script' ? 'primary' : 'outline'}
                              size="lg"
                              onClick={() => handleOptionSelect('own-script')}
                              disabled={selectedOption !== null && selectedOption !== 'own-script'}
                              className={cn(
                                "h-12 px-6 flex-1 transition-all duration-200",
                                selectedOption === 'own-script' 
                                  ? "bg-primary text-white border-primary" 
                                  : selectedOption === null
                                  ? "hover:bg-primary-light hover:border-primary hover:text-primary"
                                  : "opacity-50 cursor-not-allowed"
                              )}
                            >
                              Have your own script
                          </Button>
                            <Button
                              variant={selectedOption === 'generate-ai' ? 'primary' : 'outline'}
                              size="lg"
                              onClick={() => handleOptionSelect('generate-ai')}
                              disabled={selectedOption !== null && selectedOption !== 'generate-ai'}
                              className={cn(
                                "h-12 px-6 flex-1 transition-all duration-200",
                                selectedOption === 'generate-ai' 
                                  ? "bg-primary text-white border-primary" 
                                  : selectedOption === null
                                  ? "hover:bg-primary-light hover:border-primary hover:text-primary"
                                  : "opacity-50 cursor-not-allowed"
                              )}
                            >
                              Generate with AI
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Show generating indicator */}
                  {isGenerating && (
                    <div className="bg-secondary border border-border rounded-lg p-4 mr-auto max-w-[80%]">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <p className={typography.body.small}>Generating your script...</p>
                      </div>
                    </div>
                  )}

                  {/* Display generated script */}
                  {script && scriptFormatted && !isGenerating && (
                    <div className="bg-secondary border border-border rounded-lg p-4 mr-auto max-w-[90%] space-y-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className={cn(typography.heading.h6, "text-primary")}>Generated Script</h4>
                          <Button
                            variant="outline"
                            size="sm"
                          onClick={handleRegenerate}
                          disabled={isGenerating || !videoStyle}
                          className="flex items-center gap-2"
                          >
                          <RefreshCw className={cn("w-4 h-4", isGenerating && "animate-spin")} />
                            Regenerate
                          </Button>
                        </div>
                      <div className="bg-background rounded-lg p-4 border border-border">
                        <pre className={cn(typography.body.small, "whitespace-pre-wrap font-sans")}>
                          {scriptFormatted}
                        </pre>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && selectedOption && handleChatSubmit()}
                    placeholder={selectedOption ? "Type your ideas here..." : "Please select an option above"}
                    disabled={!selectedOption}
                    className={cn(
                      "flex-1 px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary transition-opacity",
                      !selectedOption && "opacity-50 cursor-not-allowed"
                    )}
                    />
                    <Button
                      variant="primary"
                      size="sm"
                    icon={isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      onClick={handleChatSubmit}
                    disabled={!selectedOption || !chatInput.trim() || isGenerating || !videoStyle}
                    className={cn(
                      "rounded-full w-10 h-10 p-0 transition-opacity",
                      (!selectedOption || !chatInput.trim() || isGenerating || !videoStyle) && "opacity-50 cursor-not-allowed"
                    )}
                      aria-label="Send message"
                    />
                  </div>
                </Card>
          </div>
        </div>
      </div>

      <ProgressBar
        progress={script ? 40 : 20}
        message={script ? "Great script! Ready for the next step." : "Chat with AI to generate your script"}
        onNext={handleNext}
        disabled={!script}
      />
    </div>
  );
}

export default function ScriptPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <ScriptPageContent />
    </Suspense>
  );
}

