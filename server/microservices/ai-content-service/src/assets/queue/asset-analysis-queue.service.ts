import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface AssetAnalysisJobData {
  projectId: string;
  userId: string;
  assets: Array<{
    id: string;
    url: string;
    type: 'image' | 'url';
    userLabel?: string; // From UI (logo, product, etc.)
  }>;
}

@Injectable()
export class AssetAnalysisQueueService {
  constructor(
    @InjectQueue('asset-analysis') private assetAnalysisQueue: Queue,
  ) {}

  /**
   * Add asset analysis job to queue
   */
  async addAnalysisJob(data: AssetAnalysisJobData): Promise<string> {
    const job = await this.assetAnalysisQueue.add(
      `asset-analysis-${data.projectId}`,
      data,
      {
        jobId: `asset-analysis-${data.projectId}-${Date.now()}`,
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

    console.log(`[AssetAnalysisQueue] Added analysis job for project ${data.projectId}: ${job.id}`);
    return job.id!;
  }

  /**
   * Get analysis status for a project
   */
  async getAnalysisStatus(projectId: string): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    completedAssets: number;
    totalAssets: number;
  } | null> {
    // Get the most recent job for this project
    const jobs = await this.assetAnalysisQueue.getJobs(['waiting', 'active', 'completed', 'failed'], 0, 10);
    const projectJob = jobs.find(job => 
      job.data?.projectId === projectId
    );

    if (!projectJob) {
      return null;
    }

    const state = await projectJob.getState();
    
    return {
      status: state === 'completed' ? 'completed' : 
              state === 'failed' ? 'failed' :
              state === 'active' ? 'processing' : 'pending',
      completedAssets: projectJob.returnvalue?.completedAssets || 0,
      totalAssets: projectJob.data?.assets?.length || 0,
    };
  }
}



