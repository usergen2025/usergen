'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Search,
  Video,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  ExternalLink,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { apiClient } from '@/lib/api/client';
import { useToast } from '@/lib/toast/toast';

interface Project {
  id: string;
  userId: string;
  title: string;
  videoType: string;
  style: string;
  status: string;
  currentStep: string;
  creditsSpent: number;
  progress: number;
  createdAt: string;
  completedAt?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
}

const statusColors: Record<string, string> = {
  COMPLETED: 'bg-green-500/20 text-green-400',
  IN_PROGRESS: 'bg-yellow-500/20 text-yellow-400',
  DRAFT: 'bg-blue-500/20 text-blue-400',
  FAILED: 'bg-red-500/20 text-red-400',
};

const styleLabels: Record<string, string> = {
  'HALF_N_HALF': 'Half & Half',
  'half-n-half': 'Half & Half',
  'AVATAR_PRODUCT': 'Avatar + Product',
  'PRODUCT_ONLY': 'Product Only',
  'AVATAR_CUTOUT': 'Avatar Cutout',
  'avatar-cutout': 'Avatar Cutout',
  'ALTERNATE': 'Alternate',
  'alternate': 'Alternate',
};

function GenerationsLoadingSkeleton() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="h-8 w-48 bg-gray-700 rounded animate-pulse mb-2"></div>
        <div className="h-4 w-64 bg-gray-700 rounded animate-pulse"></div>
      </div>
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="p-4 border-b border-gray-700 animate-pulse">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-gray-700"></div>
              <div className="flex-1">
                <div className="h-4 w-48 bg-gray-700 rounded mb-2"></div>
                <div className="h-3 w-32 bg-gray-700 rounded"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminGenerationsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const filterUserId = searchParams?.get('userId') ?? '';

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProjects, setTotalProjects] = useState(0);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [projectDetails, setProjectDetails] = useState<any>(null);
  const { showToast } = useToast();

  const itemsPerPage = 20;

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.getAdminProjects({
        page: currentPage,
        limit: itemsPerPage,
        status: selectedStatus !== 'all' ? selectedStatus : undefined,
        search: searchQuery || undefined,
        userId: filterUserId || undefined,
      });

      if (response.success && response.data) {
        let list = response.data.projects as Project[];
        const ids = [...new Set(list.map((p) => p.userId))];
        if (ids.length > 0) {
          const batch = await apiClient.getAdminUsersByIds(ids);
          if (batch.success && batch.data?.length) {
            const map = new Map(batch.data.map((u) => [u.id, u]));
            list = list.map((p) => ({
              ...p,
              ownerName: map.get(p.userId)?.name ?? null,
              ownerEmail: map.get(p.userId)?.email ?? null,
            }));
          }
        }
        setProjects(list);
        setTotalPages(response.data.pagination.totalPages);
        setTotalProjects(response.data.pagination.total);
      }
    } catch (error: any) {
      console.error('Failed to fetch projects:', error);
      showToast(error.message || 'Failed to fetch projects', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, selectedStatus, searchQuery, filterUserId, showToast]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedStatus, filterUserId]);

  const fetchProjectDetails = async (projectId: string) => {
    try {
      const [projectResponse, costResponse] = await Promise.all([
        apiClient.getAdminProjectById(projectId),
        apiClient.getProjectCostBreakdown(projectId).catch(() => ({ success: false, data: null })),
      ]);

      if (projectResponse.success && projectResponse.data) {
        const rawBreakdown = costResponse.data || null;
        const operations =
          rawBreakdown?.operations ||
          rawBreakdown?.snapshots ||
          (rawBreakdown?.byScene
            ? Object.values(rawBreakdown.byScene).flatMap((scene: any) => scene?.operations || [])
            : []);
        setProjectDetails({
          ...projectResponse.data,
          costBreakdown: rawBreakdown
            ? {
                ...rawBreakdown,
                operations,
              }
            : null,
        });
      }
    } catch (error: any) {
      console.error('Failed to fetch project details:', error);
    }
  };

  const handleExpandProject = (projectId: string) => {
    if (expandedProject === projectId) {
      setExpandedProject(null);
      setProjectDetails(null);
    } else {
      setExpandedProject(projectId);
      fetchProjectDetails(projectId);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const userSubtitle = (project: Project) => {
    if (project.ownerName || project.ownerEmail) {
      const name = project.ownerName || 'Unknown';
      const email = project.ownerEmail || '';
      return `${name}${email ? ` · ${email}` : ''} · ${project.videoType}`;
    }
    return `${project.userId} · ${project.videoType}`;
  };

  if (isLoading && projects.length === 0) {
    return <GenerationsLoadingSkeleton />;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">Generation History</h1>
        <p className="text-gray-400">View all video generations across the platform ({totalProjects} total)</p>
      </div>

      {filterUserId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3">
          <p className="text-sm text-gray-300">
            Filtered by user{' '}
            <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-orange-300">{filterUserId}</code>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/admin/users?userId=${encodeURIComponent(filterUserId)}`}
              className="inline-flex items-center gap-1 text-sm text-orange-400 hover:text-orange-300"
            >
              User in directory
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => router.push('/admin/generations')}
              className="inline-flex items-center gap-1 rounded-lg bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600"
            >
              <X className="h-4 w-4" />
              Clear filter
            </button>
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search by project name or user..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-10 pr-4 text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
          />
        </div>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white focus:border-orange-500 focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="COMPLETED">Completed</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="DRAFT">Draft</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800">
        {projects.length === 0 ? (
          <div className="p-8 text-center">
            <Video className="mx-auto mb-4 h-12 w-12 text-gray-600" />
            <p className="text-gray-400">No projects found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {projects.map((project) => (
              <div key={project.id} className="bg-gray-800">
                <button
                  onClick={() => handleExpandProject(project.id)}
                  className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-gray-700/50"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-500">
                      <Video className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-white">{project.title || 'Untitled Project'}</p>
                      <p className="truncate text-sm text-gray-400">{userSubtitle(project)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="hidden text-right md:block">
                      <p className="font-medium text-white">₹{project.creditsSpent || 0}</p>
                      <p className="text-sm text-gray-400">{styleLabels[project.style] || project.style || 'N/A'}</p>
                    </div>
                    <span
                      className={cn(
                        'whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium',
                        statusColors[project.status] || 'bg-gray-500/20 text-gray-400'
                      )}
                    >
                      {project.status}
                    </span>
                    <div className="hidden text-right sm:block">
                      <p className="text-sm text-gray-400">{formatDate(project.createdAt)}</p>
                    </div>
                    {expandedProject === project.id ? (
                      <ChevronUp className="h-5 w-5 flex-shrink-0 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 flex-shrink-0 text-gray-400" />
                    )}
                  </div>
                </button>

                {expandedProject === project.id && (
                  <div className="bg-gray-900/50 px-4 pb-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
                        <h4 className="mb-3 flex items-center gap-2 font-medium text-white">
                          <Coins className="h-4 w-4 text-orange-500" />
                          Cost Breakdown
                        </h4>
                        {projectDetails?.costBreakdown?.operations?.length > 0 ? (
                          <div className="space-y-2">
                            {projectDetails.costBreakdown.operations.map((op: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">
                                  {op.operationType?.replace(/_/g, ' ') || op.operationName}
                                </span>
                                <span className="text-white">₹{op.creditCost || 0}</span>
                              </div>
                            ))}
                            <div className="mt-2 flex items-center justify-between border-t border-gray-700 pt-2 font-medium">
                              <span className="text-gray-300">Total</span>
                              <span className="text-orange-400">
                                ₹{projectDetails.costBreakdown.totalCost || projectDetails.costBreakdown.operations?.reduce((sum: number, op: any) => sum + (op.creditCost || 0), 0) || project.creditsSpent || 0}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">No cost data available</p>
                        )}
                      </div>

                      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
                        <h4 className="mb-3 flex items-center gap-2 font-medium text-white">
                          <Clock className="h-4 w-4 text-orange-500" />
                          Details
                        </h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-400">Project ID</span>
                            <span className="break-all font-mono text-xs text-white">{project.id}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-400">User</span>
                            <div className="text-right">
                              {(project.ownerName || project.ownerEmail) && (
                                <p className="text-white">
                                  {project.ownerName || '—'}{' '}
                                  {project.ownerEmail && (
                                    <span className="text-gray-400">({project.ownerEmail})</span>
                                  )}
                                </p>
                              )}
                              <p className="font-mono text-xs text-gray-500">{project.userId}</p>
                              <Link
                                href={`/admin/users?userId=${encodeURIComponent(project.userId)}`}
                                className="mt-1 inline-flex items-center gap-1 text-orange-400 hover:text-orange-300"
                              >
                                Open in Users
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400">Video Type</span>
                            <span className="text-white">{project.videoType}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400">Video Style</span>
                            <span className="text-white">{styleLabels[project.style] || project.style || 'N/A'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400">Current Step</span>
                            <span className="text-white">{project.currentStep}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400">Progress</span>
                            <span className="text-white">{project.progress}%</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400">Created</span>
                            <span className="text-white">{formatDate(project.createdAt)}</span>
                          </div>
                          {project.completedAt && (
                            <div className="flex items-center justify-between">
                              <span className="text-gray-400">Completed</span>
                              <span className="text-white">{formatDate(project.completedAt)}</span>
                            </div>
                          )}
                          {project.videoUrl && (
                            <div className="pt-2">
                              <a
                                href={project.videoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-orange-400 hover:text-orange-300"
                              >
                                <Eye className="h-4 w-4" />
                                View Video
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {projects.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-700 px-6 py-4">
            <p className="text-sm text-gray-400">
              Showing {(currentPage - 1) * itemsPerPage + 1} to{' '}
              {Math.min(currentPage * itemsPerPage, totalProjects)} of {totalProjects} projects
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-gray-400">
                Page {currentPage} of {totalPages || 1}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminGenerationsPage() {
  return (
    <Suspense fallback={<GenerationsLoadingSkeleton />}>
      <AdminGenerationsContent />
    </Suspense>
  );
}
