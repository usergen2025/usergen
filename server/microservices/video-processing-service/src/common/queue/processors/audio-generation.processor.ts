import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { JobStatusGateway } from '../../websocket/job-status.gateway';
import { buildAudioGenerationConfig } from '../../utils/audio-config.util';
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
}

