import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';

@ApiTags('Admin')
@Controller('admin')
@ApiBearerAuth('JWT-auth')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('project-stats')
  @ApiOperation({ summary: 'Get project statistics' })
  @ApiResponse({ status: 200, description: 'Project statistics' })
  async getProjectStats() {
    const stats = await this.adminService.getProjectStats();
    return { success: true, data: stats };
  }

  @Get('projects')
  @ApiOperation({ summary: 'Get all projects (paginated)' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  async getAllProjects(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const result = await this.adminService.getAllProjects({
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      status,
      search,
    });
    return { success: true, data: result };
  }

  @Get('projects/:projectId')
  @ApiOperation({ summary: 'Get project by ID' })
  @ApiResponse({ status: 200, description: 'Project details' })
  async getProjectById(@Param('projectId') projectId: string) {
    const project = await this.adminService.getProjectById(projectId);
    return { success: true, data: project };
  }

  @Get('users/:userId/stats')
  @ApiOperation({ summary: 'Get user project statistics' })
  @ApiResponse({ status: 200, description: 'User project statistics' })
  async getUserProjectStats(@Param('userId') userId: string) {
    const stats = await this.adminService.getUserProjectStats(userId);
    return { success: true, data: stats };
  }
}
