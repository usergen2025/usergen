'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, X, Send, Loader2, RefreshCw, Edit2, Check, X as XIcon } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/layout/ProgressBar';
import TagAwareInput from '@/components/ui/TagAwareInput';
import Textarea from '@/components/ui/Textarea';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useVideoStepNavigation } from '@/hooks/useVideoStepNavigation';

function ScriptPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const projectIdFromUrl = searchParams?.get('projectId') ?? null;
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
  const [selectedLanguage, setSelectedLanguage] = useState<'english' | 'hindi' | 'hinglish' | null>(null);
  const [videoStyle, setVideoStyle] = useState<'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT' | null>(null);
  const [lastUserPrompt, setLastUserPrompt] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [regeneratingScenes, setRegeneratingScenes] = useState<Set<number>>(new Set());
  // Script input state for "own-script" option
  const [scriptInput, setScriptInput] = useState('');

  // Reset state on mount or when projectId changes
  useEffect(() => {
    // Reset all state when projectId changes
    setScript(null);
    setScriptFormatted('');
    setChatMessages([{ role: 'ai', content: "Hey there! Tell me about your video." }]);
    setChatInput('');
    setIsGenerating(false);
    setSelectedOption(null);
    setSelectedLanguage(null);
    setVideoStyle(null);
    setLastUserPrompt('');
    setProjectId(projectIdFromUrl);
    setIsInitialized(false);
    setScriptInput('');
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
              
              // Try to extract lastUserPrompt from project metadata or use a default
              // If we have the script, we can infer the prompt might be stored elsewhere
              // For now, we'll set it to empty and let user regenerate with new prompt
              // In future, we could store originalPrompt in project metadata
            } catch (e) {
              // If script is already a formatted string
              setScriptFormatted(response.data.script);
            }
          }
          
          // Set project to access it later
          setProject(response.data);
          
          setIsInitialized(true);
        }
      } catch (error: any) {
        console.error('Failed to load project:', error);
        setIsInitialized(true);
        if (error.response?.status === 401) {
          showToast('Session expired. Please log in again.', 'error');
          // AuthExpiryProvider handles 401
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
      
      if (scene.avatar_motion) {
        formatted += `   🎭 **Motion:** ${scene.avatar_motion}\n`;
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

  // Simplified format: returns array of scenes with just scene number and voiceover
  const formatScriptSimple = (scriptData: any): Array<{ sceneNumber: number; voiceover: string; scene: any }> => {
    const scenes = scriptData.scenes || scriptData.scene_plan || [];
    return scenes.map((scene: any, index: number) => ({
      sceneNumber: scene.scene_number || scene.sceneNumber || (index + 1),
      voiceover: scene.voiceover || '',
      scene: scene, // Keep full scene object for updates
    }));
  };

  // Extract tags and content from input
  // Replaces @tag with tag (without @) in content
  const extractTagsAndContent = (input: string): { content: string; tags: string[] } => {
    const tagRegex = /@(\w+)/g;
    const matches = Array.from(input.matchAll(tagRegex));
    const extractedTags = matches.map(match => match[1].toLowerCase().trim());
    
    // Replace @tag with tag (without @) in content
    // Example: "Generate a @technology related video" -> "Generate a technology related video"
    const content = input
      .replace(/@(\w+)/g, '$1')  // Replace @tag with tag
      .replace(/\s+/g, ' ')       // Normalize whitespace
      .trim();
    
    return { content, tags: Array.from(new Set(extractedTags)) };
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
    
    // If "Generate with AI" is selected, reset language selection
    if (option === 'generate-ai') {
      setSelectedLanguage(null);
      setScriptInput('');
    }
    
    // If "Have your own script" is selected, reset language and chat input
    if (option === 'own-script') {
      setSelectedLanguage(null);
      setChatInput('');
    }
    
    // If "Have your own script" is selected, we can implement manual script entry later
    // For now, we focus on AI generation
  };

  const handleChatSubmit = async () => {
    if (!selectedOption) return;
    
    // Validate based on selected option
    if (selectedOption === 'generate-ai') {
      if (!chatInput.trim() || !selectedLanguage) {
        if (!selectedLanguage) {
          showToast('Please select a language first', 'warning');
        }
        return;
      }
    } else if (selectedOption === 'own-script') {
      if (!scriptInput.trim()) {
        showToast('Please enter your script', 'warning');
        return;
      }
    }
    
    // Extract content and tags
    let userMessage: string;
    let extractedTags: string[] = [];
    
    if (selectedOption === 'own-script') {
      const { content, tags } = extractTagsAndContent(scriptInput);
      userMessage = content;
      extractedTags = tags;
      
      if (!userMessage.trim()) {
        showToast('Please enter script content', 'warning');
        return;
      }
    } else {
      // For generate-ai, extract tags from chatInput and replace @tag with tag
      const { content, tags } = extractTagsAndContent(chatInput);
      userMessage = content;
      extractedTags = tags;
      
      if (!userMessage.trim()) {
        showToast('Please enter your ideas', 'warning');
        return;
      }
    }
    
    setLastUserPrompt(userMessage);
    
    // Add user message to chat (show original with tags for display)
    const displayMessage = extractedTags.length > 0 
      ? `${selectedOption === 'own-script' ? scriptInput : chatInput} [Tags: ${extractedTags.join(', ')}]`
      : (selectedOption === 'own-script' ? scriptInput : chatInput);
    const newMessages = [...chatMessages, { role: 'user' as const, content: displayMessage }];
    setChatMessages(newMessages);
    
    if (selectedOption === 'own-script') {
      setScriptInput('');
    } else {
      setChatInput('');
    }
    
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

    // Generate script for both options
    if (styleToUse && (selectedOption === 'generate-ai' ? selectedLanguage : true)) {
      if (!currentProjectId) {
        showToast('Project not found. Please try again.', 'error');
        setIsGenerating(false);
        return;
      }
      
      try {
        const response = await apiClient.generateVideoScript({
          userPrompt: userMessage, // Cleaned content (with @tag replaced by tag)
          videoStyle: styleToUse || videoStyle,
          language: selectedOption === 'generate-ai' ? (selectedLanguage ?? undefined) : undefined,
          tags: extractedTags.length > 0 ? extractedTags : undefined, // Send tags for both options
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
          setScriptFormatted(formatScriptForDisplay(scriptData));
          
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
    } else {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    // If no lastUserPrompt, try to extract from script or use a generic prompt
    let promptToUse = lastUserPrompt;
    if (!promptToUse && script) {
      // Try to infer from script content or use a generic prompt
      promptToUse = 'Regenerate the entire video script with new creative variations';
    }
    
    if (!promptToUse) {
      showToast('Please generate a script first before regenerating', 'warning');
      return;
    }
    
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
    
    if (!selectedLanguage) {
      showToast('Language not selected. Please start again.', 'error');
      return;
    }
    
    setIsGenerating(true);
    try {
      const response = await apiClient.generateVideoScript({
        userPrompt: promptToUse,
        videoStyle: styleToUse,
        language: selectedLanguage,
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
        setScriptFormatted(formatScriptForDisplay(scriptData));
        
        // Update lastUserPrompt if we used a different prompt
        if (promptToUse !== lastUserPrompt) {
          setLastUserPrompt(promptToUse);
        }
        
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

  const handleEditScene = (sceneNumber: number, currentVoiceover: string) => {
    setEditingScene(sceneNumber);
    setEditValue(currentVoiceover);
  };

  const handleCancelEdit = () => {
    setEditingScene(null);
    setEditValue('');
  };

  const handleSaveEdit = async (sceneNumber: number) => {
    if (!script || !videoStyle) {
      showToast('Missing required information for editing', 'error');
      return;
    }
    
    if (!selectedLanguage) {
      showToast('Language not selected', 'error');
      return;
    }
    
    // Use lastUserPrompt if available, otherwise use a generic prompt
    const promptToUse = lastUserPrompt || 'Update the scene with the provided voiceover';

    const currentProjectId = projectId || projectIdFromUrl;
    if (!currentProjectId) {
      showToast('Project not found', 'error');
      return;
    }

    try {
      const response = await apiClient.regenerateScene({
        sceneNumber,
        videoStyle,
        existingScript: script,
        originalUserPrompt: promptToUse,
        operation: 'edit',
        newVoiceover: editValue.trim(),
        language: selectedLanguage,
      });

      if (response.success && response.data) {
        const updatedScene = response.data.scene;
        
        // Update the scene in the script
        const scenes = script.scenes || script.scene_plan || [];
        const sceneIndex = scenes.findIndex((s: any) => 
          (s.scene_number || s.sceneNumber) === sceneNumber
        );

        if (sceneIndex >= 0) {
          const updatedScenes = [...scenes];
          updatedScenes[sceneIndex] = updatedScene;
          
          const updatedScript = {
            ...script,
            scenes: script.scenes ? updatedScenes : undefined,
            scene_plan: script.scene_plan ? updatedScenes : undefined,
          };

          // Save to database
          await apiClient.updateVideoProject(currentProjectId, {
            script: JSON.stringify(updatedScript),
          });

          setScript(updatedScript);
          setScriptFormatted(formatScriptForDisplay(updatedScript));
          setEditingScene(null);
          setEditValue('');
          
          showToast(`Scene ${sceneNumber} updated successfully!`, 'success');
        }
      } else {
        throw new Error(response.message || 'Failed to edit scene');
      }
    } catch (error: any) {
      console.error('Failed to edit scene:', error);
      showToast(error.response?.data?.message || error.message || 'Failed to edit scene', 'error');
    }
  };

  const handleRegenerateScene = async (sceneNumber: number) => {
    if (!script || !videoStyle) {
      showToast('Missing required information for regeneration', 'error');
      return;
    }
    
    if (!selectedLanguage) {
      showToast('Language not selected', 'error');
      return;
    }
    
    // Use lastUserPrompt if available, otherwise use a generic prompt based on script
    const promptToUse = lastUserPrompt || 'Regenerate the scene with new creative content';

    const currentProjectId = projectId || projectIdFromUrl;
    if (!currentProjectId) {
      showToast('Project not found', 'error');
      return;
    }

    // Add to regenerating set
    setRegeneratingScenes(prev => new Set(prev).add(sceneNumber));

    try {
      const response = await apiClient.regenerateScene({
        sceneNumber,
        videoStyle,
        existingScript: script,
        originalUserPrompt: promptToUse,
        operation: 'regenerate',
        language: selectedLanguage,
      });

      if (response.success && response.data) {
        const updatedScene = response.data.scene;
        
        // Update the scene in the script
        const scenes = script.scenes || script.scene_plan || [];
        const sceneIndex = scenes.findIndex((s: any) => 
          (s.scene_number || s.sceneNumber) === sceneNumber
        );

        if (sceneIndex >= 0) {
          const updatedScenes = [...scenes];
          updatedScenes[sceneIndex] = updatedScene;
          
          const updatedScript = {
            ...script,
            scenes: script.scenes ? updatedScenes : undefined,
            scene_plan: script.scene_plan ? updatedScenes : undefined,
          };

          // Save to database
          await apiClient.updateVideoProject(currentProjectId, {
            script: JSON.stringify(updatedScript),
          });

          setScript(updatedScript);
          setScriptFormatted(formatScriptForDisplay(updatedScript));
          
          showToast(`Scene ${sceneNumber} regenerated successfully!`, 'success');
        }
      } else {
        throw new Error(response.message || 'Failed to regenerate scene');
      }
    } catch (error: any) {
      console.error('Failed to regenerate scene:', error);
      showToast(error.response?.data?.message || error.message || 'Failed to regenerate scene', 'error');
    } finally {
      // Remove from regenerating set
      setRegeneratingScenes(prev => {
        const next = new Set(prev);
        next.delete(sceneNumber);
        return next;
      });
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
                      setSelectedLanguage(null);
                      setChatInput('');
                      setScriptInput('');
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
                          <>
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
                            
                            {/* Show language selection after "Generate with AI" is selected */}
                            {selectedOption === 'generate-ai' && (
                              <div className="mr-auto max-w-[80%] space-y-2">
                                <p className={cn(typography.body.small, "text-text-secondary mb-2")}>
                                  Select language for your script:
                                </p>
                                <div className="flex flex-row gap-3">
                                  <Button
                                    variant={selectedLanguage === 'english' ? 'primary' : 'outline'}
                                    size="md"
                                    onClick={() => setSelectedLanguage('english')}
                                    disabled={selectedLanguage !== null && selectedLanguage !== 'english'}
                                    className={cn(
                                      "h-10 px-4 flex-1 transition-all duration-200",
                                      selectedLanguage === 'english' 
                                        ? "bg-primary text-white border-primary" 
                                        : selectedLanguage === null
                                        ? "hover:bg-primary-light hover:border-primary hover:text-primary"
                                        : "opacity-50 cursor-not-allowed"
                                    )}
                                  >
                                    English
                                  </Button>
                                  <Button
                                    variant={selectedLanguage === 'hindi' ? 'primary' : 'outline'}
                                    size="md"
                                    onClick={() => setSelectedLanguage('hindi')}
                                    disabled={selectedLanguage !== null && selectedLanguage !== 'hindi'}
                                    className={cn(
                                      "h-10 px-4 flex-1 transition-all duration-200",
                                      selectedLanguage === 'hindi' 
                                        ? "bg-primary text-white border-primary" 
                                        : selectedLanguage === null
                                        ? "hover:bg-primary-light hover:border-primary hover:text-primary"
                                        : "opacity-50 cursor-not-allowed"
                                    )}
                                  >
                                    Hindi
                                  </Button>
                                  <Button
                                    variant={selectedLanguage === 'hinglish' ? 'primary' : 'outline'}
                                    size="md"
                                    onClick={() => setSelectedLanguage('hinglish')}
                                    disabled={selectedLanguage !== null && selectedLanguage !== 'hinglish'}
                                    className={cn(
                                      "h-10 px-4 flex-1 transition-all duration-200",
                                      selectedLanguage === 'hinglish' 
                                        ? "bg-primary text-white border-primary" 
                                        : selectedLanguage === null
                                        ? "hover:bg-primary-light hover:border-primary hover:text-primary"
                                        : "opacity-50 cursor-not-allowed"
                                    )}
                                  >
                                    Hinglish
                                  </Button>
                                </div>
                              </div>
                            )}
                            
                            {/* Show textarea for "Have your own script" option */}
                            {selectedOption === 'own-script' && (
                              <div className="mr-auto max-w-[80%] space-y-2">
                                <p className={cn(typography.body.small, "text-text-secondary mb-2")}>
                                  Write your script below:
                                </p>
                                <Textarea
                                  value={scriptInput}
                                  onChange={(e) => setScriptInput(e.target.value)}
                                  placeholder="Write your script here..."
                                  disabled={isGenerating}
                                  rows={6}
                                />
                              </div>
                            )}
                          </>
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

                  {/* Display generated script - Simplified view */}
                  {script && !isGenerating && (
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
                          Regenerate All
                        </Button>
                      </div>
                      <div className="bg-background rounded-lg p-4 border border-border space-y-3">
                        {formatScriptSimple(script).map((item) => {
                          const isRegenerating = regeneratingScenes.has(item.sceneNumber);
                          const isEditing = editingScene === item.sceneNumber;
                          
                          return (
                            <div key={item.sceneNumber} className="flex items-start gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors">
                              {/* Scene number and voiceover */}
                              <div className="flex-1 min-w-0">
                                {isRegenerating ? (
                                  // Shimmer effect while regenerating
                                  <div className="space-y-2">
                                    <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-24"></div>
                                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-full"></div>
                                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4"></div>
                                  </div>
                                ) : isEditing ? (
                                  // Edit mode
                                  <div className="space-y-2">
                                    <div className={cn(typography.body.medium, "font-semibold")}>
                                      Scene {item.sceneNumber}:
                                    </div>
                                    <textarea
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                                      rows={3}
                                      autoFocus
                                    />
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={() => handleSaveEdit(item.sceneNumber)}
                                        className="flex items-center gap-1"
                                      >
                                        <Check className="w-4 h-4" />
                                        Save
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleCancelEdit}
                                        className="flex items-center gap-1"
                                      >
                                        <XIcon className="w-4 h-4" />
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  // Display mode
                                  <div>
                                    <div className={cn(typography.body.medium, "font-semibold mb-1")}>
                                      Scene {item.sceneNumber}:
                                    </div>
                                    <div className={cn(typography.body.small, "text-text-secondary")}>
                                      "{item.voiceover}"
                                    </div>
                                  </div>
                                )}
                              </div>
                              
                              {/* Action buttons - only show when not regenerating or editing */}
                              {!isRegenerating && !isEditing && (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <button
                                    onClick={() => handleEditScene(item.sceneNumber, item.voiceover)}
                                    className="p-2 hover:bg-primary-light rounded-lg transition-colors"
                                    title="Edit voiceover"
                                  >
                                    <Edit2 className="w-4 h-4 text-text-secondary hover:text-primary" />
                                  </button>
                                  <button
                                    onClick={() => handleRegenerateScene(item.sceneNumber)}
                                    disabled={!videoStyle}
                                    className="p-2 hover:bg-primary-light rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Regenerate scene"
                                  >
                                    <RefreshCw className="w-4 h-4 text-text-secondary hover:text-primary" />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  </div>

                  {/* Input area - different for each option */}
                  {selectedOption === 'own-script' ? (
                    <div className="flex gap-2">
                      <div className="flex-1" /> {/* Spacer */}
                      <Button
                        variant="primary"
                        size="sm"
                        icon={isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        onClick={handleChatSubmit}
                        disabled={!scriptInput.trim() || isGenerating || !videoStyle}
                        className={cn(
                          "rounded-full w-10 h-10 p-0 transition-opacity",
                          (!scriptInput.trim() || isGenerating || !videoStyle) && "opacity-50 cursor-not-allowed"
                        )}
                        aria-label="Generate script"
                      />
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <TagAwareInput
                        value={chatInput}
                        onChange={setChatInput}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && selectedOption === 'generate-ai' && selectedLanguage && chatInput.trim()) {
                            handleChatSubmit();
                          }
                        }}
                        placeholder={
                          selectedOption === 'generate-ai' 
                            ? selectedLanguage 
                              ? "Type your ideas here... Use @tags for themes (e.g., @technology @professional)" 
                              : "Please select a language first"
                            : selectedOption 
                              ? "Type your ideas here..." 
                              : "Please select an option above"
                        }
                        disabled={!selectedOption || (selectedOption === 'generate-ai' && !selectedLanguage)}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        icon={isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        onClick={handleChatSubmit}
                        disabled={!selectedOption || !chatInput.trim() || isGenerating || !videoStyle || (selectedOption === 'generate-ai' && !selectedLanguage)}
                        className={cn(
                          "rounded-full w-10 h-10 p-0 transition-opacity",
                          (!selectedOption || !chatInput.trim() || isGenerating || !videoStyle || (selectedOption === 'generate-ai' && !selectedLanguage)) && "opacity-50 cursor-not-allowed"
                        )}
                        aria-label="Send message"
                      />
                    </div>
                  )}
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

