import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CampaignEventsGateway, CampaignEvent, CampaignEventType } from './campaign-events.gateway';

export type CampaignNotificationType =
  | 'CAMPAIGN_APPLICATION_RECEIVED'
  | 'CAMPAIGN_APPLICATION_APPROVED'
  | 'CAMPAIGN_APPLICATION_REJECTED'
  | 'CAMPAIGN_POST_SUBMITTED'
  | 'CAMPAIGN_POST_VERIFIED'
  | 'CAMPAIGN_POST_REJECTED'
  | 'CAMPAIGN_DEADLINE_APPROACHING'
  | 'CAMPAIGN_EARNINGS_ACCRUED'
  | 'CAMPAIGN_EARNINGS_AVAILABLE'
  | 'CAMPAIGN_FINALIZED_BRAND'
  | 'CAMPAIGN_FINALIZED_CREATOR_WIN'
  | 'CAMPAIGN_FINALIZED_CREATOR_DROPPED'
  | 'CAMPAIGN_REFUNDED_EXCEPTION';

interface NotificationPayload {
  userId: string;
  type: CampaignNotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

interface EmailPayload {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

@Injectable()
export class CampaignNotificationService {
  private readonly logger = new Logger(CampaignNotificationService.name);
  private readonly notificationServiceUrl: string;
  private readonly internalNotificationSecret?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly campaignEventsGateway: CampaignEventsGateway,
  ) {
    this.notificationServiceUrl = this.normalizeApiRoot(
      this.configService.get<string>('NOTIFICATION_SERVICE_URL') || 'http://localhost:9006/api',
    );
    this.internalNotificationSecret = this.configService.get<string>('INTERNAL_NOTIFICATION_SECRET');
  }

  private normalizeApiRoot(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (/\/api$/i.test(trimmed)) return trimmed;
    return `${trimmed}/api`;
  }

  private internalHeaders(): Record<string, string> {
    return this.internalNotificationSecret
      ? { 'X-Internal-Secret': this.internalNotificationSecret }
      : {};
  }

  async notifyApplicationReceived(params: {
    brandId: string;
    creatorId: string;
    campaignId: string;
    campaignName: string;
    applicationId: string;
  }) {
    const { brandId, creatorId, campaignId, campaignName, applicationId } = params;

    this.emitRealtimeEvent('campaign:application:new', {
      campaignId,
      campaignName,
      applicationId,
      creatorId,
      brandId,
    });

    await this.createInAppNotification({
      userId: brandId,
      type: 'CAMPAIGN_APPLICATION_RECEIVED',
      title: 'New Campaign Application',
      message: `A creator has applied to your campaign "${campaignName}"`,
      data: { campaignId, applicationId, creatorId },
    });
  }

  async notifyApplicationApproved(params: {
    brandId: string;
    creatorId: string;
    campaignId: string;
    campaignName: string;
    applicationId: string;
  }) {
    const { brandId, creatorId, campaignId, campaignName, applicationId } = params;

    this.emitRealtimeEvent('campaign:application:reviewed', {
      campaignId,
      campaignName,
      applicationId,
      creatorId,
      brandId,
      status: 'APPROVED',
    });

    await this.createInAppNotification({
      userId: creatorId,
      type: 'CAMPAIGN_APPLICATION_APPROVED',
      title: 'Application Approved',
      message: `Your application for "${campaignName}" has been approved! You can now submit your final post.`,
      data: { campaignId, applicationId },
    });
  }

  async notifyApplicationRejected(params: {
    brandId: string;
    creatorId: string;
    campaignId: string;
    campaignName: string;
    applicationId: string;
    comment?: string;
  }) {
    const { brandId, creatorId, campaignId, campaignName, applicationId, comment } = params;

    this.emitRealtimeEvent('campaign:application:reviewed', {
      campaignId,
      campaignName,
      applicationId,
      creatorId,
      brandId,
      status: 'REJECTED',
      message: comment,
    });

    await this.createInAppNotification({
      userId: creatorId,
      type: 'CAMPAIGN_APPLICATION_REJECTED',
      title: 'Application Not Selected',
      message: `Your application for "${campaignName}" was not selected.${comment ? ` Note: ${comment}` : ''}`,
      data: { campaignId, applicationId, comment },
    });
  }

  async notifyPostSubmitted(params: {
    brandId: string;
    creatorId: string;
    campaignId: string;
    campaignName: string;
    postId: string;
    postUrl: string;
  }) {
    const { brandId, creatorId, campaignId, campaignName, postId, postUrl } = params;

    this.emitRealtimeEvent('campaign:post:submitted', {
      campaignId,
      campaignName,
      postId,
      creatorId,
      brandId,
      data: { postUrl },
    });

    await this.createInAppNotification({
      userId: brandId,
      type: 'CAMPAIGN_POST_SUBMITTED',
      title: 'Post Submitted for Review',
      message: `A creator has submitted their final post for "${campaignName}"`,
      data: { campaignId, postId, postUrl, creatorId },
    });
  }

  async notifyPostVerified(params: {
    brandId: string;
    creatorId: string;
    campaignId: string;
    campaignName: string;
    postId: string;
  }) {
    const { brandId, creatorId, campaignId, campaignName, postId } = params;

    this.emitRealtimeEvent('campaign:post:verified', {
      campaignId,
      campaignName,
      postId,
      creatorId,
      brandId,
    });

    await this.createInAppNotification({
      userId: creatorId,
      type: 'CAMPAIGN_POST_VERIFIED',
      title: 'Post Verified',
      message: `Your post for "${campaignName}" has been verified! Earnings will begin accruing.`,
      data: { campaignId, postId },
    });
  }

  async notifyDeadlineApproaching(params: {
    userId: string;
    campaignId: string;
    campaignName: string;
    deadlineType: 'apply' | 'post';
    daysRemaining: number;
  }) {
    const { userId, campaignId, campaignName, deadlineType, daysRemaining } = params;

    this.campaignEventsGateway.notifyUser(userId, {
      type: 'campaign:deadline:approaching',
      campaignId,
      campaignName,
      message: `${deadlineType === 'apply' ? 'Application' : 'Post submission'} deadline in ${daysRemaining} day(s)`,
      timestamp: new Date().toISOString(),
    });

    await this.createInAppNotification({
      userId,
      type: 'CAMPAIGN_DEADLINE_APPROACHING',
      title: `Deadline Approaching`,
      message: `${deadlineType === 'apply' ? 'Application' : 'Post submission'} deadline for "${campaignName}" is in ${daysRemaining} day(s)`,
      data: { campaignId, deadlineType, daysRemaining },
    });
  }

  async notifyEarningsAccrued(params: {
    creatorId: string;
    campaignId: string;
    campaignName: string;
    amount: number;
    views: number;
  }) {
    const { creatorId, campaignId, campaignName, amount, views } = params;

    this.campaignEventsGateway.notifyUser(creatorId, {
      type: 'campaign:earnings:accrued',
      campaignId,
      campaignName,
      creatorId,
      data: { amount, views },
      timestamp: new Date().toISOString(),
    });

    await this.createInAppNotification({
      userId: creatorId,
      type: 'CAMPAIGN_EARNINGS_ACCRUED',
      title: 'Earnings Updated',
      message: `You earned ₹${amount.toLocaleString('en-IN')} from ${views.toLocaleString()} views on "${campaignName}"`,
      data: { campaignId, amount, views },
    });
  }

  async notifyEarningsAvailable(params: {
    creatorId: string;
    amount: number;
  }) {
    const { creatorId, amount } = params;

    this.campaignEventsGateway.notifyUser(creatorId, {
      type: 'campaign:earnings:available',
      campaignId: '',
      creatorId,
      data: { amount },
      timestamp: new Date().toISOString(),
    });

    await this.createInAppNotification({
      userId: creatorId,
      type: 'CAMPAIGN_EARNINGS_AVAILABLE',
      title: 'Earnings Available',
      message: `₹${amount.toLocaleString('en-IN')} is now available for withdrawal`,
      data: { amount },
    });
  }

  /**
   * Emit a leaderboard update on the campaign room. Listeners are encouraged to refetch
   * `/leaderboard` rather than rely on a payload-only diff, to keep this lightweight.
   */
  emitLeaderboardUpdated(params: {
    campaignId: string;
    campaignName?: string;
    qualifiersCount?: number;
    approvedCount?: number;
    triggeredBy: string;
  }) {
    const event: CampaignEvent = {
      type: 'campaign:leaderboard:updated',
      campaignId: params.campaignId,
      campaignName: params.campaignName,
      message: `Leaderboard updated (${params.triggeredBy})`,
      data: {
        qualifiersCount: params.qualifiersCount,
        approvedCount: params.approvedCount,
        triggeredBy: params.triggeredBy,
      },
      timestamp: new Date().toISOString(),
    };
    this.campaignEventsGateway.notifyCampaign(params.campaignId, event);
  }

  emitViewsUpdated(params: {
    campaignId: string;
    campaignName?: string;
    creatorId: string;
    postSubmissionId: string;
    previousViews: number;
    newViews: number;
  }) {
    const event: CampaignEvent = {
      type: 'campaign:views:updated',
      campaignId: params.campaignId,
      campaignName: params.campaignName,
      creatorId: params.creatorId,
      postId: params.postSubmissionId,
      data: {
        previousViews: params.previousViews,
        newViews: params.newViews,
      },
      timestamp: new Date().toISOString(),
    };
    this.campaignEventsGateway.notifyCampaign(params.campaignId, event);
  }

  emitPostDisqualified(params: {
    campaignId: string;
    campaignName?: string;
    creatorId: string;
    postSubmissionId: string;
    reason: string;
  }) {
    const event: CampaignEvent = {
      type: 'campaign:post:disqualified',
      campaignId: params.campaignId,
      campaignName: params.campaignName,
      creatorId: params.creatorId,
      postId: params.postSubmissionId,
      data: { reason: params.reason },
      timestamp: new Date().toISOString(),
    };
    this.campaignEventsGateway.notifyCampaign(params.campaignId, event);
    this.campaignEventsGateway.notifyUser(params.creatorId, event);
  }

  async notifyCampaignFinalized(params: {
    brandId: string;
    campaignId: string;
    campaignName: string;
    qualifiersCount: number;
    droppedCount: number;
    distributedAmountRupees: number;
    qualifyingCreators: Array<{ creatorId: string; rank: number; payoutAmountRupees: number; unlockAt: string }>;
    droppedCreators: Array<{ creatorId: string; reason: string }>;
    unlockAt: string;
  }) {
    const {
      brandId,
      campaignId,
      campaignName,
      qualifiersCount,
      droppedCount,
      distributedAmountRupees,
      qualifyingCreators,
      droppedCreators,
      unlockAt,
    } = params;

    this.campaignEventsGateway.notifyCampaign(campaignId, {
      type: 'campaign:finalized',
      campaignId,
      campaignName,
      data: { qualifiersCount, droppedCount, distributedAmountRupees, unlockAt },
      timestamp: new Date().toISOString(),
    });

    await this.createInAppNotification({
      userId: brandId,
      type: 'CAMPAIGN_FINALIZED_BRAND',
      title: 'Campaign finalized',
      message:
        `Pool of ₹${distributedAmountRupees.toLocaleString('en-IN')} on "${campaignName}" was distributed across ${qualifiersCount} creator(s)` +
        (droppedCount > 0 ? `; ${droppedCount} dropped at validation.` : '.'),
      data: { campaignId, qualifiersCount, droppedCount, distributedAmountRupees, unlockAt },
    });

    for (const winner of qualifyingCreators) {
      this.campaignEventsGateway.notifyUser(winner.creatorId, {
        type: 'campaign:rank:changed',
        campaignId,
        campaignName,
        creatorId: winner.creatorId,
        data: {
          rank: winner.rank,
          payoutAmountRupees: winner.payoutAmountRupees,
          unlockAt: winner.unlockAt,
        },
        timestamp: new Date().toISOString(),
      });
      await this.createInAppNotification({
        userId: winner.creatorId,
        type: 'CAMPAIGN_FINALIZED_CREATOR_WIN',
        title: `You earned ₹${winner.payoutAmountRupees.toLocaleString('en-IN')}!`,
        message: `Final rank #${winner.rank} on "${campaignName}". Earnings unlock on ${new Date(winner.unlockAt).toLocaleDateString('en-IN')}.`,
        data: { campaignId, rank: winner.rank, payoutAmountRupees: winner.payoutAmountRupees, unlockAt: winner.unlockAt },
      });
    }

    for (const dropped of droppedCreators) {
      await this.createInAppNotification({
        userId: dropped.creatorId,
        type: 'CAMPAIGN_FINALIZED_CREATOR_DROPPED',
        title: `Campaign "${campaignName}" finalized`,
        message: `You did not qualify for the prize pool. Reason: ${dropped.reason}`,
        data: { campaignId, reason: dropped.reason },
      });
    }
  }

  async notifyPoolRefundedException(params: {
    brandId: string;
    campaignId: string;
    campaignName: string;
    refundAmountRupees: number;
  }) {
    const { brandId, campaignId, campaignName, refundAmountRupees } = params;
    this.campaignEventsGateway.notifyUser(brandId, {
      type: 'campaign:refunded:exception',
      campaignId,
      campaignName,
      data: { refundAmountRupees },
      timestamp: new Date().toISOString(),
    });
    await this.createInAppNotification({
      userId: brandId,
      type: 'CAMPAIGN_REFUNDED_EXCEPTION',
      title: 'Pool refund issued',
      message: `No creators qualified for "${campaignName}". ₹${refundAmountRupees.toLocaleString('en-IN')} has been refunded to your wallet.`,
      data: { campaignId, refundAmountRupees },
    });
  }

  private emitRealtimeEvent(
    type: CampaignEventType,
    params: {
      campaignId: string;
      campaignName?: string;
      applicationId?: string;
      creatorId?: string;
      brandId?: string;
      postId?: string;
      status?: string;
      message?: string;
      data?: Record<string, unknown>;
    },
  ) {
    const event: CampaignEvent = {
      type,
      campaignId: params.campaignId,
      campaignName: params.campaignName,
      applicationId: params.applicationId,
      creatorId: params.creatorId,
      brandId: params.brandId,
      postId: params.postId,
      status: params.status,
      message: params.message,
      data: params.data,
      timestamp: new Date().toISOString(),
    };

    if (params.brandId) {
      this.campaignEventsGateway.notifyUser(params.brandId, event);
    }
    if (params.creatorId && params.creatorId !== params.brandId) {
      this.campaignEventsGateway.notifyUser(params.creatorId, event);
    }

    this.campaignEventsGateway.notifyCampaign(params.campaignId, event);
  }

  private async createInAppNotification(payload: NotificationPayload) {
    try {
      const url = `${this.notificationServiceUrl}/notifications/internal/create`;
      await axios.post(url, payload, {
        timeout: 10000,
        headers: this.internalHeaders(),
      });
      this.logger.log(`In-app notification created for user ${payload.userId}: ${payload.type}`);
    } catch (error: any) {
      this.logger.error(`Failed to create in-app notification: ${error?.message}`);
    }
  }

  async sendEmail(payload: EmailPayload) {
    try {
      const url = `${this.notificationServiceUrl}/notifications/send-email`;
      await axios.post(
        url,
        {
          to: payload.to,
          subject: payload.subject,
          html: payload.htmlBody,
          text: payload.textBody,
        },
        { timeout: 30000 },
      );
      this.logger.log(`Email sent to ${payload.to}: ${payload.subject}`);
    } catch (error: any) {
      this.logger.error(`Failed to send email: ${error?.message}`);
    }
  }

  async sendApplicationApprovedEmail(params: {
    creatorEmail: string;
    creatorName: string;
    campaignName: string;
    campaignId: string;
  }) {
    const { creatorEmail, creatorName, campaignName, campaignId } = params;
    const appUrl = this.configService.get<string>('APP_URL') || 'http://localhost:3200';
    const subject = `Your application for "${campaignName}" has been approved!`;
    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #E86412, #F12A4C); padding: 30px; border-radius: 12px; text-align: center;">
    <h1 style="color: white; margin: 0;">Congratulations!</h1>
  </div>
  <div style="padding: 30px 20px;">
    <p style="font-size: 16px; color: #212121;">Hi ${creatorName || 'Creator'},</p>
    <p style="font-size: 16px; color: #212121;">Great news! Your application for <strong>"${campaignName}"</strong> has been approved.</p>
    <p style="font-size: 16px; color: #212121;">You can now submit your final post link to start earning.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${appUrl}/campaigns/${campaignId}" style="display: inline-block; background: linear-gradient(135deg, #E86412, #F12A4C); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">View Campaign</a>
    </div>
    <p style="font-size: 14px; color: #616161;">Good luck!</p>
  </div>
  <div style="border-top: 1px solid #E8E2DB; padding-top: 20px; text-align: center; color: #9E9E9E; font-size: 12px;">
    <p>UserGen.ai - AI-Powered Video Creation</p>
  </div>
</body>
</html>`;
    const textBody = `Hi ${creatorName || 'Creator'},\n\nGreat news! Your application for "${campaignName}" has been approved.\n\nYou can now submit your final post link to start earning.\n\nView the campaign: ${appUrl}/campaigns/${campaignId}\n\nGood luck!\n\nUserGen.ai`;
    await this.sendEmail({ to: creatorEmail, subject, htmlBody, textBody });
  }

  async sendApplicationRejectedEmail(params: {
    creatorEmail: string;
    creatorName: string;
    campaignName: string;
    comment?: string;
  }) {
    const { creatorEmail, creatorName, campaignName, comment } = params;
    const appUrl = this.configService.get<string>('APP_URL') || 'http://localhost:3200';
    const subject = `Update on your application for "${campaignName}"`;
    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="padding: 30px 20px;">
    <p style="font-size: 16px; color: #212121;">Hi ${creatorName || 'Creator'},</p>
    <p style="font-size: 16px; color: #212121;">Thank you for your interest in <strong>"${campaignName}"</strong>.</p>
    <p style="font-size: 16px; color: #212121;">Unfortunately, your application was not selected this time.${comment ? ` The brand left a note: "${comment}"` : ''}</p>
    <p style="font-size: 16px; color: #212121;">Don't be discouraged — there are many more campaigns waiting for you!</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${appUrl}/campaigns" style="display: inline-block; background: linear-gradient(135deg, #E86412, #F12A4C); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">Explore Campaigns</a>
    </div>
    <p style="font-size: 14px; color: #616161;">Keep creating!</p>
  </div>
  <div style="border-top: 1px solid #E8E2DB; padding-top: 20px; text-align: center; color: #9E9E9E; font-size: 12px;">
    <p>UserGen.ai - AI-Powered Video Creation</p>
  </div>
</body>
</html>`;
    const textBody = `Hi ${creatorName || 'Creator'},\n\nThank you for your interest in "${campaignName}".\n\nUnfortunately, your application was not selected this time.${comment ? ` The brand left a note: "${comment}"` : ''}\n\nDon't be discouraged — there are many more campaigns waiting for you!\n\nExplore campaigns: ${appUrl}/campaigns\n\nKeep creating!\n\nUserGen.ai`;
    await this.sendEmail({ to: creatorEmail, subject, htmlBody, textBody });
  }

  async sendDeadlineApproachingEmail(params: {
    email: string;
    name: string;
    campaignName: string;
    campaignId: string;
    deadlineType: 'apply' | 'post';
    daysRemaining: number;
  }) {
    const { email, name, campaignName, campaignId, deadlineType, daysRemaining } = params;
    const appUrl = this.configService.get<string>('APP_URL') || 'http://localhost:3200';
    const action = deadlineType === 'apply' ? 'apply' : 'submit your final post';
    const subject = `Reminder: ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left to ${action} for "${campaignName}"`;
    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #FFF8F3; border-left: 4px solid #E86412; padding: 20px; border-radius: 4px; margin-bottom: 20px;">
    <p style="margin: 0; font-weight: 600; color: #212121;">Deadline Reminder</p>
  </div>
  <div style="padding: 0 20px 30px;">
    <p style="font-size: 16px; color: #212121;">Hi ${name || 'there'},</p>
    <p style="font-size: 16px; color: #212121;">Just a friendly reminder that you have <strong>${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}</strong> left to ${action} for <strong>"${campaignName}"</strong>.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${appUrl}/campaigns/${campaignId}" style="display: inline-block; background: linear-gradient(135deg, #E86412, #F12A4C); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">View Campaign</a>
    </div>
    <p style="font-size: 14px; color: #616161;">Don't miss out!</p>
  </div>
  <div style="border-top: 1px solid #E8E2DB; padding-top: 20px; text-align: center; color: #9E9E9E; font-size: 12px;">
    <p>UserGen.ai - AI-Powered Video Creation</p>
  </div>
</body>
</html>`;
    const textBody = `Hi ${name || 'there'},\n\nJust a friendly reminder that you have ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left to ${action} for "${campaignName}".\n\nView the campaign: ${appUrl}/campaigns/${campaignId}\n\nDon't miss out!\n\nUserGen.ai`;
    await this.sendEmail({ to: email, subject, htmlBody, textBody });
  }

  async sendNewApplicationEmail(params: {
    brandEmail: string;
    brandName: string;
    campaignName: string;
    campaignId: string;
    creatorName: string;
  }) {
    const { brandEmail, brandName, campaignName, campaignId, creatorName } = params;
    const appUrl = this.configService.get<string>('APP_URL') || 'http://localhost:3200';
    const subject = `New application for "${campaignName}"`;
    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="padding: 30px 20px;">
    <p style="font-size: 16px; color: #212121;">Hi ${brandName || 'there'},</p>
    <p style="font-size: 16px; color: #212121;"><strong>${creatorName || 'A creator'}</strong> has applied to your campaign <strong>"${campaignName}"</strong>.</p>
    <p style="font-size: 16px; color: #212121;">Review their draft and decide whether to approve or reject the application.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${appUrl}/brand/campaigns/${campaignId}" style="display: inline-block; background: linear-gradient(135deg, #E86412, #F12A4C); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">Review Applicants</a>
    </div>
  </div>
  <div style="border-top: 1px solid #E8E2DB; padding-top: 20px; text-align: center; color: #9E9E9E; font-size: 12px;">
    <p>UserGen.ai - AI-Powered Video Creation</p>
  </div>
</body>
</html>`;
    const textBody = `Hi ${brandName || 'there'},\n\n${creatorName || 'A creator'} has applied to your campaign "${campaignName}".\n\nReview their draft and decide whether to approve or reject the application.\n\nReview applicants: ${appUrl}/brand/campaigns/${campaignId}\n\nUserGen.ai`;
    await this.sendEmail({ to: brandEmail, subject, htmlBody, textBody });
  }

  async sendPostSubmittedEmail(params: {
    brandEmail: string;
    brandName: string;
    campaignName: string;
    campaignId: string;
    creatorName: string;
    postUrl: string;
  }) {
    const { brandEmail, brandName, campaignName, campaignId, creatorName, postUrl } = params;
    const appUrl = this.configService.get<string>('APP_URL') || 'http://localhost:3200';
    const subject = `Post submitted for verification - "${campaignName}"`;
    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="padding: 30px 20px;">
    <p style="font-size: 16px; color: #212121;">Hi ${brandName || 'there'},</p>
    <p style="font-size: 16px; color: #212121;"><strong>${creatorName || 'A creator'}</strong> has submitted their final post for <strong>"${campaignName}"</strong>.</p>
    <p style="font-size: 16px; color: #212121;">Post URL: <a href="${postUrl}" style="color: #E86412;">${postUrl}</a></p>
    <p style="font-size: 16px; color: #212121;">Please verify the post to start accruing earnings for the creator.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${appUrl}/brand/campaigns/${campaignId}" style="display: inline-block; background: linear-gradient(135deg, #E86412, #F12A4C); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">View Submissions</a>
    </div>
  </div>
  <div style="border-top: 1px solid #E8E2DB; padding-top: 20px; text-align: center; color: #9E9E9E; font-size: 12px;">
    <p>UserGen.ai - AI-Powered Video Creation</p>
  </div>
</body>
</html>`;
    const textBody = `Hi ${brandName || 'there'},\n\n${creatorName || 'A creator'} has submitted their final post for "${campaignName}".\n\nPost URL: ${postUrl}\n\nPlease verify the post to start accruing earnings for the creator.\n\nView submissions: ${appUrl}/brand/campaigns/${campaignId}\n\nUserGen.ai`;
    await this.sendEmail({ to: brandEmail, subject, htmlBody, textBody });
  }

  async sendPostVerifiedEmail(params: {
    creatorEmail: string;
    creatorName: string;
    campaignName: string;
    campaignId: string;
  }) {
    const { creatorEmail, creatorName, campaignName, campaignId } = params;
    const appUrl = this.configService.get<string>('APP_URL') || 'http://localhost:3200';
    const subject = `Your post has been verified - "${campaignName}"`;
    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #10B981, #059669); padding: 30px; border-radius: 12px; text-align: center;">
    <h1 style="color: white; margin: 0;">Post Verified!</h1>
  </div>
  <div style="padding: 30px 20px;">
    <p style="font-size: 16px; color: #212121;">Hi ${creatorName || 'Creator'},</p>
    <p style="font-size: 16px; color: #212121;">Great news! Your post for <strong>"${campaignName}"</strong> has been verified by the brand.</p>
    <p style="font-size: 16px; color: #212121;">Your earnings will now begin accruing based on your post's performance. Keep the post live for at least 90 days as per the terms.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${appUrl}/campaigns/${campaignId}" style="display: inline-block; background: linear-gradient(135deg, #E86412, #F12A4C); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">View Campaign</a>
    </div>
  </div>
  <div style="border-top: 1px solid #E8E2DB; padding-top: 20px; text-align: center; color: #9E9E9E; font-size: 12px;">
    <p>UserGen.ai - AI-Powered Video Creation</p>
  </div>
</body>
</html>`;
    const textBody = `Hi ${creatorName || 'Creator'},\n\nGreat news! Your post for "${campaignName}" has been verified by the brand.\n\nYour earnings will now begin accruing based on your post's performance. Keep the post live for at least 90 days as per the terms.\n\nView the campaign: ${appUrl}/campaigns/${campaignId}\n\nUserGen.ai`;
    await this.sendEmail({ to: creatorEmail, subject, htmlBody, textBody });
  }
}
