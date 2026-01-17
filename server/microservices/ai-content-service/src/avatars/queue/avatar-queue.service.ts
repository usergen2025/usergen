import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface AvatarImageProcessingJobData {
  avatarId: string;
  userId: string;
  imageBuffer: Buffer;
  originalImageKey: string;
}

export interface AvatarGenerationJobData {
  avatarId: string;
  userId: string;
  currentJobId: string;
  jobType: string;
}

@Injectable()
export class AvatarQueueService {
  constructor(
    @InjectQueue('avatar-image-processing') private imageProcessingQueue: Queue,
    @InjectQueue('avatar-generation') private generationQueue: Queue,
  ) {}

  /**
   * Add image processing job to queue
   */
  async addImageProcessingJob(data: AvatarImageProcessingJobData): Promise<string> {
    // Convert Buffer to array for serialization
    const serializedData = {
      ...data,
      imageBuffer: Array.from(data.imageBuffer),
    };

    const job = await this.imageProcessingQueue.add(
      `image-processing-${data.avatarId}`,
      serializedData,
      {
        jobId: `img-proc-${data.avatarId}-${Date.now()}`,
        attempts: 3,
        removeOnComplete: {
          age: 3600, // Keep for 1 hour
          count: 50,
        },
        removeOnFail: {
          age: 86400, // Keep for 24 hours
          count: 20,
        },
      },
    );

    console.log(`[AvatarQueue] Added image processing job: ${job.id}`);
    return job.id!;
  }

  /**
   * Add avatar generation step job to queue
   */
  async addGenerationJob(data: AvatarGenerationJobData): Promise<string> {
    const job = await this.generationQueue.add(
      `generation-${data.avatarId}-${data.jobType}`,
      data,
      {
        jobId: `gen-${data.avatarId}-${data.jobType}-${Date.now()}`,
        attempts: 3,
        removeOnComplete: {
          age: 3600,
          count: 100,
        },
        removeOnFail: {
          age: 86400,
          count: 50,
        },
      },
    );

    console.log(`[AvatarQueue] Added generation job: ${job.id}`);
    return job.id!;
  }

  /**
   * Get job status
   */
  async getJobStatus(queueName: 'avatar-image-processing' | 'avatar-generation', jobId: string) {
    const queue = queueName === 'avatar-image-processing' 
      ? this.imageProcessingQueue 
      : this.generationQueue;

    const job = await queue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job.progress || 0;

    return {
      id: job.id,
      state,
      progress,
      data: job.data,
      result: job.returnvalue,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
    };
  }
}






