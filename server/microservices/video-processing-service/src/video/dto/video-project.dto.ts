import { IsString, IsOptional, IsEnum, IsBoolean, IsInt, IsNumber, IsArray, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum VideoTypeDto {
  WITH_AVATAR = 'WITH_AVATAR',
  WITHOUT_AVATAR = 'WITHOUT_AVATAR',
}

export enum VideoStyleDto {
  HALF_N_HALF = 'HALF_N_HALF',
  ALTERNATE = 'ALTERNATE',
  AVATAR_CUTOUT = 'AVATAR_CUTOUT',
  AVATAR_ONLY = 'AVATAR_ONLY',
  PRODUCT_ONLY = 'PRODUCT_ONLY',
  AVATAR_PRODUCT = 'AVATAR_PRODUCT',
  ANIMATED_AVATAR = 'ANIMATED_AVATAR',
  B_ROLL_ONLY = 'B_ROLL_ONLY',
}

export enum VoiceTypeDto {
  CLONED = 'CLONED',
  SYNTHETIC = 'SYNTHETIC',
  PRESET = 'PRESET',
}

export enum BRollSourceDto {
  SKIP = 'SKIP',
  AI_GENERATED = 'AI_GENERATED',
  UPLOAD = 'UPLOAD',
  STOCK = 'STOCK',
}

export enum VideoProjectStatusDto {
  DRAFT = 'DRAFT',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum VideoCreationStepDto {
  STYLE_SELECTION = 'STYLE_SELECTION',
  VIDEO_TYPE = 'VIDEO_TYPE',
  AVATAR_SELECTION = 'AVATAR_SELECTION',
  SCRIPT = 'SCRIPT',
  VOICE = 'VOICE',
  BROLL_IMAGES = 'BROLL_IMAGES',
  BROLL_VIDEOS = 'BROLL_VIDEOS',
  B_ROLL = 'B_ROLL',
  CAPTIONS = 'CAPTIONS',
  RENDERING = 'RENDERING',
  COMPLETED = 'COMPLETED',
}

export class CreateVideoProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: VideoTypeDto })
  @IsEnum(VideoTypeDto)
  videoType: VideoTypeDto;

  @ApiPropertyOptional({ enum: VideoStyleDto })
  @IsOptional()
  @IsEnum(VideoStyleDto)
  style?: VideoStyleDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  script?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  scriptGenerated?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  voiceId?: string;

  @ApiPropertyOptional({ enum: VoiceTypeDto })
  @IsOptional()
  @IsEnum(VoiceTypeDto)
  voiceType?: VoiceTypeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clonedVoiceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  voiceSettings?: any;

  @ApiPropertyOptional({ enum: BRollSourceDto })
  @IsOptional()
  @IsEnum(BRollSourceDto)
  bRollSource?: BRollSourceDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  bRollVideos?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bRollPrompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  captionSettings?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  captionsEnabled?: boolean;

  @ApiPropertyOptional({ enum: VideoCreationStepDto })
  @IsOptional()
  @IsEnum(VideoCreationStepDto)
  currentStep?: VideoCreationStepDto;

  @ApiPropertyOptional({ enum: VideoProjectStatusDto })
  @IsOptional()
  @IsEnum(VideoProjectStatusDto)
  status?: VideoProjectStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: any;
}

export class UpdateVideoProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: VideoTypeDto })
  @IsOptional()
  @IsEnum(VideoTypeDto)
  videoType?: VideoTypeDto;

  @ApiPropertyOptional({ enum: VideoStyleDto })
  @IsOptional()
  @IsEnum(VideoStyleDto)
  style?: VideoStyleDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  script?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  scriptGenerated?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  voiceId?: string;

  @ApiPropertyOptional({ enum: VoiceTypeDto })
  @IsOptional()
  @IsEnum(VoiceTypeDto)
  voiceType?: VoiceTypeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clonedVoiceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  voiceSettings?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  audioFiles?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  audioGenerationConfig?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  bRollImages?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  bRollVideoTasks?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  avatarVideos?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  sceneVideos?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  renderingStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  renderingProgress?: number;

  @ApiPropertyOptional({ enum: BRollSourceDto })
  @IsOptional()
  @IsEnum(BRollSourceDto)
  bRollSource?: BRollSourceDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  bRollVideos?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bRollPrompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  captionSettings?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  captionsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  backgroundMusic?: any;

  @ApiPropertyOptional({ enum: VideoProjectStatusDto })
  @IsOptional()
  @IsEnum(VideoProjectStatusDto)
  status?: VideoProjectStatusDto;

  @ApiPropertyOptional({ enum: VideoCreationStepDto })
  @IsOptional()
  @IsEnum(VideoCreationStepDto)
  currentStep?: VideoCreationStepDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  progress?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  progressStage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  duration?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: any;
}

export class UpdateVideoProjectStepDto {
  @ApiProperty({ enum: VideoCreationStepDto })
  @IsEnum(VideoCreationStepDto)
  step: VideoCreationStepDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  updateData?: any;
}

