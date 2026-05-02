import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { UserPresenceService } from './user-presence.service';

export interface CreateNotificationPayload {
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class InAppNotificationService {
  private readonly logger = new Logger(InAppNotificationService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly presence: UserPresenceService,
  ) {}

  async create(payload: CreateNotificationPayload) {
    return this.database.userNotification.create({
      data: {
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        data: (payload.data ?? {}) as object,
        read: false,
      },
    });
  }

  async notifyProcessingEvent(params: {
    userId: string;
    projectId?: string;
    type: string;
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

    if (projectId && this.presence.isUserOnProject(userId, projectId)) {
      return;
    }

    const since = new Date(Date.now() - dedupeWindowMs);
    const andFilters: Array<{ data: { path: string[]; equals: string } }> = [];
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
        } as object,
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

  setUserPresence(userId: string, projectId: string | null | undefined): void {
    this.presence.setActiveProject(userId, projectId);
  }
}
