import { Controller, Get, Post, Param, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { WorkspaceRole } from '@prisma/client';

interface SendInvitationDto {
  email: string;
  role?: WorkspaceRole;
}

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('workspaces/:workspaceId')
  async sendInvitation(
    @Param('userId') userId: string,
    @Param('workspaceId') workspaceId: string,
    @Body() sendDto: SendInvitationDto,
  ) {
    const invitation = await this.invitationsService.sendInvitation(workspaceId, userId, sendDto);
    return {
      success: true,
      data: invitation,
    };
  }

  @Post('accept/:token')
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(
    @Param('userId') userId: string,
    @Param('token') token: string,
  ) {
    const result = await this.invitationsService.acceptInvitation(token, userId);
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

  @Get('workspaces/:workspaceId')
  async getWorkspaceInvitations(
    @Param('userId') userId: string,
    @Param('workspaceId') workspaceId: string,
  ) {
    const invitations = await this.invitationsService.getWorkspaceInvitations(workspaceId, userId);
    return {
      success: true,
      data: invitations,
    };
  }
}


