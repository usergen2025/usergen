import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { JobStatusGateway } from '../../websocket/job-status.gateway';
import { buildAudioGenerationConfig } from '../../utils/audio-config.util';
import { UserNotificationService } from '../../../notifications/user-notification.service';
import axios from 'axios';

export interface AudioGenerationJobData {
  projectId: string;
  userId: string;
  authToken?: string;
}

@Processor('audio-generation', {
  concurrency: 10, // Process 10 audio generation jobs concurrently per worker
})
@Injectable()
export class AudioGenerationProcessor extends WorkerHost {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly jobStatusGateway: JobStatusGateway,
    private readonly userNotificationService: UserNotificationService,
  ) {
    super();
  }

  async process(job: Job<AudioGenerationJobData>): Promise<any> {
    const { projectId, userId, authToken } = job.data;

    console.log(`[AudioGenerationProcessor] Processing job ${job.id} for project ${projectId}`);

    try {
      // Get project
      const project = await this.databaseService.videoProject.findFirst({
        where: { id: projectId, userId },
      });

      if (!project || !project.script || !project.voiceId) {
        throw new Error('Project missing script or voice configuration');
      }

      // Parse script
      const script = typeof project.script === 'string' 
        ? JSON.parse(project.script) 
        : project.script;
      
      const scenes = script.scenes || script.scene_plan || [];
      
      // Extract language from script metadata or project metadata
      // Language might be stored in script metadata or project metadata
      const scriptLanguage = (script as any)?.language || 
                            (project as any)?.metadata?.language || 
                            'hinglish'; // Default fallback
      
      // Call voice-audio-service to generate audio
      const voiceServiceUrl = this.configService.get<string>('VOICE_AUDIO_SERVICE_URL') || 'http://localhost:9002/api';
      const token = authToken ? (authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`) : null;
      
      const scenesWithVoiceover = scenes
        .filter((scene: any) => scene.voiceover)
        .map((scene: any, index: number) => ({
          sceneNumber: scene.scene_number || scene.sceneNumber || (index + 1),
          voiceover: scene.voiceover,
          timeRange: scene.time_range || scene.timeRange,
        }));

      // Update progress
      await job.updateProgress(10);

      const response = await axios.post(
        `${voiceServiceUrl}/voice/generate-script-audio`,
        {
          voiceId: project.voiceId,
          scenes: scenesWithVoiceover,
          projectId,
          userId,
          model_id: 'eleven_multilingual_v2',
          output_format: 'mp3_44100_128',
          language: scriptLanguage, // Pass language for voice settings optimization
          includeWordTimestamps: true,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token } : {}),
          },
        }
      );

      await job.updateProgress(50);

      if (!response.data.success || !response.data.data) {
        throw new Error('Failed to generate audio files');
      }

      const audioFiles = response.data.data;

      // Build audio generation config to store
      const audioGenerationConfig = buildAudioGenerationConfig(
        project.voiceId!,
        project.voiceType || 'SYNTHETIC',
        project.script,
        'eleven_multilingual_v2',
        'mp3_44100_128',
        audioFiles.length,
      );

      // Update project with audio files and generation config
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          audioFiles,
          audioGenerationConfig: audioGenerationConfig as any, // Cast to any for Prisma JSON field compatibility
          renderingStatus: 'audio_completed',
          renderingProgress: 20,
        },
      });

      const files = Array.isArray(audioFiles) ? audioFiles : [];
      for (const af of files) {
        const sn = (af as any)?.sceneNumber ?? (af as any)?.scene_number;
        if (sn == null) continue;
        await this.recordOperationCharge({
          projectId,
          userId,
          operationType: 'AUDIO_GENERATION',
          operationName: 'Audio Generation',
          idempotencyKey: `audio:${projectId}:${sn}:${job.id}`,
          sceneNumber: typeof sn === 'number' ? sn : parseInt(String(sn), 10),
          metadata: { jobId: job.id },
        });
      }

      await job.updateProgress(100);

      console.log(`[AudioGenerationProcessor] Completed job ${job.id} - Generated ${audioFiles.length} audio files`);
      
      // Emit WebSocket event for job completion (non-blocking)
      this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'audio-generation',
        state: 'completed',
        result: {
          success: true,
          audioFiles,
        },
        progress: 100,
      }).catch(err => {
        console.error(`[AudioGenerationProcessor] Failed to emit WebSocket event for job ${job.id}:`, err);
      });
      this.userNotificationService
        .notifyProcessingEvent({
          userId,
          projectId,
          type: 'AUDIO_GENERATED',
          operation: 'audio-generation',
          status: 'completed',
          title: 'Audio generation completed',
          message: 'Voice audio is ready for your project scenes.',
          data: { jobId: job.id, queueType: 'audio-generation' },
        })
        .catch(() => {});
      
      return {
        success: true,
        audioFiles,
      };
    } catch (error: any) {
      console.error(`[AudioGenerationProcessor] Error processing job ${job.id}:`, error);
      
      // Update project status on error
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          renderingStatus: 'failed',
          renderingProgress: 0,
        },
      });

      // Emit WebSocket event for job failure (non-blocking)
      this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: job.id!,
        queueType: 'audio-generation',
        state: 'failed',
        error: error.message,
        progress: typeof job.progress === 'number' ? job.progress : 0,
      }).catch(err => {
        console.error(`[AudioGenerationProcessor] Failed to emit WebSocket event for failed job ${job.id}:`, err);
      });
      this.userNotificationService
        .notifyProcessingEvent({
          userId,
          projectId,
          type: 'PROCESSING_FAILED',
          operation: 'audio-generation',
          status: 'failed',
          title: 'Audio generation failed',
          message: 'Audio generation failed. Please retry from the workspace.',
          data: { jobId: job.id, queueType: 'audio-generation', error: error.message },
        })
        .catch(() => {});

      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`[AudioGenerationProcessor] Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`[AudioGenerationProcessor] Job ${job.id} failed:`, error.message);
  }

  private async recordOperationCharge(params: {
    projectId: string;
    userId: string;
    operationType: string;
    operationName: string;
    idempotencyKey: string;
    sceneNumber?: number;
    metadata?: Record<string, unknown>;
  }) {
    const { projectId, userId, operationType, operationName, idempotencyKey, sceneNumber, metadata } = params;
    try {
      const project = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
        select: { metadata: true },
      });
      const baseMetadata =
        project?.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
          ? ({ ...(project.metadata as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const billedKeys = Array.isArray(baseMetadata.billedOperationKeys)
        ? (baseMetadata.billedOperationKeys as string[])
        : [];
      if (billedKeys.includes(idempotencyKey)) {
        return;
      }

      const paymentServiceUrl = (this.configService.get<string>('PAYMENT_SERVICE_URL') || 'http://localhost:9005').replace(/\/api\/?$/, '');
      const response = await axios.post(
        `${paymentServiceUrl}/api/pricing/record-cost`,
        {
          projectId,
          userId,
          sceneNumber,
          operationType,
          operationName,
          metadata: { ...metadata, idempotencyKey },
        },
        { timeout: 10000 },
      );

      if (response.data?.skipped || !response.data?.data) {
        return;
      }
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          metadata: {
            ...baseMetadata,
            billedOperationKeys: [...billedKeys, idempotencyKey],
          } as any,
        },
      });
    } catch (error: any) {
      console.warn(`[AudioGenerationProcessor] Billing hook failed for ${operationType}: ${error.message}`);
    }
  }
}

