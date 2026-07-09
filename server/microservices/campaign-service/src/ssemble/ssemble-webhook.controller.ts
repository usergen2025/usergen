import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SsembleWebhookPayload } from './dto/ssemble.dto';
import { DatabaseService } from '../common/database/database.service';
import { SsembleService } from './ssemble.service';

@Controller('internal/ssemble')
export class SsembleWebhookController {
  private readonly logger = new Logger(SsembleWebhookController.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly ssembleService: SsembleService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() payload: SsembleWebhookPayload) {
    this.logger.log(`Received Ssemble webhook: event=${payload.event}, requestId=${payload.requestId}`);

    try {
      // Find the clip request by Ssemble's requestId
      const clipRequest = await this.db.ssembleClipRequest.findFirst({
        where: { ssembleRequestId: payload.requestId },
      });

      if (!clipRequest) {
        this.logger.warn(`No clip request found for Ssemble requestId: ${payload.requestId}`);
        return { received: true, matched: false };
      }

      if (payload.event === 'shorts.completed' && payload.status === 'completed') {
        // Fetch the generated shorts
        const shortsData = await this.ssembleService.getShorts(payload.requestId);
        const shorts = shortsData.shorts || [];

        this.logger.log(`Fetched ${shorts.length} clips for request ${clipRequest.id}`);

        // Create clip records
        await this.db.$transaction(async (tx) => {
          // Create SsembleClip records for each generated short
          for (const short of shorts) {
            await tx.ssembleClip.create({
              data: {
                requestId: clipRequest.id,
                ssembleClipId: short.id,
                title: short.title || null,
                description: short.description || null,
                videoUrl: short.video_url,
                thumbnailUrl: short.thumbnail_url || null,
                durationSecs: short.duration || null,
                viralScore: short.viral_score || null,
              },
            });
          }

          // Update request status to completed
          await tx.ssembleClipRequest.update({
            where: { id: clipRequest.id },
            data: {
              status: 'COMPLETED',
              progress: 100,
              currentStep: null,
            },
          });
        });

        this.logger.log(`Completed processing webhook for request ${clipRequest.id}`);
      } else if (payload.event === 'shorts.failed' || payload.status === 'failed') {
        // Update request status to failed
        await this.db.ssembleClipRequest.update({
          where: { id: clipRequest.id },
          data: {
            status: 'FAILED',
            errorMessage: payload.data?.error || 'Unknown error',
          },
        });

        this.logger.warn(`Clip generation failed for request ${clipRequest.id}: ${payload.data?.error}`);
      }

      return { received: true, matched: true, processed: true };
    } catch (error) {
      this.logger.error(`Error processing Ssemble webhook: ${error.message}`, error.stack);
      throw error;
    }
  }
}
