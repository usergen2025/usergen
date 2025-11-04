import { Controller, Get, Delete, Patch, Param, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { MembersService } from './members.service';
import { WorkspaceRole } from '@prisma/client';

interface UpdateMemberRoleDto {
  role: WorkspaceRole;
}

@Controller('workspaces/:workspaceId/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  async getWorkspaceMembers(
    @Param('userId') userId: string,
    @Param('workspaceId') workspaceId: string,
  ) {
    const members = await this.membersService.getWorkspaceMembers(workspaceId, userId);
    return {
      success: true,
      data: members,
    };
  }

  @Delete(':memberId')
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @Param('userId') userId: string,
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
  ) {
    const result = await this.membersService.removeMember(workspaceId, memberId, userId);
    return {
      success: true,
      message: result.message,
    };
  }

  @Patch('leave')
  @HttpCode(HttpStatus.OK)
  async leaveWorkspace(
    @Param('userId') userId: string,
    @Param('workspaceId') workspaceId: string,
  ) {
    const result = await this.membersService.leaveWorkspace(workspaceId, userId);
    return {
      success: true,
      message: result.message,
    };
  }

  @Patch(':memberId/role')
  async updateMemberRole(
    @Param('userId') userId: string,
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Body() updateDto: UpdateMemberRoleDto,
  ) {
    const member = await this.membersService.updateMemberRole(workspaceId, memberId, updateDto.role, userId);
    return {
      success: true,
      data: member,
    };
  }
}


