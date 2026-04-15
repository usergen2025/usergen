'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  ArrowLeft, 
  Wallet, 
  ChevronDown, 
  ChevronUp, 
  Video,
  Image,
  Mic,
  Play,
  RefreshCw,
  FileText
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import CreditDisplay from '@/components/billing/CreditDisplay';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';

interface ProjectCost {
  projectId: string;
  totalCost: number;
  operations: number;
  firstOperation: string;
  lastOperation: string;
  projectName?: string;
}

interface BillingSummary {
  userId: string;
  currentBalance: number;
  totalSpent: number;
  projectCount: number;
  operationCount: number;
  projects: ProjectCost[];
  byOperationType: Record<string, { count: number; totalCost: number }>;
}

interface VideoProject {
  id: string;
  name?: string;
  title?: string;
  status?: string;
  step?: string;
  scenes?: any[];
  createdAt?: string;
  updatedAt?: string;
}

interface MergedProject {
  projectId: string;
  projectName: string;
  status: string;
  sceneCount: number;
  totalCost: number | null;
  operations: number | null;
  lastActivity: string;
  hasBillingData: boolean;
}

interface CostBreakdown {
  projectId: string;
  totalCost: number;
  operationCount: number;
  byOperationType: Record<string, { count: number; totalCost: number }>;
  byScene: Record<number, { operations: any[]; totalCost: number }>;
  snapshots: Array<{
    id: string;
    sceneNumber: number | null;
    operationType: string;
    operationName: string;
    creditCost: number;
    createdAt: string;
    metadata: any;
  }>;
}

const operationIcons: Record<string, React.ReactNode> = {
  'IMAGE_GENERATION': <Image className="w-4 h-4 text-blue-500" />,
  'VIDEO_GENERATION': <Video className="w-4 h-4 text-purple-500" />,
  'AUDIO_GENERATION': <Mic className="w-4 h-4 text-green-500" />,
  'AVATAR_VIDEO': <Play className="w-4 h-4 text-orange-500" />,
  'SCRIPT_GENERATION': <RefreshCw className="w-4 h-4 text-gray-500" />,
  'SCENE_REGENERATION': <RefreshCw className="w-4 h-4 text-yellow-500" />,
  'STOCK_FOOTAGE': <Video className="w-4 h-4 text-cyan-500" />,
  'FINAL_RENDER': <Play className="w-4 h-4 text-red-500" />,
};

// Skeleton Components
function SkeletonPulse({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse bg-gray-200 rounded", className)} />
  );
}

function CreditDisplaySkeleton() {
  return (
    <div className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-orange-100 to-pink-100 border border-orange-200">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-white/50 animate-pulse" />
        <div>
          <SkeletonPulse className="h-4 w-24 mb-2" />
          <SkeletonPulse className="h-8 w-20" />
        </div>
      </div>
      <SkeletonPulse className="h-10 w-32 rounded-[26px]" />
    </div>
  );
}

function StatsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <SkeletonPulse className="w-10 h-10 rounded-full" />
            <SkeletonPulse className="h-4 w-24" />
          </div>
          <SkeletonPulse className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

function OperationTypeSkeleton() {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm mb-8">
      <SkeletonPulse className="h-6 w-48 mb-4" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <SkeletonPulse className="w-4 h-4 rounded" />
            <div>
              <SkeletonPulse className="h-3 w-20 mb-1" />
              <SkeletonPulse className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectListSkeleton() {
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="p-6 border-b border-gray-100">
        <SkeletonPulse className="h-6 w-36" />
      </div>
      <div className="divide-y divide-gray-100">
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <SkeletonPulse className="w-10 h-10 rounded-full" />
              <div>
                <SkeletonPulse className="h-5 w-40 mb-2" />
                <SkeletonPulse className="h-4 w-32" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <SkeletonPulse className="h-5 w-16" />
              <SkeletonPulse className="w-5 h-5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BillingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, user, isLoading: authLoading } = useAuth();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [videoProjects, setVideoProjects] = useState<VideoProject[]>([]);
  const [mergedProjects, setMergedProjects] = useState<MergedProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [projectBreakdowns, setProjectBreakdowns] = useState<Record<string, CostBreakdown>>({});
  const [loadingBreakdown, setLoadingBreakdown] = useState<string | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?redirect=/billing');
    }
  }, [isAuthenticated, authLoading, router]);

  // Fetch billing summary and video projects
  useEffect(() => {
    const fetchData = async () => {
      if (!user?.id) return;

      setIsLoading(true);
      
      try {
        // Fetch both billing summary and video projects in parallel
        const [billingSummaryResponse, videoProjectsResponse] = await Promise.all([
          apiClient.getUserBillingSummary(user.id).catch(() => ({ success: false, data: null })),
          apiClient.getVideoProjects().catch(() => ({ success: false, data: [] }))
        ]);

        // Set billing summary
        if (billingSummaryResponse.success && billingSummaryResponse.data) {
          setSummary(billingSummaryResponse.data);
        } else {
          setSummary({
            userId: user.id,
            currentBalance: user.credits ?? 100,
            totalSpent: 0,
            projectCount: 0,
            operationCount: 0,
            projects: [],
            byOperationType: {},
          });
        }

        // Set video projects
        if (videoProjectsResponse.success && videoProjectsResponse.data) {
          setVideoProjects(videoProjectsResponse.data);
        }
      } catch (error) {
        console.error('Failed to fetch billing data:', error);
        setSummary({
          userId: user.id,
          currentBalance: user.credits ?? 100,
          totalSpent: 0,
          projectCount: 0,
          operationCount: 0,
          projects: [],
          byOperationType: {},
        });
      } finally {
        setIsLoading(false);
      }
    };

    if (isAuthenticated && user?.id) {
      fetchData();
    }
  }, [isAuthenticated, user?.id, user?.credits]);

  // Merge video projects with billing data
  useEffect(() => {
    if (!videoProjects.length && !summary?.projects?.length) {
      setMergedProjects([]);
      return;
    }

    const billingProjectMap = new Map<string, ProjectCost>();
    summary?.projects?.forEach(p => billingProjectMap.set(p.projectId, p));

    const merged: MergedProject[] = [];
    const processedIds = new Set<string>();

    // First, add all video projects
    videoProjects.forEach(vp => {
      const billingData = billingProjectMap.get(vp.id);
      processedIds.add(vp.id);

      merged.push({
        projectId: vp.id,
        projectName: vp.name || vp.title || `Project ${vp.id.slice(0, 8)}...`,
        status: vp.status || vp.step || 'unknown',
        sceneCount: vp.scenes?.length || 0,
        totalCost: billingData?.totalCost ?? null,
        operations: billingData?.operations ?? null,
        lastActivity: vp.updatedAt || vp.createdAt || new Date().toISOString(),
        hasBillingData: !!billingData,
      });
    });

    // Add any billing projects not in video projects (edge case)
    summary?.projects?.forEach(bp => {
      if (!processedIds.has(bp.projectId)) {
        merged.push({
          projectId: bp.projectId,
          projectName: bp.projectName || `Project ${bp.projectId.slice(0, 8)}...`,
          status: 'completed',
          sceneCount: 0,
          totalCost: bp.totalCost,
          operations: bp.operations,
          lastActivity: bp.lastOperation,
          hasBillingData: true,
        });
      }
    });

    // Sort by last activity (most recent first)
    merged.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

    setMergedProjects(merged);
  }, [videoProjects, summary]);

  const fetchProjectBreakdown = async (projectId: string) => {
    if (projectBreakdowns[projectId]) return;

    setLoadingBreakdown(projectId);
    try {
      const response = await apiClient.getProjectCostBreakdown(projectId);
      if (response.success && response.data) {
        setProjectBreakdowns(prev => ({
          ...prev,
          [projectId]: response.data,
        }));
      }
    } catch (error) {
      console.error('Failed to fetch project breakdown:', error);
    } finally {
      setLoadingBreakdown(null);
    }
  };

  const handleToggleProject = async (projectId: string, hasBillingData: boolean) => {
    if (expandedProject === projectId) {
      setExpandedProject(null);
    } else {
      setExpandedProject(projectId);
      if (hasBillingData) {
        await fetchProjectBreakdown(projectId);
      }
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, string> = {
      'completed': 'bg-green-100 text-green-700',
      'rendering': 'bg-blue-100 text-blue-700',
      'workspace': 'bg-yellow-100 text-yellow-700',
      'script': 'bg-purple-100 text-purple-700',
      'draft': 'bg-gray-100 text-gray-700',
    };
    return statusColors[status.toLowerCase()] || 'bg-gray-100 text-gray-700';
  };

  // Show skeleton while auth is loading
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FFF5F0] to-[#FFF0F5]">
        <div className="max-w-6xl mx-auto px-4 pt-8 md:pt-12">
          <div className="flex flex-row items-center gap-4 mb-8">
            <SkeletonPulse className="w-6 h-6" />
            <SkeletonPulse className="h-8 w-24" />
          </div>
          <div className="mb-8">
            <CreditDisplaySkeleton />
          </div>
          <StatsGridSkeleton />
          <OperationTypeSkeleton />
          <ProjectListSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFF5F0] to-[#FFF0F5]">
      <div className="max-w-6xl mx-auto px-4 pt-8 md:pt-12">
        {/* Workspace-style Header */}
        <div className="flex flex-row items-center gap-4 mb-8">
          <button
            onClick={() => router.back()}
            className="flex items-center justify-center w-6 h-6 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <ArrowLeft className="w-full h-full text-[#212121]" strokeWidth={1.5} />
          </button>
          <h2 className="font-heading text-2xl font-medium text-[#212121]">Billing</h2>
        </div>

        {/* Show skeleton or content based on loading state */}
        {isLoading ? (
          <>
            <div className="mb-8">
              <CreditDisplaySkeleton />
            </div>
            <StatsGridSkeleton />
            <OperationTypeSkeleton />
            <ProjectListSkeleton />
          </>
        ) : (
          <>
            {/* Credits Overview Card */}
            <div className="mb-8">
              <CreditDisplay variant="full" />
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                    <Video className="w-5 h-5 text-purple-600" />
                  </div>
                  <p className="text-sm text-gray-500">Total Projects</p>
                </div>
                <p className="text-3xl font-bold text-gray-800">
                  {mergedProjects.length || summary?.projectCount || 0}
                </p>
              </div>
              
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <RefreshCw className="w-5 h-5 text-green-600" />
                  </div>
                  <p className="text-sm text-gray-500">Total Operations</p>
                </div>
                <p className="text-3xl font-bold text-gray-800">
                  {summary?.operationCount ?? 0}
                </p>
              </div>
              
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                    <Wallet className="w-5 h-5 text-orange-600" />
                  </div>
                  <p className="text-sm text-gray-500">Total Spent</p>
                </div>
                <p className="text-3xl font-bold text-gray-800">
                  {summary?.totalSpent ? `₹${summary.totalSpent}` : 'N/A'}
                </p>
              </div>
            </div>

            {/* Operation Type Breakdown */}
            {summary?.byOperationType && Object.keys(summary.byOperationType).length > 0 && (
              <div className="bg-white rounded-2xl p-6 shadow-sm mb-8">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Usage by Operation Type</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(summary.byOperationType).map(([type, data]) => (
                    <div
                      key={type}
                      className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl"
                    >
                      {operationIcons[type] || <RefreshCw className="w-4 h-4 text-gray-400" />}
                      <div>
                        <p className="text-xs text-gray-500">{type.replace(/_/g, ' ')}</p>
                        <p className="text-sm font-medium text-gray-800">
                          {data.count} × ₹{Math.round(data.totalCost / data.count)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Projects List */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-800">Project History</h2>
              </div>

              {mergedProjects.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {mergedProjects.map((project) => (
                    <div key={project.projectId} className="bg-white">
                      {/* Project Row */}
                      <button
                        onClick={() => handleToggleProject(project.projectId, project.hasBillingData)}
                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-100 to-pink-100 flex items-center justify-center">
                            <Video className="w-5 h-5 text-orange-500" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-800">{project.projectName}</p>
                              <span className={cn("text-xs px-2 py-0.5 rounded-full capitalize", getStatusBadge(project.status))}>
                                {project.status}
                              </span>
                            </div>
                            <p className="text-sm text-gray-500">
                              {project.sceneCount > 0 ? `${project.sceneCount} scenes` : 'No scenes'} • {formatDate(project.lastActivity)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-semibold text-gray-800">
                            {project.totalCost !== null ? `₹${project.totalCost}` : 'N/A'}
                          </span>
                          {project.hasBillingData && (
                            expandedProject === project.projectId ? (
                              <ChevronUp className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            )
                          )}
                        </div>
                      </button>

                      {/* Expanded Details */}
                      {expandedProject === project.projectId && project.hasBillingData && (
                        <div className="px-6 pb-6 bg-gray-50">
                          {loadingBreakdown === project.projectId ? (
                            <div className="flex items-center justify-center py-8">
                              <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                            </div>
                          ) : projectBreakdowns[project.projectId] ? (
                            <div className="space-y-4">
                              {/* Scene-by-Scene Breakdown */}
                              {Object.entries(projectBreakdowns[project.projectId].byScene).map(
                                ([sceneNum, sceneData]) => (
                                  <div
                                    key={sceneNum}
                                    className="bg-white rounded-xl p-4 border border-gray-200"
                                  >
                                    <div className="flex items-center justify-between mb-3">
                                      <span className="font-medium text-gray-700">
                                        {sceneNum === '0' ? 'General' : `Scene ${sceneNum}`}
                                      </span>
                                      <span className="text-sm font-semibold text-orange-600">
                                        ₹{sceneData.totalCost}
                                      </span>
                                    </div>
                                    <div className="space-y-2">
                                      {sceneData.operations.map((op, idx) => (
                                        <div
                                          key={idx}
                                          className="flex items-center justify-between text-sm"
                                        >
                                          <div className="flex items-center gap-2">
                                            {operationIcons[op.operationType] || (
                                              <RefreshCw className="w-3 h-3 text-gray-400" />
                                            )}
                                            <span className="text-gray-600">{op.operationName}</span>
                                          </div>
                                          <span className="text-gray-500">₹{op.creditCost}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          ) : (
                            <p className="text-center text-gray-500 py-4">
                              No detailed breakdown available
                            </p>
                          )}
                        </div>
                      )}

                      {/* Message for projects without billing data */}
                      {expandedProject === project.projectId && !project.hasBillingData && (
                        <div className="px-6 pb-6 bg-gray-50">
                          <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                            <FileText className="w-5 h-5 text-yellow-600" />
                            <p className="text-sm text-yellow-800">
                              Cost tracking was not enabled for this project. Detailed billing data is not available.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-6 py-12 text-center">
                  <Video className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-700 mb-2">No projects yet</h3>
                  <p className="text-gray-500 mb-4">
                    Start creating videos to see your billing history here
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => router.push('/create-video/ai-chat')}
                  >
                    Create Your First Video
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-[#FFF5F0] to-[#FFF0F5]">
        <div className="max-w-6xl mx-auto px-4 pt-8 md:pt-12">
          <div className="flex flex-row items-center gap-4 mb-8">
            <div className="w-6 h-6 animate-pulse bg-gray-200 rounded" />
            <div className="h-8 w-24 animate-pulse bg-gray-200 rounded" />
          </div>
          <div className="mb-8">
            <div className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-orange-100 to-pink-100 border border-orange-200">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white/50 animate-pulse" />
                <div>
                  <div className="h-4 w-24 mb-2 animate-pulse bg-gray-200 rounded" />
                  <div className="h-8 w-20 animate-pulse bg-gray-200 rounded" />
                </div>
              </div>
              <div className="h-10 w-32 rounded-[26px] animate-pulse bg-gray-200" />
            </div>
          </div>
        </div>
      </div>
    }>
      <BillingContent />
    </Suspense>
  );
}
