import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JobStatusGateway } from '../common/websocket/job-status.gateway';
import { UserNotificationService } from '../notifications/user-notification.service';
import { BrandPackagingService } from './brand-packaging.service';

export interface BrandPackagingJobData {
  projectId: string;
  userId: string;
}

@Processor('brand-packaging', { concurrency: 3 })
@Injectable()
export class BrandPackagingProcessor extends WorkerHost {
  constructor(
    private readonly brandPackagingService: BrandPackagingService,
    private readonly jobStatusGateway: JobStatusGateway,
    private readonly userNotificationService: UserNotificationService,
  ) {
    super();
  }

  async process(job: Job<BrandPackagingJobData>): Promise<{ success: boolean; status: string }> {
    const { projectId, userId } = job.data;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-pack-'));

    console.log(`[BrandPackagingProcessor] Processing job ${job.id} for project ${projectId}`);

    try {
      await this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'brand-packaging',
        state: 'processing',
        progress: 10,
      });

      await job.updateProgress(20);
      await this.brandPackagingService.processProject(projectId, userId, workDir);
      await job.updateProgress(100);

      const status = await this.brandPackagingService.getStatus(projectId, userId);

      await this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'brand-packaging',
        state: 'completed',
        progress: 100,
        result: {
          brandPackaging: status.brandPackaging,
          cornerReady: status.brandPackaging.cornerReady,
          endCardPlateReady: status.brandPackaging.endCardPlateReady,
        },
      });

      return { success: true, status: status.brandPackaging.status };
    } catch (err: any) {
      const message = err?.message || 'Brand packaging failed';
      console.error(`[BrandPackagingProcessor] Failed for project ${projectId}: ${message}`);
      await this.brandPackagingService.markFailed(projectId, message);

      await this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'brand-packaging',
        state: 'failed',
        error: message,
      });

      throw err;
    } finally {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`[BrandPackagingProcessor] Job ${job?.id} failed: ${error.message}`);
  }
}
