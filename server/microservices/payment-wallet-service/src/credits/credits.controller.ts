import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CreditsService } from './credits.service';

@ApiTags('Credits')
@Controller('credits')
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('project/:projectId/breakdown')
  @ApiOperation({ summary: 'Get cost breakdown for a project' })
  @ApiResponse({ status: 200, description: 'Returns detailed cost breakdown' })
  async getProjectCostBreakdown(@Param('projectId') projectId: string) {
    const breakdown = await this.creditsService.getProjectCostBreakdown(projectId);
    return { success: true, data: breakdown };
  }

  @Get('user/:userId/projects')
  @ApiOperation({ summary: 'Get costs for all user projects' })
  @ApiResponse({ status: 200, description: 'Returns project costs summary' })
  async getUserProjectsCosts(
    @Param('userId') userId: string,
    @Query('limit') limit?: string
  ) {
    const costs = await this.creditsService.getUserProjectsCosts(
      userId,
      limit ? parseInt(limit) : 50
    );
    return { success: true, data: costs };
  }

  @Get('user/:userId/summary')
  @ApiOperation({ summary: 'Get billing summary for a user' })
  @ApiResponse({ status: 200, description: 'Returns user billing summary' })
  async getUserBillingSummary(
    @Param('userId') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const summary = await this.creditsService.getUserBillingSummary(
      userId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );
    return { success: true, data: summary };
  }

  @Post('record-and-deduct')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record generation cost and deduct credits' })
  @ApiResponse({ status: 201, description: 'Credits recorded and deducted' })
  async recordAndDeductCredits(
    @Body() body: {
      projectId: string;
      userId: string;
      sceneNumber?: number;
      operationType: string;
      operationName: string;
      metadata?: Record<string, any>;
    }
  ) {
    const snapshot = await this.creditsService.recordAndDeductCredits(body);
    return { success: true, data: snapshot, skipped: !snapshot };
  }

  @Post('check-export-affordability')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pre-export: unsettled costs + final render vs balance' })
  async checkExportAffordability(
    @Body() body: { projectId: string; userId: string },
  ) {
    const result = await this.creditsService.checkExportAffordability(body.userId, body.projectId);
    return { success: true, data: result };
  }

  @Post('settle-project')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Settle all unsettled snapshots for a project (single debit)' })
  async settleProject(
    @Body() body: { projectId: string; userId: string; settlementNonce?: string },
  ) {
    const result = await this.creditsService.settleProjectWallet(body.userId, body.projectId, body.settlementNonce);
    return { success: true, data: result };
  }
}
