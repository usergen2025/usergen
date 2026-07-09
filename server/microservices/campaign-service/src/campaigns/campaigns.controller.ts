import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { LeaderboardService } from './leaderboard.service';
import { CampaignFinalizationService } from './campaign-finalization.service';
import {
  AdminFinalizeCampaignDto,
  ApplyToCampaignDto,
  DisqualifyPostDto,
  DraftFromProjectDto,
  IngestDraftUrlDto,
  PreviewLeaderboardQueryDto,
  ReplaceApplicationDraftDto,
  CreatePostSubmissionDto,
  CreateCampaignDto,
  CreateSubmissionDto,
  ListCampaignsQueryDto,
  ReviewPostSubmissionDto,
  ReviewSubmissionDto,
  UpdateCampaignDto,
  UpdatePostViewsDto,
  VerifyPostViewsDto,
} from './dto/campaign.dto';
import { JwtAuthGuard } from '../common/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/auth/guards/roles.guard';
import { Roles } from '../common/auth/decorators/roles.decorator';
import { CurrentUser } from '../common/auth/decorators/current-user.decorator';
import { Response } from 'express';
import { PostScraperService } from '../scraper/post-scraper.service';
import { RefreshLeaderboardDto } from '../scraper/dto/refresh-leaderboard.dto';
import { SsembleService } from '../ssemble/ssemble.service';
import {
  AddSourceVideoDto,
  UpdateSourceVideoDto,
  GenerateClipsDto,
} from '../ssemble/dto/ssemble.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly campaignMediaService: CampaignMediaService,
    private readonly leaderboardService: LeaderboardService,
    private readonly campaignFinalizationService: CampaignFinalizationService,
    private readonly postScraperService: PostScraperService,
    private readonly ssembleService: SsembleService,
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

  @Get('campaigns/:id/pending-applications-count')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  getPendingApplicationsCount(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.getPendingApplicationsCount(id, user.id);
  }

  @Post('campaigns/:id/start')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  startCampaign(
    @Param('id') id: string,
    @Body() body: { handlePendingAs?: 'REJECT_ALL' | 'KEEP_PENDING' },
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.startCampaignManually(id, user.id, body);
  }

  @Post('campaigns/:id/end')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  endCampaign(
    @Param('id') id: string,
    @Body() body: { skipGracePeriod?: boolean },
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.endCampaignManually(id, user.id, body);
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

  @Post('post-submissions/:id/update-views')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  updatePostViews(
    @Param('id') id: string,
    @Body() dto: UpdatePostViewsDto,
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.updatePostViews(id, dto, { id: user.id, role: user.role });
  }

  @Post('post-submissions/:id/disqualify')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  disqualifyPost(
    @Param('id') id: string,
    @Body() dto: DisqualifyPostDto,
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.disqualifyPost(id, dto, { id: user.id, role: user.role });
  }

  @Get('campaigns/:id/leaderboard')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  async getCampaignLeaderboard(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    await this.leaderboardService.assertCampaignReadable(id, user);
    const leaderboard = await this.leaderboardService.computeLiveLeaderboard(id);
    return this.serializeLeaderboard(leaderboard);
  }

  @Get('campaigns/:id/leaderboard/snapshot')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  async getCampaignLeaderboardSnapshot(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    await this.leaderboardService.assertCampaignReadable(id, user);
    return this.leaderboardService.getSnapshot(id);
  }

  @Get('campaigns/:id/prize-pool')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  async getCampaignPrizePool(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    await this.leaderboardService.assertCampaignReadable(id, user);
    return this.leaderboardService.getPrizePool(id);
  }

  @Get('campaigns/:id/prize-pool/preview')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  async previewCampaignPrizePool(
    @Param('id') id: string,
    @Query() query: PreviewLeaderboardQueryDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    await this.leaderboardService.assertCampaignReadable(id, user);
    const preview = await this.leaderboardService.previewAllocation(id, query.previewN);
    return {
      campaignId: preview.campaignId,
      participants: preview.participants,
      totalPoolPaise: preview.totalPoolPaise.toString(),
      totalPoolRupees: preview.totalPoolRupees,
      entries: preview.entries.map((entry) => ({
        ...entry,
        payoutPaise: entry.payoutPaise.toString(),
      })),
    };
  }

  @Post('campaigns/:id/refresh-leaderboard')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  @HttpCode(HttpStatus.ACCEPTED)
  async refreshCampaignLeaderboard(
    @Param('id') id: string,
    @Body() dto: RefreshLeaderboardDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    await this.leaderboardService.assertCampaignReadable(id, user);
    return this.postScraperService.runScrapeForCampaign(id, 'MANUAL', {
      id: user.id,
      role: user.role,
    }, { force: dto?.force });
  }

  @Get('campaigns/:id/scrape-runs')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  async getCampaignScrapeRuns(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    await this.leaderboardService.assertCampaignReadable(id, user);
    return this.postScraperService.getScrapeRuns(id);
  }

  @Get('campaigns/:id/scrape-runs/:runId')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  async getCampaignScrapeRun(
    @Param('id') id: string,
    @Param('runId') runId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    await this.leaderboardService.assertCampaignReadable(id, user);
    return this.postScraperService.getScrapeRun(id, runId);
  }

  @Post('campaigns/:id/finalize')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  finalizeCampaign(
    @Param('id') id: string,
    @Body() dto: AdminFinalizeCampaignDto | undefined,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.campaignFinalizationService.finalizeCampaign(id, user, { force: dto?.force });
  }

  @Post('campaigns/:id/finalize/reset')
  @Roles('ADMIN', 'OWNER')
  resetStuckFinalization(@Param('id') id: string) {
    return this.campaignFinalizationService.resetStuckFinalization(id);
  }

  private serializeLeaderboard(leaderboard: import('./leaderboard.service').LiveLeaderboard) {
    return {
      ...leaderboard,
      totalPoolPaise: leaderboard.totalPoolPaise.toString(),
      entries: leaderboard.entries.map((entry) => ({
        ...entry,
        projectedPayoutPaise: entry.projectedPayoutPaise.toString(),
      })),
      tierGroups: leaderboard.tierGroups?.map((group) => ({
        ...group,
        payoutPaise: group.payoutPaise.toString(),
      })),
    };
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

  // ==================== SOURCE VIDEO CRUD (Brand) ====================

  @Post('campaigns/:id/source-videos')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  addSourceVideo(
    @Param('id') id: string,
    @Body() dto: AddSourceVideoDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.campaignsService.addSourceVideo(id, dto, user);
  }

  @Get('campaigns/:id/source-videos')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getSourceVideos(@Param('id') id: string) {
    return this.campaignsService.getSourceVideos(id);
  }

  @Patch('campaigns/:id/source-videos/:videoId')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  updateSourceVideo(
    @Param('id') id: string,
    @Param('videoId') videoId: string,
    @Body() dto: UpdateSourceVideoDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.campaignsService.updateSourceVideo(id, videoId, dto, user);
  }

  @Post('campaigns/:id/source-videos/:videoId/delete')
  @Roles('BRAND', 'ADMIN', 'OWNER')
  deleteSourceVideo(
    @Param('id') id: string,
    @Param('videoId') videoId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.campaignsService.deleteSourceVideo(id, videoId, user);
  }

  // ==================== SSEMBLE CLIP GENERATION (Creator) ====================

  @Post('creator/campaigns/:id/clips/generate')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  generateClips(
    @Param('id') id: string,
    @Body() dto: GenerateClipsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.campaignsService.generateClips(id, dto, user.id);
  }

  @Get('creator/campaigns/:id/clips/requests')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getMyClipRequests(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.campaignsService.getMyClipRequests(id, user.id);
  }

  @Get('creator/campaigns/:id/clips/requests/:reqId')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getClipRequestDetail(
    @Param('id') id: string,
    @Param('reqId') reqId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.campaignsService.getClipRequestDetail(id, reqId, user.id);
  }

  // ==================== SSEMBLE CATALOG (Proxy) ====================

  @Get('ssemble/templates')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getSsembleTemplates() {
    return this.ssembleService.listTemplates();
  }

  @Get('ssemble/music')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getSsembleMusic(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.ssembleService.listMusic(
      page ? Number(page) : 1,
      limit ? Number(limit) : 100,
    );
  }

  @Get('ssemble/meme-hooks')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getSsembleMemeHooks(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.ssembleService.listMemeHooks(
      page ? Number(page) : 1,
      limit ? Number(limit) : 100,
    );
  }

  @Get('ssemble/game-videos')
  @Roles('USER', 'BRAND', 'ADMIN', 'OWNER')
  getSsembleGameVideos(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.ssembleService.listGameVideos(
      page ? Number(page) : 1,
      limit ? Number(limit) : 100,
    );
  }
}
