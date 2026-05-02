import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateInternalNotificationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty()
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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
