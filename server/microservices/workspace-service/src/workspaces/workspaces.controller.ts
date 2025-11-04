import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceType } from '@prisma/client';

interface CreateWorkspaceDto {
  name: string;
  description?: string;
  workspaceType?: WorkspaceType;
}

interface UpdateWorkspaceDto {
  name?: string;
  description?: string;
  avatar?: string;
}

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  async createWorkspace(
    @Param('userId') userId: string,
    @Body() createDto: CreateWorkspaceDto,
  ) {
    const workspace = await this.workspacesService.createWorkspace(userId, createDto);
    return {
      success: true,
      data: workspace,
    };
  }

  @Get('/user/:userId')
  async getMyWorkspaces(@Param('userId') userId: string) {
    const workspaces = await this.workspacesService.getUserWorkspaces(userId);
    return {
      success: true,
      data: workspaces,
    };
  }

  @Get(':workspaceId/user/:userId')
  async getWorkspace(
    @Param('userId') userId: string,
    @Param('workspaceId') workspaceId: string,
  ) {
    const workspace = await this.workspacesService.getWorkspaceById(workspaceId, userId);
    return {
      success: true,
      data: workspace,
    };
  }

  @Patch(':workspaceId/user/:userId')
  async updateWorkspace(
    @Param('userId') userId: string,
    @Param('workspaceId') workspaceId: string,
    @Body() updateDto: UpdateWorkspaceDto,
  ) {
    const workspace = await this.workspacesService.updateWorkspace(workspaceId, userId, updateDto);
    return {
      success: true,
      data: workspace,
    };
  }

  @Delete(':workspaceId/user/:userId')
  @HttpCode(HttpStatus.OK)
  async deleteWorkspace(
    @Param('userId') userId: string,
    @Param('workspaceId') workspaceId: string,
  ) {
    const result = await this.workspacesService.deleteWorkspace(workspaceId, userId);
    return {
      success: true,
      message: result.message,
    };
  }
}


