import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { NotificationService } from './notification.service';
import { SendOTPDto } from './dto/send-otp.dto';
import { SendEmailDto } from './dto/send-email.dto';
import { InAppNotificationService } from '../in-app/in-app-notification.service';
import { CreateInternalNotificationDto } from '../in-app/dto/create-internal-notification.dto';
import { VideoProcessingNotificationDto } from '../in-app/dto/video-processing-notification.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly inApp: InAppNotificationService,
    private readonly configService: ConfigService,
  ) {}

  private extractUserId(req: Request): string | null {
    try {
      const authHeader = req.headers?.authorization;
      if (!authHeader?.startsWith('Bearer ')) return null;
      const token = authHeader.replace('Bearer ', '');
      const jwtSecret =
        this.configService.get<string>('JWT_SECRET') ||
        'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';
      const decoded = jwt.verify(token, jwtSecret) as Record<string, unknown>;
      return (decoded.sub || decoded.userId || decoded.id) as string | null;
    } catch {
      return null;
    }
  }

  private assertInternalSecret(req: Request): void {
    const expected = this.configService.get<string>('INTERNAL_NOTIFICATION_SECRET');
    if (!expected) {
      this.logger.warn(
        'INTERNAL_NOTIFICATION_SECRET is not set — internal notification routes accept any caller (dev only)',
      );
      return;
    }
    const got = req.headers['x-internal-secret'];
    if (typeof got !== 'string' || got !== expected) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send OTP',
    description: 'Send OTP via email (and SMS in future)',
  })
  @ApiBody({ type: SendOTPDto })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
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
    description: 'Send a custom email to a user',
  })
  @ApiBody({ type: SendEmailDto })
  @ApiResponse({ status: 200, description: 'Email sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async sendEmail(@Body() sendEmailDto: SendEmailDto) {
    await this.notificationService.sendEmail(sendEmailDto);
    return {
      success: true,
      message: 'Email sent successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('internal/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create in-app notification (internal services only)' })
  @ApiBody({ type: CreateInternalNotificationDto })
  async internalCreate(@Req() req: Request, @Body() body: CreateInternalNotificationDto) {
    this.assertInternalSecret(req);
    await this.inApp.create(body);
    return { success: true, timestamp: new Date().toISOString() };
  }

  @Post('internal/video-processing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Video pipeline notification with dedupe (internal)' })
  @ApiBody({ type: VideoProcessingNotificationDto })
  async internalVideoProcessing(@Req() req: Request, @Body() body: VideoProcessingNotificationDto) {
    this.assertInternalSecret(req);
    await this.inApp.notifyProcessingEvent(body);
    return { success: true, timestamp: new Date().toISOString() };
  }

  @Get()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List notifications for the current user' })
  async list(@Req() req: Request) {
    const userId = this.extractUserId(req);
    if (!userId) {
      throw new HttpException('Authentication failed', HttpStatus.UNAUTHORIZED);
    }
    const items = await this.inApp.listForUser(userId);
    return { success: true, data: { notifications: items } };
  }

  @Patch(':id/read')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markRead(@Req() req: Request, @Param('id') id: string) {
    const userId = this.extractUserId(req);
    if (!userId) {
      throw new HttpException('Authentication failed', HttpStatus.UNAUTHORIZED);
    }
    const ok = await this.inApp.markRead(userId, id);
    if (!ok) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }
    return { success: true };
  }

  @Post('presence')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Heartbeat: active video project (suppress notifications while on page)',
  })
  async reportPresence(@Req() req: Request, @Body() body: { projectId?: string | null }) {
    const userId = this.extractUserId(req);
    if (!userId) {
      throw new HttpException('Authentication failed', HttpStatus.UNAUTHORIZED);
    }
    this.inApp.setUserPresence(userId, body?.projectId ?? null);
    return { success: true };
  }
}
