'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronUp,
  Coins,
  Film,
  Layers,
  RefreshCw,
  Video,
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import {
  BrandIconChip,
  BrandPageHeader,
  BrandPrimaryButton,
  BrandStatStrip,
  type BrandStatItem,
} from '@/components/brand';
import { cn } from '@/lib/utils/cn';
import {
  BillingSummary,
  CostBreakdown,
  MergedProject,
  VideoProject,
  formatDate,
  formatOperationLabel,
  mergeProjects,
  operationIconFor,
  projectStatusPillClass,
} from '@/lib/billing/shared';

function SkeletonPulse({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-[#F0E5DC]', className)} />;
}

export default function UsagePage() {
  const router = useRouter();
  const { isAuthenticated, user, isLoading: authLoading } = useAuth();

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [videoProjects, setVideoProjects] = useState<VideoProject[]>([]);
  const [mergedProjects, setMergedProjects] = useState<MergedProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [projectBreakdowns, setProjectBreakdowns] = useState<Record<string, CostBreakdown>>({});
  const [loadingBreakdown, setLoadingBreakdown] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?redirect=/usage');
    }
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    const fetchData = async () => {
      if (!user?.id) return;
      setIsLoading(true);
      try {
        const [summaryRes, projectsRes] = await Promise.all([
          apiClient.getUserBillingSummary(user.id).catch(() => ({ success: false, data: null })),
          apiClient.getVideoProjects().catch(() => ({ success: false, data: [] })),
        ]);

        setSummary(
          summaryRes.success && summaryRes.data
            ? summaryRes.data
            : {
                userId: user.id,
                currentBalance: user.credits ?? 0,
                totalSpent: 0,
                projectCount: 0,
                operationCount: 0,
                projects: [],
                byOperationType: {},
              },
        );

        if (projectsRes.success && projectsRes.data) {
          setVideoProjects(projectsRes.data);
        }
      } catch (error) {
        console.error('Failed to fetch usage data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (isAuthenticated && user?.id) {
      void fetchData();
    }
  }, [isAuthenticated, user?.id, user?.credits]);

  useEffect(() => {
    setMergedProjects(mergeProjects(videoProjects, summary));
  }, [videoProjects, summary]);

  const fetchProjectBreakdown = useCallback(
    async (projectId: string) => {
      if (projectBreakdowns[projectId]) return;
      setLoadingBreakdown(projectId);
      try {
        const response = await apiClient.getProjectCostBreakdown(projectId);
        if (response.success && response.data) {
          setProjectBreakdowns((prev) => ({ ...prev, [projectId]: response.data }));
        }
      } catch (error) {
        console.error('Failed to fetch project breakdown:', error);
      } finally {
        setLoadingBreakdown(null);
      }
    },
    [projectBreakdowns],
  );

  const handleToggleProject = async (projectId: string, hasBillingData: boolean) => {
    if (expandedProject === projectId) {
      setExpandedProject(null);
      return;
    }
    setExpandedProject(projectId);
    if (hasBillingData) await fetchProjectBreakdown(projectId);
  };

  const statItems: BrandStatItem[] = [
    {
      value: String(mergedProjects.length || summary?.projectCount || 0),
      label: 'Projects',
      Icon: Video,
    },
    {
      value: String(summary?.operationCount ?? 0),
      label: 'Operations',
      Icon: RefreshCw,
    },
    {
      value: (summary?.totalSpent ?? 0).toLocaleString('en-IN'),
      label: 'Credits Used',
      Icon: Coins,
    },
  ];

  const operationEntries = Object.entries(summary?.byOperationType ?? {});
  const showSkeleton = isLoading || authLoading;

  return (
    <div className="brand-page-shell brand-page-shell--campaigns">
      <BrandPageHeader
        onBack={() => router.back()}
        className="mb-3 shrink-0 sm:mb-3"
        title="Usage"
        subtitle="How your credits are being consumed"
      />

      <div className="brand-gradient-frame mb-3 shrink-0 p-3 sm:mb-4 sm:p-4">
        {showSkeleton ? (
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <SkeletonPulse key={i} className="h-[3.25rem] rounded-lg" />
            ))}
          </div>
        ) : (
          <BrandStatStrip items={statItems} layout="inline" columns={3} />
        )}
      </div>

      <div className="brand-gradient-frame mb-0 flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[20px] p-3 sm:p-4">
        <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[18px] bg-white/95 shadow-sm">
          {/* Operation mix reads as the panel toolbar, mirroring the campaigns tab row */}
          <div className="shrink-0 space-y-2.5 border-b border-[#EFE8E3] p-3 sm:p-4">
            <h2 className="brand-page-section-title">By operation type</h2>
            {showSkeleton ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <SkeletonPulse key={i} className="h-[2.75rem] rounded-lg" />
                ))}
              </div>
            ) : operationEntries.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {operationEntries.map(([type, data]) => {
                  const Icon = operationIconFor(type);
                  const average = Math.round(data.totalCost / Math.max(data.count, 1));
                  return (
                    <div key={type} className="brand-stat-tile--inline">
                      <BrandIconChip size="sm">
                        <Icon className="text-white" strokeWidth={1.8} />
                      </BrandIconChip>
                      <div className="min-w-0">
                        <p className="brand-stat-tile__label-inline truncate font-heading font-medium text-[#212121]">
                          {formatOperationLabel(type)}
                        </p>
                        <p className="brand-campaign-meta text-[#616161]">
                          {data.count} × {average}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="brand-campaign-meta text-[#616161]">No operations recorded yet.</p>
            )}
          </div>

          <div className="shrink-0 border-b border-[#EFE8E3] px-3 py-2.5 sm:px-4">
            <h2 className="brand-page-section-title">By project</h2>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {showSkeleton ? (
              <div className="space-y-2.5 sm:space-y-3">
                {[1, 2, 3].map((i) => (
                  <SkeletonPulse key={i} className="h-[5.25rem] rounded-[20px]" />
                ))}
              </div>
            ) : mergedProjects.length > 0 ? (
              <div className="space-y-2.5 pr-0.5 sm:space-y-3">
                {mergedProjects.map((project) => {
                  const isExpanded = expandedProject === project.projectId;
                  const breakdown = projectBreakdowns[project.projectId];

                  return (
                    <div key={project.projectId} className="brand-campaign-card-figma shadow-sm">
                      <button
                        type="button"
                        onClick={() =>
                          handleToggleProject(project.projectId, project.hasBillingData)
                        }
                        className="flex w-full flex-col gap-2 text-left sm:gap-2.5"
                      >
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <BrandIconChip size="sm">
                              <Film className="text-white" strokeWidth={1.8} />
                            </BrandIconChip>
                            <span className="brand-campaign-title min-w-0 truncate font-heading leading-tight text-[#212121]">
                              {project.projectName}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-2.5">
                            <span className="brand-campaign-meta text-[#616161]">
                              {formatDate(project.lastActivity)}
                            </span>
                            <span
                              className={cn(
                                'brand-status-pill brand-status-pill--auto',
                                projectStatusPillClass(project.status),
                              )}
                              translate="no"
                            >
                              {project.status}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                          <div className="brand-campaign-row inline-flex items-center gap-1.5 font-heading font-medium text-[#212121]">
                            <Layers
                              className="brand-campaign-metric-stroke h-3.5 w-3.5"
                              strokeWidth={2}
                              aria-hidden
                            />
                            <span>
                              Scenes: {String(project.sceneCount).padStart(2, '0')}
                            </span>
                          </div>
                          <div className="brand-campaign-row inline-flex items-center gap-1.5 font-heading font-medium text-[#212121]">
                            <Coins
                              className="brand-campaign-metric-stroke h-3.5 w-3.5"
                              strokeWidth={2}
                              aria-hidden
                            />
                            <span>
                              Credits:{' '}
                              {project.totalCost !== null
                                ? project.totalCost.toLocaleString('en-IN')
                                : '—'}
                            </span>
                          </div>
                          {project.hasBillingData && (
                            <span className="brand-campaign-meta inline-flex items-center gap-1 font-heading font-medium text-[#212121] underline decoration-[#212121] underline-offset-2 sm:ml-auto">
                              {isExpanded ? 'Hide breakdown' : 'View breakdown'}
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4 shrink-0 text-[#E86512]" aria-hidden />
                              ) : (
                                <ChevronDown
                                  className="h-4 w-4 shrink-0 text-[#E86512]"
                                  aria-hidden
                                />
                              )}
                            </span>
                          )}
                        </div>
                      </button>

                      {isExpanded && project.hasBillingData && (
                        <div className="mt-2.5 border-t border-[#EFE8E3] pt-2.5">
                          {loadingBreakdown === project.projectId ? (
                            <div className="flex items-center justify-center py-5">
                              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#E86512] border-t-transparent" />
                            </div>
                          ) : breakdown ? (
                            <div className="space-y-2">
                              {Object.entries(breakdown.byScene).map(([sceneNum, sceneData]) => (
                                <div
                                  key={sceneNum}
                                  className="rounded-[14px] border border-[#F0E5DC] bg-[#FFFCFA] p-2.5 sm:p-3"
                                >
                                  <div className="mb-1.5 flex items-center justify-between gap-2">
                                    <span className="brand-campaign-row font-heading font-medium text-[#212121]">
                                      {sceneNum === '0' ? 'General' : `Scene ${sceneNum}`}
                                    </span>
                                    <span className="brand-campaign-row font-heading font-semibold text-[#E85A1F]">
                                      {sceneData.totalCost}
                                    </span>
                                  </div>
                                  <div className="space-y-1">
                                    {sceneData.operations.map((op, idx) => {
                                      const operation = op as {
                                        operationType?: string;
                                        operationName?: string;
                                        creditCost?: number;
                                      };
                                      const OpIcon = operationIconFor(operation.operationType || '');
                                      return (
                                        <div
                                          key={idx}
                                          className="brand-campaign-meta flex items-center justify-between gap-2"
                                        >
                                          <span className="flex min-w-0 items-center gap-1.5 text-[#616161]">
                                            <OpIcon
                                              className="brand-campaign-metric-stroke h-3.5 w-3.5"
                                              strokeWidth={2}
                                              aria-hidden
                                            />
                                            <span className="truncate">
                                              {operation.operationName || 'Operation'}
                                            </span>
                                          </span>
                                          <span className="shrink-0 text-[#212121]">
                                            {operation.creditCost ?? 0}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="brand-campaign-meta py-2 text-center text-[#616161]">
                              No detailed breakdown available
                            </p>
                          )}
                        </div>
                      )}

                      {isExpanded && !project.hasBillingData && (
                        <div className="mt-2.5 border-t border-[#EFE8E3] pt-2.5">
                          <p className="brand-campaign-meta rounded-[14px] border border-dashed border-[#F0C9A8] bg-[#FFF8F2] px-3 py-2 text-[#8A5300]">
                            Cost tracking was not enabled for this project.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center sm:py-10">
                <div className="mx-auto mb-2 max-w-md rounded-xl border border-dashed border-orange-200/80 bg-gradient-to-br from-orange-50/90 to-pink-50/90 p-6 sm:p-8">
                  <p className="mb-4 font-heading text-base text-[#212121] sm:text-lg">
                    No usage to show here.
                  </p>
                  <BrandPrimaryButton
                    type="button"
                    onClick={() => router.push('/create-video/ai-chat')}
                    className="mx-auto w-full sm:w-auto"
                  >
                    Create a Video
                  </BrandPrimaryButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
