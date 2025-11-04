import { IsString, IsOptional, IsArray, IsObject, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePolicyDto {
  @ApiProperty({ description: 'Policy name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Policy description', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Entity type (e.g., workspace, project)', required: false })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiProperty({ description: 'Entity ID', required: false })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiProperty({ description: 'Array of permission names', type: [String] })
  @IsArray()
  @IsString({ each: true })
  permissions: string[];

  @ApiProperty({ description: 'Conditions (JSON)', required: false })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, any>;

  @ApiProperty({ description: 'Priority', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class UpdatePolicyDto {
  @ApiProperty({ description: 'Policy name', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: 'Description', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Permissions', required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @ApiProperty({ description: 'Conditions', required: false })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, any>;

  @ApiProperty({ description: 'Priority', required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}


