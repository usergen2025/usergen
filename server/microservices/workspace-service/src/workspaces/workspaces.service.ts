import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { LoggerService } from '../common/logger/logger.service';
import { MessageQueueService } from '../common/message-queue/message-queue.service';
import { WorkspaceType } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
    private readonly messageQueueService: MessageQueueService,
  ) {}

  async validateUser(userId: string): Promise<boolean> {
    // Validate user exists in auth-service
    try {
      const response = await axios.get(`${process.env.AUTH_SERVICE_URL}/api/users/${userId}`, {
        headers: { 'x-service-request': 'true' },
      });
      return !!response.data;
    } catch (error) {
      this.logger.error(`Failed to validate user ${userId}`, 'WorkspacesService');
      return false;
    }
  }

  async createWorkspace(userId: string, data: { name: string; description?: string; workspaceType?: WorkspaceType }) {
    const { name, description, workspaceType = WorkspaceType.TEAM } = data;

    // Validate user exists
    const isValidUser = await this.validateUser(userId);
    if (!isValidUser) {
      throw new NotFoundException('User not found');
    }

    // Create workspace
    const workspace = await this.databaseService.workspace.create({
      data: {
        name,
        description,
        workspaceType,
        ownerId: userId,
      },
    });

    // Add owner as a member with OWNER role
    await this.databaseService.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: userId,
        role: 'OWNER',
      },
    });

    this.logger.log(`Workspace created: ${workspace.id} by user ${userId}`, 'WorkspacesService');

    // Publish event
    await this.messageQueueService.publish('workspace.events', 'workspace.created', {
      workspaceId: workspace.id,
      ownerId: userId,
      name: workspace.name,
      createdAt: workspace.createdAt,
    });

    return workspace;
  }

  async getUserWorkspaces(userId: string) {
    // Validate user
    const isValidUser = await this.validateUser(userId);
    if (!isValidUser) {
      throw new NotFoundException('User not found');
    }

    // Get all workspaces where user is a member
    const memberships = await this.databaseService.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            description: true,
            workspaceType: true,
            settings: true,
            avatar: true,
            createdAt: true,
            updatedAt: true,
            ownerId: true,
            _count: {
              select: {
                members: true,
              },
            },
          },
        },
      },
      orderBy: {
        joinedAt: 'desc',
      },
    });

    return memberships.map((membership) => ({
      ...membership.workspace,
      memberRole: membership.role,
      isOwner: membership.workspace.ownerId === userId,
      memberCount: membership.workspace._count.members,
    }));
  }

  async getWorkspaceById(workspaceId: string, userId: string) {
    // Check if user is a member
    const membership = await this.databaseService.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            description: true,
            workspaceType: true,
            ownerId: true,
            settings: true,
            avatar: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                members: true,
                invitations: true,
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Workspace not found or you do not have access');
    }

    return {
      ...membership.workspace,
      memberRole: membership.role,
      isOwner: membership.workspace.ownerId === userId,
      memberCount: membership.workspace._count.members,
      invitationCount: membership.workspace._count.invitations,
    };
  }

  async updateWorkspace(workspaceId: string, userId: string, data: { name?: string; description?: string; avatar?: string }) {
    // Check if user is a member
    const membership = await this.databaseService.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
      include: {
        workspace: true,
      },
    });

    if (!membership) {
      throw new NotFoundException('Workspace not found');
    }

    // Only owner or ADMIN can update
    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
      throw new ForbiddenException('Only workspace owners or admins can update workspace');
    }

    const workspace = await this.databaseService.workspace.update({
      where: { id: workspaceId },
      data,
    });

    this.logger.log(`Workspace updated: ${workspaceId}`, 'WorkspacesService');

    await this.messageQueueService.publish('workspace.events', 'workspace.updated', {
      workspaceId,
      updatedBy: userId,
      changes: data,
    });

    return workspace;
  }

  async deleteWorkspace(workspaceId: string, userId: string) {
    // Check if user is the owner
    const workspace = await this.databaseService.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    if (workspace.ownerId !== userId) {
      throw new ForbiddenException('Only workspace owner can delete workspace');
    }

    await this.databaseService.workspace.delete({
      where: { id: workspaceId },
    });

    this.logger.log(`Workspace deleted: ${workspaceId}`, 'WorkspacesService');

    await this.messageQueueService.publish('workspace.events', 'workspace.deleted', {
      workspaceId,
      deletedBy: userId,
    });

    return { message: 'Workspace deleted successfully' };
  }
}


