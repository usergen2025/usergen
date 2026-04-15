import { IsString, IsOptional, IsEmail, MinLength, IsEnum, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
  OWNER = 'OWNER',
  AVATAR_CREATOR = 'AVATAR_CREATOR',
  BRAND = 'BRAND',
}

export class CreateAdminDto {
  @ApiProperty({ description: 'Admin email', example: 'admin@usergen.ai' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Admin password', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ description: 'Admin name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Admin role', enum: ['ADMIN', 'OWNER'] })
  @IsEnum(['ADMIN', 'OWNER'])
  role: 'ADMIN' | 'OWNER';
}

export class UpdateUserRoleDto {
  @ApiProperty({ description: 'New role', enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

export class UpdateUserCreditsDto {
  @ApiProperty({ description: 'Credits to add or set' })
  @IsInt()
  credits: number;

  @ApiProperty({ description: 'Whether to add to existing credits or set absolute value', default: false })
  @IsOptional()
  addToExisting?: boolean;
}

export class ListUsersQueryDto {
  @ApiProperty({ description: 'Page number', default: 1, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ description: 'Items per page', default: 20, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ description: 'Search term (name or email)', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: 'Filter by role', required: false, enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
