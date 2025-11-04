import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { LoggerService } from '../common/logger/logger.service';
import { MessageQueueService } from '../common/message-queue/message-queue.service';
import { InvitationStatus, WorkspaceRole } from '@prisma/client';
import { CryptoHelper, DateHelper } from '../../../shared/utils';
import axios from 'axios';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
    private readonly messageQueueService: MessageQueueService,
  ) {}

  async sendInvitation(
    workspaceId: string,
    userId: string,
    data: { email: string; role?: WorkspaceRole },
  ) {
    const { email, role = WorkspaceRole.MEMBER } = data;

    // Check if user has permission
    const membership = await this.databaseService.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      throw new ForbiddenException('Only workspace owners or admins can send invitations');
    }

    // Verify email exists in auth-service
    try {
      await axios.get(`${process.env.AUTH_SERVICE_URL}/api/users/by-email/${email}`, {
        headers: { 'x-service-request': 'true' },
      });
    } catch (error) {
      throw new BadRequestException('User with this email does not exist');
    }

    // Check if user is already a member
    const existingInvitation = await this.databaseService.teamInvitation.findFirst({
      where: {
        workspaceId,
        email,
        status: InvitationStatus.PENDING,
      },
    });

    if (existingInvitation) {
      throw new BadRequestException('Invitation already sent to this email');
    }

    // Generate invitation token
    const token = CryptoHelper.generateRandomString(32);
    const expiresAt = DateHelper.addDays(new Date(), 7);

    // Create invitation
    const invitation = await this.databaseService.teamInvitation.create({
      data: {
        workspaceId,
        invitedBy: userId,
        email,
        role,
        token,
        expiresAt,
        status: InvitationStatus.PENDING,
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    this.logger.log(`Invitation sent to ${email} for workspace ${workspaceId}`, 'InvitationsService');

    // TODO: Send invitation email
    this.logger.log(`Invitation token: ${token}`, 'InvitationsService');

    await this.messageQueueService.publish('workspace.events', 'invitation.sent', {
      invitationId: invitation.id,
      workspaceId,
      email,
      invitedBy: userId,
    });

    return invitation;
  }

  async acceptInvitation(token: string, userId: string) {
    const invitation = await this.databaseService.teamInvitation.findUnique({
      where: { token },
      include: {
        workspace: true,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Invitation is not pending');
    }

    if (DateHelper.isExpired(invitation.expiresAt)) {
      await this.databaseService.teamInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new BadRequestException('Invitation has expired');
    }

    // Verify user exists
    const isValidUser = await axios.get(`${process.env.AUTH_SERVICE_URL}/api/users/${userId}`, {
      headers: { 'x-service-request': 'true' },
    }).catch(() => null);

    if (!isValidUser) {
      throw new NotFoundException('User not found');
    }

    // Add user to workspace
    await this.databaseService.workspaceMember.create({
      data: {
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
      },
    });

    // Update invitation status
    await this.databaseService.teamInvitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
        userId,
      },
    });

    this.logger.log(`Invitation accepted by user ${userId}`, 'InvitationsService');

    await this.messageQueueService.publish('workspace.events', 'invitation.accepted', {
      invitationId: invitation.id,
      workspaceId: invitation.workspaceId,
      userId,
    });

    return {
      message: 'Invitation accepted successfully',
      workspaceId: invitation.workspaceId,
    };
  }

  async getWorkspaceInvitations(workspaceId: string, userId: string) {
    const membership = await this.databaseService.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      throw new ForbiddenException('Only workspace owners or admins can view invitations');
    }

    const invitations = await this.databaseService.teamInvitation.findMany({
      where: { workspaceId },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return invitations;
  }
}


