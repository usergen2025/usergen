import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { LoggerService } from '../common/logger/logger.service';
import { MessageQueueService } from '../common/message-queue/message-queue.service';
import { ActivityType } from '@prisma/client';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
    private readonly messageQueueService: MessageQueueService,
  ) {}

  async logActivity(params: {
    userId: string;
    workspaceId?: string;
    activityType: ActivityType;
    resourceType: string;
    resourceId: string;
    creditsSpent?: number;
    transactionId?: string;
    actionDetails?: Record<string, any>;
  }) {
    const { userId, workspaceId, activityType, resourceType, resourceId, creditsSpent, transactionId, actionDetails } = params;

    // Log to user activities
    const userActivity = await this.databaseService.userActivity.create({
      data: {
        userId,
        workspaceId: workspaceId || undefined,
        activityType,
        resourceType,
        resourceId,
        creditsSpent: creditsSpent || 0,
        transactionId: transactionId || undefined,
        actionDetails,
      },
    });

    // If workspace context, also log to workspace activities
    if (workspaceId) {
      await this.databaseService.workspaceActivity.create({
        data: {
          workspaceId,
          activityType,
          resourceType,
          resourceId,
          actorUserId: userId,
          creditsSpent: creditsSpent || 0,
          transactionId: transactionId || undefined,
          actionDetails,
        },
      });
    }

    this.logger.log(`Activity logged: ${activityType} for user ${userId}`, 'ActivitiesService');

    await this.messageQueueService.publish('activity.events', 'activity.created', {
      activityId: userActivity.id,
      userId,
      workspaceId,
      activityType,
      resourceType,
      resourceId,
    });

    return userActivity;
  }

  async getUserActivities(userId: string, workspaceId?: string, limit = 50) {
    const where: any = { userId };
    if (workspaceId) {
      where.workspaceId = workspaceId;
    }

    const activities = await this.databaseService.userActivity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return activities;
  }

  async getWorkspaceActivities(workspaceId: string, limit = 50) {
    const activities = await this.databaseService.workspaceActivity.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return activities;
  }
}


