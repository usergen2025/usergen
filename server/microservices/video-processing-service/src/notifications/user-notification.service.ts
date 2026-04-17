import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { UserPresenceService } from './user-presence.service';

@Injectable()
export class UserNotificationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly presence: UserPresenceService,
  ) {}

  /**
   * Called when final render completes. Skips insert if user is on the workspace for this project
   * or a duplicate was created in the last 2 minutes.
   */
  async notifyVideoReadyForProject(userId: string, projectId: string): Promise<void> {
    if (this.presence.isUserOnProject(userId, projectId)) {
      return;
    }

    const since = new Date(Date.now() - 120_000);
    const recent = await this.database.userNotification.findFirst({
      where: {
        userId,
        type: 'VIDEO_READY',
        createdAt: { gte: since },
        data: { path: ['projectId'], equals: projectId },
      },
    });
    if (recent) return;

    await this.database.userNotification.create({
      data: {
        userId,
        type: 'VIDEO_READY',
        title: 'Your video is ready',
        message: 'Open your project to watch or download the finished video.',
        data: { projectId },
        read: false,
      },
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
