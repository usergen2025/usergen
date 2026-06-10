import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../common/database/database.service';
import { CampaignNotificationService } from './campaign-notification.service';
import { CampaignsService } from './campaigns.service';
import { CampaignFinalizationService } from './campaign-finalization.service';
import { PostScraperService } from '../scraper/post-scraper.service';
import { ApifyClientService } from '../scraper/apify.client';
import { isOnOrAfterCampaignStartDay, isAfterCampaignEndDay } from './utils/date-compare.util';

@Injectable()
export class CampaignSchedulerService {
  private readonly logger = new Logger(CampaignSchedulerService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly notificationService: CampaignNotificationService,
    private readonly campaignsService: CampaignsService,
    private readonly campaignFinalizationService: CampaignFinalizationService,
    private readonly postScraperService: PostScraperService,
    private readonly apifyClient: ApifyClientService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkDeadlinesApproaching() {
    this.logger.log('Running deadline approaching check...');

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const in3Days = new Date(now);
    in3Days.setDate(in3Days.getDate() + 3);
    const in7Days = new Date(now);
    in7Days.setDate(in7Days.getDate() + 7);

    try {
      const campaigns = await this.databaseService.campaign.findMany({
        where: {
          status: 'LIVE',
          OR: [
            { deadlineToApply: { gte: now, lte: in7Days } },
            { endDate: { gte: now, lte: in7Days } },
          ],
        },
        include: {
          applications: true,
        },
      });

      for (const campaign of campaigns) {
        const deadlineDate = new Date(campaign.deadlineToApply);
        const endDate = new Date(campaign.endDate);

        const daysToApplyDeadline = Math.ceil(
          (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        const daysToEndDate = Math.ceil(
          (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysToApplyDeadline === 1 || daysToApplyDeadline === 3 || daysToApplyDeadline === 7) {
          this.logger.log(
            `Notifying brand ${campaign.brandId} about deadline approaching for campaign ${campaign.id}`,
          );
          await this.notificationService.notifyDeadlineApproaching({
            userId: campaign.brandId,
            campaignId: campaign.id,
            campaignName: campaign.name,
            deadlineType: 'apply',
            daysRemaining: daysToApplyDeadline,
          });
        }

        for (const application of campaign.applications) {
          if (application.status !== 'APPROVED') continue;

          const hasSubmission = await this.databaseService.campaignPostSubmission.findFirst({
            where: {
              campaignId: campaign.id,
              creatorId: application.creatorId,
            },
          });

          if (!hasSubmission && (daysToEndDate === 1 || daysToEndDate === 3 || daysToEndDate === 7)) {
            this.logger.log(
              `Notifying creator ${application.creatorId} about post deadline for campaign ${campaign.id}`,
            );
            await this.notificationService.notifyDeadlineApproaching({
              userId: application.creatorId,
              campaignId: campaign.id,
              campaignName: campaign.name,
              deadlineType: 'post',
              daysRemaining: daysToEndDate,
            });
          }
        }
      }

      this.logger.log('Deadline check completed');
    } catch (error: any) {
      this.logger.error(`Deadline check failed: ${error?.message}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async processEarningsMaturity() {
    this.logger.log('Running earnings maturity check...');
    try {
      const now = new Date();
      const dueEarnings = await this.databaseService.creatorEarning.findMany({
        where: {
          status: 'LOCKED',
          unlockAt: { lte: now },
        },
        select: { id: true, creatorId: true, amount: true },
      });
      const creatorTotals = new Map<string, number>();
      for (const earning of dueEarnings) {
        const current = creatorTotals.get(earning.creatorId) || 0;
        creatorTotals.set(earning.creatorId, current + Number(earning.amount));
      }

      const result = await this.campaignsService.processMaturedLockedEarnings();

      for (const [creatorId, amount] of creatorTotals) {
        if (amount > 0) {
          try {
            await this.notificationService.notifyEarningsAvailable({ creatorId, amount });
          } catch (notifyErr: any) {
            this.logger.warn(
              `Earnings-available notification failed for ${creatorId}: ${notifyErr?.message}`,
            );
          }
        }
      }

      this.logger.log(`Processed ${result.processed} matured earnings (wallet-credited)`);
    } catch (error: any) {
      this.logger.error(`Earnings maturity check failed: ${error?.message}`);
    }
  }

  /** 12:00 AM IST daily = 18:30 UTC previous calendar day boundary check at midnight IST */
  @Cron('30 18 * * *', { timeZone: 'UTC' })
  async processScheduledCampaignStarts() {
    this.logger.log('Running scheduled campaign start check...');
    const now = new Date();
    try {
      const campaigns = await this.databaseService.campaign.findMany({
        where: {
          status: 'LIVE',
          actualStartDate: null,
        },
      });

      for (const campaign of campaigns) {
        if (!isOnOrAfterCampaignStartDay(campaign.startDate, now)) {
          continue;
        }

        await this.databaseService.campaign.update({
          where: { id: campaign.id },
          data: { status: 'IN_PROGRESS' },
        });

        await this.databaseService.campaignApplication.updateMany({
          where: { campaignId: campaign.id, status: 'APPLIED' },
          data: { status: 'REJECTED', reviewedAt: now },
        });

        const approved = await this.databaseService.campaignApplication.findMany({
          where: { campaignId: campaign.id, status: 'APPROVED' },
        });
        for (const app of approved) {
          try {
            await this.notificationService.notifyCampaignStarted({
              creatorId: app.creatorId,
              campaignId: campaign.id,
              campaignName: campaign.name,
            });
          } catch (notifyErr: any) {
            this.logger.warn(
              `Campaign-started notification failed for ${app.creatorId}: ${notifyErr?.message}`,
            );
          }
        }
      }

      this.logger.log(`Scheduled start processed for ${campaigns.length} candidate campaign(s)`);
    } catch (error: any) {
      this.logger.error(`Scheduled campaign start check failed: ${error?.message}`);
    }
  }

  /** Friday 12:00 IST = 06:30 UTC */
  @Cron('0 30 6 * * 5', { timeZone: 'UTC' })
  async weeklyLeaderboardScrape() {
    if (!this.apifyClient.isConfigured()) {
      this.logger.warn('Skipping weekly leaderboard scrape: APIFY_TOKEN not configured');
      return;
    }
    this.logger.log('Running weekly POOL leaderboard scrape...');
    const now = new Date();
    try {
      const campaigns = await this.databaseService.campaign.findMany({
        where: {
          payoutModel: 'POOL',
          status: { in: ['LIVE', 'IN_PROGRESS'] },
          actualEndDate: null,
        },
        select: { id: true, name: true, startDate: true, actualStartDate: true, endDate: true, actualEndDate: true },
      });
      for (const campaign of campaigns) {
        const effectiveEnd = campaign.actualEndDate ?? campaign.endDate;
        if (isAfterCampaignEndDay(effectiveEnd, now)) {
          continue;
        }
        const effectiveStart = campaign.actualStartDate ?? campaign.startDate;
        if (!isOnOrAfterCampaignStartDay(effectiveStart, now)) {
          continue;
        }
        try {
          await this.postScraperService.runScrapeForCampaign(campaign.id, 'WEEKLY', {
            id: 'cron',
            role: 'CRON',
          });
        } catch (err: any) {
          this.logger.error(
            `Weekly scrape failed for campaign ${campaign.id}: ${err?.message ?? err}`,
          );
        }
      }
      this.logger.log(`Weekly scrape queued for ${campaigns.length} campaign(s)`);
    } catch (error: any) {
      this.logger.error(`Weekly leaderboard scrape failed: ${error?.message}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async finalizePoolCampaigns() {
    this.logger.log('Running POOL campaign finalization sweep...');
    try {
      const due = await this.campaignFinalizationService.findCampaignsDueForFinalization(20);
      if (!due.length) {
        return;
      }
      this.logger.log(`Found ${due.length} POOL campaign(s) due for finalization`);
      for (const campaign of due) {
        if (!this.campaignFinalizationService.isPastFinalizationWindow(campaign)) {
          continue;
        }
        try {
          const hasRecentFinal = await this.postScraperService.hasRecentFinalScrape(campaign.id);
          if (!hasRecentFinal) {
            if (this.apifyClient.isConfigured()) {
              this.logger.log(
                `Queueing final scrape for campaign ${campaign.id} before finalization`,
              );
              await this.postScraperService.runScrapeForCampaign(campaign.id, 'FINAL', {
                id: 'cron',
                role: 'CRON',
              });
            } else {
              this.logger.warn(
                `Skipping final scrape for ${campaign.id}: APIFY_TOKEN not configured`,
              );
            }
            continue;
          }
          await this.campaignFinalizationService.finalizeCampaign(
            campaign.id,
            { id: 'cron', role: 'CRON' },
          );
        } catch (err: any) {
          this.logger.error(
            `Auto-finalization failed for campaign ${campaign.id}: ${err?.message ?? err}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`POOL finalization sweep failed: ${error?.message}`);
    }
  }
}
