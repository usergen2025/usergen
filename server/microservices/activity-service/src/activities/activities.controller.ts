import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ActivitiesService } from './activities.service';
import { ActivityType } from '@prisma/client';

@ApiTags('activities')
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Post()
  @ApiOperation({ summary: 'Log user activity', description: 'Creates a new activity log entry' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', example: 'clx1234567890' },
        workspaceId: { type: 'string', example: 'clx9876543210' },
        type: { type: 'string', enum: ['LOGIN', 'LOGOUT', 'CREATED', 'UPDATED', 'DELETED', 'VIEWED'], example: 'VIEWED' },
        entityType: { type: 'string', example: 'PROJECT' },
        entityId: { type: 'string', example: 'clx555666777' },
        description: { type: 'string', example: 'User viewed project dashboard' },
        metadata: { type: 'object', example: { page: 'dashboard', action: 'view' } }
      },
      required: ['userId', 'type']
    }
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Activity logged successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'clx111222333' },
            userId: { type: 'string', example: 'clx1234567890' },
            type: { type: 'string', example: 'VIEWED' },
            createdAt: { type: 'string', example: '2024-11-02T04:16:00.000Z' }
          }
        },
        message: { type: 'string', example: 'Activity logged successfully' },
        timestamp: { type: 'string', example: '2024-11-02T04:16:00.000Z' }
      }
    }
  })
  async logActivity(@Body() activityDto: any) {
    const activity = await this.activitiesService.logActivity(activityDto);
    return { success: true, data: activity };
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user activities', description: 'Retrieves activity logs for a specific user' })
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'userId', description: 'User ID', example: 'clx1234567890' })
  @ApiQuery({ name: 'workspaceId', required: false, description: 'Filter by workspace', example: 'clx9876543210' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum number of activities', example: '50' })
  @ApiResponse({ 
    status: 200, 
    description: 'User activities retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'clx111222333' },
              userId: { type: 'string', example: 'clx1234567890' },
              type: { type: 'string', example: 'VIEWED' },
              createdAt: { type: 'string', example: '2024-11-02T04:16:00.000Z' }
            }
          }
        },
        message: { type: 'string', example: 'Activities retrieved successfully' },
        timestamp: { type: 'string', example: '2024-11-02T04:16:00.000Z' }
      }
    }
  })
  async getUserActivities(
    @Param('userId') userId: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('limit') limit?: string,
  ) {
    const activities = await this.activitiesService.getUserActivities(userId, workspaceId, limit ? parseInt(limit) : 50);
    return { success: true, data: activities };
  }

  @Get('workspace/:workspaceId')
  @ApiOperation({ summary: 'Get workspace activities', description: 'Retrieves activity logs for a specific workspace' })
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID', example: 'clx9876543210' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum number of activities', example: '50' })
  @ApiResponse({ 
    status: 200, 
    description: 'Workspace activities retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'clx111222333' },
              workspaceId: { type: 'string', example: 'clx9876543210' },
              type: { type: 'string', example: 'CREATED' },
              createdAt: { type: 'string', example: '2024-11-02T04:16:00.000Z' }
            }
          }
        },
        message: { type: 'string', example: 'Activities retrieved successfully' },
        timestamp: { type: 'string', example: '2024-11-02T04:16:00.000Z' }
      }
    }
  })
  async getWorkspaceActivities(
    @Param('workspaceId') workspaceId: string,
    @Query('limit') limit?: string,
  ) {
    const activities = await this.activitiesService.getWorkspaceActivities(workspaceId, limit ? parseInt(limit) : 50);
    return { success: true, data: activities };
  }
}


