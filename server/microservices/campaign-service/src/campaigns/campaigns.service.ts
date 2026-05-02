import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import {
  ApplyToCampaignDto,
  CreateCampaignDto,
  CreatePostSubmissionDto,
  CreateSubmissionDto,
  ReviewPostSubmissionDto,
  ReviewSubmissionDto,
  UpdateCampaignDto,
  VerifyPostViewsDto,
} from './dto/campaign.dto';
import { DatabaseService } from '../common/database/database.service';
import { WalletSyncService } from './wallet-sync.service';
import { CampaignMediaService } from './campaign-media.service';
import { CampaignNotificationService } from './campaign-notification.service';
import { isAfterCampaignEndDay, isOnOrBeforeDeadlineDay } from './utils/date-compare.util';

export type CampaignStatus = 'LIVE' | 'IN_PROGRESS' | 'COMPLETED' | 'PAUSED' | 'DRAFT';
export type SubmissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Campaign {
  id: string;
  brandId?: string;
  name: string;
  description: string;
  status: CampaignStatus;
  postedAt: string;
  deadlineToApply: string;
  startDate: string;
  endDate: string;
  payoutRate: number;
  totalBudget: number;
  budgetUsed: number;
  remainingBudget: number;
  views: number;
  targetViews: number;
  applicantsCount: number;
  shortlistedCount: number;
  brandAssetsUrl?: string;
  campaignType?: string;
  industry?: string;
  platformTarget?: string;
  regionFilter?: string;
}

export interface Submission {
  id: string;
  campaignId: string;
  creatorId?: string;
  creatorName: string;
  creatorHandle: string;
  contentUrl: string;
  platform: 'INSTAGRAM' | 'YOUTUBE';
  status: SubmissionStatus;
  createdAt: string;
  comment?: string;
  views: number;
  earnings: number;
}

export interface CampaignApplicationView {
  id: string;
  campaignId: string;
  creatorId: string;
  status: 'APPLIED' | 'APPROVED' | 'REJECTED' | 'SUBMITTED' | 'WITHDRAWN';
  draftMediaUrl?: string;
  draftMediaAssetId?: string;
  platform?: 'INSTAGRAM' | 'YOUTUBE';
  termsAccepted: boolean;
  termsAcceptedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewComment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignPostSubmissionView {
  id: string;
  campaignId: string;
  creatorId: string;
  applicationId?: string;
  postUrl: string;
  platform: 'INSTAGRAM' | 'YOUTUBE';
  status: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewComment?: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CampaignsService implements OnModuleInit, OnModuleDestroy {
  private readonly maxRetryAttempts = 10;
  private readonly logger = new Logger(CampaignsService.name);
  private autoRetryTimer: NodeJS.Timeout | null = null;
  private isAutoRetryRunning = false;
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly walletSyncService: WalletSyncService,
    private readonly configService: ConfigService,
    private readonly campaignMediaService: CampaignMediaService,
    private readonly notificationService: CampaignNotificationService,
  ) {}

  private getIdempotencyKey(scope: string, ids: Array<string | number>) {
    return `campaign-service:${scope}:${ids.join(':')}`;
  }

  private buildWalletSyncFilters(params?: {
    status?: 'SYNCED' | 'RETRY_PENDING' | 'FAILED';
    eventType?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const createdAtFilter: Record<string, Date> = {};
    if (params?.startDate) {
      const start = new Date(params.startDate);
      if (!Number.isNaN(start.getTime())) createdAtFilter.gte = start;
    }
    if (params?.endDate) {
      const end = new Date(params.endDate);
      if (!Number.isNaN(end.getTime())) createdAtFilter.lte = end;
    }
    return {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.eventType ? { eventType: params.eventType } : {}),
      ...(Object.keys(createdAtFilter).length ? { createdAt: createdAtFilter } : {}),
    };
  }

  async onModuleInit() {
    await this.removeLegacySeedCampaigns();
    this.startWalletSyncAutoRetryWorker();
  }

  onModuleDestroy() {
    if (this.autoRetryTimer) {
      clearInterval(this.autoRetryTimer);
      this.autoRetryTimer = null;
    }
  }

  /** List campaigns: brands see only their rows; ADMIN/OWNER see all. */
  async listCampaignsForRequest(
    user: { id: string; role: string },
    status?: CampaignStatus,
    search?: string,
  ): Promise<Campaign[]> {
    const isPrivileged = user.role === 'ADMIN' || user.role === 'OWNER';
    return this.queryCampaigns({
      brandId: isPrivileged ? undefined : user.id,
      status,
      search,
    });
  }

  private async queryCampaigns(options: {
    brandId?: string;
    status?: CampaignStatus;
    search?: string;
    deadlineNotPassed?: boolean;
  }): Promise<Campaign[]> {
    const { brandId, status, search, deadlineNotPassed } = options;
    const now = new Date();
    const rows = await this.databaseService.campaign.findMany({
      where: {
        NOT: {
          brandId: 'seed-brand',
        },
        ...(brandId ? { brandId } : {}),
        ...(status ? { status } : {}),
        ...(deadlineNotPassed ? { deadlineToApply: { gte: now } } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        submissions: true,
        applications: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.mapCampaign(row));
  }

  async getCampaign(id: string): Promise<Campaign> {
    const found = await this.databaseService.campaign.findUnique({
      where: { id },
      include: { submissions: true, applications: true },
    });
    if (!found) {
      throw new NotFoundException('Campaign not found');
    }
    return this.mapCampaign(found);
  }

  async getCampaignForRequest(user: { id: string; role: string }, id: string): Promise<Campaign> {
    const found = await this.databaseService.campaign.findUnique({
      where: { id },
      include: { submissions: true, applications: true },
    });
    if (!found) {
      throw new NotFoundException('Campaign not found');
    }
    const isPrivileged = user.role === 'ADMIN' || user.role === 'OWNER';
    if (!isPrivileged && found.brandId !== user.id) {
      throw new ForbiddenException('You do not have permission to access this campaign');
    }
    return this.mapCampaign(found);
  }

  async createCampaign(dto: CreateCampaignDto, brandUserId: string): Promise<Campaign> {
    const payoutRate = Number(dto.payoutRate);
    const totalBudget = Number(dto.totalBudget);
    const created = await this.databaseService.campaign.create({
      data: {
        brandId: brandUserId,
        name: dto.name,
        description: dto.description,
        status: 'DRAFT',
        deadlineToApply: new Date(dto.deadlineToApply),
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        payoutRate,
        totalBudget,
        budgetUsed: 0,
        views: 0,
        targetViews: Math.floor((totalBudget / payoutRate) * 1000),
        brandAssetsUrl: dto.brandAssetsUrl,
        campaignType: dto.campaignType ?? 'REPOST_CPM',
        industry: dto.industry,
        platformTarget: dto.platformTarget,
        regionFilter: dto.regionFilter,
      },
      include: { submissions: true, applications: true },
    });
    return this.mapCampaign(created);
  }

  async updateCampaign(id: string, dto: UpdateCampaignDto, brandUserId: string): Promise<Campaign> {
    const campaign = await this.assertCampaignOwnership(id, brandUserId);
    const totalBudget = dto.totalBudget !== undefined ? Number(dto.totalBudget) : Number(campaign.totalBudget);
    const payoutRate = dto.payoutRate !== undefined ? Number(dto.payoutRate) : Number(campaign.payoutRate);
    const updated = await this.databaseService.campaign.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.deadlineToApply ? { deadlineToApply: new Date(dto.deadlineToApply) } : {}),
        ...(dto.startDate ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.endDate ? { endDate: new Date(dto.endDate) } : {}),
        totalBudget,
        payoutRate,
        targetViews: Math.floor((totalBudget / Math.max(payoutRate, 1)) * 1000),
      },
      include: { submissions: true, applications: true },
    });
    return this.mapCampaign(updated);
  }

  async publishCampaign(id: string, brandUserId: string): Promise<Campaign> {
    const campaign = await this.assertCampaignOwnership(id, brandUserId);
    if (campaign.status === 'LIVE') {
      return this.getCampaign(id);
    }
    if (campaign.status !== 'DRAFT' && campaign.status !== 'PAUSED') {
      throw new BadRequestException(`Campaign cannot be published from status ${campaign.status}`);
    }
    const reservedAmount = Number(campaign.totalBudget) - Number(campaign.budgetUsed);
    if (reservedAmount <= 0) {
      throw new BadRequestException('Campaign has no reservable budget remaining');
    }
    const idempotencyKey = this.getIdempotencyKey('brand-budget-reserve', [id, brandUserId, reservedAmount]);
    try {
      await this.walletSyncService.deductBrandBudget(brandUserId, reservedAmount, 'CAMPAIGN_BUDGET_RESERVE', {
        campaignId: id,
      }, idempotencyKey);
      await this.databaseService.walletSyncEvent.create({
        data: {
          eventType: 'BRAND_BUDGET_DEBIT',
          status: 'SYNCED',
          attempts: 1,
          payload: {
            userId: brandUserId,
            amount: reservedAmount,
            campaignId: id,
            activityName: 'CAMPAIGN_BUDGET_RESERVE',
            idempotencyKey,
          },
        },
      });
    } catch (error: any) {
      await this.databaseService.walletSyncEvent.create({
        data: {
          eventType: 'BRAND_BUDGET_DEBIT',
          status: 'RETRY_PENDING',
          attempts: 3,
          payload: {
            userId: brandUserId,
            amount: reservedAmount,
            campaignId: id,
            activityName: 'CAMPAIGN_BUDGET_RESERVE',
            idempotencyKey,
          },
          lastError: error?.message || 'wallet sync failure',
        },
      });
      throw new BadRequestException(
        error?.message || 'Campaign publish failed due to wallet sync error',
      );
    }
    return this.transitionStatus(id, 'LIVE');
  }

  async pauseCampaign(id: string, brandUserId: string): Promise<Campaign> {
    await this.assertCampaignOwnership(id, brandUserId);
    return this.transitionStatus(id, 'PAUSED');
  }

  async resumeCampaign(id: string, brandUserId: string): Promise<Campaign> {
    await this.assertCampaignOwnership(id, brandUserId);
    return this.transitionStatus(id, 'LIVE');
  }

  async topUpCampaign(id: string, amount: number, brandUserId: string): Promise<Campaign> {
    if (!amount || amount <= 0) {
      throw new BadRequestException('Top-up amount must be greater than 0');
    }
    const campaign = await this.assertCampaignOwnership(id, brandUserId);
    const idempotencyKey = this.getIdempotencyKey('brand-budget-topup', [id, brandUserId, amount]);
    try {
      await this.walletSyncService.deductBrandBudget(brandUserId, amount, 'CAMPAIGN_BUDGET_TOPUP', {
        campaignId: id,
      }, idempotencyKey);
      await this.databaseService.walletSyncEvent.create({
        data: {
          eventType: 'BRAND_BUDGET_DEBIT',
          status: 'SYNCED',
          attempts: 1,
          payload: {
            userId: brandUserId,
            amount,
            campaignId: id,
            activityName: 'CAMPAIGN_BUDGET_TOPUP',
            idempotencyKey,
          },
        },
      });
    } catch (error: any) {
      await this.databaseService.walletSyncEvent.create({
        data: {
          eventType: 'BRAND_BUDGET_DEBIT',
          status: 'RETRY_PENDING',
          attempts: 3,
          payload: {
            userId: brandUserId,
            amount,
            campaignId: id,
            activityName: 'CAMPAIGN_BUDGET_TOPUP',
            idempotencyKey,
          },
          lastError: error?.message || 'wallet sync failure',
        },
      });
      throw new BadRequestException('Campaign top-up failed due to wallet sync error');
    }
    const updated = await this.databaseService.campaign.update({
      where: { id },
      data: {
        totalBudget: Number(campaign.totalBudget) + amount,
        targetViews: Math.floor(((Number(campaign.totalBudget) + amount) / Math.max(Number(campaign.payoutRate), 1)) * 1000),
      },
      include: { submissions: true, applications: true },
    });
    return this.mapCampaign(updated);
  }

  async getCampaignSubmissions(
    campaignId: string,
    requester: { id: string; role: string },
  ): Promise<Submission[]> {
    await this.assertCampaignAccess(campaignId, requester);
    const submissions = await this.databaseService.submission.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
    return submissions.map((submission) => this.mapSubmission(submission));
  }

  async applyToCampaign(
    campaignId: string,
    creatorId: string,
    dto?: ApplyToCampaignDto,
  ): Promise<{ success: boolean; message: string }> {
    const campaign = await this.getCampaign(campaignId);
    if (campaign.status !== 'LIVE' && campaign.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Applications are allowed only on active campaigns');
    }
    const now = new Date();
    if (!isOnOrBeforeDeadlineDay(campaign.deadlineToApply, now)) {
      throw new BadRequestException('Application deadline has passed');
    }
    if (!dto?.termsAccepted) {
      throw new BadRequestException('Terms must be accepted before applying');
    }

    const urlFromLegacy = dto?.draftMediaUrl?.trim();
    const assetId = dto?.draftAssetId?.trim();
    if (!urlFromLegacy && !assetId) {
      throw new BadRequestException('Provide draftMediaUrl or draftAssetId');
    }

    let resolvedDraftUrl = urlFromLegacy || '';
    let resolvedDraftAssetId: string | undefined;

    if (assetId) {
      const asset = await this.databaseService.campaignMediaAsset.findUnique({
        where: { id: assetId },
      });
      if (!asset || asset.ownerId !== creatorId) {
        throw new BadRequestException('Invalid draft asset');
      }
      if (asset.status !== 'READY') {
        throw new BadRequestException('Draft asset is not ready yet');
      }
      await this.databaseService.campaignMediaAsset.update({
        where: { id: assetId },
        data: { campaignId },
      });
      resolvedDraftAssetId = assetId;
      resolvedDraftUrl = this.campaignMediaService.previewApiPath(assetId);
    }

    await this.databaseService.campaignApplication.upsert({
      where: {
        campaignId_creatorId: {
          campaignId,
          creatorId,
        },
      },
      update: {
        status: 'APPLIED',
        draftMediaUrl: resolvedDraftUrl,
        draftMediaAssetId: resolvedDraftAssetId ?? null,
        platform: dto?.platform || 'INSTAGRAM',
        termsAccepted: true,
        termsAcceptedAt: now,
      },
      create: {
        campaignId,
        creatorId,
        status: 'APPLIED',
        draftMediaUrl: resolvedDraftUrl,
        draftMediaAssetId: resolvedDraftAssetId ?? null,
        platform: dto?.platform || 'INSTAGRAM',
        termsAccepted: true,
        termsAcceptedAt: now,
      },
    });
    const application = await this.databaseService.campaignApplication.findUnique({
      where: { campaignId_creatorId: { campaignId, creatorId } },
    });
    await this.databaseService.walletSyncEvent.create({
      data: {
        eventType: 'APPLICATION_SUBMITTED',
        status: 'SYNCED',
        attempts: 1,
        payload: {
          campaignId,
          creatorId,
          sourceType: dto?.sourceType || 'EXTERNAL_URL',
          projectId: dto?.projectId || null,
          submittedAt: now.toISOString(),
        },
      },
    });

    void this.notificationService.notifyApplicationReceived({
      brandId: campaign.brandId || '',
      creatorId,
      campaignId,
      campaignName: campaign.name,
      applicationId: application?.id || '',
    });

    return { success: true, message: 'Application received' };
  }

  async createSubmission(campaignId: string, dto: CreateSubmissionDto, creatorId: string): Promise<Submission> {
    const campaign = await this.getCampaign(campaignId);
    if (campaign.status !== 'LIVE' && campaign.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Submissions are allowed only on active campaigns');
    }
    const now = new Date();
    if (isAfterCampaignEndDay(campaign.endDate, now)) {
      throw new BadRequestException('Campaign has already ended');
    }
    const application = await this.databaseService.campaignApplication.findUnique({
      where: {
        campaignId_creatorId: {
          campaignId,
          creatorId,
        },
      },
    });
    if (!application || (application.status !== 'APPLIED' && application.status !== 'APPROVED' && application.status !== 'SUBMITTED')) {
      throw new BadRequestException('Apply to the campaign first before submitting content');
    }
    const created = await this.databaseService.submission.create({
      data: {
        campaignId,
        creatorId,
        creatorName: dto.creatorName || `Creator ${creatorId.slice(-5)}`,
        creatorHandle: dto.creatorHandle || `@${(dto.creatorName || creatorId).toLowerCase().replace(/\s+/g, '_').slice(0, 24)}`,
        contentUrl: dto.contentUrl,
        platform: dto.platform,
        status: 'PENDING',
        views: 0,
        earnings: 0,
      },
    });
    await this.databaseService.campaignApplication.upsert({
      where: {
        campaignId_creatorId: {
          campaignId,
          creatorId,
        },
      },
      update: {
        status: 'SUBMITTED',
      },
      create: {
        campaignId,
        creatorId,
        status: 'SUBMITTED',
      },
    });
    return this.mapSubmission(created);
  }

  async reviewSubmission(
    submissionId: string,
    dto: ReviewSubmissionDto,
    reviewer: { id: string; role: string } | string,
  ): Promise<Submission> {
    const actor =
      typeof reviewer === 'string'
        ? { id: reviewer, role: 'BRAND' }
        : reviewer;
    const existing = await this.databaseService.submission.findUnique({
      where: { id: submissionId },
      include: { campaign: true },
    });
    if (!existing) {
      throw new NotFoundException('Submission not found');
    }
    const isPrivileged = actor.role === 'ADMIN' || actor.role === 'OWNER';
    if (!isPrivileged && existing.campaign.brandId !== actor.id) {
      throw new ForbiddenException('You do not have permission to review this submission');
    }
    const reviewed = await this.databaseService.submission.update({
      where: { id: submissionId },
      data: {
        status: dto.status,
        comment: dto.comment,
      },
      include: { campaign: true },
    });
    await this.databaseService.submissionReview.create({
      data: {
        submissionId,
        reviewerId: actor.id,
        status: dto.status,
        comment: dto.comment,
      },
    });
    await this.databaseService.campaignApplication.upsert({
      where: {
        campaignId_creatorId: {
          campaignId: reviewed.campaignId,
          creatorId: reviewed.creatorId,
        },
      },
      update: {
        status: dto.status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        reviewComment: dto.comment,
      },
      create: {
        campaignId: reviewed.campaignId,
        creatorId: reviewed.creatorId,
        status: dto.status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        reviewComment: dto.comment,
      },
    });
    return this.mapSubmission(reviewed);
  }

  async getCampaignApplications(
    campaignId: string,
    requester: { id: string; role: string },
  ): Promise<CampaignApplicationView[]> {
    await this.assertCampaignAccess(campaignId, requester);
    const rows = await this.databaseService.campaignApplication.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.mapApplication(row));
  }

  async reviewCampaignApplication(
    applicationId: string,
    dto: ReviewSubmissionDto,
    reviewer: { id: string; role: string },
  ): Promise<CampaignApplicationView> {
    const application = await this.databaseService.campaignApplication.findUnique({
      where: { id: applicationId },
      include: { campaign: true },
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }
    const isPrivileged = reviewer.role === 'ADMIN' || reviewer.role === 'OWNER';
    if (!isPrivileged && application.campaign.brandId !== reviewer.id) {
      throw new ForbiddenException('You do not have permission to review this application');
    }
    if (application.status !== 'APPLIED' && application.status !== 'SUBMITTED') {
      throw new BadRequestException('Only applied/submitted applications can be reviewed');
    }
    const updated = await this.databaseService.campaignApplication.update({
      where: { id: applicationId },
      data: {
        status: dto.status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        reviewedBy: reviewer.id,
        reviewedAt: new Date(),
        reviewComment: dto.comment,
      },
    });
    await this.databaseService.walletSyncEvent.create({
      data: {
        eventType: 'APPLICATION_REVIEWED',
        status: 'SYNCED',
        attempts: 1,
        payload: {
          campaignId: application.campaignId,
          creatorId: application.creatorId,
          applicationId,
          reviewedBy: reviewer.id,
          status: updated.status,
          comment: dto.comment || null,
          reviewedAt: new Date().toISOString(),
        },
      },
    });

    if (updated.status === 'APPROVED') {
      void this.notificationService.notifyApplicationApproved({
        brandId: application.campaign.brandId,
        creatorId: application.creatorId,
        campaignId: application.campaignId,
        campaignName: application.campaign.name,
        applicationId,
      });
    } else if (updated.status === 'REJECTED') {
      void this.notificationService.notifyApplicationRejected({
        brandId: application.campaign.brandId,
        creatorId: application.creatorId,
        campaignId: application.campaignId,
        campaignName: application.campaign.name,
        applicationId,
        comment: dto.comment,
      });
    }

    return this.mapApplication(updated);
  }

  async submitFinalPostLink(
    campaignId: string,
    creatorId: string,
    dto: CreatePostSubmissionDto,
  ): Promise<CampaignPostSubmissionView> {
    const campaign = await this.getCampaign(campaignId);
    if (campaign.status !== 'LIVE' && campaign.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Campaign is not active');
    }
    const now = new Date();
    if (isAfterCampaignEndDay(campaign.endDate, now)) {
      throw new BadRequestException('Campaign has already ended');
    }
    const application = await this.databaseService.campaignApplication.findUnique({
      where: {
        campaignId_creatorId: {
          campaignId,
          creatorId,
        },
      },
    });
    if (!application || application.status !== 'APPROVED') {
      throw new BadRequestException('Only approved applicants can submit final post links');
    }
    const created = await this.databaseService.campaignPostSubmission.create({
      data: {
        campaignId,
        creatorId,
        applicationId: application.id,
        postUrl: dto.postUrl,
        platform: dto.platform,
      },
    });
    await this.databaseService.walletSyncEvent.create({
      data: {
        eventType: 'POST_LINK_SUBMITTED',
        status: 'SYNCED',
        attempts: 1,
        payload: {
          campaignId,
          creatorId,
          postSubmissionId: created.id,
          submittedAt: new Date().toISOString(),
        },
      },
    });

    void this.notificationService.notifyPostSubmitted({
      brandId: campaign.brandId || '',
      creatorId,
      campaignId,
      campaignName: campaign.name,
      postId: created.id,
      postUrl: dto.postUrl,
    });

    return this.mapPostSubmission(created);
  }

  async getCampaignPostSubmissions(
    campaignId: string,
    requester: { id: string; role: string },
  ): Promise<CampaignPostSubmissionView[]> {
    await this.assertCampaignAccess(campaignId, requester);
    const rows = await this.databaseService.campaignPostSubmission.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.mapPostSubmission(row));
  }

  async reviewPostSubmission(
    postSubmissionId: string,
    dto: ReviewPostSubmissionDto,
    reviewer: { id: string; role: string },
  ): Promise<CampaignPostSubmissionView> {
    const existing = await this.databaseService.campaignPostSubmission.findUnique({
      where: { id: postSubmissionId },
      include: { campaign: true },
    });
    if (!existing) {
      throw new NotFoundException('Post submission not found');
    }
    const isPrivileged = reviewer.role === 'ADMIN' || reviewer.role === 'OWNER';
    if (!isPrivileged && existing.campaign.brandId !== reviewer.id) {
      throw new ForbiddenException('You do not have permission to review this post submission');
    }
    const updated = await this.databaseService.campaignPostSubmission.update({
      where: { id: postSubmissionId },
      data: {
        status: dto.status,
        reviewComment: dto.comment,
        reviewedBy: reviewer.id,
        reviewedAt: new Date(),
      },
    });
    await this.databaseService.walletSyncEvent.create({
      data: {
        eventType: dto.status === 'VERIFIED' ? 'POST_LINK_APPROVED' : 'POST_LINK_REJECTED',
        status: 'SYNCED',
        attempts: 1,
        payload: {
          campaignId: existing.campaignId,
          creatorId: existing.creatorId,
          postSubmissionId,
          reviewedBy: reviewer.id,
          reviewedAt: new Date().toISOString(),
          comment: dto.comment || null,
        },
      },
    });
    return this.mapPostSubmission(updated);
  }

  async verifyPostViewsAndAccrueEarnings(
    postSubmissionId: string,
    dto: VerifyPostViewsDto,
    verifier: { id: string; role: string },
  ) {
    const postSubmission = await this.databaseService.campaignPostSubmission.findUnique({
      where: { id: postSubmissionId },
      include: { campaign: true },
    });
    if (!postSubmission) {
      throw new NotFoundException('Post submission not found');
    }
    const isPrivileged = verifier.role === 'ADMIN' || verifier.role === 'OWNER';
    if (!isPrivileged && postSubmission.campaign.brandId !== verifier.id) {
      throw new ForbiddenException('You do not have permission to verify views for this submission');
    }
    if (postSubmission.status !== 'VERIFIED') {
      throw new BadRequestException('Post submission must be verified before view updates');
    }
    if (postSubmission.campaign.status !== 'LIVE' && postSubmission.campaign.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Campaign is not active');
    }
    const latestEarning = await this.databaseService.creatorEarning.findFirst({
      where: { postSubmissionId },
      orderBy: { earnedAt: 'desc' },
    });
    const prevViews = latestEarning?.metadata && typeof latestEarning.metadata === 'object'
      ? Number((latestEarning.metadata as Record<string, unknown>).currentViews ?? 0)
      : 0;
    const currentViews = Math.max(0, Number(dto.currentViews || 0));
    const viewsDelta = Math.max(0, currentViews - prevViews);
    if (viewsDelta <= 0) {
      return { success: true, message: 'No new views to accrue', viewsDelta: 0, amount: 0 };
    }
    const cpmRate = Number(postSubmission.campaign.payoutRate);
    const amount = Math.floor((viewsDelta / 1000) * cpmRate);
    if (amount <= 0) {
      return { success: true, message: 'Views increased but below next CPM threshold', viewsDelta, amount: 0 };
    }
    const availableBudget = Number(postSubmission.campaign.totalBudget) - Number(postSubmission.campaign.budgetUsed);
    if (availableBudget <= 0) {
      await this.completeCampaign(postSubmission.campaignId, 'Budget exhausted');
      return { success: false, message: 'Campaign budget exhausted' };
    }
    const payableAmount = Math.min(amount, availableBudget);
    const now = new Date();
    const unlockAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const earning = await this.databaseService.creatorEarning.create({
      data: {
        campaignId: postSubmission.campaignId,
        creatorId: postSubmission.creatorId,
        postSubmissionId,
        viewsDelta,
        cpmRate,
        amount: payableAmount,
        status: 'LOCKED',
        earnedAt: now,
        unlockAt,
        lockReason: '14_DAY_HOLD',
        metadata: {
          verifiedBy: verifier.id,
          note: dto.note,
          currentViews,
        },
      },
    });
    await this.databaseService.walletSyncEvent.create({
      data: {
        eventType: 'EARNING_LOCKED',
        status: 'SYNCED',
        attempts: 1,
        payload: {
          campaignId: postSubmission.campaignId,
          creatorId: postSubmission.creatorId,
          postSubmissionId,
          earningId: earning.id,
          amount: payableAmount,
          unlockAt: unlockAt.toISOString(),
        },
      },
    });
    await this.databaseService.campaign.update({
      where: { id: postSubmission.campaignId },
      data: {
        budgetUsed: {
          increment: payableAmount,
        },
        views: {
          increment: viewsDelta,
        },
      },
    });
    // Backward-compatibility bridge: snapshots still reference legacy Submission rows.
    // Ensure a synthetic submission exists for the post submission before writing snapshot.
    let snapshotSubmission = await this.databaseService.submission.findFirst({
      where: {
        campaignId: postSubmission.campaignId,
        creatorId: postSubmission.creatorId,
        contentUrl: postSubmission.postUrl,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!snapshotSubmission) {
      snapshotSubmission = await this.databaseService.submission.create({
        data: {
          campaignId: postSubmission.campaignId,
          creatorId: postSubmission.creatorId,
          creatorName: `Creator ${postSubmission.creatorId.slice(-5)}`,
          creatorHandle: `@${postSubmission.creatorId.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24)}`,
          contentUrl: postSubmission.postUrl,
          platform: postSubmission.platform,
          status: 'APPROVED',
          views: currentViews,
          earnings: payableAmount,
        },
      });
    } else {
      await this.databaseService.submission.update({
        where: { id: snapshotSubmission.id },
        data: {
          status: 'APPROVED',
          views: currentViews,
          earnings: {
            increment: payableAmount,
          },
        },
      });
    }
    await this.databaseService.campaignEarningSnapshot.create({
      data: {
        campaignId: postSubmission.campaignId,
        submissionId: snapshotSubmission.id,
        creatorId: postSubmission.creatorId,
        views: viewsDelta,
        cpmRate,
        earnings: payableAmount,
      },
    });
    const freshCampaign = await this.databaseService.campaign.findUnique({
      where: { id: postSubmission.campaignId },
    });
    if (freshCampaign && Number(freshCampaign.totalBudget) <= Number(freshCampaign.budgetUsed)) {
      await this.completeCampaign(postSubmission.campaignId, 'Budget exhausted');
    }
    return {
      success: true,
      earningId: earning.id,
      viewsDelta,
      amount: payableAmount,
      status: earning.status,
      unlockAt: earning.unlockAt,
    };
  }

  async getCreatorCampaignStates(creatorId: string) {
    const applications = await this.databaseService.campaignApplication.findMany({
      where: { creatorId },
      include: { campaign: { include: { submissions: true, applications: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const postSubmissions = await this.databaseService.campaignPostSubmission.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
    });
    const postByCampaign = postSubmissions.reduce<Record<string, CampaignPostSubmissionView[]>>((acc, row) => {
      if (!acc[row.campaignId]) acc[row.campaignId] = [];
      acc[row.campaignId].push(this.mapPostSubmission(row));
      return acc;
    }, {});
    return applications.map((app) => ({
      application: this.mapApplication(app),
      campaign: this.mapCampaign(app.campaign),
      postSubmissions: postByCampaign[app.campaignId] || [],
    }));
  }

  async getCampaignDetailForCreator(campaignId: string, creatorId: string) {
    const row = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!row) {
      throw new NotFoundException('Campaign not found');
    }
    const application = await this.databaseService.campaignApplication.findUnique({
      where: { campaignId_creatorId: { campaignId, creatorId } },
    });
    const postSubmissions = await this.databaseService.campaignPostSubmission.findMany({
      where: { campaignId, creatorId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      campaign: this.mapCampaign(row),
      application: application ? this.mapApplication(application) : null,
      postSubmissions: postSubmissions.map((p) => this.mapPostSubmission(p)),
    };
  }

  async replaceApplicationDraft(campaignId: string, creatorId: string, draftAssetId: string) {
    const application = await this.databaseService.campaignApplication.findUnique({
      where: { campaignId_creatorId: { campaignId, creatorId } },
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }
    if (application.status !== 'APPLIED') {
      throw new BadRequestException('You can only replace a draft while status is APPLIED');
    }
    if (application.reviewedAt) {
      throw new BadRequestException('Application is already under review');
    }
    const asset = await this.databaseService.campaignMediaAsset.findUnique({ where: { id: draftAssetId } });
    if (!asset || asset.ownerId !== creatorId || asset.status !== 'READY') {
      throw new BadRequestException('Invalid draft asset');
    }
    await this.databaseService.campaignMediaAsset.update({
      where: { id: draftAssetId },
      data: { campaignId },
    });
    const previewUrl = this.campaignMediaService.previewApiPath(draftAssetId);
    const updated = await this.databaseService.campaignApplication.update({
      where: { id: application.id },
      data: {
        draftMediaUrl: previewUrl,
        draftMediaAssetId: draftAssetId,
      },
    });
    return this.mapApplication(updated);
  }

  async processMaturedLockedEarnings() {
    try {
      const now = new Date();
      const due = await this.databaseService.creatorEarning.findMany({
        where: {
          status: 'LOCKED',
          unlockAt: { lte: now },
        },
        orderBy: { unlockAt: 'asc' },
        take: 200,
      });
      if (!due.length) return { processed: 0 };
      let unlocked = 0;
      for (const row of due) {
        await this.databaseService.creatorEarning.update({
          where: { id: row.id },
          data: {
            status: 'AVAILABLE',
            availableAt: now,
          },
        });
        await this.databaseService.walletSyncEvent.create({
          data: {
            eventType: 'EARNING_UNLOCKED',
            status: 'SYNCED',
            attempts: 1,
            payload: {
              campaignId: row.campaignId,
              creatorId: row.creatorId,
              postSubmissionId: row.postSubmissionId,
              earningId: row.id,
              amount: Number(row.amount),
              unlockedAt: now.toISOString(),
            },
          },
        });
        unlocked += 1;
      }
      return { processed: unlocked };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`processMaturedLockedEarnings skipped: ${message}`);
      return { processed: 0 };
    }
  }

  async getCampaignCreatorEarnings(campaignId: string, requester: { id: string; role: string }) {
    await this.assertCampaignAccess(campaignId, requester);
    const rows = await this.databaseService.creatorEarning.findMany({
      where: { campaignId },
      orderBy: { earnedAt: 'desc' },
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      creatorId: row.creatorId,
      postSubmissionId: row.postSubmissionId,
      status: row.status,
      amount: Number(row.amount),
      viewsDelta: row.viewsDelta,
      earnedAt: row.earnedAt.toISOString(),
      unlockAt: row.unlockAt.toISOString(),
      availableAt: row.availableAt ? row.availableAt.toISOString() : null,
      reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
    }));
  }

  async reverseLockedEarning(
    earningId: string,
    actor: { id: string; role: string },
    reason?: string,
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'OWNER') {
      throw new ForbiddenException('Only admin or owner can reverse locked earnings');
    }
    const earning = await this.databaseService.creatorEarning.findUnique({
      where: { id: earningId },
    });
    if (!earning) throw new NotFoundException('Earning not found');
    if (earning.status !== 'LOCKED') {
      throw new BadRequestException('Only locked earnings can be reversed');
    }
    const now = new Date();
    const updated = await this.databaseService.creatorEarning.update({
      where: { id: earningId },
      data: {
        status: 'REVERSED',
        reversedAt: now,
        metadata: {
          ...(typeof earning.metadata === 'object' && earning.metadata ? earning.metadata : {}),
          reversedBy: actor.id,
          reverseReason: reason,
        },
      },
    });
    await this.databaseService.campaign.update({
      where: { id: earning.campaignId },
      data: {
        budgetUsed: {
          decrement: Number(earning.amount),
        },
      },
    });
    return updated;
  }

  /**
   * Dashboard aggregates for the brand. Query param `dateRange` on the HTTP route is accepted for API
   * stability but is not yet applied; filter by created/updated time in a follow-up when needed.
   */
  async getBrandDashboardStats(brandUserId: string) {
    const campaigns = await this.databaseService.campaign.findMany({
      where: { brandId: brandUserId },
      include: { submissions: true, applications: true },
    });
    const liveCampaigns = campaigns.filter((campaign) => campaign.status === 'LIVE' || campaign.status === 'IN_PROGRESS').length;
    const totalViews = campaigns.reduce((sum, campaign) => sum + campaign.views, 0);
    const spentSoFar = campaigns.reduce((sum, campaign) => sum + Number(campaign.budgetUsed), 0);
    let walletBalance = 0;
    try {
      walletBalance = await this.walletSyncService.getUserCreditsBalance(brandUserId);
    } catch (err) {
      this.logger.warn(
        `Could not read payment-wallet balance for brand ${brandUserId}; returning 0 for walletBalance. ${(err as Error)?.message || ''}`,
      );
    }
    return {
      totalCampaigns: campaigns.length,
      liveCampaigns,
      totalViews,
      spentSoFar,
      walletBalance,
    };
  }

  async getCreatorCampaigns(search?: string) {
    return this.queryCampaigns({ status: 'LIVE', search, deadlineNotPassed: true });
  }

  async getCreatorEarnings(creatorId: string) {
    const entries = await this.databaseService.creatorEarning.findMany({
      where: { creatorId },
      orderBy: { earnedAt: 'desc' },
    });
    const locked = entries
      .filter((row) => row.status === 'LOCKED')
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const available = entries
      .filter((row) => row.status === 'AVAILABLE')
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const total = locked + available;
    return {
      totalEarnings: total,
      availableEarnings: available,
      lockedEarnings: locked,
      entries: entries.map((row) => ({
        id: row.id,
        campaignId: row.campaignId,
        postSubmissionId: row.postSubmissionId,
        viewsDelta: row.viewsDelta,
        amount: Number(row.amount),
        status: row.status,
        earnedAt: row.earnedAt.toISOString(),
        unlockAt: row.unlockAt.toISOString(),
        availableAt: row.availableAt ? row.availableAt.toISOString() : null,
      })),
    };
  }

  async requestWithdrawal(amount: number, creatorId: string) {
    return {
      requestId: `disabled-${creatorId}-${Date.now()}`,
      amount: Number(amount || 0),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      message: 'Withdrawals are currently disabled',
    };
  }

  async getWalletSyncEvents(params?: {
    status?: 'SYNCED' | 'RETRY_PENDING' | 'FAILED';
    eventType?: string;
    limit?: number;
    cursor?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const limit = Math.min(Math.max(params?.limit ?? 30, 1), 100);
    const items = await this.databaseService.walletSyncEvent.findMany({
      where: this.buildWalletSyncFilters(params),
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(params?.cursor
        ? {
            cursor: { id: params.cursor },
            skip: 1,
          }
        : {}),
    });
    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    return {
      items: trimmed,
      nextCursor: hasMore ? trimmed[trimmed.length - 1]?.id ?? null : null,
      hasMore,
    };
  }

  async exportWalletSyncEventsCsv(params?: {
    status?: 'SYNCED' | 'RETRY_PENDING' | 'FAILED';
    eventType?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const rows = await this.databaseService.walletSyncEvent.findMany({
      where: this.buildWalletSyncFilters(params),
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const headers = ['id', 'eventType', 'status', 'attempts', 'lastError', 'createdAt', 'updatedAt'];
    const lines = rows.map((row) =>
      [
        row.id,
        row.eventType,
        row.status,
        row.attempts,
        row.lastError || '',
        row.createdAt.toISOString(),
        row.updatedAt.toISOString(),
      ]
        .map(escapeCsv)
        .join(','),
    );
    return [headers.join(','), ...lines].join('\n');
  }

  async getWalletSyncSummary() {
    const [syncedCount, retryPendingCount, failedCount, eventTypeRows] = await Promise.all([
      this.databaseService.walletSyncEvent.count({ where: { status: 'SYNCED' } }),
      this.databaseService.walletSyncEvent.count({ where: { status: 'RETRY_PENDING' } }),
      this.databaseService.walletSyncEvent.count({ where: { status: 'FAILED' } }),
      this.databaseService.walletSyncEvent.findMany({
        distinct: ['eventType'],
        select: { eventType: true },
        orderBy: { eventType: 'asc' },
      }),
    ]);

    return {
      syncedCount,
      retryPendingCount,
      failedCount,
      totalCount: syncedCount + retryPendingCount + failedCount,
      eventTypes: eventTypeRows.map((row) => row.eventType),
    };
  }

  async retryWalletSyncEventsByStatus(statuses: Array<'RETRY_PENDING' | 'FAILED'>) {
    if (!statuses.length) {
      return { processed: 0, synced: 0, failed: 0, skipped: 0 };
    }
    const events = await this.databaseService.walletSyncEvent.findMany({
      where: {
        status: {
          in: statuses,
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    let synced = 0;
    let failed = 0;
    let skipped = 0;
    for (const event of events) {
      const result: any = await this.retryWalletSyncEvent(event.id);
      if (result.retryOutcome === 'skipped') {
        skipped += 1;
      } else if (result.status === 'SYNCED') {
        synced += 1;
      } else {
        failed += 1;
      }
    }

    return {
      processed: events.length,
      synced,
      failed,
      skipped,
    };
  }

  async retryWalletSyncEvent(eventId: string) {
    const event = await this.databaseService.walletSyncEvent.findUnique({
      where: { id: eventId },
    });
    if (!event) {
      throw new NotFoundException('Wallet sync event not found');
    }
    if (event.status === 'SYNCED') {
      return {
        ...event,
        retryOutcome: 'skipped',
        reason: 'already_synced',
      };
    }
    if (event.attempts >= this.maxRetryAttempts) {
      return {
        ...event,
        retryOutcome: 'skipped',
        reason: 'max_attempts_reached',
      };
    }
    const payload = event.payload as any;
    try {
      if (event.eventType === 'CREATOR_EARNING_CREDIT') {
        await this.walletSyncService.addCreatorEarning(
          payload.creatorId,
          Number(payload.amount),
          'Campaign submission approved (retry)',
          payload,
          payload.idempotencyKey || this.getIdempotencyKey('creator-earning-credit', [event.id]),
        );
      } else if (event.eventType === 'CREATOR_WITHDRAWAL_DEBIT') {
        await this.walletSyncService.deductCreatorWithdrawal(
          payload.creatorId,
          Number(payload.amount),
          payload,
          payload.idempotencyKey || this.getIdempotencyKey('creator-withdrawal-debit', [event.id]),
        );
      } else if (event.eventType === 'BRAND_BUDGET_DEBIT') {
        await this.walletSyncService.deductBrandBudget(
          payload.userId,
          Number(payload.amount),
          payload.activityName || 'CAMPAIGN_BUDGET_SYNC',
          payload,
          payload.idempotencyKey || this.getIdempotencyKey('brand-budget-debit', [event.id]),
        );
      } else {
        throw new BadRequestException(`Unsupported wallet sync event type: ${event.eventType}`);
      }
      return this.databaseService.walletSyncEvent.update({
        where: { id: eventId },
        data: {
          status: 'SYNCED',
          attempts: { increment: 1 },
          lastError: null,
        },
      });
    } catch (error: any) {
      return this.databaseService.walletSyncEvent.update({
        where: { id: eventId },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          lastError: error?.message || 'retry failed',
        },
      });
    }
  }

  private startWalletSyncAutoRetryWorker() {
    const enabled = this.configService.get<string>('WALLET_SYNC_AUTO_RETRY_ENABLED', 'false') === 'true';
    if (!enabled) {
      return;
    }
    const intervalMs = Math.max(
      Number(this.configService.get<string>('WALLET_SYNC_AUTO_RETRY_INTERVAL_MS', '60000')) || 60000,
      5000,
    );
    this.autoRetryTimer = setInterval(() => {
      void this.processWalletSyncAutoRetryBatch();
      void this.processMaturedLockedEarnings();
    }, intervalMs);
    this.logger.log(`Wallet sync auto-retry worker started (interval=${intervalMs}ms)`);
    void this.processWalletSyncAutoRetryBatch();
    void this.processMaturedLockedEarnings();
  }

  private async processWalletSyncAutoRetryBatch() {
    if (this.isAutoRetryRunning) {
      return;
    }
    this.isAutoRetryRunning = true;
    try {
      const batchSize = Math.min(
        Math.max(Number(this.configService.get<string>('WALLET_SYNC_AUTO_RETRY_BATCH_SIZE', '25')) || 25, 1),
        200,
      );
      const cooldownSeconds = Math.max(
        Number(this.configService.get<string>('WALLET_SYNC_AUTO_RETRY_COOLDOWN_SECONDS', '120')) || 120,
        0,
      );
      const cooldownBefore = new Date(Date.now() - cooldownSeconds * 1000);
      const candidateStatuses = ['RETRY_PENDING', 'FAILED'] as Array<'RETRY_PENDING' | 'FAILED'>;
      const events = await this.databaseService.walletSyncEvent.findMany({
        where: {
          status: { in: candidateStatuses },
          attempts: { lt: this.maxRetryAttempts },
          updatedAt: { lte: cooldownBefore },
        },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });
      if (!events.length) {
        return;
      }
      let synced = 0;
      let failed = 0;
      let skipped = 0;
      for (const event of events) {
        const result: any = await this.retryWalletSyncEvent(event.id);
        if (result.retryOutcome === 'skipped') skipped += 1;
        else if (result.status === 'SYNCED') synced += 1;
        else failed += 1;
      }
      this.logger.log(
        `Wallet sync auto-retry batch processed=${events.length} synced=${synced} failed=${failed} skipped=${skipped}`,
      );
    } catch (error: any) {
      this.logger.error(`Wallet sync auto-retry batch failed: ${error?.message || 'unknown error'}`);
    } finally {
      this.isAutoRetryRunning = false;
    }
  }

  private async transitionStatus(id: string, status: CampaignStatus): Promise<Campaign> {
    const updated = await this.databaseService.campaign.update({
      where: { id },
      data: { status },
      include: { submissions: true, applications: true },
    });
    return this.mapCampaign(updated);
  }

  async uploadBrandAsset(
    file: { buffer?: Buffer; originalname?: string; size?: number },
    brandUserId: string,
  ): Promise<{ url: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    const maxBytes = 50 * 1024 * 1024;
    const size = file.size ?? file.buffer.length;
    if (size > maxBytes) {
      throw new BadRequestException('File is too large (max 50MB)');
    }
    const rawExt = extname(file.originalname || '');
    const safeExt = /^\.[a-zA-Z0-9]+$/.test(rawExt) ? rawExt : '';
    const baseDir = join(process.cwd(), 'uploads', 'campaign-assets', brandUserId);
    await mkdir(baseDir, { recursive: true });
    const filename = `${randomUUID()}${safeExt}`;
    const dest = join(baseDir, filename);
    await writeFile(dest, file.buffer);
    const port = this.configService.get<number>('SERVICE_PORT', 9011);
    const publicBase =
      this.configService.get<string>('PUBLIC_ASSET_BASE_URL')?.replace(/\/$/, '') ||
      `http://localhost:${port}`;
    const url = `${publicBase}/api/uploads/campaign-assets/${encodeURIComponent(brandUserId)}/${encodeURIComponent(filename)}`;
    return { url };
  }

  private async assertCampaignAccess(campaignId: string, user: { id: string; role: string }) {
    const campaign = await this.databaseService.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    const isPrivileged = user.role === 'ADMIN' || user.role === 'OWNER';
    if (!isPrivileged && campaign.brandId !== user.id) {
      throw new ForbiddenException('You do not have permission to access this campaign');
    }
    return campaign;
  }

  private async completeCampaign(campaignId: string, reason: string) {
    await this.databaseService.campaign.update({
      where: { id: campaignId },
      data: { status: 'COMPLETED' },
    });
    await this.databaseService.walletSyncEvent.create({
      data: {
        eventType: 'CAMPAIGN_COMPLETED',
        status: 'SYNCED',
        attempts: 1,
        payload: {
          campaignId,
          reason,
          completedAt: new Date().toISOString(),
        },
      },
    });
  }

  private async assertCampaignOwnership(campaignId: string, brandUserId: string) {
    const campaign = await this.databaseService.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    if (campaign.brandId !== brandUserId) {
      throw new ForbiddenException('You do not have permission to access this campaign');
    }
    return campaign;
  }

  private mapApplication(row: any): CampaignApplicationView {
    return {
      id: row.id,
      campaignId: row.campaignId,
      creatorId: row.creatorId,
      status: row.status,
      draftMediaUrl: row.draftMediaUrl || undefined,
      draftMediaAssetId: row.draftMediaAssetId || undefined,
      platform: row.platform || undefined,
      termsAccepted: Boolean(row.termsAccepted),
      termsAcceptedAt: row.termsAcceptedAt ? row.termsAcceptedAt.toISOString() : undefined,
      reviewedBy: row.reviewedBy || undefined,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : undefined,
      reviewComment: row.reviewComment || undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapPostSubmission(row: any): CampaignPostSubmissionView {
    return {
      id: row.id,
      campaignId: row.campaignId,
      creatorId: row.creatorId,
      applicationId: row.applicationId || undefined,
      postUrl: row.postUrl,
      platform: row.platform,
      status: row.status,
      reviewedBy: row.reviewedBy || undefined,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : undefined,
      reviewComment: row.reviewComment || undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapCampaign(row: any): Campaign {
    const submissions = row.submissions || [];
    const applications = row.applications || [];
    return {
      id: row.id,
      brandId: row.brandId,
      name: row.name,
      description: row.description,
      status: row.status,
      postedAt: row.createdAt.toISOString(),
      deadlineToApply: row.deadlineToApply.toISOString(),
      startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(),
      payoutRate: Number(row.payoutRate),
      totalBudget: Number(row.totalBudget),
      budgetUsed: Number(row.budgetUsed),
      remainingBudget: Math.max(Number(row.totalBudget) - Number(row.budgetUsed), 0),
      views: row.views,
      targetViews: row.targetViews,
      applicantsCount: applications.length,
      shortlistedCount: applications.filter((application: any) => application.status === 'APPROVED').length,
      brandAssetsUrl: row.brandAssetsUrl || undefined,
      campaignType: row.campaignType || undefined,
      industry: row.industry || undefined,
      platformTarget: row.platformTarget || undefined,
      regionFilter: row.regionFilter || undefined,
    };
  }

  private mapSubmission(submission: any): Submission {
    return {
      id: submission.id,
      campaignId: submission.campaignId,
      creatorId: submission.creatorId,
      creatorName: submission.creatorName,
      creatorHandle: submission.creatorHandle,
      contentUrl: submission.contentUrl,
      platform: submission.platform,
      status: submission.status,
      createdAt: submission.createdAt.toISOString(),
      comment: submission.comment || undefined,
      views: submission.views,
      earnings: Number(submission.earnings),
    };
  }

  private async removeLegacySeedCampaigns() {
    const removed = await this.databaseService.campaign.deleteMany({
      where: {
        brandId: 'seed-brand',
      },
    });
    if (removed.count > 0) {
      this.logger.log(`Removed ${removed.count} legacy seed campaign(s)`);
    }
  }
}
