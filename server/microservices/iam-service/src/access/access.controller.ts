import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AccessControlService } from './access-control.service';
import { CheckPermissionDto, BatchCheckPermissionDto } from './dto/access.dto';

@ApiTags('Access Control')
@Controller('access')
export class AccessController {
  constructor(private readonly accessService: AccessControlService) {}

  @Post('check')
  @ApiOperation({ summary: 'Check if user has permission' })
  @ApiResponse({ status: 200, description: 'Returns true or false' })
  async checkPermission(@Body() dto: CheckPermissionDto) {
    const granted = await this.accessService.checkPermission(dto);
    return { granted };
  }

  @Post('batch-check')
  @ApiOperation({ summary: 'Check multiple permissions at once' })
  @ApiResponse({ status: 200, description: 'Returns object with permission results' })
  async batchCheck(@Body() dto: BatchCheckPermissionDto) {
    return this.accessService.checkPermissions(dto);
  }

  @Get('logs')
  @ApiOperation({ summary: 'List access audit logs' })
  async listLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { items, total, page: p, limit: l } = await this.accessService.listAccessLogs({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return {
      success: true,
      data: items,
      meta: { total, page: p, limit: l },
    };
  }

  @Get('user/:userId/permissions')
  @ApiOperation({ summary: 'Get all effective permissions for a user' })
  async getUserPermissions(
    @Param('userId') userId: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
  ) {
    return this.accessService.getUserPermissions(userId, resourceType, resourceId);
  }
}


