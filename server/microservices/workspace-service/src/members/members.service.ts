import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { LoggerService } from '../common/logger/logger.service';
import { MessageQueueService } from '../common/message-queue/message-queue.service';
import { WorkspaceRole } from '@prisma/client';

@Injectable()
export class MembersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
    private readonly messageQueueService: MessageQueueService,
  ) {}

  async getWorkspaceMembers(workspaceId: string, userId: string) {
    // Check if user is a member
    const membership = await this.databaseService.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Workspace not found');
    }

    const members = await this.databaseService.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: [
        { role: 'asc' },
        { joinedAt: 'asc' },
      ],
    });

    return members;
  }

  async removeMember(workspaceId: string, memberIdToRemove: string, userId: string) {
    // Check if requester is a member
    const requesterMembership = await this.databaseService.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    if (!requesterMembership) {
      throw new NotFoundException('Workspace not found');
    }

    // Only owner or ADMIN can remove members
    if (requesterMembership.role !== 'OWNER' && requesterMembership.role !== 'ADMIN') {
      throw new ForbiddenException('Only workspace owners or admins can remove members');
    }

    // Cannot remove owner
    const memberToRemove = await this.databaseService.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: memberIdToRemove,
        },
      },
    });

    if (memberToRemove?.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove workspace owner');
    }

    // Cannot remove self if you're owner
    if (memberIdToRemove === userId && requesterMembership.role === 'OWNER') {
      throw new ForbiddenException('Owner cannot remove themselves. Transfer ownership first.');
    }

    await this.databaseService.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: memberIdToRemove,
        },
      },
    });

    this.logger.log(`Member removed from workspace: ${workspaceId}`, 'MembersService');

    await this.messageQueueService.publish('workspace.events', 'member.removed', {
      workspaceId,
      memberId: memberIdToRemove,
      removedBy: userId,
    });

    return { message: 'Member removed successfully' };
  }

  async leaveWorkspace(workspaceId: string, userId: string) {
    // Check if user is a member
    const membership = await this.databaseService.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('You are not a member of this workspace');
    }

    // Owner cannot leave
    if (membership.role === 'OWNER') {
      throw new ForbiddenException('Owner cannot leave workspace. Transfer ownership or delete workspace instead.');
    }

    await this.databaseService.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    this.logger.log(`User ${userId} left workspace: ${workspaceId}`, 'MembersService');

    await this.messageQueueService.publish('workspace.events', 'member.left', {
      workspaceId,
      userId,
    });

    return { message: 'Left workspace successfully' };
  }

  async updateMemberRole(workspaceId: string, memberId: string, newRole: WorkspaceRole, userId: string) {
    // Check if requester is owner
    const workspace = await this.databaseService.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    if (workspace.ownerId !== userId) {
      throw new ForbiddenException('Only workspace owner can update member roles');
    }

    // Cannot change owner's role
    const member = await this.databaseService.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: memberId,
        },
      },
    });

    if (member?.role === 'OWNER') {
      throw new ForbiddenException('Cannot change owner role');
    }

    if (newRole === 'OWNER') {
      throw new ForbiddenException('To transfer ownership, use transfer ownership endpoint');
    }

    const updatedMember = await this.databaseService.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: memberId,
        },
      },
      data: { role: newRole },
    });

    this.logger.log(`Member role updated in workspace: ${workspaceId}`, 'MembersService');

    await this.messageQueueService.publish('workspace.events', 'member.role.updated', {
      workspaceId,
      memberId,
      newRole,
      updatedBy: userId,
    });

    return updatedMember;
  }

  async checkMemberAccess(workspaceId: string, userId: string) {
    const membership = await this.databaseService.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    return membership ? {
      hasAccess: true,
      role: membership.role,
      isOwner: membership.role === 'OWNER',
    } : { hasAccess: false };
  }
}


