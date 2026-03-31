import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis, { RedisOptions } from 'ioredis';

export enum JobType {
  AUDIO_GENERATION = 'audio-generation',
  IMAGE_GENERATION = 'image-generation',
  VIDEO_GENERATION = 'video-generation',
  AVATAR_VIDEO_GENERATION = 'avatar-video-generation',
  SCENE_COMPOSITE = 'scene-composite',
}

export interface JobData {
  projectId: string;
  userId: string;
  sceneNumber?: number;
  prompt?: string;
  imageUrl?: string;
  duration?: number;
  authToken?: string;
  [key: string]: any;
}

@Injectable()
export class QueueManagerService {
  private readonly concurrencyPerUser: number;
  private readonly maxAttempts: number;

  constructor(
    @InjectQueue('audio-generation') private audioQueue: Queue,
    @InjectQueue('image-generation') private imageQueue: Queue,
    @InjectQueue('video-generation') private videoQueue: Queue,
    @InjectQueue('avatar-video-generation') private avatarVideoQueue: Queue,
    @InjectQueue('scene-composite') private sceneCompositeQueue: Queue,
    private readonly configService: ConfigService,
  ) {
    this.concurrencyPerUser = parseInt(
      this.configService.get<string>('QUEUE_CONCURRENCY_PER_USER', '2'),
      10,
    );
    this.maxAttempts = parseInt(
      this.configService.get<string>('QUEUE_MAX_ATTEMPTS', '3'),
      10,
    );
  }

  /**
   * Get Redis connection options
   */
  static getRedisConnection(): RedisOptions {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const url = new URL(redisUrl);

    return {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: url.password || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }

  /**
   * Add audio generation job to queue
   */
  async addAudioGenerationJob(data: JobData): Promise<string> {
    const job = await this.audioQueue.add(
      `audio-${data.projectId}-${data.userId}`,
      data,
      {
        jobId: `audio-${data.projectId}-${Date.now()}`,
        attempts: this.maxAttempts,
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 100,
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
          count: 50,
        },
      },
    );

    console.log(`[QueueManager] Added audio generation job: ${job.id}`);
    return job.id!;
  }

  /**
   * Add image generation job to queue
   */
  async addImageGenerationJob(data: JobData): Promise<string> {
    const job = await this.imageQueue.add(
      `image-${data.projectId}-${data.sceneNumber}-${data.userId}`,
      data,
      {
        jobId: `image-${data.projectId}-${data.sceneNumber}-${Date.now()}`,
        attempts: this.maxAttempts,
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

    console.log(`[QueueManager] Added image generation job: ${job.id}`);
    return job.id!;
  }

  /**
   * Add video generation job to queue
   */
  async addVideoGenerationJob(data: JobData): Promise<string> {
    const job = await this.videoQueue.add(
      `video-${data.projectId}-${data.sceneNumber}-${data.userId}`,
      data,
      {
        jobId: `video-${data.projectId}-${data.sceneNumber}-${Date.now()}`,
        attempts: this.maxAttempts,
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

    console.log(`[QueueManager] Added video generation job: ${job.id}`);
    return job.id!;
  }

  /**
   * Add avatar video generation job to queue (for ALTERNATE odd / half-n-half scenes)
   */
  async addAvatarVideoGenerationJob(data: JobData): Promise<string> {
    const job = await this.avatarVideoQueue.add(
      `avatar-${data.projectId}-${data.sceneNumber}-${data.userId}`,
      data,
      {
        jobId: `avatar-${data.projectId}-${data.sceneNumber}-${Date.now()}`,
        attempts: this.maxAttempts,
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400, count: 50 },
      },
    );
    console.log(`[QueueManager] Added avatar video generation job: ${job.id}`);
    return job.id!;
  }

  /**
   * Add scene composite job to queue (b-roll + avatar for ALTERNATE odd / half-n-half scenes)
   */
  async addSceneCompositeJob(data: JobData): Promise<string> {
    const jobId = `composite-${data.projectId}-${data.sceneNumber}`;
    try {
      const job = await this.sceneCompositeQueue.add(
        `composite-${data.projectId}-${data.sceneNumber}-${data.userId}`,
        data,
        {
          jobId,
          attempts: this.maxAttempts,
          removeOnComplete: { age: 3600, count: 100 },
          removeOnFail: { age: 86400, count: 50 },
        },
      );
      console.log(`[QueueManager] Added scene composite job: ${job.id}`);
      return job.id!;
    } catch (err: any) {
      if (err?.message?.includes('already exists') || err?.code === 'JOB_ALREADY_EXISTS') {
        console.log(`[QueueManager] Scene composite job ${jobId} already queued, skipping duplicate`);
        return jobId;
      }
      throw err;
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(queueName: JobType, jobId: string) {
    let queue: Queue;
    switch (queueName) {
      case JobType.AUDIO_GENERATION:
        queue = this.audioQueue;
        break;
      case JobType.IMAGE_GENERATION:
        queue = this.imageQueue;
        break;
      case JobType.VIDEO_GENERATION:
        queue = this.videoQueue;
        break;
      case JobType.AVATAR_VIDEO_GENERATION:
        queue = this.avatarVideoQueue;
        break;
      case JobType.SCENE_COMPOSITE:
        queue = this.sceneCompositeQueue;
        break;
      default:
        throw new Error(`Unknown queue: ${queueName}`);
    }

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

  /**
   * Get user-specific queue stats
   */
  async getUserQueueStats(userId: string) {
    const [audioWaiting, audioActive, audioCompleted, audioFailed] = await Promise.all([
      this.audioQueue.getWaitingCount(),
      this.audioQueue.getActiveCount(),
      this.audioQueue.getCompletedCount(),
      this.audioQueue.getFailedCount(),
    ]);

    const [imageWaiting, imageActive, imageCompleted, imageFailed] = await Promise.all([
      this.imageQueue.getWaitingCount(),
      this.imageQueue.getActiveCount(),
      this.imageQueue.getCompletedCount(),
      this.imageQueue.getFailedCount(),
    ]);

    const [videoWaiting, videoActive, videoCompleted, videoFailed] = await Promise.all([
      this.videoQueue.getWaitingCount(),
      this.videoQueue.getActiveCount(),
      this.videoQueue.getCompletedCount(),
      this.videoQueue.getFailedCount(),
    ]);

    return {
      audio: {
        waiting: audioWaiting,
        active: audioActive,
        completed: audioCompleted,
        failed: audioFailed,
      },
      image: {
        waiting: imageWaiting,
        active: imageActive,
        completed: imageCompleted,
        failed: imageFailed,
      },
      video: {
        waiting: videoWaiting,
        active: videoActive,
        completed: videoCompleted,
        failed: videoFailed,
      },
    };
  }

  /**
   * Get concurrency limit per user
   */
  getConcurrencyPerUser(): number {
    return this.concurrencyPerUser;
  }
}

