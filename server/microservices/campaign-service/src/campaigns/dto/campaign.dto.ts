import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsUrl()
  brandAssetsUrl?: string;

  @IsString()
  deadlineToApply!: string;

  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsNumber()
  @Min(1)
  payoutRate!: number;

  @IsNumber()
  @Min(1)
  totalBudget!: number;

  @IsOptional()
  @IsString()
  campaignType?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  platformTarget?: string;

  @IsOptional()
  @IsString()
  regionFilter?: string;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl()
  brandAssetsUrl?: string;

  @IsOptional()
  @IsString()
  deadlineToApply?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  payoutRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  totalBudget?: number;
}

export class ListCampaignsQueryDto {
  @IsOptional()
  @IsIn(['LIVE', 'IN_PROGRESS', 'COMPLETED', 'PAUSED', 'DRAFT'])
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class ReviewSubmissionDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  comment?: string;
}

export class CreateSubmissionDto {
  @IsString()
  @IsUrl()
  contentUrl!: string;

  @IsString()
  @IsIn(['INSTAGRAM', 'YOUTUBE'])
  platform!: 'INSTAGRAM' | 'YOUTUBE';

  @IsOptional()
  @IsString()
  creatorName?: string;

  @IsOptional()
  @IsString()
  creatorHandle?: string;
}

export class ApplyToCampaignDto {
  @IsString()
  @IsUrl()
  draftMediaUrl!: string;

  @IsOptional()
  @IsString()
  @IsIn(['INSTAGRAM', 'YOUTUBE'])
  platform?: 'INSTAGRAM' | 'YOUTUBE';

  @IsOptional()
  @IsString()
  @IsIn(['PROJECT_LIBRARY', 'UPLOAD', 'EXTERNAL_URL'])
  sourceType?: 'PROJECT_LIBRARY' | 'UPLOAD' | 'EXTERNAL_URL';

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsBoolean()
  termsAccepted!: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreatePostSubmissionDto {
  @IsString()
  @IsUrl()
  postUrl!: string;

  @IsString()
  @IsIn(['INSTAGRAM', 'YOUTUBE'])
  platform!: 'INSTAGRAM' | 'YOUTUBE';
}

export class ReviewPostSubmissionDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  status!: 'VERIFIED' | 'REJECTED';

  @IsOptional()
  @IsString()
  comment?: string;
}

export class VerifyPostViewsDto {
  @IsInt()
  @Min(0)
  currentViews!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
