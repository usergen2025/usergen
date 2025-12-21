'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Search, User, Upload, Loader2, CheckCircle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/layout/ProgressBar';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { AvatarCategory } from '@/types';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';
import { useVideoStepNavigation } from '@/hooks/useVideoStepNavigation';

function AvatarPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { isAuthenticated } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const projectIdFromUrl = searchParams.get('projectId');
  const [projectId, setProjectId] = useState<string | null>(projectIdFromUrl);
  const [project, setProject] = useState<any>(null);
  const { goToPreviousStep } = useVideoStepNavigation(projectId, project?.currentStep);
  
  const [activeTab, setActiveTab] = useState<'library' | 'upload'>('library');
  const [selectedCategory, setSelectedCategory] = useState<AvatarCategory>('all');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  
  // Avatar mode selection (for library avatars)
  const [avatarModes, setAvatarModes] = useState<Record<string, 'BASIC' | 'PREMIUM'>>({});
  
  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [avatarCreationStarted, setAvatarCreationStarted] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState<'BASIC' | 'PREMIUM'>('BASIC');

  const categories: AvatarCategory[] = ['all', 'professional', 'casual', 'modern'];

  // Mock avatars - in real app, this would come from API
  const [avatars, setAvatars] = useState(Array.from({ length: 8 }, (_, i) => ({
    id: `avatar-${i}`,
    name: `Avatar ${i + 1}`,
    category: ['professional', 'casual', 'modern'][i % 3] as AvatarCategory,
  })));

  // Load user avatars
  useEffect(() => {
    const loadUserAvatars = async () => {
      try {
        const response = await apiClient.getUserAvatars({ category: selectedCategory === 'all' ? undefined : selectedCategory });
        if (response.success && response.data) {
          setAvatars(response.data);
        }
      } catch (error: any) {
        console.error('Failed to load user avatars:', error);
        // If error, keep empty array
        setAvatars([]);
      }
    };

    loadUserAvatars();
  }, [selectedCategory]);

  const filteredAvatars = selectedCategory === 'all' 
    ? avatars 
    : avatars.filter(avatar => avatar.category === selectedCategory);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }

    // Create preview URL
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);

    setUploading(true);
    setUploadSuccess(false);
    setImageKey(null);
    setAssetId(null);

    try {
      // Upload image to HeyGen
      const uploadResponse = await apiClient.uploadAvatarImage(file);
      
      if (uploadResponse.success && uploadResponse.data) {
        setImageKey(uploadResponse.data.imageKey);
        setAssetId(uploadResponse.data.assetId);
        setUploadSuccess(true);
        showToast('Image uploaded successfully! Avatar generation will start automatically.', 'success');
        
        // Automatically start avatar creation
        await createAvatarFromImageKey(
          uploadResponse.data.imageKey, 
          uploadResponse.data.assetId,
          uploadResponse.data.localUrl
        );
      } else {
        throw new Error(uploadResponse.message || 'Failed to upload image');
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to upload image. Please try again.', 'error');
      setUploading(false);
      setImagePreview(null);
    }
  };

  const createAvatarFromImageKey = async (key: string, assetId?: string, localUrl?: string) => {
    try {
      setAvatarCreationStarted(true);
      const response = await apiClient.createAvatarFromUpload({
        imageKey: key,
        assetId: assetId,
        originalImageUrl: localUrl, // Pass local image URL
        // Don't send name - backend will generate Avatar_{userId}_{avatarId}
      });

      if (response.success && response.data) {
        showToast('Avatar generation started! This will take a few minutes.', 'info');
        
        // Set selectedAvatar to the returned avatar ID so it can be used when proceeding
        if (response.data.avatarId) {
          setSelectedAvatar(response.data.avatarId);
        }
        
        // Update project with avatar ID and mode
        const projectIdParam = searchParams.get('projectId');
        if (projectIdParam && response.data.avatarId) {
          try {
            await apiClient.updateVideoProject(projectIdParam, {
              avatarId: response.data.avatarId,
              avatarMode: uploadMode, // Save upload mode
            });
          } catch (error: any) {
            console.error('Failed to save avatar to project:', error);
          }
        }
        
        // User can proceed, avatar generation happens in background
      } else {
        throw new Error(response.message || 'Failed to start avatar generation');
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to start avatar generation', 'error');
      setAvatarCreationStarted(false);
    } finally {
      setUploading(false);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleNext = async () => {
    if (!selectedAvatar && !(activeTab === 'upload' && uploadSuccess && avatarCreationStarted)) {
      if (activeTab === 'upload' && !uploadSuccess) {
        showToast('Please upload an image first', 'warning');
      } else {
        showToast('Please select an avatar first', 'warning');
      }
      return;
    }

    const projectIdParam = searchParams.get('projectId');
    let currentProjectId = projectIdParam;
    const avatarIdToUse = activeTab === 'upload' && avatarCreationStarted ? selectedAvatar || imageKey : selectedAvatar;
    
    // Get the selected mode for the avatar
    const selectedMode = activeTab === 'upload' && avatarCreationStarted
      ? uploadMode  // Use upload mode
      : avatarModes[avatarIdToUse || ''] || 'BASIC'; // Use library mode

    // If no project exists, create one now
    if (!currentProjectId) {
      try {
        const createResponse = await apiClient.createVideoProject({
          videoType: 'WITH_AVATAR',
          avatarId: avatarIdToUse || undefined,
          avatarMode: selectedMode, // Add avatarMode
          currentStep: 'SCRIPT',
        });
        
        if (createResponse.success && createResponse.data) {
          currentProjectId = createResponse.data.id;
          // Update URL with new projectId
          router.replace(`/create-video/script?projectId=${currentProjectId}`);
          return;
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

    // Update existing project
    if (currentProjectId) {
      try {
        await apiClient.updateVideoProject(currentProjectId, {
          avatarId: avatarIdToUse || undefined,
          avatarMode: selectedMode, // Add avatarMode
          currentStep: 'SCRIPT',
        });
      } catch (error: any) {
        console.error('Failed to save avatar selection:', error);
        showToast('Failed to save progress', 'error');
      }
    }

    router.push(`/create-video/script${currentProjectId ? `?projectId=${currentProjectId}` : ''}`);
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

          <h1 className={cn(typography.heading.h2, "mb-6 text-center")}>Select Avatar</h1>

          {/* Tabs */}
          <div className="flex gap-4 mb-6 justify-center">
            <button
              onClick={() => setActiveTab('library')}
              className={cn(
                'px-6 py-2 rounded-full font-medium transition-colors',
                activeTab === 'library' 
                  ? 'bg-primary text-secondary' 
                  : 'bg-secondary border border-border text-text-primary'
              )}
            >
              Library
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={cn(
                'px-6 py-2 rounded-full font-medium transition-colors',
                activeTab === 'upload' 
                  ? 'bg-primary text-secondary' 
                  : 'bg-secondary border border-border text-text-primary'
              )}
            >
              Upload
            </button>
          </div>

          {activeTab === 'library' ? (
            <>
              {/* Search and Filters */}
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
                  <input
                    type="text"
                    placeholder="Search"
                    className="w-full pl-10 pr-4 py-2 border border-border rounded-full bg-secondary focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {categories.map((category) => (
                    <button
                      key={category}
                      onClick={() => setSelectedCategory(category)}
                      className={cn(
                        'px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize',
                        selectedCategory === category
                          ? 'bg-primary text-secondary'
                          : 'bg-secondary border border-border text-text-primary'
                      )}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>

              {/* Avatar Grid */}
              {filteredAvatars.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <div className="w-24 h-24 rounded-full bg-secondary border-2 border-dashed border-text-muted flex items-center justify-center mb-6">
                    <User className="w-12 h-12 text-text-muted" />
                  </div>
                  <h3 className={cn(typography.heading.h4, "mb-2 text-center")}>
                    No Avatars Available
                  </h3>
                  <p className={cn(typography.body.base, "text-center text-text-secondary max-w-md mb-6")}>
                    {selectedCategory === 'all'
                      ? "There are no avatars in the library yet. Try uploading your own avatar or check back later."
                      : `No avatars found in the "${selectedCategory}" category. Try a different category or upload your own.`}
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => setActiveTab('upload')}
                    className="flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Upload Your Avatar
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {/* Avatar options */}
                  {filteredAvatars.map((avatar: any) => {
                    const avatarImageUrl = avatar.avatarUrl || avatar.thumbnailUrl || avatar.originalImageUrl;
                    const AI_CONTENT_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL 
                      ? process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL.replace('/api', '')
                      : 'http://localhost:9001';
                    const imageUrl = avatarImageUrl?.startsWith('http') 
                      ? avatarImageUrl 
                      : avatarImageUrl 
                        ? `${AI_CONTENT_SERVICE_BASE_URL}${avatarImageUrl}` 
                        : null;
                    
                    const currentMode = avatarModes[avatar.id] || 'BASIC';
                    
                    return (
                      <Card
                        key={avatar.id}
                        selected={selectedAvatar === avatar.id}
                        onClick={() => {
                          setSelectedAvatar(avatar.id);
                          // Set default mode if not set
                          if (!avatarModes[avatar.id]) {
                            setAvatarModes(prev => ({ ...prev, [avatar.id]: 'BASIC' }));
                          }
                        }}
                        className="p-6 cursor-pointer text-center relative"
                      >
                        {selectedAvatar === avatar.id && (
                          <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center z-10">
                            <span className="text-secondary text-sm">✓</span>
                          </div>
                        )}
                        {imageUrl ? (
                          <img 
                            src={imageUrl} 
                            alt={avatar.name || 'Avatar'} 
                            className="w-24 h-24 mx-auto mb-2 rounded-full object-cover border-2 border-border"
                            onError={(e) => {
                              // Fallback to User icon if image fails to load
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                        ) : null}
                        {!imageUrl && <User className="w-12 h-12 mx-auto mb-2" />}
                        <p className="font-medium text-sm mb-2">{avatar.name}</p>
                        
                        {/* Basic/Premium Toggle - Only show when avatar is selected */}
                        {selectedAvatar === avatar.id && (
                          <div className="mt-2 flex gap-2 justify-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setAvatarModes(prev => ({ ...prev, [avatar.id]: 'BASIC' }));
                              }}
                              className={cn(
                                'px-3 py-1 text-xs rounded-full font-medium transition-colors',
                                currentMode === 'BASIC'
                                  ? 'bg-primary text-secondary'
                                  : 'bg-secondary border border-border text-text-primary hover:bg-border hover:text-text-secondary'
                              )}
                            >
                              Basic
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setAvatarModes(prev => ({ ...prev, [avatar.id]: 'PREMIUM' }));
                              }}
                              className={cn(
                                'px-3 py-1 text-xs rounded-full font-medium transition-colors',
                                currentMode === 'PREMIUM'
                                  ? 'bg-primary text-secondary'
                                  : 'bg-secondary border border-border text-text-primary hover:bg-border hover:text-text-secondary'
                              )}
                            >
                              Premium
                            </button>
                          </div>
                        )}
                        
                        {avatar.generationStatus && avatar.generationStatus !== 'COMPLETED' && (
                          <span className="text-xs text-text-muted mt-1 block">
                            {avatar.generationStatus === 'PENDING' && 'Pending...'}
                            {avatar.generationStatus === 'PROCESSING' && 'Processing...'}
                          </span>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="max-w-md mx-auto">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Card className={cn(
                "p-12 text-center border-2",
                uploadSuccess ? "border-green-300 bg-green-50" : "border-dashed"
              )}>
                {uploading ? (
                  <>
                    <Loader2 className="w-16 h-16 mx-auto mb-4 animate-spin text-primary" />
                    <h3 className={cn(typography.heading.h4, "mb-2")}>Uploading...</h3>
                    <p className={cn(typography.body.small, "mb-6 text-text-secondary")}>
                      Uploading your image to HeyGen. Please wait.
                    </p>
                  </>
                ) : uploadSuccess && avatarCreationStarted ? (
                  <>
                    <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600" />
                    <h3 className={cn(typography.heading.h4, "mb-2")}>Upload Successful!</h3>
                    <p className={cn(typography.body.small, "mb-6 text-text-secondary")}>
                      Your image has been uploaded and avatar generation has started. 
                      You can proceed to the next step. The avatar will be ready in a few minutes.
                    </p>
                    {imagePreview && (
                      <div className="mb-4 flex justify-center">
                        <div className="relative w-64 h-64 rounded-lg overflow-hidden border-2 border-green-300">
                          <img
                            src={imagePreview}
                            alt="Uploaded preview"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </div>
                    )}
                    
                    {/* Basic/Premium Selection for Upload */}
                    <div className="mb-4">
                      <p className="text-sm font-medium mb-2 text-center">Select Avatar Mode:</p>
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => setUploadMode('BASIC')}
                          className={cn(
                            'px-4 py-2 text-sm rounded-full font-medium transition-colors',
                            uploadMode === 'BASIC'
                              ? 'bg-primary text-secondary'
                              : 'bg-secondary border border-border text-text-primary hover:bg-border hover:text-text-secondary'
                          )}
                        >
                          Basic
                        </button>
                        <button
                          onClick={() => setUploadMode('PREMIUM')}
                          className={cn(
                            'px-4 py-2 text-sm rounded-full font-medium transition-colors',
                            uploadMode === 'PREMIUM'
                              ? 'bg-primary text-secondary'
                              : 'bg-secondary border border-border text-text-primary hover:bg-border hover:text-text-secondary'
                          )}
                        >
                          Premium
                        </button>
                      </div>
                    </div>
                    
                    <div className="mb-4 p-3 bg-green-100 rounded-lg">
                      <p className="text-sm text-green-800">
                        ✓ Image uploaded to HeyGen<br/>
                        ✓ Avatar generation started in background
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="w-16 h-16 mx-auto mb-4 text-text-muted" />
                    <h3 className={cn(typography.heading.h4, "mb-2")}>Upload your photo</h3>
                    <p className={cn(typography.body.small, "mb-6 text-text-secondary")}>
                      Upload a clear photo of yourself to create a custom avatar using HeyGen.
                      Supported formats: JPEG, PNG (Max 10MB)
                    </p>
                    <Button variant="primary" onClick={handleBrowseClick} disabled={uploading}>
                      {uploading ? 'Uploading...' : 'Browse'}
                    </Button>
                  </>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>

      <ProgressBar
        progress={selectedAvatar || (activeTab === 'upload' && uploadSuccess && avatarCreationStarted) ? 20 : 0}
        message={
          activeTab === 'upload' && uploading 
            ? "Uploading your image..." 
            : activeTab === 'upload' && uploadSuccess && avatarCreationStarted
            ? "Image uploaded! Avatar generation started in background. You can proceed."
            : selectedAvatar || activeTab === 'upload'
            ? "Your star-cast is ready!"
            : "Let's go, your journey begins here..."
        }
        onNext={handleNext}
      />
    </div>
  );
}

export default function AvatarPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <AvatarPageContent />
    </Suspense>
  );
}

