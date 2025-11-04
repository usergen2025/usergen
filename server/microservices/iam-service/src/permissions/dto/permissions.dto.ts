import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePermissionDto {
  @ApiProperty({ description: 'Permission name (e.g., video.generate)', example: 'video.generate' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Resource type (e.g., video, project)', example: 'video' })
  @IsString()
  resource: string;

  @ApiProperty({ description: 'Action (e.g., generate, delete, create)', example: 'generate' })
  @IsString()
  action: string;

  @ApiProperty({ description: 'Permission description', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdatePermissionDto {
  @ApiProperty({ description: 'Resource type', required: false })
  @IsOptional()
  @IsString()
  resource?: string;

  @ApiProperty({ description: 'Action', required: false })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiProperty({ description: 'Description', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}


