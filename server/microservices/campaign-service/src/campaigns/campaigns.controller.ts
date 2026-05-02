import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Headers,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { CampaignsService } from './campaigns.service';
import { CampaignMediaService } from './campaign-media.service';
import {
  ApplyToCampaignDto,
  DraftFromProjectDto,
  IngestDraftUrlDto,
  ReplaceApplicationDraftDto,
  CreatePostSubmissionDto,
  CreateCampaignDto,
  CreateSubmissionDto,
  ListCampaignsQueryDto,
  ReviewPostSubmissionDto,
  ReviewSubmissionDto,
  UpdateCampaignDto,
  VerifyPostViewsDto,
} from './dto/campaign.dto';
import { JwtAuthGuard } from '../common/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/auth/guards/roles.guard';
import { Roles } from '../common/auth/decorators/roles.decorator';
import { CurrentUser } from '../common/auth/decorators/current-user.decorator';
import { Response } from 'express';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly campaignMediaService: CampaignMediaService,
  ) {}

  @Get('campaigns')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  getCampaigns(@Query() query: ListCampaignsQueryDto, @CurrentUser() user: { id: string; role: string }) {
    return this.campaignsService.listCampaignsForRequest(
      { id: user.id, role: user.role },
      query.status as any,
      query.search,
    );
  }

  @Post('campaigns/assets/upload')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 52 * 1024 * 1024 },
    }),
  )
  uploadCampaignAsset(
    @UploadedFile() file: { buffer?: Buffer; originalname?: string; size?: number } | undefined,
    @CurrentUser() user: { id: string },
  ) {
    return this.campaignsService.uploadBrandAsset(file ?? {}, user.id);
  }

  @Post('campaigns/drafts/upload')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 52 * 1024 * 1024 },
    }),
  )
  uploadCreatorDraftAsset(
    @UploadedFile() file: { buffer?: Buffer; originalname?: string; size?: number; mimetype?: string } | undefined,
    @CurrentUser() user: { id: string },
    @Query('campaignId') campaignId?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    return this.campaignMediaService.createFromUpload(
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype, size: file.size },
      user.id,
      campaignId,
    );
  }

  @Post('campaigns/drafts/ingest-url')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  ingestDraftUrl(@Body() dto: IngestDraftUrlDto, @CurrentUser() user: { id: string }) {
    return this.campaignMediaService.createFromExternalUrl(dto.url, user.id, dto.campaignId);
  }

  @Post('campaigns/drafts/from-project')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  draftFromProject(
    @Body() dto: DraftFromProjectDto,
    @CurrentUser() user: { id: string },
    @Headers('authorization') authorization?: string,
  ) {
    return this.campaignMediaService.createFromProject(
      dto.projectId,
      user.id,
      dto.campaignId,
      authorization,
    );
  }

  @Get('campaigns/:id')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  getCampaign(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }) {
    return this.campaignsService.getCampaignForRequest({ id: user.id, role: user.role }, id);
  }

  @Post('campaigns')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  createCampaign(@Body() dto: CreateCampaignDto, @CurrentUser() user: any) {
    return this.campaignsService.createCampaign(dto, user.id);
  }

  @Put('campaigns/:id')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  updateCampaign(@Param('id') id: string, @Body() dto: UpdateCampaignDto, @CurrentUser() user: any) {
    return this.campaignsService.updateCampaign(id, dto, user.id);
  }

  @Patch('campaigns/:id')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  patchCampaign(@Param('id') id: string, @Body() dto: UpdateCampaignDto, @CurrentUser() user: any) {
    return this.campaignsService.updateCampaign(id, dto, user.id);
  }

  @Post('campaigns/:id/publish')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  publishCampaign(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.publishCampaign(id, user.id);
  }

  @Post('campaigns/:id/pause')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  pauseCampaign(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.pauseCampaign(id, user.id);
  }

  @Post('campaigns/:id/resume')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  resumeCampaign(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.resumeCampaign(id, user.id);
  }

  @Post('campaigns/:id/top-up')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  topUpCampaign(@Param('id') id: string, @Body() body: { amount: number }, @CurrentUser() user: any) {
    return this.campaignsService.topUpCampaign(id, body?.amount ?? 0, user.id);
  }

  @Get('campaigns/:id/applicants')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  getCampaignApplicants(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.getCampaignApplications(id, { id: user.id, role: user.role });
  }

  @Get('campaigns/:id/applications')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  getCampaignApplications(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }) {
    return this.campaignsService.getCampaignApplications(id, { id: user.id, role: user.role });
  }

  @Get('campaigns/:id/submissions')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  getCampaignSubmissions(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.getCampaignSubmissions(id, { id: user.id, role: user.role });
  }

  @Post('campaigns/:id/apply')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  applyToCampaign(@Param('id') id: string, @Body() dto: ApplyToCampaignDto, @CurrentUser() user: any) {
    return this.campaignsService.applyToCampaign(id, user.id, dto);
  }

  @Post('campaigns/:id/submissions')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  createSubmission(@Param('id') id: string, @Body() dto: CreateSubmissionDto, @CurrentUser() user: any) {
    return this.campaignsService.createSubmission(id, dto, user.id);
  }

  @Post('submissions/:id/review')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  reviewSubmission(@Param('id') id: string, @Body() dto: ReviewSubmissionDto, @CurrentUser() user: any) {
    return this.campaignsService.reviewSubmission(id, dto, { id: user.id, role: user.role });
  }

  @Post('campaigns/:id/applicants/:applicantId/shortlist')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  shortlistApplicant(@Param('applicantId') applicantId: string, @CurrentUser() user: any) {
    return this.campaignsService.reviewCampaignApplication(
      applicantId,
      { status: 'APPROVED' },
      { id: user.id, role: user.role },
    );
  }

  @Post('applications/:id/review')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  reviewApplication(@Param('id') id: string, @Body() dto: ReviewSubmissionDto, @CurrentUser() user: any) {
    return this.campaignsService.reviewCampaignApplication(id, dto, { id: user.id, role: user.role });
  }

  @Post('campaigns/:id/post-submissions')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  submitFinalPostLink(
    @Param('id') id: string,
    @Body() dto: CreatePostSubmissionDto,
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.submitFinalPostLink(id, user.id, dto);
  }

  @Get('campaigns/:id/post-submissions')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  getCampaignPostSubmissions(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }) {
    return this.campaignsService.getCampaignPostSubmissions(id, { id: user.id, role: user.role });
  }

  @Get('campaigns/:id/creator-earnings')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  getCampaignCreatorEarnings(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }) {
    return this.campaignsService.getCampaignCreatorEarnings(id, { id: user.id, role: user.role });
  }

  @Post('post-submissions/:id/review')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  reviewPostSubmission(
    @Param('id') id: string,
    @Body() dto: ReviewPostSubmissionDto,
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.reviewPostSubmission(id, dto, { id: user.id, role: user.role });
  }

  @Post('post-submissions/:id/verify-views')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  verifyPostViews(
    @Param('id') id: string,
    @Body() dto: VerifyPostViewsDto,
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.verifyPostViewsAndAccrueEarnings(id, dto, { id: user.id, role: user.role });
  }

  @Get('brands/dashboard/stats')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  getBrandDashboardStats(@CurrentUser() user: any) {
    return this.campaignsService.getBrandDashboardStats(user.id);
  }

  @Get('creator/campaigns')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getCreatorCampaigns(@Query('search') search?: string) {
    return this.campaignsService.getCreatorCampaigns(search);
  }

  @Get('creator/campaigns/:id')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getCreatorCampaignById(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.campaignsService.getCampaignDetailForCreator(id, user.id);
  }

  @Post('creator/campaigns/:campaignId/replace-draft')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  replaceApplicationDraft(
    @Param('campaignId') campaignId: string,
    @Body() dto: ReplaceApplicationDraftDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.campaignsService.replaceApplicationDraft(campaignId, user.id, dto.draftAssetId);
  }

  @Get('creator/earnings')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getCreatorEarnings(@CurrentUser() user: any) {
    return this.campaignsService.getCreatorEarnings(user.id);
  }

  @Get('creator/campaign-states')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getCreatorCampaignStates(@CurrentUser() user: any) {
    return this.campaignsService.getCreatorCampaignStates(user.id);
  }

  @Post('creator/withdrawals')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  requestWithdrawal(@Body() body: { amount: number }, @CurrentUser() user: any) {
    return this.campaignsService.requestWithdrawal(body?.amount ?? 0, user.id);
  }

  @Get('wallet-sync-events')
  @Roles('ADMIN', 'OWNER')
  getWalletSyncEvents(
    @Query('status') status?: 'SYNCED' | 'RETRY_PENDING' | 'FAILED',
    @Query('eventType') eventType?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.campaignsService.getWalletSyncEvents({
      status,
      eventType,
      limit: limit ? Number(limit) : undefined,
      cursor,
      startDate,
      endDate,
    });
  }

  @Get('wallet-sync-events/summary')
  @Roles('ADMIN', 'OWNER')
  getWalletSyncSummary() {
    return this.campaignsService.getWalletSyncSummary();
  }

  @Get('wallet-sync-events/export')
  @Roles('ADMIN', 'OWNER')
  async exportWalletSyncEventsCsv(
    @Res() res: Response,
    @Query('status') status?: 'SYNCED' | 'RETRY_PENDING' | 'FAILED',
    @Query('eventType') eventType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const csv = await this.campaignsService.exportWalletSyncEventsCsv({
      status,
      eventType,
      startDate,
      endDate,
    });
    const dateSuffix = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wallet-sync-events-${dateSuffix}.csv"`);
    res.send(csv);
  }

  @Post('wallet-sync-events/:id/retry')
  @Roles('ADMIN', 'OWNER')
  retryWalletSyncEvent(@Param('id') id: string) {
    return this.campaignsService.retryWalletSyncEvent(id);
  }

  @Post('wallet-sync-events/retry-all')
  @Roles('ADMIN', 'OWNER')
  retryWalletSyncEvents(@Body() body: { statuses?: Array<'RETRY_PENDING' | 'FAILED'> }) {
    const statuses: Array<'RETRY_PENDING' | 'FAILED'> = body?.statuses?.length
      ? body.statuses
      : ['RETRY_PENDING', 'FAILED'];
    return this.campaignsService.retryWalletSyncEventsByStatus(statuses);
  }

  @Post('creator-earnings/process-unlock')
  @Roles('ADMIN', 'OWNER')
  processLockedEarnings() {
    return this.campaignsService.processMaturedLockedEarnings();
  }

  @Post('creator-earnings/:id/reverse')
  @Roles('ADMIN', 'OWNER')
  reverseLockedEarning(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: any) {
    return this.campaignsService.reverseLockedEarning(id, { id: user.id, role: user.role }, body?.reason);
  }
}
