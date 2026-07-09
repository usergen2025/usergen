import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsIn,
  Min,
  Max,
  MaxLength,
  IsUrl,
} from 'class-validator';

export class AddSourceVideoDto {
  @IsUrl()
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class UpdateSourceVideoDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}

export class GenerateClipsDto {
  @IsString()
  sourceVideoId: string;

  @IsInt()
  @Min(0)
  startSec: number;

  @IsInt()
  @Min(1)
  endSec: number;

  @IsOptional()
  @IsIn(['under30sec', 'under60sec', 'under90sec', 'under3min', 'under5min', 'under10min'])
  preferredLength?: string;

  @IsOptional()
  @IsIn(['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'tr', 'pl', 'nl', 'sv', 'no', 'da', 'fi', 'cs'])
  language?: string;

  @IsOptional()
  @IsIn(['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'tr', 'pl', 'nl', 'sv', 'no', 'da', 'fi', 'cs'])
  captionLanguage?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsBoolean()
  hookTitle?: boolean;

  @IsOptional()
  @IsBoolean()
  memeHook?: boolean;

  @IsOptional()
  @IsString()
  memeHookName?: string;

  @IsOptional()
  @IsBoolean()
  gameVideo?: boolean;

  @IsOptional()
  @IsString()
  gameVideoName?: string;

  @IsOptional()
  @IsBoolean()
  ctaEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ctaText?: string;

  @IsOptional()
  @IsBoolean()
  music?: boolean;

  @IsOptional()
  @IsString()
  musicName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  musicVolume?: number;

  @IsOptional()
  @IsIn(['auto', 'fill', 'fit', 'square'])
  layout?: string;
}

export interface SsembleTemplate {
  id: string;
  name: string;
  thumbnailUrl?: string;
}

export interface SsembleMusicTrack {
  name: string;
  durationSecs?: number;
}

export interface SsembleMemeHook {
  name: string;
  durationSecs?: number;
  thumbnailUrl?: string;
}

export interface SsembleGameVideo {
  name: string;
  thumbnailUrl?: string;
}

export interface SsembleShort {
  id: string;
  title?: string;
  description?: string;
  video_url: string;
  thumbnail_url?: string;
  duration?: number;
  viral_score?: number;
}

export interface SsembleWebhookPayload {
  event: 'shorts.completed' | 'shorts.failed';
  requestId: string;
  status: 'completed' | 'failed';
  timestamp: string;
  data?: {
    shorts?: SsembleShort[];
    error?: string;
  };
}

export interface CreateShortParams {
  url?: string;
  fileUrl?: string;
  start: number;
  end: number;
  preferredLength?: string;
  language?: string;
  captionLanguage?: string;
  templateId?: string;
  noClipping?: boolean;
  hookTitle?: boolean;
  memeHook?: boolean;
  memeHookName?: string;
  gameVideo?: boolean;
  gameVideoName?: string;
  ctaEnabled?: boolean;
  ctaText?: string;
  music?: boolean;
  musicName?: string;
  musicVolume?: number;
  layout?: string;
  webhookUrl?: string;
}

export interface CreateShortResponse {
  requestId: string;
  status: string;
  creditsUsed: number;
  estimatedCompletionTime?: string;
}

export interface StatusResponse {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  currentStep?: string;
  error?: string;
}

export interface ShortsResponse {
  shorts: SsembleShort[];
}
