'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Toggle from '@/components/ui/Toggle';
import ProgressBar from '@/components/layout/ProgressBar';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { VideoStyle } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useVideoStepNavigation } from '@/hooks/useVideoStepNavigation';

// Map frontend style to backend enum
const mapStyleToBackend = (style: VideoStyle): 'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT' | 'AVATAR_ONLY' | 'PRODUCT_ONLY' | 'AVATAR_PRODUCT' | 'ANIMATED_AVATAR' | 'B_ROLL_ONLY' => {
  const map: Record<VideoStyle, 'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT' | 'AVATAR_ONLY' | 'PRODUCT_ONLY' | 'AVATAR_PRODUCT' | 'ANIMATED_AVATAR' | 'B_ROLL_ONLY'> = {
    'half-n-half': 'HALF_N_HALF',
    'alternate': 'ALTERNATE',
    'avatar-cutout': 'AVATAR_CUTOUT',
    'avatar-only': 'AVATAR_ONLY',
    'product-only': 'PRODUCT_ONLY',
    'avatar-product': 'AVATAR_PRODUCT',
    'animated-avatar': 'ANIMATED_AVATAR',
    'broll-only': 'B_ROLL_ONLY',
  };
  return map[style];
};

// Map backend style to frontend
const mapStyleFromBackend = (style?: string): VideoStyle | null => {
  if (!style) return null;
  const map: Record<string, VideoStyle> = {
    HALF_N_HALF: 'half-n-half',
    ALTERNATE: 'alternate',
    AVATAR_CUTOUT: 'avatar-cutout',
    AVATAR_ONLY: 'avatar-only',
    PRODUCT_ONLY: 'product-only',
    AVATAR_PRODUCT: 'avatar-product',
    ANIMATED_AVATAR: 'animated-avatar',
    B_ROLL_ONLY: 'broll-only',
  };
  return map[style] || null;
};

function StylePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useAuth();
  const { showToast } = useToast();
  const projectIdFromUrl = searchParams?.get('projectId');
  const [projectId, setProjectId] = useState<string | null>(projectIdFromUrl);
  const [project, setProject] = useState<any>(null);
  const { goToPreviousStep } = useVideoStepNavigation(projectId, project?.currentStep);
  const [selectedStyle, setSelectedStyle] = useState<VideoStyle | null>(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [captionText, setCaptionText] = useState('The quick brown fox jumps over the lazy dog');
  const [fontFamily, setFontFamily] = useState('Poppins');
  const [fontSize, setFontSize] = useState(24);
  const [textColor, setTextColor] = useState('#000000');
  const [backgroundColor, setBackgroundColor] = useState('#FFFFFF');
  const [borderColor, setBorderColor] = useState('#000000');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);

  // Check if this is the first page (from home) vs coming from another page
  const fromParam = searchParams?.get('from');
  const isFirstPage = !fromParam;

  // Load project ONLY if projectId is in URL (editing existing project)
  useEffect(() => {
    const loadProject = async () => {
      if (!isAuthenticated || isLoading) return;

      const projectIdParam = searchParams?.get('projectId');
      
      // Only load if projectId is explicitly in URL (coming from projects page)
      if (projectIdParam) {
        try {
          const response = await apiClient.getVideoProject(projectIdParam);
          if (response.success && response.data) {
            const project = response.data;
            setProjectId(project.id);
            if (project.style) {
              const frontendStyle = mapStyleFromBackend(project.style);
              if (frontendStyle) setSelectedStyle(frontendStyle);
            }
            if (project.captionSettings) {
              const caps = project.captionSettings;
              setCaptionsEnabled(project.captionsEnabled || false);
              if (caps) {
                setCaptionText(caps.text || '');
                setFontFamily(caps.fontFamily || 'Poppins');
                setFontSize(caps.fontSize || 24);
                setTextColor(caps.textColor || '#000000');
                setBackgroundColor(caps.backgroundColor || '#FFFFFF');
                setBorderColor(caps.borderColor || '#000000');
                setIsBold(caps.isBold || false);
                setIsItalic(caps.isItalic || false);
                setIsUnderline(caps.isUnderline || false);
              }
            }
          }
        } catch (error: any) {
          console.error('Failed to load project:', error);
        }
      } else {
        // No projectId in URL - this is a new flow, don't create project yet
        // Reset projectId to ensure clean state
        setProjectId(null);
      }

      // Fallback to sessionStorage for backward compatibility
      if (typeof window !== 'undefined') {
        const styleParam = searchParams?.get('style');
        if (styleParam && styleParam !== '') {
          setSelectedStyle(styleParam as VideoStyle);
        }
        
        const savedStyle = sessionStorage.getItem('videoCreationStyle');
        const savedProgress = sessionStorage.getItem('videoCreationProgress');
        
        if (savedStyle && savedStyle !== '' && !styleParam && !selectedStyle) {
          setSelectedStyle(savedStyle as VideoStyle);
        }
        
        if (savedProgress && fromParam === 'b-roll') {
          try {
            const progress = JSON.parse(savedProgress);
            if (progress.captions) {
              setCaptionsEnabled(progress.captions.enabled ?? true);
              setCaptionText(progress.captions.text ?? '');
              setFontFamily(progress.captions.fontFamily ?? 'Poppins');
              setFontSize(progress.captions.fontSize ?? 24);
              setTextColor(progress.captions.textColor ?? '#000000');
              setBackgroundColor(progress.captions.backgroundColor ?? '#FFFFFF');
              setBorderColor(progress.captions.borderColor ?? '#000000');
              setIsBold(progress.captions.isBold ?? false);
              setIsItalic(progress.captions.isItalic ?? false);
              setIsUnderline(progress.captions.isUnderline ?? false);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    };

    loadProject();
  }, [isAuthenticated, isLoading, searchParams, fromParam]);

  const styles: { id: VideoStyle; name: string; description: string }[] = [
    { id: 'half-n-half', name: 'Half-n-Half', description: 'Avatar above, content below' },
    { id: 'alternate', name: 'Alternate', description: 'Alternating layout' },
    { id: 'avatar-cutout', name: 'Avatar Cut-out', description: 'Avatar overlay style' },
    { id: 'avatar-only', name: 'Avatar Only', description: 'Full-screen avatar' },
    { id: 'product-only', name: 'Product Only', description: 'Product showcase only' },
    { id: 'avatar-product', name: 'Avatar with Product', description: 'Avatar with product' },
    { id: 'animated-avatar', name: 'Animated Avatar', description: '3D animated avatar style' },
    { id: 'broll-only', name: 'B-roll Only', description: 'Full-screen b-roll, no avatar' },
  ];

  // Save to backend when style changes
  const handleStyleChange = async (style: VideoStyle) => {
    setSelectedStyle(style);
    if (projectId) {
      try {
        await apiClient.updateVideoProject(projectId, {
          style: mapStyleToBackend(style),
        });
      } catch (error: any) {
        console.error('Failed to save style:', error);
      }
    }
  };

  // Save caption settings to backend
  const saveCaptionSettings = async () => {
    if (!projectId || !isFirstPage) return;
    
    try {
      await apiClient.updateVideoProject(projectId, {
        captionsEnabled,
        captionSettings: {
          enabled: captionsEnabled,
          text: captionText,
          fontFamily,
          fontSize,
          textColor,
          backgroundColor,
          borderColor,
          isBold,
          isItalic,
          isUnderline,
        },
      });
    } catch (error: any) {
      console.error('Failed to save caption settings:', error);
    }
  };

  // Save caption settings when they change (debounced)
  useEffect(() => {
    if (!isFirstPage && captionsEnabled) {
      const timer = setTimeout(() => {
        saveCaptionSettings();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [captionsEnabled, captionText, fontFamily, fontSize, textColor, backgroundColor, borderColor, isBold, isItalic, isUnderline, isFirstPage, projectId]);

  const handleNext = async () => {
    if (!selectedStyle) return;

    let currentProjectId = projectId;

    // If this is a new flow (no projectId), create a new project now
    if (!currentProjectId && isFirstPage) {
      try {
        const createResponse = await apiClient.createVideoProject({
          style: mapStyleToBackend(selectedStyle),
          videoType: 'WITHOUT_AVATAR', // Default, will be updated later
          currentStep: 'VIDEO_TYPE',
        });
        
        if (createResponse.success && createResponse.data) {
          currentProjectId = createResponse.data.id;
          setProjectId(currentProjectId);
          
          // Check if there's a pending script from AI chat page and save it
          if (typeof window !== 'undefined') {
            const pendingScriptData = sessionStorage.getItem('pendingScriptData');
            if (pendingScriptData && currentProjectId) {
              try {
                await apiClient.updateVideoProject(currentProjectId, {
                  script: pendingScriptData,
                  scriptGenerated: true,
                });
                // Clear pending script data after successful save
                sessionStorage.removeItem('pendingScriptData');
                sessionStorage.removeItem('pendingScriptFormatted');
                sessionStorage.removeItem('pendingUserPrompt');
              } catch (error) {
                console.error('Failed to save pending script to project:', error);
                // Don't block navigation if script save fails
              }
            }
          }
          
          // Save style to project before navigation
          if (!currentProjectId) {
            showToast('Project not found. Please try again.', 'error');
            return;
          }
          try {
            await apiClient.updateVideoProject(currentProjectId, {
              style: mapStyleToBackend(selectedStyle),
              currentStep: 'VIDEO_TYPE',
            });
          } catch (error) {
            console.error('Failed to save style to project:', error);
            // Don't block navigation if save fails
          }
          
          // Update URL with new projectId
          router.replace(`/create-video/type?projectId=${currentProjectId}`);
          return; // Exit early since we've handled navigation
        } else {
          showToast('Failed to create project. Please try again.', 'error');
          return;
        }
      } catch (error: any) {
        console.error('Failed to create project:', error);
        showToast('Failed to create project. Please try again.', 'error');
        return;
      }
    }

    // Save to backend if project exists
    if (currentProjectId) {
      try {
        const updateData: any = {
          style: mapStyleToBackend(selectedStyle),
          currentStep: isFirstPage ? 'VIDEO_TYPE' : 'RENDERING',
        };

        // Save caption settings if not first page
        if (!isFirstPage && captionsEnabled) {
          updateData.captionsEnabled = true;
          updateData.captionSettings = {
            enabled: captionsEnabled,
            text: captionText,
            fontFamily,
            fontSize,
            textColor,
            backgroundColor,
            borderColor,
            isBold,
            isItalic,
            isUnderline,
          };
        }

        await apiClient.updateVideoProject(currentProjectId, updateData);
      } catch (error: any) {
        // Show the actual error message
        const errorMessage = error.message || 'Failed to save progress';
        showToast(errorMessage, 'error');
        console.error('Failed to save:', error);
        
        // If 401, redirect to login
        if (error.response?.status === 401 || errorMessage.includes('Unauthorized') || errorMessage.includes('User ID')) {
          sessionStorage.setItem('pendingRedirect', `/create-video/style?projectId=${currentProjectId}`);
          // AuthExpiryProvider handles 401 via auth:session-expired
          return;
        }
        // Don't prevent navigation on other errors - user can still proceed
      }
    }

    // Save to sessionStorage for backward compatibility
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('videoCreationStyle', selectedStyle);
      
      if (!isFirstPage && captionsEnabled) {
        const progress = {
          captions: {
            enabled: captionsEnabled,
            text: captionText,
            fontFamily,
            fontSize,
            textColor,
            backgroundColor,
            borderColor,
            isBold,
            isItalic,
            isUnderline,
          }
        };
        sessionStorage.setItem('videoCreationProgress', JSON.stringify(progress));
      }
    }

    // If this is the first page and user is not authenticated, redirect to login
    if (isFirstPage && !isLoading && !isAuthenticated) {
      sessionStorage.setItem('pendingRedirect', `/create-video/style${selectedStyle ? `?style=${selectedStyle}` : ''}`);
      sessionStorage.setItem('videoCreationStyle', selectedStyle);
      return;
    }
    
    // Navigate to next step - only add projectId if it exists
    const nextUrl = isFirstPage 
      ? `/create-video/type${currentProjectId ? `?projectId=${currentProjectId}` : ''}` 
      : `/create-video/rendering${currentProjectId ? `?projectId=${currentProjectId}` : ''}`;
    router.push(nextUrl);
  };

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

          <h1 className={cn(typography.heading.h2, "mb-8")}>Select Style</h1>

          {/* Style Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {styles.map((style) => (
              <Card
                key={style.id}
                selected={selectedStyle === style.id}
                onClick={() => handleStyleChange(style.id)}
                className="p-6 cursor-pointer text-center"
              >
                <h3 className={cn(typography.heading.h5, "mb-2")}>{style.name}</h3>
                <p className={typography.body.small}>{style.description}</p>
              </Card>
            ))}
          </div>

          {/* Only show Caption Settings if NOT the first page */}
          {!isFirstPage && (
            <Card className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className={cn(typography.heading.h5)}>Enable Captions</h3>
                <Toggle checked={captionsEnabled} onCheckedChange={setCaptionsEnabled} />
              </div>

              {captionsEnabled && (
                <>
                  <div>
                    <textarea
                      value={captionText}
                      onChange={(e) => setCaptionText(e.target.value)}
                      className="w-full px-4 py-2 border border-border rounded-lg bg-secondary min-h-[100px]"
                      placeholder="Caption text..."
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Font Style</label>
                      <select
                        value={fontFamily}
                        onChange={(e) => setFontFamily(e.target.value)}
                        className="w-full px-4 py-2 border border-border rounded-lg bg-secondary"
                      >
                        <option>Poppins</option>
                        <option>Arial</option>
                        <option>Roboto</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Size</label>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setFontSize(Math.max(12, fontSize - 1))}>-</button>
                        <span className="px-4">{fontSize}</span>
                        <button onClick={() => setFontSize(Math.min(72, fontSize + 1))}>+</button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Text Color</label>
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => setTextColor(e.target.value)}
                        className="w-full h-10 border border-border rounded"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Background Color</label>
                      <input
                        type="color"
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="w-full h-10 border border-border rounded"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Text Border Color</label>
                      <input
                        type="color"
                        value={borderColor}
                        onChange={(e) => setBorderColor(e.target.value)}
                        className="w-full h-10 border border-border rounded"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Format</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setIsBold(!isBold)}
                          className={cn('px-3 py-1 border border-border rounded', isBold && 'bg-primary text-secondary')}
                        >
                          B
                        </button>
                        <button
                          onClick={() => setIsItalic(!isItalic)}
                          className={cn('px-3 py-1 border border-border rounded', isItalic && 'bg-primary text-secondary')}
                        >
                          I
                        </button>
                        <button
                          onClick={() => setIsUnderline(!isUnderline)}
                          className={cn('px-3 py-1 border border-border rounded', isUnderline && 'bg-primary text-secondary')}
                        >
                          U
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      </div>

      <ProgressBar
        progress={isFirstPage ? 20 : 80}
        message={isFirstPage ? "Choose your style to get started!" : "Scene is set, now for final touches!"}
        onNext={handleNext}
        disabled={!selectedStyle}
      />
    </div>
  );
}

export default function StylePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <StylePageContent />
    </Suspense>
  );
}


