'use client';

import {
  FileText,
  Image as ImageIcon,
  Languages,
  Mic,
  Play,
  RefreshCw,
  Sparkles,
  Video,
  type LucideIcon,
} from 'lucide-react';

/**
 * Shared between /billing (money paid) and /usage (credits consumed).
 * Billing owns purchases + invoices; Usage owns credit consumption.
 */

export interface ProjectCost {
  projectId: string;
  totalCost: number;
  operations: number;
  firstOperation: string;
  lastOperation: string;
  projectName?: string;
}

export interface BillingSummary {
  userId: string;
  currentBalance: number;
  totalSpent: number;
  projectCount: number;
  operationCount: number;
  projects: ProjectCost[];
  byOperationType: Record<string, { count: number; totalCost: number }>;
}

export interface VideoProject {
  id: string;
  name?: string;
  title?: string;
  status?: string;
  step?: string;
  scenes?: unknown[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MergedProject {
  projectId: string;
  projectName: string;
  status: string;
  sceneCount: number;
  totalCost: number | null;
  operations: number | null;
  lastActivity: string;
  hasBillingData: boolean;
}

export interface CostBreakdown {
  projectId: string;
  totalCost: number;
  operationCount: number;
  byOperationType: Record<string, { count: number; totalCost: number }>;
  byScene: Record<number, { operations: unknown[]; totalCost: number }>;
  snapshots: Array<{
    id: string;
    sceneNumber: number | null;
    operationType: string;
    operationName: string;
    creditCost: number;
    createdAt: string;
    metadata: unknown;
  }>;
}

/**
 * Icons render inside `BrandIconChip`, which supplies the brand gradient and
 * white stroke — so these are shapes only, never per-type colours.
 */
const OPERATION_ICONS: Record<string, LucideIcon> = {
  IMAGE_GENERATION: ImageIcon,
  VIDEO_GENERATION: Video,
  AUDIO_GENERATION: Mic,
  AVATAR_VIDEO: Play,
  SCRIPT_GENERATION: FileText,
  SCENE_REGENERATION: RefreshCw,
  STOCK_FOOTAGE: Video,
  FINAL_RENDER: Sparkles,
  VIDEO_TRANSLATION: Languages,
};

export function operationIconFor(type: string): LucideIcon {
  return OPERATION_ICONS[type] || RefreshCw;
}

/** `VIDEO_GENERATION` -> `Video Generation` */
export function formatOperationLabel(type: string) {
  return type
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

export function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Maps a project step onto the shared `.brand-status-pill` variants. */
export function projectStatusPillClass(status: string) {
  const s = status.toLowerCase();
  if (s === 'completed') return 'brand-status-pill--completed';
  if (s === 'draft' || s === 'unknown') return 'brand-status-pill--draft';
  return 'brand-status-pill--in-progress';
}

/** Merges project metadata with per-project credit spend from the billing summary. */
export function mergeProjects(
  videoProjects: VideoProject[],
  summary: BillingSummary | null,
): MergedProject[] {
  if (!videoProjects.length && !summary?.projects?.length) return [];

  const billingProjectMap = new Map<string, ProjectCost>();
  summary?.projects?.forEach((p) => billingProjectMap.set(p.projectId, p));

  const merged: MergedProject[] = [];
  const processedIds = new Set<string>();

  videoProjects.forEach((vp) => {
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

  summary?.projects?.forEach((bp) => {
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

  merged.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
  return merged;
}
