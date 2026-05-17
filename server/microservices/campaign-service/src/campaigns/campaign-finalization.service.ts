import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Campaign, FinalizationStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../common/database/database.service';
import { LeaderboardService } from './leaderboard.service';
import { CampaignNotificationService } from './campaign-notification.service';
import { WalletSyncService } from './wallet-sync.service';

const POOL_LOCKUP_DAYS = 14;

@Injectable()
export class CampaignFinalizationService {
  private readonly logger = new Logger(CampaignFinalizationService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly leaderboardService: LeaderboardService,
    private readonly walletSyncService: WalletSyncService,
    private readonly notificationService: CampaignNotificationService,
  ) {}

  /**
   * Finalize a POOL campaign:
   *  - Validate eligibility (verified post, min views, not disqualified).
   *  - Compute allocation; persist CreatorEarning rows for qualifiers and snapshot rows for both
   *    qualifiers and dropped creators.
   *  - If zero qualifiers: refund the brand budget (exception path).
   *  - Mark campaign COMPLETED with finalizationStatus=COMPLETED.
   *
   * Idempotent: if `finalizationStatus` is already COMPLETED, returns the existing summary.
   * Re-entrancy guarded: if a row is in RUNNING and `force` is false, this throws.
   */
  async finalizeCampaign(
    campaignId: string,
    actor: { id: string; role: string } | { id: string; role: 'CRON' },
    options: { force?: boolean } = {},
  ): Promise<{
    success: boolean;
    finalizationStatus: FinalizationStatus;
    qualifiersCount: number;
    droppedCount: number;
    distributedPaise: string;
    refundPaise: string;
    finalizationId: string;
  }> {
    const campaign = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    if (campaign.payoutModel !== 'POOL') {
      throw new BadRequestException('Only POOL campaigns can be finalized via this path');
    }
    if (campaign.finalizationStatus === 'COMPLETED') {
      const existing = await this.databaseService.campaignLeaderboardSnapshot.findFirst({
        where: { campaignId, rank: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      const finalizationId = existing?.finalizationId || 'completed';
      const [qualifiersCount, droppedCount] = await Promise.all([
        this.databaseService.campaignLeaderboardSnapshot.count({ where: { campaignId, rank: { not: null } } }),
        this.databaseService.campaignLeaderboardSnapshot.count({ where: { campaignId, rank: null } }),
      ]);
      return {
        success: true,
        finalizationStatus: 'COMPLETED',
        qualifiersCount,
        droppedCount,
        distributedPaise: campaign.exceptionRefundAmountPaise == null ? '0' : '0',
        refundPaise: campaign.exceptionRefundAmountPaise?.toString() || '0',
        finalizationId,
      };
    }

    const isPrivileged = actor.role === 'ADMIN' || actor.role === 'OWNER' || actor.role === 'CRON';
    if (!isPrivileged && campaign.brandId !== actor.id) {
      throw new ForbiddenException('You do not have permission to finalize this campaign');
    }

    if (!options.force && !this.isPastFinalizationWindow(campaign)) {
      throw new BadRequestException(
        'Campaign is not past the finalization window (endDate + gracePeriodHours). Use force=true to override.',
      );
    }

    if (campaign.finalizationStatus === 'RUNNING' && !options.force) {
      throw new BadRequestException('Finalization is already running for this campaign');
    }

    // Mark as RUNNING (and bump attempts).
    await this.databaseService.campaign.update({
      where: { id: campaignId },
      data: {
        finalizationStatus: 'RUNNING',
        finalizationAttempts: { increment: 1 },
      },
    });

    const finalizationId = randomUUID();
    const now = new Date();
    const unlockAt = new Date(now.getTime() + POOL_LOCKUP_DAYS * 24 * 60 * 60 * 1000);

    try {
      const allocationResult = await this.leaderboardService.computeFinalAllocation(campaignId);
      const { qualifying, dropped, totalPoolPaise } = allocationResult;

      let distributedPaise = 0n;
      let refundPaise = 0n;

      await this.databaseService.$transaction(async (tx) => {
        // Wipe any prior snapshot rows from a failed run for this campaign.
        await tx.campaignLeaderboardSnapshot.deleteMany({ where: { campaignId } });

        if (qualifying.length === 0) {
          // Exception path: refund the brand the entire reserved budget (totalBudget − budgetUsed).
          const reservedRupees = Number(campaign.totalBudget) - Number(campaign.budgetUsed);
          const reservedPaise = BigInt(Math.max(0, Math.round(reservedRupees * 100)));
          refundPaise = reservedPaise;
          await tx.campaign.update({
            where: { id: campaignId },
            data: {
              exceptionRefundAmountPaise: refundPaise,
              status: 'COMPLETED',
              finalizationStatus: 'COMPLETED',
              finalizedAt: now,
              finalizationError: null,
            },
          });
        } else {
          // Persist a CreatorEarning per qualifying creator (LOCKED with 14-day unlock).
          for (const entry of qualifying) {
            await tx.creatorEarning.create({
              data: {
                campaignId,
                creatorId: entry.creatorId,
                postSubmissionId: entry.post.id,
                viewsDelta: entry.post.currentViews,
                amount: new Prisma.Decimal(Number(entry.payoutPaise) / 100),
                status: 'LOCKED',
                source: 'POOL',
                earnedAt: now,
                unlockAt,
                lockReason: 'POOL_FINALIZATION_LOCK_14D',
                metadata: {
                  finalizationId,
                  rank: entry.rank,
                  percentageBps: entry.percentageBps,
                  tierIndex: entry.tierIndex,
                  bandIndex: entry.tierIndex,
                  payoutPaise: entry.payoutPaise.toString(),
                  views: entry.post.currentViews,
                },
              },
            });
            distributedPaise += entry.payoutPaise;
          }
          // Update budgetUsed to reflect distributed pool. (Treat it as fully consumed.)
          await tx.campaign.update({
            where: { id: campaignId },
            data: {
              budgetUsed: new Prisma.Decimal(Number(distributedPaise) / 100),
              status: 'COMPLETED',
              finalizationStatus: 'COMPLETED',
              finalizedAt: now,
              finalizationError: null,
              exceptionRefundAmountPaise: 0n,
            },
          });
        }

        // Snapshot the leaderboard, including dropped creators (rank=null with reason).
        for (const entry of qualifying) {
          await tx.campaignLeaderboardSnapshot.create({
            data: {
              campaignId,
              creatorId: entry.creatorId,
              postSubmissionId: entry.post.id,
              hadVerifiedPost: true,
              rank: entry.rank,
              views: entry.post.currentViews,
              percentageBps: entry.percentageBps,
              payoutAmountPaise: entry.payoutPaise,
              droppedReason: null,
              finalizationId,
            },
          });
        }
        for (const drop of dropped) {
          await tx.campaignLeaderboardSnapshot.create({
            data: {
              campaignId,
              creatorId: drop.creatorId,
              postSubmissionId: drop.postId ?? null,
              hadVerifiedPost: false,
              rank: null,
              views: 0,
              percentageBps: 0,
              payoutAmountPaise: 0n,
              droppedReason: drop.reason,
              finalizationId,
            },
          });
        }

        // Emit a wallet-sync audit row for the finalization itself.
        await tx.walletSyncEvent.create({
          data: {
            eventType: qualifying.length === 0 ? 'CAMPAIGN_POOL_REFUNDED' : 'CAMPAIGN_FINALIZED',
            status: 'SYNCED',
            attempts: 1,
            payload: {
              campaignId,
              finalizationId,
              qualifiersCount: qualifying.length,
              droppedCount: dropped.length,
              distributedPaise: distributedPaise.toString(),
              refundPaise: refundPaise.toString(),
              totalPoolPaise: totalPoolPaise.toString(),
              completedAt: now.toISOString(),
            },
          },
        });
      });

      // Out-of-tx side-effects: refund call to wallet (if applicable), notifications, websocket.
      if (refundPaise > 0n) {
        try {
          const refundRupees = Number(refundPaise) / 100;
          await this.walletSyncService.refundBrandBudget(
            campaign.brandId,
            refundRupees,
            'CAMPAIGN_POOL_REFUND_NO_QUALIFIERS',
            { campaignId, finalizationId },
            `campaign-service:pool-refund:${campaignId}:${finalizationId}`,
          );
        } catch (refundError) {
          // The refund failure is recorded as a wallet-sync retry candidate.
          await this.databaseService.walletSyncEvent.create({
            data: {
              eventType: 'BRAND_BUDGET_REFUND',
              status: 'RETRY_PENDING',
              attempts: 3,
              payload: {
                userId: campaign.brandId,
                amount: Number(refundPaise) / 100,
                campaignId,
                activityName: 'CAMPAIGN_POOL_REFUND_NO_QUALIFIERS',
                idempotencyKey: `campaign-service:pool-refund:${campaignId}:${finalizationId}`,
              },
              lastError: (refundError as Error).message,
            },
          });
          this.logger.error(
            `Pool refund failed for campaign ${campaignId}; queued for retry: ${(refundError as Error).message}`,
          );
        }
      }

      // Notifications (brand always; creators per outcome).
      try {
        if (qualifying.length === 0) {
          await this.notificationService.notifyPoolRefundedException({
            brandId: campaign.brandId,
            campaignId,
            campaignName: campaign.name,
            refundAmountRupees: Number(refundPaise) / 100,
          });
        } else {
          await this.notificationService.notifyCampaignFinalized({
            brandId: campaign.brandId,
            campaignId,
            campaignName: campaign.name,
            qualifiersCount: qualifying.length,
            droppedCount: dropped.length,
            distributedAmountRupees: Number(distributedPaise) / 100,
            qualifyingCreators: qualifying.map((entry) => ({
              creatorId: entry.creatorId,
              rank: entry.rank,
              payoutAmountRupees: Number(entry.payoutPaise) / 100,
              unlockAt: unlockAt.toISOString(),
            })),
            droppedCreators: dropped.map((d) => ({
              creatorId: d.creatorId,
              reason: d.reason,
            })),
            unlockAt: unlockAt.toISOString(),
          });
        }
      } catch (err) {
        this.logger.warn(`Finalization notifications failed: ${(err as Error).message}`);
      }

      return {
        success: true,
        finalizationStatus: 'COMPLETED',
        qualifiersCount: qualifying.length,
        droppedCount: dropped.length,
        distributedPaise: distributedPaise.toString(),
        refundPaise: refundPaise.toString(),
        finalizationId,
      };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Finalization failed for campaign ${campaignId}: ${message}`);
      await this.databaseService.campaign.update({
        where: { id: campaignId },
        data: {
          finalizationStatus: 'FAILED',
          finalizationError: message,
        },
      });
      await this.databaseService.walletSyncEvent.create({
        data: {
          eventType: 'CAMPAIGN_FINALIZATION_FAILED',
          status: 'FAILED',
          attempts: 1,
          payload: { campaignId, finalizationId, error: message },
          lastError: message,
        },
      });
      throw error;
    }
  }

  /**
   * Resets a stuck finalization (RUNNING with no recent attempts) back to PENDING. Admin-only.
   */
  async resetStuckFinalization(campaignId: string) {
    const campaign = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    if (campaign.finalizationStatus !== 'RUNNING' && campaign.finalizationStatus !== 'FAILED') {
      throw new BadRequestException('Campaign finalization is not in a stuck state');
    }
    return this.databaseService.campaign.update({
      where: { id: campaignId },
      data: { finalizationStatus: 'PENDING', finalizationError: null },
    });
  }

  isPastFinalizationWindow(campaign: Pick<Campaign, 'endDate' | 'gracePeriodHours'>): boolean {
    const cutoff = new Date(campaign.endDate.getTime() + campaign.gracePeriodHours * 60 * 60 * 1000);
    return Date.now() >= cutoff.getTime();
  }

  /** Find POOL campaigns that are past the cutoff and not yet COMPLETED. */
  async findCampaignsDueForFinalization(limit = 20) {
    const now = new Date();
    return this.databaseService.campaign.findMany({
      where: {
        payoutModel: 'POOL',
        finalizationStatus: { in: ['PENDING', 'FAILED'] },
        status: { not: 'COMPLETED' },
        endDate: { lte: now },
      },
      orderBy: { endDate: 'asc' },
      take: limit,
    });
  }
}
