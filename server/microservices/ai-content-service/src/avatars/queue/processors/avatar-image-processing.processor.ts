import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ImageProcessorService } from '../../services/image-processor.service';
import { DatabaseService } from '../../../common/database/database.service';

@Processor('avatar-image-processing', {
  concurrency: 5, // Process 5 image processing jobs concurrently
})
@Injectable()
export class AvatarImageProcessingProcessor extends WorkerHost {
  constructor(
    @Inject(forwardRef(() => ImageProcessorService))
    private readonly imageProcessor: ImageProcessorService,
    private readonly databaseService: DatabaseService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { avatarId, userId, imageBuffer, originalImageKey } = job.data;

    console.log(`[AvatarImageProcessingProcessor] Processing job ${job.id} for avatar ${avatarId}`);

    try {
      await job.updateProgress(10);

      // Convert array back to Buffer
      const buffer = Buffer.from(imageBuffer);

      // Process image into variants (now with userId and avatarId for local storage)
      const processedImages = await this.imageProcessor.processAvatarImage(
        buffer,
        originalImageKey,
        userId,
        avatarId
      );

      await job.updateProgress(80);

      // Update avatar record with processed image keys
      await this.databaseService.avatar.update({
        where: { id: avatarId },
        data: {
          imageKey: processedImages.imageKeyFull,
          imageKeyHalfNHalf: processedImages.imageKeyHalfNHalf,
          imageKeyHalfNHalfWithWhite: processedImages.imageKeyHalfNHalfWithWhite,
        },
      });

      await job.updateProgress(100);

      console.log(`[AvatarImageProcessingProcessor] Completed job ${job.id}`);
      console.log(`[AvatarImageProcessingProcessor] Local image paths:`, processedImages.localPaths);
      
      return {
        success: true,
        imageKeys: processedImages,
        localPaths: processedImages.localPaths,
      };
    } catch (error: any) {
      console.error(`[AvatarImageProcessingProcessor] Error processing job ${job.id}:`, error);
      
      // Update avatar status to failed
      try {
        await this.databaseService.avatar.update({
          where: { id: avatarId },
          data: {
            generationStatus: 'FAILED',
          },
        });
      } catch (updateError) {
        console.error(`[AvatarImageProcessingProcessor] Failed to update avatar status:`, updateError);
      }
      
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`[AvatarImageProcessingProcessor] Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`[AvatarImageProcessingProcessor] Job ${job.id} failed:`, error.message);
  }
}

