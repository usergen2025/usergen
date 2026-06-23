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

/**
 * Background music source options.
 * - heygen: HeyGen audio catalog (recommended, semantic search)
 * - magnific: Legacy Magnific library
 * - upload: User-uploaded audio file
 */
export enum BackgroundMusicSourceDto {
  HEYGEN = 'heygen',
  MAGNIFIC = 'magnific',
  UPLOAD = 'upload',
}

/**
 * Background music configuration for video projects.
 * Supports HeyGen audio catalog (recommended), Magnific library (legacy), or user uploads.
 */
export interface BackgroundMusicDto {
  /** Whether background music is enabled */
  enabled: boolean;
  /** Music source: 'heygen' (recommended), 'magnific' (legacy), or 'upload' */
  source: BackgroundMusicSourceDto | 'heygen' | 'magnific' | 'upload';
  
  // Common fields
  /** Public URL of the audio file (populated at export time for heygen/magnific) */
  publicUrl?: string;
  /** GCS URL of the audio file (if uploaded to cloud storage) */
  gcsUrl?: string;
  /** Original search query used to find the track (used for re-fetching fresh URLs) */
  searchSeed?: string;
  /** Mix volume for background music (0-1, default 0.05) */
  mixVolume?: number;
  /** Voice volume when background music is playing (0-1, default 1.0) */
  voiceDuckTo?: number;
  /** Fade-in duration in milliseconds (default 500) */
  fadeInMs?: number;
  /** Fade-out duration in milliseconds (default 1500) */
  fadeOutMs?: number;

  // HeyGen-specific fields
  /** HeyGen track ID (for verification when re-fetching) */
  heygenTrackId?: string;
  /** HeyGen track display name */
  heygenTrackName?: string;
  /** HeyGen track duration in seconds */
  heygenTrackDuration?: number;
  /** HeyGen track semantic similarity score (0-1) */
  heygenTrackScore?: number;

  // Magnific-specific fields (legacy)
  /** Magnific library track external ID */
  externalId?: number;
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

