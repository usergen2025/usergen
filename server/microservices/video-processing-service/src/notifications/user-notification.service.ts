import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

function normalizeApiRoot(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/\/api$/i.test(trimmed)) return trimmed;
  return `${trimmed}/api`;
}

/**
 * Delegates in-app notifications to notification-service (central store).
 */
@Injectable()
export class UserNotificationService {
  private readonly logger = new Logger(UserNotificationService.name);
  private readonly notificationApiRoot: string;
  private readonly internalSecret?: string;

  constructor(private readonly config: ConfigService) {
    this.notificationApiRoot = normalizeApiRoot(
      this.config.get<string>('NOTIFICATION_SERVICE_URL') || 'http://localhost:9006/api',
    );
    this.internalSecret = this.config.get<string>('INTERNAL_NOTIFICATION_SECRET');
  }

  private internalHeaders(): Record<string, string> {
    return this.internalSecret ? { 'X-Internal-Secret': this.internalSecret } : {};
  }

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
    try {
      await axios.post(
        `${this.notificationApiRoot}/notifications/internal/video-processing`,
        params,
        { timeout: 15000, headers: this.internalHeaders() },
      );
    } catch (e: any) {
      this.logger.error(`notifyProcessingEvent failed: ${e?.message || e}`);
    }
  }

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
}
