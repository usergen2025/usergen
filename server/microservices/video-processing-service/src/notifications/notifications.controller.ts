import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { UserNotificationService } from './user-notification.service';
import { UserPresenceService } from './user-presence.service';

@ApiTags('notifications')
@Controller('notifications')
@ApiBearerAuth('JWT-auth')
export class NotificationsController {
  constructor(
    private readonly notifications: UserNotificationService,
    private readonly presenceService: UserPresenceService,
    private readonly configService: ConfigService,
  ) {}

  private extractUserId(req: any): string | null {
    try {
      const authHeader = req.headers?.authorization;
      if (!authHeader?.startsWith('Bearer ')) return null;
      const token = authHeader.replace('Bearer ', '');
      const jwtSecret =
        this.configService.get<string>('JWT_SECRET') ||
        'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';
      const decoded = jwt.verify(token, jwtSecret) as any;
      return decoded.sub || decoded.userId || decoded.id || null;
    } catch {
      return null;
    }
  }

  @Get()
  @ApiOperation({ summary: 'List notifications for the current user' })
  async list(@Request() req: any) {
    const userId = this.extractUserId(req);
    if (!userId) {
      throw new HttpException('Authentication failed', HttpStatus.UNAUTHORIZED);
    }
    const items = await this.notifications.listForUser(userId);
    return { success: true, data: { notifications: items } };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markRead(@Request() req: any, @Param('id') id: string) {
    const userId = this.extractUserId(req);
    if (!userId) {
      throw new HttpException('Authentication failed', HttpStatus.UNAUTHORIZED);
    }
    const ok = await this.notifications.markRead(userId, id);
    if (!ok) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }
    return { success: true };
  }

  @Post('presence')
  @ApiOperation({ summary: 'Heartbeat: active video project (suppress notifications while on page)' })
  async reportPresence(@Request() req: any, @Body() body: { projectId?: string | null }) {
    const userId = this.extractUserId(req);
    if (!userId) {
      throw new HttpException('Authentication failed', HttpStatus.UNAUTHORIZED);
    }
    this.presenceService.setActiveProject(userId, body?.projectId ?? null);
    return { success: true };
  }
}
