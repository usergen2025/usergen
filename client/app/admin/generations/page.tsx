'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Search, 
  Video,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins
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

export default function AdminGenerationsPage() {
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
      });

      if (response.success && response.data) {
        setProjects(response.data.projects);
        setTotalPages(response.data.pagination.totalPages);
        setTotalProjects(response.data.pagination.total);
      }
    } catch (error: any) {
      console.error('Failed to fetch projects:', error);
      showToast(error.message || 'Failed to fetch projects', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, selectedStatus, searchQuery, showToast]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedStatus]);

  const fetchProjectDetails = async (projectId: string) => {
    try {
      const [projectResponse, costResponse] = await Promise.all([
        apiClient.getAdminProjectById(projectId),
        apiClient.getProjectCostBreakdown(projectId).catch(() => ({ success: false, data: null })),
      ]);

      if (projectResponse.success && projectResponse.data) {
        setProjectDetails({
          ...projectResponse.data,
          costBreakdown: costResponse.data,
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

  if (isLoading && projects.length === 0) {
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

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">Generation History</h1>
        <p className="text-gray-400">View all video generations across the platform ({totalProjects} total)</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input
            type="text"
            placeholder="Search by project name or user..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
          />
        </div>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-orange-500"
        >
          <option value="all">All Status</option>
          <option value="COMPLETED">Completed</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="DRAFT">Draft</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {/* Projects List */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        {projects.length === 0 ? (
          <div className="p-8 text-center">
            <Video className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">No projects found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {projects.map((project) => (
              <div key={project.id} className="bg-gray-800">
                {/* Row */}
                <button
                  onClick={() => handleExpandProject(project.id)}
                  className="w-full p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                      <Video className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{project.title || 'Untitled Project'}</p>
                      <p className="text-sm text-gray-400 truncate">
                        User: {project.userId} • {project.videoType}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right hidden md:block">
                      <p className="text-white font-medium">₹{project.creditsSpent || 0}</p>
                      <p className="text-sm text-gray-400">{styleLabels[project.style] || project.style || 'N/A'}</p>
                    </div>
                    <span className={cn(
                      "px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap",
                      statusColors[project.status] || 'bg-gray-500/20 text-gray-400'
                    )}>
                      {project.status}
                    </span>
                    <div className="text-right hidden sm:block">
                      <p className="text-sm text-gray-400">{formatDate(project.createdAt)}</p>
                    </div>
                    {expandedProject === project.id ? (
                      <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    )}
                  </div>
                </button>

                {/* Expanded Details */}
                {expandedProject === project.id && (
                  <div className="px-4 pb-4 bg-gray-900/50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Cost Breakdown */}
                      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                        <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                          <Coins className="w-4 h-4 text-orange-500" />
                          Cost Breakdown
                        </h4>
                        {projectDetails?.costBreakdown?.operations?.length > 0 ? (
                          <div className="space-y-2">
                            {projectDetails.costBreakdown.operations.map((op: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">{op.operationType?.replace(/_/g, ' ') || op.operationName}</span>
                                <span className="text-white">₹{op.creditCost || 0}</span>
                              </div>
                            ))}
                            <div className="border-t border-gray-700 pt-2 mt-2 flex items-center justify-between font-medium">
                              <span className="text-gray-300">Total</span>
                              <span className="text-orange-400">₹{projectDetails.costBreakdown.totalCost || project.creditsSpent || 0}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-gray-500 text-sm">No cost data available</p>
                        )}
                      </div>

                      {/* Details */}
                      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                        <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                          <Clock className="w-4 h-4 text-orange-500" />
                          Details
                        </h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400">Project ID</span>
                            <span className="text-white font-mono text-xs">{project.id}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400">User ID</span>
                            <span className="text-white font-mono text-xs">{project.userId}</span>
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
                                <Eye className="w-4 h-4" />
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

        {/* Pagination */}
        {projects.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between">
            <p className="text-sm text-gray-400">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, totalProjects)} of {totalProjects} projects
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-gray-400">
                Page {currentPage} of {totalPages || 1}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
