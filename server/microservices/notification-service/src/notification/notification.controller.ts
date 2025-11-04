import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { SendOTPDto } from './dto/send-otp.dto';
import { SendEmailDto } from './dto/send-email.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Send OTP', 
    description: 'Send OTP via email (and SMS in future)' 
  })
  @ApiBody({ type: SendOTPDto })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP sent successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'OTP sent successfully' },
        timestamp: { type: 'string', example: '2024-11-02T22:30:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'Invalid email format' },
        timestamp: { type: 'string', example: '2024-11-02T22:30:00.000Z' }
      }
    }
  })
  async sendOTP(@Body() sendOTPDto: SendOTPDto) {
    await this.notificationService.sendOTP(sendOTPDto);
    return {
      success: true,
      message: 'OTP sent successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('send-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Send email', 
    description: 'Send a custom email to a user' 
  })
  @ApiBody({ type: SendEmailDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Email sent successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Email sent successfully' },
        timestamp: { type: 'string', example: '2024-11-02T22:30:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request' 
  })
  async sendEmail(@Body() sendEmailDto: SendEmailDto) {
    await this.notificationService.sendEmail(sendEmailDto);
    return {
      success: true,
      message: 'Email sent successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user notifications', description: 'Get all notifications for a user' })
  @ApiResponse({ status: 200, description: 'Notifications retrieved successfully' })
  async getUserNotifications() {
    return { success: true, data: [] };
  }
}

