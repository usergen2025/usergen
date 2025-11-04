import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendEmailDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address to send to',
  })
  @IsEmail()
  @IsNotEmpty()
  to: string;

  @ApiProperty({
    example: 'Welcome to UserGen.ai',
    description: 'Email subject',
  })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({
    example: '<html><body><h1>Welcome!</h1></body></html>',
    description: 'HTML content of the email',
  })
  @IsString()
  @IsNotEmpty()
  html: string;

  @ApiProperty({
    example: 'Welcome!',
    description: 'Plain text version of the email (optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  text?: string;
}

