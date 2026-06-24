import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RegisterStagedAssetDto {
  @ApiProperty({ example: 'product-1234567890' })
  @IsString()
  clientAssetId: string;

  @ApiProperty({ example: 'product', enum: ['logo', 'product', 'reference'] })
  @IsString()
  category: string;

  @ApiProperty({ example: 'https://storage.googleapis.com/bucket/image.png' })
  @IsString()
  publicUrl: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  localPath?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gcsPath?: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional({ enum: ['image', 'url'], default: 'image' })
  @IsOptional()
  @IsIn(['image', 'url'])
  assetType?: 'image' | 'url';
}

export class OrphanStagedAssetsDto {
  @ApiProperty({ type: [String], example: ['product-1234567890'] })
  @IsArray()
  @IsString({ each: true })
  clientAssetIds: string[];
}

export class CommitAssetItemDto {
  @ApiProperty({ example: 'product-1234567890' })
  @IsString()
  clientAssetId: string;

  @ApiProperty({ example: 'product' })
  @IsString()
  category: string;

  @ApiPropertyOptional({ example: 'My product' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ enum: ['image', 'url'], default: 'image' })
  @IsOptional()
  @IsIn(['image', 'url'])
  type?: 'image' | 'url';

  @ApiPropertyOptional({ description: 'Required for URL-type assets without a staged row' })
  @IsOptional()
  @IsString()
  url?: string;
}

export class CommitStagedAssetsDto {
  @ApiProperty({ type: [CommitAssetItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitAssetItemDto)
  assets: CommitAssetItemDto[];
}
