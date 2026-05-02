import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class VideoProcessingNotificationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({
    enum: [
      'AVATAR_PREVIEW_READY',
      'AUDIO_GENERATED',
      'SCRIPT_GENERATED',
      'BROLL_IMAGE_READY',
      'BROLL_VIDEO_READY',
      'FINAL_VIDEO_READY',
      'PROCESSING_FAILED',
      'PROCESSING_UPDATE',
    ],
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  operation: string;

  @ApiProperty({ enum: ['completed', 'failed', 'processing'] })
  @IsString()
  @IsIn(['completed', 'failed', 'processing'])
  status: 'completed' | 'failed' | 'processing';

  @ApiProperty({ required: false, default: 90000 })
  @IsOptional()
  @IsNumber()
  dedupeWindowMs?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
