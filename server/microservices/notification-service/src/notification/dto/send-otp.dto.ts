import { IsEmail, IsNotEmpty, IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum OtpType {
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  LOGIN = 'LOGIN',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

export class SendOTPDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address to send OTP to',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '+1234567890',
    description: 'Mobile number (optional, for future SMS support)',
    required: false,
  })
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit OTP code',
  })
  @IsString()
  @IsNotEmpty()
  otp: string;

  @ApiProperty({
    example: OtpType.EMAIL_VERIFICATION,
    enum: OtpType,
    description: 'Type of OTP',
  })
  @IsEnum(OtpType)
  @IsNotEmpty()
  type: OtpType;
}

