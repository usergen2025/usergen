import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Campaign, CampaignPostSubmission, CampaignApplication, FinalizationStatus } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';
import {
  AllocationResult,
  PrizePoolConfig,
  PrizePoolTier,
  allocate as allocatePool,
  groupAllocationByTier,
  normalizeStoredPool,
} from './prize-pool';

export interface LeaderboardEntry {
  rank: number;
  creatorId: string;
  postSubmissionId?: string;
  postUrl?: string;
  platform?: string;
  views: number;
  hasVerifiedPost: boolean;
  qualifies: boolean;
  projectedPayoutPaise: bigint;
  projectedPayoutRupees: number;
  percentageBps: number;
  tier?: { index: number; label?: string };
  /** @deprecated use tier */
  band?: { index: number; label?: string };
  caveat?: string;
}

export interface LiveLeaderboard {
  campaignId: string;
  payoutModel: 'CPM' | 'POOL';
  totalPoolPaise: bigint;
  totalPoolRupees: number;
  qualifiersCount: number;
  approvedCount: number;
  approvedWithVerifiedPostCount: number;
  entries: LeaderboardEntry[];
  caveat: string;
  finalizationStatus: FinalizationStatus | null;
  finalizedAt: string | null;
  endDate: string;
  gracePeriodHours: number;
  tiers: PrizePoolTier[];
  tierGroups?: ReturnType<typeof groupAllocationByTier>;
}

export interface PreviewLeaderboard {
  campaignId: string;
  totalPoolPaise: bigint;
  totalPoolRupees: number;
  participants: number;
  tiers: PrizePoolTier[];
  tierGroups: ReturnType<typeof groupAllocationByTier>;
  entries: Array<{
    rank: number;
    payoutPaise: bigint;
    payoutRupees: number;
    percentageBps: number;
    tierIndex: number;
    tierLabel?: string;
    bandIndex?: number;
    bandLabel?: string;
  }>;
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Convert a Campaign row's frozen prize pool JSON (or default template) to a runtime config.
   * Always returns a valid PrizePoolConfig; falls back to BALANCED if missing or invalid.
   */
  resolvePrizePool(campaign: Pick<Campaign, 'prizePoolJson'>): PrizePoolConfig {
    return normalizeStoredPool(campaign?.prizePoolJson);
  }

  /**
   * Compute the live, in-flight leaderboard for a POOL campaign.
   *
   * - Includes all approved applicants. Approved-without-post creators are placed at the
   *   bottom (sorted after creators with verified posts) and shown as "no post yet".
   * - Includes posts that are PENDING_REVIEW or VERIFIED, but only VERIFIED posts qualify
   *   for projected earnings while live.
   * - Sorting: VERIFIED posts by views desc, then earlier reviewedAt; then PENDING; then no-post.
   *
   * The pool used for live projections is the campaign's totalBudget (paise).
   */
  async computeLiveLeaderboard(campaignId: string): Promise<LiveLeaderboard> {
    const campaign = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    if (campaign.payoutModel !== 'POOL') {
      throw new BadRequestException('Leaderboard is only available for POOL campaigns');
    }

    const config = this.resolvePrizePool(campaign);
    const totalPoolPaise = BigInt(Math.round(Number(campaign.totalBudget) * 100));

    const [approvedApplications, postSubmissions] = await Promise.all([
      this.databaseService.campaignApplication.findMany({
        where: { campaignId, status: 'APPROVED' },
        orderBy: { reviewedAt: 'asc' },
      }),
      this.databaseService.campaignPostSubmission.findMany({
        where: { campaignId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const verifiedPostByCreator = new Map<string, CampaignPostSubmission>();
    for (const post of postSubmissions) {
      if (post.disqualifiedAt) continue;
      if (post.status === 'VERIFIED') {
        // Keep latest verified post per creator (highest view count).
        const existing = verifiedPostByCreator.get(post.creatorId);
        if (!existing || post.currentViews > existing.currentViews) {
          verifiedPostByCreator.set(post.creatorId, post);
        }
      }
    }

    const pendingPostByCreator = new Map<string, CampaignPostSubmission>();
    for (const post of postSubmissions) {
      if (post.disqualifiedAt) continue;
      if (post.status !== 'PENDING_REVIEW') continue;
      if (verifiedPostByCreator.has(post.creatorId)) continue;
      const existing = pendingPostByCreator.get(post.creatorId);
      if (!existing || post.createdAt < existing.createdAt) {
        pendingPostByCreator.set(post.creatorId, post);
      }
    }

    const approvedCreatorIds = approvedApplications.map((a) => a.creatorId);
    const approvedSet = new Set(approvedCreatorIds);

    type Row = {
      creatorId: string;
      verified?: CampaignPostSubmission;
      pending?: CampaignPostSubmission;
      reviewedAt?: Date | null;
    };
    const rowsMap = new Map<string, Row>();
    for (const app of approvedApplications) {
      rowsMap.set(app.creatorId, { creatorId: app.creatorId, reviewedAt: app.reviewedAt });
    }
    for (const [creatorId, post] of verifiedPostByCreator) {
      const r = rowsMap.get(creatorId) || { creatorId };
      r.verified = post;
      rowsMap.set(creatorId, r);
    }
    for (const [creatorId, post] of pendingPostByCreator) {
      const r = rowsMap.get(creatorId) || { creatorId };
      r.pending = post;
      rowsMap.set(creatorId, r);
    }

    const rows = Array.from(rowsMap.values());

    // Sort: verified posts by views desc, earlier verifiedAt next; pending after; no-post last.
    rows.sort((a, b) => {
      const aTier = a.verified ? 0 : a.pending ? 1 : 2;
      const bTier = b.verified ? 0 : b.pending ? 1 : 2;
      if (aTier !== bTier) return aTier - bTier;
      if (aTier === 0 && a.verified && b.verified) {
        if (a.verified.currentViews !== b.verified.currentViews) {
          return b.verified.currentViews - a.verified.currentViews;
        }
        const aReviewed = a.verified.reviewedAt?.getTime() ?? a.verified.createdAt.getTime();
        const bReviewed = b.verified.reviewedAt?.getTime() ?? b.verified.createdAt.getTime();
        if (aReviewed !== bReviewed) return aReviewed - bReviewed;
      }
      if (aTier === 1 && a.pending && b.pending) {
        const aT = a.pending.createdAt.getTime();
        const bT = b.pending.createdAt.getTime();
        if (aT !== bT) return aT - bT;
      }
      if (aTier === 2) {
        const aT = a.reviewedAt?.getTime() ?? 0;
        const bT = b.reviewedAt?.getTime() ?? 0;
        if (aT !== bT) return aT - bT;
      }
      return a.creatorId.localeCompare(b.creatorId);
    });

    const qualifyingRows = rows.filter((r) => r.verified && r.verified.currentViews >= campaign.minViewsToQualify);
    const allocation = allocatePool(config.tiers, qualifyingRows.length, totalPoolPaise);
    const tierGroups = groupAllocationByTier(allocation.perRank, config.tiers);
    const allocByRank = new Map(allocation.perRank.map((entry) => [entry.rank, entry]));

    const entries: LeaderboardEntry[] = [];
    let qualifyingRank = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const post = row.verified || row.pending;
      const isQualifying = !!(row.verified && row.verified.currentViews >= campaign.minViewsToQualify);
      const rank = isQualifying ? ++qualifyingRank : i + 1;
      const allocEntry = isQualifying ? allocByRank.get(qualifyingRank) : undefined;
      const payoutPaise = allocEntry?.payoutPaise || 0n;
      const tierIndex = allocEntry?.tierIndex;
      const tier =
        tierIndex !== undefined ? { index: tierIndex, label: config.tiers[tierIndex]?.label } : undefined;

      let caveat: string | undefined;
      if (!row.verified && row.pending) {
        caveat = 'Post pending verification — projected earnings shown after verification.';
      } else if (!row.verified && !row.pending) {
        caveat = 'No final post submitted yet — share your post link to enter the leaderboard.';
      } else if (row.verified && row.verified.currentViews < campaign.minViewsToQualify) {
        caveat = `Below minimum (${campaign.minViewsToQualify} views) to qualify for payout.`;
      }

      entries.push({
        rank,
        creatorId: row.creatorId,
        postSubmissionId: post?.id,
        postUrl: post?.postUrl,
        platform: post?.platform,
        views: post?.currentViews ?? 0,
        hasVerifiedPost: !!row.verified,
        qualifies: isQualifying,
        projectedPayoutPaise: payoutPaise,
        projectedPayoutRupees: Number(payoutPaise) / 100,
        percentageBps: allocEntry?.percentageBps ?? 0,
        tier,
        band: tier,
        caveat,
      });
    }

    return {
      campaignId,
      payoutModel: campaign.payoutModel,
      totalPoolPaise,
      totalPoolRupees: Number(campaign.totalBudget),
      qualifiersCount: qualifyingRows.length,
      approvedCount: approvedSet.size,
      approvedWithVerifiedPostCount: verifiedPostByCreator.size,
      entries,
      caveat:
        'Live leaderboard. Final ranks and payouts are computed after the campaign ends ' +
        `(plus ${campaign.gracePeriodHours}h grace period). Creators without a verified post ` +
        'at finalization are dropped from the payout, and the pool is redistributed.',
      finalizationStatus: campaign.finalizationStatus,
      finalizedAt: campaign.finalizedAt ? campaign.finalizedAt.toISOString() : null,
      endDate: campaign.endDate.toISOString(),
      gracePeriodHours: campaign.gracePeriodHours,
      tiers: config.tiers,
      tierGroups,
    };
  }

  /**
   * Compute the final allocation for finalization.
   *
   * Filters: only verified posts (not disqualified) with views >= minViewsToQualify.
   *
   * Returns both the qualifying allocation AND the dropped creators (for the audit snapshot).
   */
  async computeFinalAllocation(campaignId: string): Promise<{
    campaign: Campaign;
    config: PrizePoolConfig;
    totalPoolPaise: bigint;
    qualifying: Array<{ creatorId: string; post: CampaignPostSubmission; rank: number; payoutPaise: bigint; percentageBps: number; tierIndex: number }>;
    dropped: Array<{ creatorId: string; postId?: string; reason: string }>;
    allocation: AllocationResult;
  }> {
    const campaign = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    if (campaign.payoutModel !== 'POOL') {
      throw new BadRequestException('Final allocation is only available for POOL campaigns');
    }

    const config = this.resolvePrizePool(campaign);
    const totalPoolPaise = BigInt(Math.round(Number(campaign.totalBudget) * 100));

    const [approved, posts] = await Promise.all([
      this.databaseService.campaignApplication.findMany({
        where: { campaignId, status: 'APPROVED' },
      }),
      this.databaseService.campaignPostSubmission.findMany({ where: { campaignId } }),
    ]);

    const dropped: Array<{ creatorId: string; postId?: string; reason: string }> = [];
    const verifiedByCreator = new Map<string, CampaignPostSubmission>();
    for (const post of posts) {
      if (post.disqualifiedAt) {
        dropped.push({
          creatorId: post.creatorId,
          postId: post.id,
          reason: post.disqualifiedReason || 'Disqualified by admin',
        });
        continue;
      }
      if (post.status !== 'VERIFIED') {
        dropped.push({
          creatorId: post.creatorId,
          postId: post.id,
          reason: post.status === 'PENDING_REVIEW' ? 'Post not verified at finalization' : 'Post rejected',
        });
        continue;
      }
      const existing = verifiedByCreator.get(post.creatorId);
      if (!existing || post.currentViews > existing.currentViews) {
        verifiedByCreator.set(post.creatorId, post);
      }
    }
    // Approved without verified post → drop with reason.
    const verifiedCreatorIds = new Set(verifiedByCreator.keys());
    for (const app of approved) {
      if (!verifiedCreatorIds.has(app.creatorId)) {
        const alreadyDropped = dropped.some((d) => d.creatorId === app.creatorId);
        if (!alreadyDropped) {
          dropped.push({ creatorId: app.creatorId, reason: 'Approved but no verified post by finalization' });
        }
      }
    }

    // Filter qualifying by minViewsToQualify.
    const qualifyingPosts: CampaignPostSubmission[] = [];
    for (const post of verifiedByCreator.values()) {
      if (post.currentViews < campaign.minViewsToQualify) {
        dropped.push({
          creatorId: post.creatorId,
          postId: post.id,
          reason: `Did not meet minViewsToQualify (${campaign.minViewsToQualify})`,
        });
        continue;
      }
      qualifyingPosts.push(post);
    }

    // Sort qualifying: views desc, then earlier reviewedAt asc (tie-breaker).
    qualifyingPosts.sort((a, b) => {
      if (a.currentViews !== b.currentViews) return b.currentViews - a.currentViews;
      const aT = a.reviewedAt?.getTime() ?? a.createdAt.getTime();
      const bT = b.reviewedAt?.getTime() ?? b.createdAt.getTime();
      if (aT !== bT) return aT - bT;
      return a.creatorId.localeCompare(b.creatorId);
    });

    const allocation = allocatePool(config.tiers, qualifyingPosts.length, totalPoolPaise);
    const qualifying = qualifyingPosts.map((post, idx) => {
      const rank = idx + 1;
      const allocEntry = allocation.perRank[idx];
      return {
        creatorId: post.creatorId,
        post,
        rank,
        payoutPaise: allocEntry?.payoutPaise ?? 0n,
        percentageBps: allocEntry?.percentageBps ?? 0,
        tierIndex: allocEntry?.tierIndex ?? 0,
      };
    });

    return {
      campaign,
      config,
      totalPoolPaise,
      qualifying,
      dropped,
      allocation,
    };
  }

  /**
   * Brand/admin/creator preview of a hypothetical leaderboard for the campaign at N participants.
   * Used in the brand create UI and for explainer cards.
   */
  async previewAllocation(campaignId: string, n?: number): Promise<PreviewLeaderboard> {
    const campaign = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    const config = this.resolvePrizePool(campaign);
    const participants = Math.max(1, Math.floor(n ?? campaign.previewN ?? 10));
    const totalPoolPaise = BigInt(Math.round(Number(campaign.totalBudget) * 100));
    const allocation = allocatePool(config.tiers, participants, totalPoolPaise);
    const tierGroups = groupAllocationByTier(allocation.perRank, config.tiers);
    return {
      campaignId,
      totalPoolPaise,
      totalPoolRupees: Number(campaign.totalBudget),
      participants,
      tiers: config.tiers,
      tierGroups,
      entries: allocation.perRank.map((entry) => ({
        rank: entry.rank,
        payoutPaise: entry.payoutPaise,
        payoutRupees: Number(entry.payoutPaise) / 100,
        percentageBps: entry.percentageBps,
        tierIndex: entry.tierIndex,
        tierLabel: config.tiers[entry.tierIndex]?.label,
        bandIndex: entry.tierIndex,
        bandLabel: config.tiers[entry.tierIndex]?.label,
      })),
    };
  }

  /**
   * Read the post-finalization snapshot, sorted by rank ascending; dropped creators last.
   */
  async getSnapshot(campaignId: string) {
    const campaign = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    const rows = await this.databaseService.campaignLeaderboardSnapshot.findMany({
      where: { campaignId },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      campaignId: row.campaignId,
      creatorId: row.creatorId,
      postSubmissionId: row.postSubmissionId,
      hadVerifiedPost: row.hadVerifiedPost,
      rank: row.rank,
      views: row.views,
      percentageBps: row.percentageBps,
      payoutAmountPaise: row.payoutAmountPaise.toString(),
      payoutAmountRupees: Number(row.payoutAmountPaise) / 100,
      droppedReason: row.droppedReason,
      finalizationId: row.finalizationId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Return only the immutable prize-pool config for a campaign (UI uses this for the rank table).
   */
  async getPrizePool(campaignId: string) {
    const campaign = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    const config = this.resolvePrizePool(campaign);
    return {
      campaignId,
      payoutModel: campaign.payoutModel,
      totalBudget: Number(campaign.totalBudget),
      totalPoolPaise: BigInt(Math.round(Number(campaign.totalBudget) * 100)).toString(),
      tiers: config.tiers,
      bands: config.tiers,
      tieBreaker: config.tieBreaker,
      minViewsToQualify: campaign.minViewsToQualify,
      gracePeriodHours: campaign.gracePeriodHours,
      previewN: campaign.previewN,
      finalizationStatus: campaign.finalizationStatus,
      finalizedAt: campaign.finalizedAt ? campaign.finalizedAt.toISOString() : null,
      endDate: campaign.endDate.toISOString(),
      isPublished: campaign.status !== 'DRAFT',
      templateKey: config.templateKey,
    };
  }

  async assertCampaignReadable(campaignId: string, user: { id: string; role: string }) {
    const campaign = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    const isPrivileged = user.role === 'ADMIN' || user.role === 'OWNER';
    if (isPrivileged) return campaign;
    if (campaign.brandId === user.id) return campaign;
    // Creator can read if they have an application or post submission.
    const [app, post] = await Promise.all([
      this.databaseService.campaignApplication.findUnique({
        where: { campaignId_creatorId: { campaignId, creatorId: user.id } },
      }),
      this.databaseService.campaignPostSubmission.findFirst({
        where: { campaignId, creatorId: user.id },
        select: { id: true },
      }),
    ]);
    if (app || post) return campaign;
    // Live POOL campaigns are publicly readable to authenticated users (so they can preview).
    if (campaign.status === 'LIVE' || campaign.status === 'IN_PROGRESS' || campaign.status === 'COMPLETED') {
      return campaign;
    }
    throw new ForbiddenException('You do not have permission to access this campaign');
  }
}
