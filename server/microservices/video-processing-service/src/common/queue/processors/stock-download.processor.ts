import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { JobStatusGateway } from '../../websocket/job-status.gateway';
import axios from 'axios';

export interface StockDownloadJobData {
  projectId: string;
  sceneNumber: number;
  searchTerm: string;
  userId: string;
  authToken?: string;
  videoStyle?: string; // Video style to determine aspect ratio (HALF_N_HALF, ALTERNATE, etc.)
  targetDuration?: number; // Target duration in seconds for the video
}

export interface StockDownloadResult {
  success: boolean;
  sceneNumber: number;
  videoUrl?: string;
  localPath?: string;
  gcsUrl?: string;
  publicUrl?: string;
  fallback?: boolean;
  error?: string;
}

@Processor('stock-download', {
  concurrency: 5, // Process 5 stock downloads concurrently per worker
})
@Injectable()
export class StockDownloadProcessor extends WorkerHost {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly jobStatusGateway: JobStatusGateway,
  ) {
    super();
  }

  async process(job: Job<StockDownloadJobData>): Promise<StockDownloadResult> {
    const { projectId, sceneNumber, searchTerm, userId, authToken, videoStyle, targetDuration } = job.data;

    console.log(`[StockDownloadProcessor] Processing job ${job.id} for project ${projectId}, scene ${sceneNumber}, style: ${videoStyle || 'default'}`);

    try {
      // Get media-management-service URL
      const mediaServiceUrl = this.configService.get<string>('MEDIA_MANAGEMENT_SERVICE_URL') || 'http://localhost:9005/api';
      
      await job.updateProgress(10);

      // Determine aspect ratio based on video style
      // HALF_N_HALF: All scenes need 1080x960 (9:8) -> use 1:1 stock videos
      // ALTERNATE: Odd scenes need 1080x960 (9:8) -> use 1:1, Even scenes need 9:16
      // Others: Use 9:16
      let aspectRatio: '9:16' | '1:1' = '9:16';
      let targetWidth: number | undefined;
      let targetHeight: number | undefined;
      
      const normalizedStyle = videoStyle?.toUpperCase().replace(/-/g, '_');
      
      if (normalizedStyle === 'HALF_N_HALF') {
        aspectRatio = '1:1';
        targetWidth = 1080;
        targetHeight = 960;
      } else if (normalizedStyle === 'ALTERNATE' && sceneNumber % 2 === 1) {
        // Odd scenes in ALTERNATE style use 1:1 (half-n-half composition)
        aspectRatio = '1:1';
        targetWidth = 1080;
        targetHeight = 960;
      }
      
      console.log(`[StockDownloadProcessor] Using aspect ratio: ${aspectRatio}, target dimensions: ${targetWidth || 'none'}x${targetHeight || 'none'}`);

      // Step 1: Search for stock video with correct aspect ratio and duration
      const searchParams: Record<string, any> = {
        term: searchTerm,
        type: 'video',
        page: 1,
        limit: 5,
        aspectRatio,
      };
      
      if (targetDuration && targetDuration > 0) {
        searchParams.targetDuration = targetDuration;
      }
      
      const searchResponse = await axios.get(
        `${mediaServiceUrl}/stock/search`,
        { params: searchParams }
      );

      if (!searchResponse.data.success || !searchResponse.data.data?.results?.[0]) {
        console.warn(`[StockDownloadProcessor] No stock video found for scene ${sceneNumber}, search: "${searchTerm}"`);
        
        // Notify job failure via WebSocket
        this.jobStatusGateway.notifyJobStatus(userId, {
          jobId: job.id!,
          queueType: 'stock-download',
          state: 'failed',
          error: 'No stock videos found for the search term',
          result: {
            success: false,
            sceneNumber,
            error: 'no_results',
          },
          progress: 100,
        }).catch(err => {
          console.error(`[StockDownloadProcessor] Failed to emit WebSocket event:`, err);
        });
        
        return {
          success: false,
          sceneNumber,
          error: 'no_results',
        };
      }

      const stockResult = searchResponse.data.data.results[0];
      console.log(`[StockDownloadProcessor] Found stock video for scene ${sceneNumber}: ${stockResult.title} (id: ${stockResult.id})`);

      await job.updateProgress(40);

      // Step 2: Download the stock video with optional processing
      const downloadParams: Record<string, any> = {
        type: 'video',
        projectId,
      };
      
      if (targetDuration && targetDuration > 0) {
        downloadParams.targetDuration = targetDuration;
      }
      
      if (targetWidth && targetHeight) {
        downloadParams.targetWidth = targetWidth;
        downloadParams.targetHeight = targetHeight;
      }
      
      const downloadResponse = await axios.get(
        `${mediaServiceUrl}/stock/${stockResult.id}/download`,
        { params: downloadParams }
      );

      await job.updateProgress(80);

      let videoUrl = stockResult.previewUrl;
      let localPath: string | undefined;
      let gcsUrl: string | undefined;
      let publicUrl: string | undefined;
      let fallback = false;

      if (downloadResponse.data.success && downloadResponse.data.data) {
        localPath = downloadResponse.data.data.localPath;
        gcsUrl = downloadResponse.data.data.gcsUrl;
        publicUrl = downloadResponse.data.data.publicUrl;
        videoUrl = publicUrl || gcsUrl || videoUrl;
        console.log(`[StockDownloadProcessor] Downloaded stock video for scene ${sceneNumber}: localPath=${localPath}, gcsUrl=${gcsUrl}`);
      } else {
        console.warn(`[StockDownloadProcessor] Download failed for scene ${sceneNumber}, using preview URL as fallback`);
        fallback = true;
      }

      // Step 3: Update the project with the stock video
      const project = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });

      if (project) {
        // Parse existing bRollVideoTasks
        let bRollVideoTasks: any[] = [];
        try {
          bRollVideoTasks = project.bRollVideoTasks 
            ? (typeof project.bRollVideoTasks === 'string' 
                ? JSON.parse(project.bRollVideoTasks) 
                : project.bRollVideoTasks as any[])
            : [];
        } catch (e) {
          bRollVideoTasks = [];
        }

        // Find or create entry for this scene
        const existingIndex = bRollVideoTasks.findIndex((v: any) => v.sceneNumber === sceneNumber);
        const videoEntry = {
          sceneNumber,
          videoUrl,
          localPath,
          gcsUrl,
          publicUrl,
          source: 'stock-video',
          customUpload: false,
          status: 'completed',
          downloadedAt: new Date().toISOString(),
        };

        if (existingIndex >= 0) {
          bRollVideoTasks[existingIndex] = videoEntry;
        } else {
          bRollVideoTasks.push(videoEntry);
        }

        // Update project
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: {
            bRollVideoTasks: bRollVideoTasks as any,
          },
        });
      }

      await job.updateProgress(100);

      console.log(`[StockDownloadProcessor] Completed job ${job.id} for scene ${sceneNumber}`);

      const result: StockDownloadResult = {
        success: true,
        sceneNumber,
        videoUrl,
        localPath,
        gcsUrl,
        publicUrl,
        fallback,
      };

      // Emit WebSocket event for job completion
      this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'stock-download',
        state: 'completed',
        result: {
          success: true,
          video: result,
        },
        progress: 100,
      }).catch(err => {
        console.error(`[StockDownloadProcessor] Failed to emit WebSocket event:`, err);
      });

      return result;
    } catch (error: any) {
      console.error(`[StockDownloadProcessor] Error processing job ${job.id}:`, error);

      // Emit WebSocket event for job failure
      this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'stock-download',
        state: 'failed',
        error: error.message,
        result: {
          success: false,
          sceneNumber,
          error: error.message,
        },
        progress: typeof job.progress === 'number' ? job.progress : 0,
      }).catch(err => {
        console.error(`[StockDownloadProcessor] Failed to emit WebSocket event:`, err);
      });

      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`[StockDownloadProcessor] Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`[StockDownloadProcessor] Job ${job.id} failed:`, error.message);
  }
}
