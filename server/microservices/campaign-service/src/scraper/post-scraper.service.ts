import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Campaign, CampaignPostSubmission } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { CampaignNotificationService } from '../campaigns/campaign-notification.service';
import { ApifyClientService } from './apify.client';
import { PostValidationService } from './post-validation.service';
import { ApifyReelResult, ScrapeRunScope } from './apify.types';
import { extractInstagramShortCode, normalizeInstagramUrl } from './instagram-url.util';

export interface ScrapeActor {
  id: string;
  role: string;
}

@Injectable()
export class PostScraperService {
  private readonly logger = new Logger(PostScraperService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly apifyClient: ApifyClientService,
    private readonly postValidation: PostValidationService,
    @Inject(forwardRef(() => CampaignsService))
    private readonly campaignsService: CampaignsService,
    private readonly notificationService: CampaignNotificationService,
  ) {}

  async runScrapeForCampaign(
    campaignId: string,
    scope: ScrapeRunScope,
    actor: ScrapeActor,
    options: { force?: boolean } = {},
  ): Promise<{ runId: string; status: string; postsRequested: number }> {
    if (!this.apifyClient.isConfigured()) {
      throw new ServiceUnavailableException('Apify is not configured (APIFY_TOKEN missing)');
    }

    const campaign = await this.databaseService.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    if (campaign.payoutModel !== 'POOL') {
      throw new ForbiddenException('Leaderboard refresh is only available for POOL campaigns');
    }

    this.assertManualCooldown(campaign, scope, actor, options.force);

    const posts = await this.databaseService.campaignPostSubmission.findMany({
      where: {
        campaignId,
        disqualifiedAt: null,
        platform: 'INSTAGRAM',
        status: { in: ['PENDING_REVIEW', 'VERIFIED'] },
      },
    });

    const run = await this.databaseService.campaignPostScrapeRun.create({
      data: {
        campaignId,
        scope,
        triggeredBy: actor.role === 'CRON' ? 'CRON' : actor.role === 'BRAND' ? 'BRAND' : 'ADMIN',
        triggeredById: actor.id === 'cron' ? null : actor.id,
        status: 'PENDING',
        postsRequested: posts.length,
      },
    });

    if (scope === 'MANUAL' && actor.role === 'BRAND') {
      await this.databaseService.campaign.update({
        where: { id: campaignId },
        data: { lastManualScrapeAt: new Date() },
      });
    }

    void this.executeScrapeRun(run.id, campaign, posts, scope).catch((err) => {
      this.logger.error(`Scrape run ${run.id} failed: ${(err as Error).message}`);
    });

    return { runId: run.id, status: 'PENDING', postsRequested: posts.length };
  }

  private assertManualCooldown(
    campaign: Campaign,
    scope: ScrapeRunScope,
    actor: ScrapeActor,
    force?: boolean,
  ) {
    if (scope !== 'MANUAL') return;
    const isPrivileged = actor.role === 'ADMIN' || actor.role === 'OWNER';
    if (isPrivileged && force) return;
    if (actor.role !== 'BRAND') return;
    if (!campaign.lastManualScrapeAt) return;
    const cooldownMs = (campaign.manualScrapeCooldownSec || 21600) * 1000;
    const elapsed = Date.now() - campaign.lastManualScrapeAt.getTime();
    if (elapsed < cooldownMs) {
      const retryAfterSec = Math.ceil((cooldownMs - elapsed) / 1000);
      throw new HttpException(
        {
          message: `Please wait before refreshing again (${Math.ceil(retryAfterSec / 60)} minutes remaining)`,
          retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async executeScrapeRun(
    runId: string,
    campaign: Campaign,
    posts: CampaignPostSubmission[],
    scope: ScrapeRunScope,
  ) {
    await this.databaseService.campaignPostScrapeRun.update({
      where: { id: runId },
      data: { status: 'RUNNING' },
    });

    let postsScraped = 0;
    let postsFailed = 0;
    let postsDisqualified = 0;
    let apifyRunId: string | undefined;

    try {
      if (!posts.length) {
        await this.databaseService.campaignPostScrapeRun.update({
          where: { id: runId },
          data: { status: 'COMPLETED', finishedAt: new Date(), apifyRunId },
        });
        return;
      }

      const urls = posts.map((p) => p.postUrl);
      const { items, apifyRunId: runIdFromApify } = await this.apifyClient.scrapeReels(urls);
      apifyRunId = runIdFromApify;

      const byShortCode = new Map<string, ApifyReelResult>();
      const byInputUrl = new Map<string, ApifyReelResult>();
      for (const item of items) {
        if (item.shortCode) {
          byShortCode.set(item.shortCode, item);
        }
        if (item.inputUrl) {
          byInputUrl.set(normalizeInstagramUrl(item.inputUrl), item);
        }
        if (item.url) {
          const code = extractInstagramShortCode(item.url);
          if (code) byShortCode.set(code, item);
        }
      }

      for (const post of posts) {
        const shortCode = extractInstagramShortCode(post.postUrl);
        const normalized = normalizeInstagramUrl(post.postUrl);
        const scrape =
          (shortCode && byShortCode.get(shortCode)) ||
          byInputUrl.get(normalized) ||
          items.find((i) => i.inputUrl && normalizeInstagramUrl(i.inputUrl) === normalized) ||
          null;

        const outcome = this.postValidation.validate(campaign, scrape);

        if (outcome.ok === false) {
          if (outcome.reason === 'PRE_CAMPAIGN') {
            await this.campaignsService.disqualifyPostFromScraper(
              post.id,
              'POST_CREATED_BEFORE_CAMPAIGN_START',
            );
            postsDisqualified += 1;
          } else {
            postsFailed += 1;
          }
          await this.databaseService.campaignPostScrapeResult.create({
            data: this.buildScrapeResultRow(runId, post.id, outcome.reason, scrape, outcome.detail),
          });
          continue;
        }

        const reel = outcome.scrape;
        const views = Math.max(0, Math.floor(reel.videoPlayCount ?? reel.videoViewCount ?? 0));

        await this.campaignsService.recordPostViewsFromScraper(post.id, views, {
          recordedBy: runId,
          note: `apify:${scope}`,
          skipLeaderboardEmit: true,
        });

        await this.databaseService.campaignPostSubmission.update({
          where: { id: post.id },
          data: {
            ownerUsername: reel.ownerUsername ?? undefined,
            postCreatedAt: reel.timestamp ? new Date(reel.timestamp) : undefined,
            postPlatformId: reel.shortCode || reel.id || undefined,
            caption: reel.caption ?? undefined,
            hashtags: reel.hashtags ?? undefined,
            likesCount: reel.likesCount ?? 0,
            commentsCount: reel.commentsCount ?? 0,
            prelimCheckedAt: new Date(),
            prelimCheckPassed: true,
            lastScrapeRunId: runId,
          },
        });

        await this.databaseService.campaignPostScrapeResult.create({
          data: this.buildScrapeResultRow(runId, post.id, 'OK', reel),
        });
        postsScraped += 1;
      }

      const status =
        postsFailed > 0 && postsScraped === 0
          ? 'FAILED'
          : postsFailed > 0
            ? 'PARTIAL'
            : 'COMPLETED';

      await this.databaseService.campaignPostScrapeRun.update({
        where: { id: runId },
        data: {
          status,
          apifyRunId,
          postsScraped,
          postsFailed,
          postsDisqualified,
          finishedAt: new Date(),
        },
      });

      this.notificationService.emitLeaderboardUpdated({
        campaignId: campaign.id,
        campaignName: campaign.name,
        triggeredBy: `scrape:${scope.toLowerCase()}`,
      });
    } catch (error) {
      const message = (error as Error).message;
      await this.databaseService.campaignPostScrapeRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          apifyRunId,
          postsScraped,
          postsFailed,
          postsDisqualified,
          finishedAt: new Date(),
          error: message,
        },
      });
      throw error;
    }
  }

  private buildScrapeResultRow(
    runId: string,
    postSubmissionId: string,
    status: string,
    scrape: ApifyReelResult | null | undefined,
    errorMessage?: string,
  ) {
    return {
      scrapeRunId: runId,
      postSubmissionId,
      status,
      apifyShortcode: scrape?.shortCode ?? null,
      apifyPostId: scrape?.id ?? null,
      videoPlayCount: scrape?.videoPlayCount ?? null,
      videoViewCount: scrape?.videoViewCount ?? null,
      likesCount: scrape?.likesCount ?? null,
      commentsCount: scrape?.commentsCount ?? null,
      postTimestamp: scrape?.timestamp ? new Date(scrape.timestamp) : null,
      ownerUsername: scrape?.ownerUsername ?? null,
      productType: scrape?.productType ?? null,
      rawJson: scrape ? (scrape as object) : undefined,
      errorMessage: errorMessage ?? null,
    };
  }

  async getScrapeRuns(campaignId: string, limit = 20) {
    return this.databaseService.campaignPostScrapeRun.findMany({
      where: { campaignId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async getScrapeRun(campaignId: string, runId: string) {
    const run = await this.databaseService.campaignPostScrapeRun.findFirst({
      where: { id: runId, campaignId },
      include: {
        results: {
          orderBy: { createdAt: 'asc' },
          include: {
            postSubmission: {
              select: { id: true, postUrl: true, creatorId: true, status: true },
            },
          },
        },
      },
    });
    if (!run) {
      throw new NotFoundException('Scrape run not found');
    }
    return run;
  }

  async hasRecentFinalScrape(campaignId: string, withinMs = 60 * 60 * 1000): Promise<boolean> {
    const since = new Date(Date.now() - withinMs);
    const run = await this.databaseService.campaignPostScrapeRun.findFirst({
      where: {
        campaignId,
        scope: 'FINAL',
        status: { in: ['COMPLETED', 'PARTIAL'] },
        finishedAt: { gte: since },
      },
      orderBy: { finishedAt: 'desc' },
    });
    return Boolean(run);
  }

  async ensureFinalScrape(campaignId: string): Promise<void> {
    const hasRecent = await this.hasRecentFinalScrape(campaignId);
    if (hasRecent) return;
    await this.runScrapeForCampaign(campaignId, 'FINAL', { id: 'cron', role: 'CRON' });
  }
}
