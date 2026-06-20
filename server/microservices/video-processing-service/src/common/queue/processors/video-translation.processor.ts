import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import {
  VideoTranslationJobData,
  VideoTranslationService,
} from '../../../rendering/video-translation.service';

@Processor('video-translation', { concurrency: 2 })
@Injectable()
export class VideoTranslationProcessor extends WorkerHost {
  constructor(private readonly videoTranslationService: VideoTranslationService) {
    super();
  }

  async process(job: Job<VideoTranslationJobData>): Promise<any> {
    return this.videoTranslationService.processTranslationJob(job.data, job.id!);
  }
}
