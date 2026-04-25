import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { UserPresenceService } from './user-presence.service';

@Injectable()
export class UserNotificationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly presence: UserPresenceService,
  ) {}

  async notifyProcessingEvent(params: {
    userId: string;
    projectId?: string;
    type:
      | 'AVATAR_PREVIEW_READY'
      | 'AUDIO_GENERATED'
      | 'SCRIPT_GENERATED'
      | 'BROLL_IMAGE_READY'
      | 'BROLL_VIDEO_READY'
      | 'FINAL_VIDEO_READY'
      | 'PROCESSING_FAILED'
      | 'PROCESSING_UPDATE';
    title: string;
    message: string;
    operation: string;
    status: 'completed' | 'failed' | 'processing';
    dedupeWindowMs?: number;
    data?: Record<string, unknown>;
  }): Promise<void> {
    const {
      userId,
      projectId,
      type,
      title,
      message,
      operation,
      status,
      dedupeWindowMs = 90_000,
      data = {},
    } = params;

    // Presence-aware suppression: avoid redundant bell notifications while user is on the same project page.
    if (projectId && this.presence.isUserOnProject(userId, projectId)) {
      return;
    }

    const since = new Date(Date.now() - dedupeWindowMs);
    const andFilters: any[] = [];
    if (projectId) andFilters.push({ data: { path: ['projectId'], equals: projectId } });
    if (operation) andFilters.push({ data: { path: ['operation'], equals: operation } });
    const recent = await this.database.userNotification.findFirst({
      where: {
        userId,
        type,
        createdAt: { gte: since },
        ...(andFilters.length > 0 ? { AND: andFilters } : {}),
      },
    });
    if (recent) return;

    await this.database.userNotification.create({
      data: {
        userId,
        type,
        title,
        message,
        data: {
          ...data,
          projectId,
          operation,
          status,
        },
        read: false,
      },
    });
  }

  /**
   * Called when final render completes. Skips insert if user is on the workspace for this project
   * or a duplicate was created in the last 2 minutes.
   */
  async notifyVideoReadyForProject(userId: string, projectId: string): Promise<void> {
    await this.notifyProcessingEvent({
      userId,
      projectId,
      type: 'FINAL_VIDEO_READY',
      operation: 'final-render',
      status: 'completed',
      title: 'Your video is ready',
      message: 'Open your project to watch or download the finished video.',
      dedupeWindowMs: 120_000,
    });
  }

  async listForUser(userId: string, take = 50) {
    return this.database.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const row = await this.database.userNotification.findFirst({
      where: { id, userId },
    });
    if (!row) return false;
    await this.database.userNotification.update({
      where: { id },
      data: { read: true },
    });
    return true;
  }
}
