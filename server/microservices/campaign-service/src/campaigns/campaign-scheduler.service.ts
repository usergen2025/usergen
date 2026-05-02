import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../common/database/database.service';
import { CampaignNotificationService } from './campaign-notification.service';

@Injectable()
export class CampaignSchedulerService {
  private readonly logger = new Logger(CampaignSchedulerService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly notificationService: CampaignNotificationService,
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

    const now = new Date();
    const maturityThreshold = new Date(now);
    maturityThreshold.setDate(maturityThreshold.getDate() - 14);

    try {
      const maturedEarnings = await this.databaseService.creatorEarning.findMany({
        where: {
          status: 'LOCKED',
          earnedAt: { lte: maturityThreshold },
        },
        include: {
          campaign: true,
        },
      });

      const creatorTotals = new Map<string, number>();

      for (const earning of maturedEarnings) {
        await this.databaseService.creatorEarning.update({
          where: { id: earning.id },
          data: { status: 'AVAILABLE' },
        });

        const current = creatorTotals.get(earning.creatorId) || 0;
        creatorTotals.set(earning.creatorId, current + Number(earning.amount));
      }

      for (const [creatorId, amount] of creatorTotals) {
        if (amount > 0) {
          await this.notificationService.notifyEarningsAvailable({
            creatorId,
            amount,
          });
        }
      }

      this.logger.log(`Processed ${maturedEarnings.length} matured earnings`);
    } catch (error: any) {
      this.logger.error(`Earnings maturity check failed: ${error?.message}`);
    }
  }
}
