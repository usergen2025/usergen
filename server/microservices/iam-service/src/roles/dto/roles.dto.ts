import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ description: 'Role name (e.g., workspace.owner)', example: 'workspace.owner' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Display name', example: 'Workspace Owner' })
  @IsString()
  @MaxLength(100)
  displayName: string;

  @ApiProperty({ description: 'Role description', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Context (e.g., workspace, project)', required: false })
  @IsOptional()
  @IsString()
  context?: string;

  @ApiProperty({ description: 'Is this a system role?', default: false })
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}

export class UpdateRoleDto {
  @ApiProperty({ description: 'Display name', required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ description: 'Description', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

export class AddPermissionToRoleDto {
  @ApiProperty({ description: 'Permission ID' })
  @IsString()
  permissionId: string;

  @ApiProperty({ description: 'Granted or denied', default: true })
  @IsOptional()
  @IsBoolean()
  granted?: boolean;
}


