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
  DisqualifyPostDto,
  ReviewPostSubmissionDto,
  ReviewSubmissionDto,
  UpdateCampaignDto,
  UpdatePostViewsDto,
  VerifyPostViewsDto,
} from './dto/campaign.dto';
import { DatabaseService } from '../common/database/database.service';
import { WalletSyncService } from './wallet-sync.service';
import { CampaignMediaService } from './campaign-media.service';
import { CampaignNotificationService } from './campaign-notification.service';
import { CampaignFinalizationService } from './campaign-finalization.service';
import { SsembleService } from '../ssemble/ssemble.service';
import {
  AddSourceVideoDto,
  UpdateSourceVideoDto,
  GenerateClipsDto,
} from '../ssemble/dto/ssemble.dto';
import { endOfIstDay, isAfterCampaignEndDay, isOnOrBeforeDeadlineDay, isOnOrAfterCampaignStartDay, isStartAtLeastOneDayAfterDeadline, startOfIstDay } from './utils/date-compare.util';
import { resolvePrizePoolConfig } from './prize-pool';
import { formatDisqualifiedReason } from './utils/disqualified-reason.util';
import { Prisma } from '@prisma/client';

export type CampaignStatus = 'LIVE' | 'IN_PROGRESS' | 'COMPLETED' | 'PAUSED' | 'DRAFT';
export type SubmissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Campaign {
  id: string;
  brandId?: string;
  name: string;
  description: string;
  status: CampaignStatus;
  payoutModel: 'CPM' | 'POOL';
  postedAt: string;
  deadlineToApply: string;
  startDate: string;
  endDate: string;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  manuallyStartedBy?: string | null;
  manuallyEndedBy?: string | null;
  payoutRate: number | null;
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
  prizePoolJson?: any;
  tieBreaker?: string;
  minViewsToQualify?: number;
  gracePeriodHours?: number;
  previewN?: number;
  finalizationStatus?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  finalizedAt?: string | null;
  finalizationError?: string | null;
  exceptionRefundAmountPaise?: string | null;
  manualScrapeCooldownSec?: number;
  lastManualScrapeAt?: string | null;
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
  currentViews?: number;
  disqualifiedAt?: string;
  disqualifiedReason?: string;
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
    private readonly campaignFinalizationService: CampaignFinalizationService,
    private readonly ssembleService: SsembleService,
  ) {}

  private getIdempotencyKey(scope: string, ids: Array<string | number>) {
    return `campaign-service:${scope}:${ids.join(':')}`;
  }

  private assertCampaignDateOrder(deadlineToApply: string, startDate: string, endDate: string) {
    if (!isStartAtLeastOneDayAfterDeadline(deadlineToApply, startDate)) {
      throw new BadRequestException(
        'Campaign start date must be at least one day after the deadline to apply',
      );
    }
    const start = startOfIstDay(startDate);
    const end = startOfIstDay(endDate);
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('Campaign end date must be after the start date');
    }
  }

  /** Effective campaign start instant for gating post submissions and scraper validation. */
  getEffectiveCampaignStart(row: {
    startDate: Date | string;
    actualStartDate?: Date | string | null;
  }): Date {
    if (row.actualStartDate) {
      return new Date(row.actualStartDate);
    }
    return startOfIstDay(row.startDate);
  }

  /** Effective deadline for applications. If manually started, deadline = actualStartDate. */
  getEffectiveDeadline(row: {
    deadlineToApply: Date | string;
    actualStartDate?: Date | string | null;
  }): Date {
    if (row.actualStartDate) {
      return new Date(row.actualStartDate);
    }
    return new Date(row.deadlineToApply);
  }

  /** Effective campaign end instant for finalization. */
  getEffectiveCampaignEnd(row: {
    endDate: Date | string;
    actualEndDate?: Date | string | null;
  }): Date {
    if (row.actualEndDate) {
      return new Date(row.actualEndDate);
    }
    return new Date(row.endDate);
  }

  /** Whether the campaign running phase has begun (post link submissions allowed). */
  hasCampaignStarted(row: {
    status: string;
    startDate: Date | string;
    actualStartDate?: Date | string | null;
  }): boolean {
    if (row.status === 'IN_PROGRESS') {
      return true;
    }
    if (row.status !== 'LIVE') {
      return false;
    }
    return isOnOrAfterCampaignStartDay(this.getEffectiveCampaignStart(row), new Date());
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
        ...(deadlineNotPassed
          ? {
              deadlineToApply: { gte: now },
              actualStartDate: null,
            }
          : {}),
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
    this.assertCampaignDateOrder(dto.deadlineToApply, dto.startDate, dto.endDate);
    const payoutModel = dto.payoutModel || 'POOL';
    const totalBudget = Number(dto.totalBudget);
    const payoutRate = payoutModel === 'CPM' ? Number(dto.payoutRate) : null;
    if (payoutModel === 'CPM' && (!payoutRate || payoutRate <= 0)) {
      throw new BadRequestException('CPM campaigns require a positive payoutRate');
    }
    const targetViews =
      payoutModel === 'CPM' && payoutRate ? Math.floor((totalBudget / payoutRate) * 1000) : 0;

    let prizePoolJson: any = null;
    let tieBreaker = 'EARLIER_VERIFIED_POST';
    let minViewsToQualify = 0;
    let gracePeriodHours = 24;
    if (payoutModel === 'POOL') {
      const config = resolvePrizePoolConfig(dto.prizePool);
      prizePoolJson = {
        templateKey: config.templateKey,
        tiers: config.tiers,
        tieBreaker: config.tieBreaker,
        minViewsToQualify: config.minViewsToQualify,
        gracePeriodHours: config.gracePeriodHours,
      };
      tieBreaker = config.tieBreaker;
      minViewsToQualify = config.minViewsToQualify;
      gracePeriodHours = config.gracePeriodHours;
    }

    const created = await this.databaseService.campaign.create({
      data: {
        brandId: brandUserId,
        name: dto.name,
        description: dto.description,
        status: 'DRAFT',
        payoutModel,
        deadlineToApply: endOfIstDay(dto.deadlineToApply),
        startDate: startOfIstDay(dto.startDate),
        endDate: endOfIstDay(dto.endDate),
        payoutRate,
        totalBudget,
        budgetUsed: 0,
        views: 0,
        targetViews,
        brandAssetsUrl: dto.brandAssetsUrl,
        campaignType: dto.campaignType ?? (payoutModel === 'POOL' ? 'POOL_LEADERBOARD' : 'REPOST_CPM'),
        industry: dto.industry,
        platformTarget: dto.platformTarget,
        regionFilter: dto.regionFilter,
        prizePoolJson,
        tieBreaker,
        minViewsToQualify,
        gracePeriodHours,
        previewN: dto.previewN ?? 10,
      },
      include: { submissions: true, applications: true },
    });
    return this.mapCampaign(created);
  }

  async updateCampaign(id: string, dto: UpdateCampaignDto, brandUserId: string): Promise<Campaign> {
    const campaign = await this.assertCampaignOwnership(id, brandUserId);
    const isDraft = campaign.status === 'DRAFT';

    const totalBudget = dto.totalBudget !== undefined ? Number(dto.totalBudget) : Number(campaign.totalBudget);
    const payoutModel = (dto.payoutModel || campaign.payoutModel) as 'CPM' | 'POOL';
    const payoutRate =
      dto.payoutRate !== undefined ? Number(dto.payoutRate) : campaign.payoutRate ? Number(campaign.payoutRate) : null;

    // Post-publish: only metadata copy (name/description/brandAssetsUrl) may change.
    if (!isDraft) {
      const allowed: Prisma.CampaignUpdateInput = {};
      if (dto.name !== undefined) allowed.name = dto.name;
      if (dto.description !== undefined) allowed.description = dto.description;
      if (dto.brandAssetsUrl !== undefined) allowed.brandAssetsUrl = dto.brandAssetsUrl;
      if (Object.keys(allowed).length === 0) {
        return this.mapCampaign(campaign);
      }
      const updated = await this.databaseService.campaign.update({
        where: { id },
        data: allowed,
        include: { submissions: true, applications: true },
      });
      return this.mapCampaign(updated);
    }

    // Draft: full edits allowed.
    const deadlineToApply = dto.deadlineToApply ?? campaign.deadlineToApply.toISOString().slice(0, 10);
    const startDate = dto.startDate ?? campaign.startDate.toISOString().slice(0, 10);
    const endDate = dto.endDate ?? campaign.endDate.toISOString().slice(0, 10);
    this.assertCampaignDateOrder(deadlineToApply, startDate, endDate);

    let prizePoolJson: any = campaign.prizePoolJson;
    let tieBreaker = campaign.tieBreaker;
    let minViewsToQualify = campaign.minViewsToQualify;
    let gracePeriodHours = campaign.gracePeriodHours;
    if (payoutModel === 'POOL' && (dto.prizePool || campaign.prizePoolJson === null)) {
      const config = resolvePrizePoolConfig(dto.prizePool || (campaign.prizePoolJson as any));
      prizePoolJson = {
        templateKey: config.templateKey,
        tiers: config.tiers,
        tieBreaker: config.tieBreaker,
        minViewsToQualify: config.minViewsToQualify,
        gracePeriodHours: config.gracePeriodHours,
      };
      tieBreaker = config.tieBreaker;
      minViewsToQualify = config.minViewsToQualify;
      gracePeriodHours = config.gracePeriodHours;
    }

    const targetViews =
      payoutModel === 'CPM' && payoutRate ? Math.floor((totalBudget / Math.max(payoutRate, 1)) * 1000) : 0;

    const updated = await this.databaseService.campaign.update({
      where: { id },
      data: {
        name: dto.name ?? campaign.name,
        description: dto.description ?? campaign.description,
        brandAssetsUrl: dto.brandAssetsUrl ?? campaign.brandAssetsUrl,
        ...(dto.deadlineToApply ? { deadlineToApply: endOfIstDay(dto.deadlineToApply) } : {}),
        ...(dto.startDate ? { startDate: startOfIstDay(dto.startDate) } : {}),
        ...(dto.endDate ? { endDate: endOfIstDay(dto.endDate) } : {}),
        ...(dto.industry !== undefined ? { industry: dto.industry } : {}),
        ...(dto.platformTarget !== undefined ? { platformTarget: dto.platformTarget } : {}),
        ...(dto.regionFilter !== undefined ? { regionFilter: dto.regionFilter } : {}),
        payoutModel,
        totalBudget,
        payoutRate,
        targetViews,
        prizePoolJson,
        tieBreaker,
        minViewsToQualify,
        gracePeriodHours,
        ...(dto.previewN !== undefined ? { previewN: dto.previewN } : {}),
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
    const campaign = await this.assertCampaignOwnership(id, brandUserId);
    const row = await this.databaseService.campaign.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Campaign not found');
    }
    const targetStatus = this.hasCampaignStarted(row) ? 'IN_PROGRESS' : 'LIVE';
    return this.transitionStatus(id, targetStatus);
  }

  async getPendingApplicationsCount(campaignId: string, brandUserId: string): Promise<{ count: number }> {
    await this.assertCampaignOwnership(campaignId, brandUserId);
    const count = await this.databaseService.campaignApplication.count({
      where: { campaignId, status: 'APPLIED' },
    });
    return { count };
  }

  async startCampaignManually(
    campaignId: string,
    brandUserId: string,
    options?: { handlePendingAs?: 'REJECT_ALL' | 'KEEP_PENDING' },
  ): Promise<{
    campaign: Campaign;
    pendingApplicationsCount: number;
    rejectedCount?: number;
  }> {
    const campaign = await this.assertCampaignOwnership(campaignId, brandUserId);
    if (campaign.status !== 'LIVE') {
      throw new BadRequestException('Campaign must be in LIVE status to start manually');
    }
    if (campaign.actualStartDate) {
      throw new BadRequestException('Campaign has already been started');
    }
    const now = new Date();
    const scheduledStart = startOfIstDay(campaign.startDate);
    if (now.getTime() >= scheduledStart.getTime()) {
      throw new BadRequestException('Campaign has already reached its scheduled start date');
    }

    const pendingApplications = await this.databaseService.campaignApplication.findMany({
      where: { campaignId, status: 'APPLIED' },
    });

    let rejectedCount = 0;
    if (options?.handlePendingAs === 'REJECT_ALL' && pendingApplications.length > 0) {
      await this.databaseService.campaignApplication.updateMany({
        where: { campaignId, status: 'APPLIED' },
        data: { status: 'REJECTED', reviewedAt: now, reviewedBy: brandUserId },
      });
      rejectedCount = pendingApplications.length;
    }

    const updated = await this.databaseService.campaign.update({
      where: { id: campaignId },
      data: {
        actualStartDate: now,
        manuallyStartedBy: brandUserId,
        status: 'IN_PROGRESS',
      },
      include: { submissions: true, applications: true },
    });

    const approvedApps = await this.databaseService.campaignApplication.findMany({
      where: { campaignId, status: 'APPROVED' },
    });
    for (const app of approvedApps) {
      void this.notificationService.notifyCampaignStarted({
        creatorId: app.creatorId,
        campaignId,
        campaignName: campaign.name,
      });
    }

    return {
      campaign: this.mapCampaign(updated),
      pendingApplicationsCount: pendingApplications.length,
      rejectedCount,
    };
  }

  async endCampaignManually(
    campaignId: string,
    brandUserId: string,
    options?: { skipGracePeriod?: boolean },
  ): Promise<Campaign> {
    const campaign = await this.assertCampaignOwnership(campaignId, brandUserId);
    const row = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!row) {
      throw new NotFoundException('Campaign not found');
    }
    if (row.status !== 'IN_PROGRESS' && row.status !== 'LIVE') {
      throw new BadRequestException('Campaign must be active to end manually');
    }
    if (row.status === 'LIVE' && !this.hasCampaignStarted(row)) {
      throw new BadRequestException('Campaign has not started yet — use Start Campaign first');
    }
    if (row.actualEndDate) {
      throw new BadRequestException('Campaign has already been ended manually');
    }

    const now = new Date();
    await this.databaseService.campaign.update({
      where: { id: campaignId },
      data: {
        actualEndDate: now,
        manuallyEndedBy: brandUserId,
      },
    });

    if (options?.skipGracePeriod && campaign.payoutModel === 'POOL') {
      await this.campaignFinalizationService.finalizeCampaign(
        campaignId,
        { id: brandUserId, role: 'BRAND' },
        { force: true },
      );
    }

    return this.getCampaign(campaignId);
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
    const newTotalBudget = Number(campaign.totalBudget) + amount;
    const newTargetViews =
      campaign.payoutModel === 'CPM' && campaign.payoutRate
        ? Math.floor((newTotalBudget / Math.max(Number(campaign.payoutRate), 1)) * 1000)
        : campaign.targetViews;
    const updated = await this.databaseService.campaign.update({
      where: { id },
      data: {
        totalBudget: newTotalBudget,
        targetViews: newTargetViews,
      },
      include: { submissions: true, applications: true },
    });
    if (campaign.payoutModel === 'POOL') {
      this.notificationService.emitLeaderboardUpdated({
        campaignId: id,
        campaignName: campaign.name,
        triggeredBy: 'budget-topup',
      });
    }
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
    if (campaign.status !== 'LIVE') {
      throw new BadRequestException('Applications are allowed only during the live application phase');
    }
    const now = new Date();
    if (!isOnOrBeforeDeadlineDay(campaign.deadlineToApply, now)) {
      throw new BadRequestException('Application deadline has passed');
    }
    if (this.hasCampaignStarted({
      status: campaign.status,
      startDate: campaign.startDate,
      actualStartDate: campaign.actualStartDate,
    })) {
      throw new BadRequestException('Application period has ended — the campaign has started');
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

    if (application.campaign.payoutModel === 'POOL') {
      this.notificationService.emitLeaderboardUpdated({
        campaignId: application.campaignId,
        campaignName: application.campaign.name,
        triggeredBy: `application-${updated.status.toLowerCase()}`,
      });
    }

    return this.mapApplication(updated);
  }

  async submitFinalPostLink(
    campaignId: string,
    creatorId: string,
    dto: CreatePostSubmissionDto,
  ): Promise<CampaignPostSubmissionView> {
    const campaignRow = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!campaignRow) {
      throw new NotFoundException('Campaign not found');
    }
    if (campaignRow.status !== 'LIVE' && campaignRow.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Campaign is not active');
    }
    const now = new Date();
    const effectiveEnd = campaignRow.actualEndDate ?? campaignRow.endDate;
    if (isAfterCampaignEndDay(effectiveEnd, now)) {
      throw new BadRequestException('Campaign has already ended');
    }
    if (!this.hasCampaignStarted(campaignRow)) {
      throw new BadRequestException(
        'Campaign has not started yet. Final post submissions open after the campaign start date.',
      );
    }
    const campaign = this.mapCampaign(campaignRow);
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

    if (campaign.payoutModel === 'POOL') {
      this.notificationService.emitLeaderboardUpdated({
        campaignId,
        campaignName: campaign.name,
        triggeredBy: 'post-submitted',
      });
    }

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
    if (existing.campaign.payoutModel === 'POOL') {
      this.notificationService.emitLeaderboardUpdated({
        campaignId: existing.campaignId,
        campaignName: existing.campaign.name,
        triggeredBy: dto.status === 'VERIFIED' ? 'post-verified' : 'post-rejected',
      });
    }
    return this.mapPostSubmission(updated);
  }

  /**
   * Unified entry point used by the brand UI.
   * - For CPM campaigns: behaves as before — accrues earnings against the CPM rate.
   * - For POOL campaigns: simply records the new total view count and emits a leaderboard
   *   update event. Earnings are settled at finalization time.
   */
  async updatePostViews(
    postSubmissionId: string,
    dto: UpdatePostViewsDto,
    actor: { id: string; role: string },
  ) {
    const postSubmission = await this.databaseService.campaignPostSubmission.findUnique({
      where: { id: postSubmissionId },
      include: { campaign: true },
    });
    if (!postSubmission) {
      throw new NotFoundException('Post submission not found');
    }
    const isPrivileged = actor.role === 'ADMIN' || actor.role === 'OWNER';
    if (!isPrivileged && postSubmission.campaign.brandId !== actor.id) {
      throw new ForbiddenException('You do not have permission to update views for this submission');
    }
    if (postSubmission.status !== 'VERIFIED') {
      throw new BadRequestException('Post submission must be verified before view updates');
    }
    if (postSubmission.disqualifiedAt) {
      throw new BadRequestException('Post is disqualified — view updates are not accepted');
    }
    if (postSubmission.campaign.status !== 'LIVE' && postSubmission.campaign.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Campaign is not active');
    }
    if (postSubmission.campaign.payoutModel === 'CPM') {
      return this.verifyPostViewsAndAccrueEarnings(
        postSubmissionId,
        { currentViews: dto.currentViews, note: dto.note },
        actor,
      );
    }
    return this.recordPostViewsFromScraper(postSubmissionId, dto.currentViews, {
      recordedBy: actor.id,
      note: dto.note,
    });
  }

  /**
   * Record POOL view counts from Apify scraper (no brand auth; allows PENDING_REVIEW posts).
   */
  async recordPostViewsFromScraper(
    postSubmissionId: string,
    currentViews: number,
    options: { recordedBy: string; note?: string; skipLeaderboardEmit?: boolean },
  ) {
    const postSubmission = await this.databaseService.campaignPostSubmission.findUnique({
      where: { id: postSubmissionId },
      include: { campaign: true },
    });
    if (!postSubmission) {
      throw new NotFoundException('Post submission not found');
    }
    if (postSubmission.campaign.payoutModel !== 'POOL') {
      throw new BadRequestException('Scraper view updates are only supported for POOL campaigns');
    }
    if (postSubmission.disqualifiedAt) {
      return { success: true, message: 'Post disqualified — skipped', previousViews: postSubmission.currentViews, newViews: postSubmission.currentViews };
    }
    if (
      postSubmission.status !== 'VERIFIED' &&
      postSubmission.status !== 'PENDING_REVIEW'
    ) {
      throw new BadRequestException('Post submission is not eligible for view updates');
    }

    const previousViews = postSubmission.currentViews;
    const newViews = Math.max(previousViews, Math.max(0, Math.floor(currentViews)));
    if (newViews === previousViews) {
      return { success: true, message: 'Views unchanged', previousViews, newViews };
    }
    const updated = await this.databaseService.campaignPostSubmission.update({
      where: { id: postSubmissionId },
      data: {
        currentViews: newViews,
        lastViewsUpdatedAt: new Date(),
      },
    });
    await this.databaseService.campaignPostViewUpdate.create({
      data: {
        postSubmissionId,
        previousViews,
        newViews,
        recordedBy: options.recordedBy,
        note: options.note,
      },
    });
    await this.databaseService.walletSyncEvent.create({
      data: {
        eventType: 'POST_VIEWS_UPDATED',
        status: 'SYNCED',
        attempts: 1,
        payload: {
          campaignId: postSubmission.campaignId,
          creatorId: postSubmission.creatorId,
          postSubmissionId,
          previousViews,
          newViews,
          recordedBy: options.recordedBy,
          note: options.note || null,
          source: 'apify-scraper',
        },
      },
    });
    await this.databaseService.campaign.update({
      where: { id: postSubmission.campaignId },
      data: { views: { increment: Math.max(0, newViews - previousViews) } },
    });
    this.notificationService.emitViewsUpdated({
      campaignId: postSubmission.campaignId,
      campaignName: postSubmission.campaign.name,
      creatorId: postSubmission.creatorId,
      postSubmissionId,
      previousViews,
      newViews,
    });
    if (!options.skipLeaderboardEmit) {
      this.notificationService.emitLeaderboardUpdated({
        campaignId: postSubmission.campaignId,
        campaignName: postSubmission.campaign.name,
        triggeredBy: 'views-updated',
      });
    }
    return {
      success: true,
      previousViews,
      newViews,
      postSubmissionId,
      lastViewsUpdatedAt: updated.lastViewsUpdatedAt?.toISOString(),
    };
  }

  /** Disqualify a post from automated scraper (no brand/admin auth). */
  async disqualifyPostFromScraper(postSubmissionId: string, reason: string) {
    return this.disqualifyPost(postSubmissionId, { reason }, { id: 'apify-scraper', role: 'SYSTEM' });
  }

  /**
   * Mark a verified POOL campaign post as disqualified. Admin/brand-only.
   * Disqualification is reflected in live and final leaderboards and reduces qualifiers count.
   */
  async disqualifyPost(
    postSubmissionId: string,
    dto: DisqualifyPostDto,
    actor: { id: string; role: string },
  ) {
    const postSubmission = await this.databaseService.campaignPostSubmission.findUnique({
      where: { id: postSubmissionId },
      include: { campaign: true },
    });
    if (!postSubmission) {
      throw new NotFoundException('Post submission not found');
    }
    const isPrivileged = actor.role === 'ADMIN' || actor.role === 'OWNER' || actor.role === 'SYSTEM';
    if (!isPrivileged && postSubmission.campaign.brandId !== actor.id) {
      throw new ForbiddenException('You do not have permission to disqualify posts for this submission');
    }
    if (postSubmission.disqualifiedAt) {
      return { success: true, message: 'Already disqualified' };
    }
    await this.databaseService.campaignPostSubmission.update({
      where: { id: postSubmissionId },
      data: {
        disqualifiedAt: new Date(),
        disqualifiedReason: dto.reason,
      },
    });
    await this.databaseService.walletSyncEvent.create({
      data: {
        eventType: 'POST_DISQUALIFIED',
        status: 'SYNCED',
        attempts: 1,
        payload: {
          campaignId: postSubmission.campaignId,
          creatorId: postSubmission.creatorId,
          postSubmissionId,
          actorId: actor.id,
          reason: dto.reason,
          disqualifiedAt: new Date().toISOString(),
        },
      },
    });
    this.notificationService.emitPostDisqualified({
      campaignId: postSubmission.campaignId,
      campaignName: postSubmission.campaign.name,
      creatorId: postSubmission.creatorId,
      postSubmissionId,
      reason: dto.reason,
    });
    this.notificationService.emitLeaderboardUpdated({
      campaignId: postSubmission.campaignId,
      campaignName: postSubmission.campaign.name,
      triggeredBy: 'post-disqualified',
    });
    return { success: true, postSubmissionId };
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
    if (postSubmission.campaign.payoutModel !== 'CPM') {
      throw new BadRequestException('CPM accrual is only available for CPM campaigns');
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
    const cpmRate = Number(postSubmission.campaign.payoutRate ?? 0);
    if (cpmRate <= 0) {
      throw new BadRequestException('Campaign payoutRate is not set for CPM accrual');
    }
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
        const idempotencyKey = this.getIdempotencyKey('creator-earning-credit', [row.id]);
        // Atomically claim the row: only one cron tick can transition LOCKED -> AVAILABLE.
        // This makes the local DB the durable idempotency boundary for the wallet credit
        // attempt below, so a wallet-service restart cannot cause re-crediting.
        const claimed = await this.databaseService.creatorEarning.updateMany({
          where: { id: row.id, status: 'LOCKED' },
          data: { status: 'AVAILABLE', availableAt: now },
        });
        if (claimed.count === 0) {
          continue;
        }
        let walletSynced = false;
        try {
          await this.walletSyncService.addCreatorEarning(
            row.creatorId,
            Number(row.amount),
            row.source === 'POOL'
              ? 'Campaign pool payout (matured)'
              : 'Campaign earnings (matured)',
            {
              creatorId: row.creatorId,
              campaignId: row.campaignId,
              earningId: row.id,
              source: row.source,
              postSubmissionId: row.postSubmissionId,
              amount: Number(row.amount),
              idempotencyKey,
            },
            idempotencyKey,
          );
          walletSynced = true;
        } catch (err) {
          // Local row is already AVAILABLE; enqueue a durable retry so the wallet
          // eventually catches up without the cron re-attempting on every tick.
          await this.databaseService.walletSyncEvent.create({
            data: {
              eventType: 'CREATOR_EARNING_CREDIT',
              status: 'RETRY_PENDING',
              attempts: 0,
              payload: {
                creatorId: row.creatorId,
                campaignId: row.campaignId,
                earningId: row.id,
                amount: Number(row.amount),
                source: row.source,
                postSubmissionId: row.postSubmissionId,
                idempotencyKey,
              },
              lastError: (err as Error).message,
            },
          });
          this.logger.warn(
            `Wallet credit failed for creator ${row.creatorId} earning ${row.id}; queued for retry: ${(err as Error).message}`,
          );
        }
        await this.databaseService.walletSyncEvent.create({
          data: {
            eventType: 'EARNING_UNLOCKED',
            status: walletSynced ? 'SYNCED' : 'RETRY_PENDING',
            attempts: 1,
            payload: {
              campaignId: row.campaignId,
              creatorId: row.creatorId,
              postSubmissionId: row.postSubmissionId,
              earningId: row.id,
              amount: Number(row.amount),
              source: row.source,
              walletSynced,
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
      } else if (event.eventType === 'BRAND_BUDGET_REFUND') {
        await this.walletSyncService.refundBrandBudget(
          payload.brandId || payload.userId,
          Number(payload.amount),
          payload.description || 'Campaign refund (retry)',
          payload,
          payload.idempotencyKey || this.getIdempotencyKey('brand-budget-refund', [event.id]),
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
      currentViews: row.currentViews ?? 0,
      disqualifiedAt: row.disqualifiedAt ? row.disqualifiedAt.toISOString() : undefined,
      disqualifiedReason: row.disqualifiedReason
        ? formatDisqualifiedReason(row.disqualifiedReason)
        : undefined,
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
      payoutModel: row.payoutModel,
      postedAt: row.createdAt.toISOString(),
      deadlineToApply: row.deadlineToApply.toISOString(),
      startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(),
      actualStartDate: row.actualStartDate ? row.actualStartDate.toISOString() : null,
      actualEndDate: row.actualEndDate ? row.actualEndDate.toISOString() : null,
      manuallyStartedBy: row.manuallyStartedBy ?? null,
      manuallyEndedBy: row.manuallyEndedBy ?? null,
      payoutRate: row.payoutRate !== null && row.payoutRate !== undefined ? Number(row.payoutRate) : null,
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
      prizePoolJson: row.prizePoolJson ?? null,
      tieBreaker: row.tieBreaker || undefined,
      minViewsToQualify: row.minViewsToQualify ?? undefined,
      gracePeriodHours: row.gracePeriodHours ?? undefined,
      previewN: row.previewN ?? undefined,
      finalizationStatus: row.finalizationStatus,
      finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
      finalizationError: row.finalizationError ?? null,
      exceptionRefundAmountPaise: row.exceptionRefundAmountPaise != null
        ? row.exceptionRefundAmountPaise.toString()
        : null,
      manualScrapeCooldownSec: row.manualScrapeCooldownSec ?? 
        Number(this.configService.get<string>('MANUAL_SCRAPE_COOLDOWN_SECONDS', '21600')),
      lastManualScrapeAt: row.lastManualScrapeAt ? row.lastManualScrapeAt.toISOString() : null,
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

  // ==================== SOURCE VIDEO CRUD ====================

  async addSourceVideo(
    campaignId: string,
    dto: AddSourceVideoDto,
    user: { id: string; role: string },
  ) {
    const campaign = await this.assertCampaignOwnershipOrAdmin(campaignId, user);
    
    const urlType = this.ssembleService.detectUrlType(dto.url);
    if (urlType === 'INVALID') {
      throw new BadRequestException('Invalid video URL. Please provide a valid YouTube URL or direct video link.');
    }

    let thumbnailUrl: string | undefined;
    if (urlType === 'YOUTUBE') {
      const videoId = this.ssembleService.extractYouTubeVideoId(dto.url);
      if (videoId) {
        thumbnailUrl = this.ssembleService.buildYouTubeThumbnailUrl(videoId);
      }
    }

    const maxOrder = await this.databaseService.campaignSourceVideo.aggregate({
      where: { campaignId },
      _max: { orderIndex: true },
    });
    const nextOrder = (maxOrder._max.orderIndex ?? -1) + 1;

    const sourceVideo = await this.databaseService.campaignSourceVideo.create({
      data: {
        campaignId,
        url: dto.url,
        urlType,
        title: dto.title || null,
        thumbnailUrl: thumbnailUrl || null,
        orderIndex: nextOrder,
      },
    });

    this.logger.log(`Added source video ${sourceVideo.id} to campaign ${campaignId}`);
    return sourceVideo;
  }

  async getSourceVideos(campaignId: string) {
    const campaign = await this.databaseService.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const videos = await this.databaseService.campaignSourceVideo.findMany({
      where: { campaignId },
      orderBy: { orderIndex: 'asc' },
      include: {
        _count: {
          select: { clipRequests: true },
        },
      },
    });

    return videos.map((v) => ({
      ...v,
      clipRequestCount: v._count.clipRequests,
    }));
  }

  async updateSourceVideo(
    campaignId: string,
    videoId: string,
    dto: UpdateSourceVideoDto,
    user: { id: string; role: string },
  ) {
    await this.assertCampaignOwnershipOrAdmin(campaignId, user);

    const video = await this.databaseService.campaignSourceVideo.findFirst({
      where: { id: videoId, campaignId },
    });
    if (!video) {
      throw new NotFoundException('Source video not found');
    }

    const updated = await this.databaseService.campaignSourceVideo.update({
      where: { id: videoId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
      },
    });

    return updated;
  }

  async deleteSourceVideo(
    campaignId: string,
    videoId: string,
    user: { id: string; role: string },
  ) {
    await this.assertCampaignOwnershipOrAdmin(campaignId, user);

    const video = await this.databaseService.campaignSourceVideo.findFirst({
      where: { id: videoId, campaignId },
    });
    if (!video) {
      throw new NotFoundException('Source video not found');
    }

    await this.databaseService.campaignSourceVideo.delete({
      where: { id: videoId },
    });

    this.logger.log(`Deleted source video ${videoId} from campaign ${campaignId}`);
    return { success: true };
  }

  // ==================== SSEMBLE CLIP GENERATION ====================

  async generateClips(campaignId: string, dto: GenerateClipsDto, creatorId: string) {
    const campaign = await this.databaseService.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const sourceVideo = await this.databaseService.campaignSourceVideo.findFirst({
      where: { id: dto.sourceVideoId, campaignId },
    });
    if (!sourceVideo) {
      throw new NotFoundException('Source video not found');
    }

    if (dto.endSec <= dto.startSec) {
      throw new BadRequestException('End time must be after start time');
    }
    if (dto.endSec - dto.startSec > 1200) {
      throw new BadRequestException('Maximum clip window is 20 minutes (1200 seconds)');
    }

    const clipRequest = await this.databaseService.ssembleClipRequest.create({
      data: {
        sourceVideoId: dto.sourceVideoId,
        creatorId,
        campaignId,
        status: 'QUEUED',
        progress: 0,
        startSec: dto.startSec,
        endSec: dto.endSec,
        preferredLength: dto.preferredLength || 'under60sec',
        language: dto.language || 'en',
        captionLanguage: dto.captionLanguage || null,
        templateId: dto.templateId || null,
        hookTitle: dto.hookTitle || false,
        memeHook: dto.memeHook || false,
        memeHookName: dto.memeHookName || null,
        gameVideo: dto.gameVideo || false,
        gameVideoName: dto.gameVideoName || null,
        ctaEnabled: dto.ctaEnabled || false,
        ctaText: dto.ctaText || null,
        music: dto.music || false,
        musicName: dto.musicName || null,
        musicVolume: dto.musicVolume ?? 10,
        layout: dto.layout || 'auto',
      },
    });

    try {
      const backendUrl = this.configService.get<string>('PUBLIC_ASSET_BASE_URL') || '';
      
      const ssembleParams: any = {
        start: dto.startSec,
        end: dto.endSec,
        preferredLength: dto.preferredLength || 'under60sec',
        language: dto.language || 'en',
      };
      
      // Only add webhookUrl if we have a non-localhost public URL
      // Ssemble rejects localhost/loopback webhook URLs
      if (backendUrl && !backendUrl.includes('localhost') && !backendUrl.includes('127.0.0.1')) {
        ssembleParams.webhookUrl = `${backendUrl}/api/internal/ssemble/webhook`;
      } else {
        this.logger.warn('Webhook URL not configured - will rely on polling for status updates');
      }

      if (sourceVideo.urlType === 'YOUTUBE') {
        ssembleParams.url = sourceVideo.url;
      } else {
        ssembleParams.fileUrl = sourceVideo.url;
      }

      if (dto.captionLanguage) ssembleParams.captionLanguage = dto.captionLanguage;
      if (dto.templateId) ssembleParams.templateId = dto.templateId;
      if (dto.hookTitle) ssembleParams.hookTitle = true;
      if (dto.memeHook) {
        ssembleParams.memeHook = true;
        if (dto.memeHookName) ssembleParams.memeHookName = dto.memeHookName;
      }
      if (dto.gameVideo) {
        ssembleParams.gameVideo = true;
        if (dto.gameVideoName) ssembleParams.gameVideoName = dto.gameVideoName;
      }
      if (dto.ctaEnabled) {
        ssembleParams.ctaEnabled = true;
        if (dto.ctaText) ssembleParams.ctaText = dto.ctaText;
      }
      if (dto.music) {
        ssembleParams.music = true;
        if (dto.musicName) ssembleParams.musicName = dto.musicName;
        if (dto.musicVolume !== undefined) ssembleParams.musicVolume = dto.musicVolume;
      }
      if (dto.layout) ssembleParams.layout = dto.layout;

      const response = await this.ssembleService.createShort(ssembleParams);

      await this.databaseService.ssembleClipRequest.update({
        where: { id: clipRequest.id },
        data: {
          ssembleRequestId: response.requestId,
          status: 'PROCESSING',
        },
      });

      this.logger.log(`Started Ssemble clip generation: requestId=${response.requestId}, dbId=${clipRequest.id}`);

      return {
        ...clipRequest,
        ssembleRequestId: response.requestId,
        status: 'PROCESSING',
        estimatedCompletionTime: response.estimatedCompletionTime,
      };
    } catch (error) {
      await this.databaseService.ssembleClipRequest.update({
        where: { id: clipRequest.id },
        data: {
          status: 'FAILED',
          errorMessage: error.message || 'Failed to start clip generation',
        },
      });
      throw error;
    }
  }

  async getMyClipRequests(campaignId: string, creatorId: string) {
    const campaign = await this.databaseService.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const requests = await this.databaseService.ssembleClipRequest.findMany({
      where: { campaignId, creatorId },
      include: {
        clips: {
          orderBy: { viralScore: 'desc' },
        },
        sourceVideo: {
          select: { id: true, url: true, urlType: true, title: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests;
  }

  async getClipRequestDetail(campaignId: string, requestId: string, creatorId: string) {
    const request = await this.databaseService.ssembleClipRequest.findFirst({
      where: { id: requestId, campaignId, creatorId },
      include: {
        clips: {
          orderBy: { viralScore: 'desc' },
        },
        sourceVideo: {
          select: { id: true, url: true, urlType: true, title: true },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Clip request not found');
    }

    return request;
  }

  private async assertCampaignOwnershipOrAdmin(
    campaignId: string,
    user: { id: string; role: string },
  ) {
    const campaign = await this.databaseService.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    if (user.role !== 'ADMIN' && user.role !== 'OWNER' && campaign.brandId !== user.id) {
      throw new ForbiddenException('You do not have permission to access this campaign');
    }
    return campaign;
  }
}
