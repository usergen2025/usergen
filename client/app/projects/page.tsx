'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Play, Clock, CheckCircle, XCircle, Loader2, Edit } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { typography } from '@/lib/config/theme';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';
import { useAuth } from '@/hooks/useAuth';

interface VideoProject {
  id: string;
  title?: string;
  description?: string;
  videoType: string;
  style?: string;
  avatarId?: string;
  status: string;
  currentStep: string;
  progress: number;
  progressStage?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export default function ProjectsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'draft' | 'in-progress' | 'completed'>('all');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?redirect=/projects');
      return;
    }

    if (isAuthenticated) {
      loadProjects();
    }
  }, [isAuthenticated, authLoading, router]);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const response = await apiClient.getVideoProjects();
      if (response.success && response.data) {
        setProjects(response.data);
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to load projects', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'IN_PROGRESS':
        return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />;
      case 'FAILED':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'DRAFT':
        return <Clock className="w-5 h-5 text-gray-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'Completed';
      case 'IN_PROGRESS':
        return 'In Progress';
      case 'FAILED':
        return 'Failed';
      case 'DRAFT':
        return 'Draft';
      default:
        return status;
    }
  };

  // Helper function to get full video URL
  const getVideoUrl = (videoUrl: string | undefined): string | undefined => {
    if (!videoUrl) return undefined;
    
    // If already a full URL (starts with http), return as-is
    if (videoUrl.startsWith('http')) {
      return videoUrl;
    }
    
    // Otherwise, construct full URL using video-processing-service
    // Static files are served at /uploads/* (not /api/uploads/*)
    // Use NEXT_PUBLIC_WS_URL which is already set to the base domain (e.g., https://api.dev.usergen.ai)
    const VIDEO_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:9004';
    return `${VIDEO_SERVICE_BASE_URL}${videoUrl}`;
  };

  const getStepText = (step: string) => {
    const stepMap: Record<string, string> = {
      STYLE_SELECTION: 'Style Selection',
      VIDEO_TYPE: 'Video Type',
      AVATAR_SELECTION: 'Avatar Selection',
      SCRIPT: 'Script',
      VOICE: 'Voice',
      B_ROLL: 'B-Roll',
      CAPTIONS: 'Captions',
      RENDERING: 'Rendering',
      COMPLETED: 'Completed',
    };
    return stepMap[step] || step;
  };

  const handleContinue = (project: VideoProject) => {
    // Determine the route based on current step
    const stepRoutes: Record<string, string> = {
      STYLE_SELECTION: '/create-video/style',
      VIDEO_TYPE: '/create-video',
      AVATAR_SELECTION: '/create-video/avatar',
      SCRIPT: '/create-video/script',
      VOICE: '/create-video/voice',
      B_ROLL: '/create-video/b-roll',
      CAPTIONS: '/create-video/style',
      RENDERING: '/create-video/rendering',
      COMPLETED: '/create-video/rendering',
    };

    const route = stepRoutes[project.currentStep] || '/create-video';
    router.push(`${route}?projectId=${project.id}`);
  };

  const handleDelete = async (projectId: string) => {
    if (!confirm('Are you sure you want to delete this project?')) {
      return;
    }

    try {
      await apiClient.deleteVideoProject(projectId);
      showToast('Project deleted successfully', 'success');
      loadProjects();
    } catch (error: any) {
      showToast(error.message || 'Failed to delete project', 'error');
    }
  };

  const filteredProjects = projects.filter((project) => {
    if (filter === 'all') return true;
    if (filter === 'draft') return project.status === 'DRAFT';
    if (filter === 'in-progress') return project.status === 'IN_PROGRESS';
    if (filter === 'completed') return project.status === 'COMPLETED';
    return true;
  });

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="flex items-center gap-2 text-text-primary hover:text-text-secondary transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Back</span>
              </button>
              <h1 className={cn(typography.heading.h1)}>My Projects</h1>
            </div>
            <Link href="/create-video">
              <Button variant="primary">
                <Plus className="w-4 h-4 mr-2" />
                Create New Project
              </Button>
            </Link>
          </div>

          {/* Filters */}
          <div className="mb-6 flex gap-2">
            {(['all', 'draft', 'in-progress', 'completed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-4 py-2 rounded-lg transition-colors',
                  filter === f
                    ? 'bg-primary text-white'
                    : 'bg-secondary text-text-primary hover:bg-primary-light'
                )}
              >
                {f.charAt(0).toUpperCase() + f.slice(1).replace('-', ' ')}
              </button>
            ))}
          </div>

          {/* Projects Grid */}
          {filteredProjects.length === 0 ? (
            <Card className="p-12 text-center">
              <p className={cn(typography.body.large, "text-text-secondary mb-4")}>
                {filter === 'all'
                  ? 'No projects yet. Create your first video project!'
                  : `No ${filter} projects found.`}
              </p>
              <Link href="/create-video">
                <Button variant="primary">
                  <Plus className="w-4 h-4 mr-2" />
                  Create New Project
                </Button>
              </Link>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProjects.map((project) => (
                <Card key={project.id} className="p-6 hover:shadow-lg transition-shadow">
                  {/* Thumbnail/Video Preview */}
                  {project.status === 'COMPLETED' && project.videoUrl ? (
                    <div className="mb-4 w-full h-48 rounded-lg overflow-hidden bg-gray-200 relative group">
                      <video
                        src={getVideoUrl(project.videoUrl) || ''}
                        className="w-full h-full object-cover"
                        controls={false}
                        muted
                        loop
                        playsInline
                        onMouseEnter={(e) => e.currentTarget.play()}
                        onMouseLeave={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                        <button
                          onClick={() => {
                            const fullVideoUrl = getVideoUrl(project.videoUrl);
                            if (fullVideoUrl) {
                              window.open(fullVideoUrl, '_blank');
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-3 rounded-full bg-background/90 hover:bg-background"
                        >
                          <Play className="w-6 h-6 text-primary" fill="currentColor" />
                        </button>
                      </div>
                    </div>
                  ) : project.thumbnailUrl ? (
                    <div className="mb-4 w-full h-48 rounded-lg overflow-hidden bg-gray-200">
                      <img
                        src={project.thumbnailUrl}
                        alt={project.title || 'Project thumbnail'}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="mb-4 w-full h-48 rounded-lg bg-gray-200 flex items-center justify-center">
                      <Play className="w-12 h-12 text-gray-400" />
                    </div>
                  )}

                  {/* Project Info */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      {getStatusIcon(project.status)}
                      <span className={cn(typography.heading.h4)}>
                        {project.title || `Project ${project.id.slice(0, 8)}`}
                      </span>
                    </div>
                    <p className={cn(typography.body.small, "text-text-secondary mb-2")}>
                      {project.description || 'No description'}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-text-secondary">
                      <span>Status: {getStatusText(project.status)}</span>
                      {project.status === 'IN_PROGRESS' && (
                        <span>Step: {getStepText(project.currentStep)}</span>
                      )}
                    </div>
                    {project.progress > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-text-secondary">Progress</span>
                          <span className="text-text-secondary">{project.progress}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full transition-all"
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {project.status === 'COMPLETED' && project.videoUrl ? (
                      <Button
                        variant="primary"
                        onClick={() => {
                          const fullVideoUrl = getVideoUrl(project.videoUrl);
                          if (fullVideoUrl) {
                            window.open(fullVideoUrl, '_blank');
                          }
                        }}
                        className="flex-1"
                      >
                        <Play className="w-4 h-4 mr-2" />
                        View
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={() => handleContinue(project)}
                        className="flex-1"
                      >
                        <Edit className="w-4 h-4 mr-2" />
                        Continue
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => handleDelete(project.id)}
                    >
                      Delete
                    </Button>
                  </div>

                  {/* Timestamp */}
                  <p className={cn(typography.body.small, "text-text-muted mt-4 text-center")}>
                    {project.status === 'COMPLETED' && project.completedAt
                      ? `Completed ${new Date(project.completedAt).toLocaleDateString()}`
                      : `Updated ${new Date(project.updatedAt).toLocaleDateString()}`}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

