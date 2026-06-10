import { HttpStatus } from '@nestjs/common';
import { PostValidationService } from './post-validation.service';
import { PostScraperService } from './post-scraper.service';

describe('PostScraperService', () => {
  const campaign = {
    id: 'camp-1',
    name: 'Test POOL',
    payoutModel: 'POOL',
    brandId: 'brand-1',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    manualScrapeCooldownSec: 21600,
    lastManualScrapeAt: new Date(Date.now() - 60_000),
  };

  const post = {
    id: 'post-1',
    campaignId: 'camp-1',
    creatorId: 'creator-1',
    postUrl: 'https://www.instagram.com/reel/ABC123/',
    platform: 'INSTAGRAM',
    status: 'VERIFIED',
    disqualifiedAt: null,
  };

  const build = (opts?: {
    scrapeItems?: Array<Record<string, unknown>>;
    lastManualScrapeAt?: Date | null;
  }) => {
    const databaseService = {
      campaign: {
        findUnique: jest.fn().mockResolvedValue({
          ...campaign,
          lastManualScrapeAt:
            opts && 'lastManualScrapeAt' in opts ? opts.lastManualScrapeAt : campaign.lastManualScrapeAt,
        }),
        update: jest.fn().mockResolvedValue(campaign),
      },
      campaignPostSubmission: {
        findMany: jest.fn().mockResolvedValue([post]),
        update: jest.fn().mockResolvedValue(post),
      },
      campaignPostScrapeRun: {
        create: jest.fn().mockResolvedValue({
          id: 'run-1',
          campaignId: 'camp-1',
          status: 'PENDING',
          postsRequested: 1,
        }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      campaignPostScrapeResult: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const apifyClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      scrapeReels: jest.fn().mockResolvedValue({
        items: opts?.scrapeItems ?? [
          {
            shortCode: 'ABC123',
            timestamp: '2026-01-05T00:00:00.000Z',
            videoPlayCount: 2000,
            ownerUsername: 'creator',
          },
        ],
        apifyRunId: 'apify-run-1',
      }),
    };
    const campaignsService = {
      recordPostViewsFromScraper: jest.fn().mockResolvedValue({
        success: true,
        lastViewsUpdatedAt: new Date().toISOString(),
      }),
      disqualifyPostFromScraper: jest.fn().mockResolvedValue({ success: true }),
    };
    const notificationService = {
      emitLeaderboardUpdated: jest.fn(),
    };
    const configService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'MANUAL_SCRAPE_COOLDOWN_SECONDS') return '21600';
        return defaultValue;
      }),
    };
    const service = new PostScraperService(
      databaseService as any,
      apifyClient as any,
      new PostValidationService(),
      campaignsService as any,
      notificationService as any,
      configService as any,
    );
    return { service, databaseService, apifyClient, campaignsService, notificationService, configService };
  };

  const runExecute = async (
    service: PostScraperService,
    scrapeItems?: Array<Record<string, unknown>>,
  ) => {
    await (service as any).executeScrapeRun('run-1', campaign, [post], 'MANUAL');
  };

  it('returns 429 when brand is within cooldown', async () => {
    const { service } = build();
    await expect(
      service.runScrapeForCampaign('camp-1', 'MANUAL', { id: 'brand-1', role: 'BRAND' }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('allows admin force bypass of cooldown', async () => {
    const { service } = build();
    const result = await service.runScrapeForCampaign(
      'camp-1',
      'MANUAL',
      { id: 'admin-1', role: 'ADMIN' },
      { force: true },
    );
    expect(result.runId).toBe('run-1');
    expect(result.postsRequested).toBe(1);
  });

  it('records views for valid scrape results', async () => {
    const { service, campaignsService, notificationService } = build();
    await runExecute(service);
    expect(campaignsService.recordPostViewsFromScraper).toHaveBeenCalledWith(
      'post-1',
      2000,
      expect.objectContaining({ skipLeaderboardEmit: true }),
    );
    expect(notificationService.emitLeaderboardUpdated).toHaveBeenCalledTimes(1);
  });

  it('auto-disqualifies pre-campaign posts', async () => {
    const { service, campaignsService } = build({
      scrapeItems: [
        {
          shortCode: 'ABC123',
          timestamp: '2025-12-01T00:00:00.000Z',
          videoPlayCount: 500,
        },
      ],
    });
    await runExecute(service);
    expect(campaignsService.disqualifyPostFromScraper).toHaveBeenCalledWith(
      'post-1',
      'POST_CREATED_BEFORE_CAMPAIGN_START',
    );
    expect(campaignsService.recordPostViewsFromScraper).not.toHaveBeenCalled();
  });

  it('does not mutate post when scrape is NOT_FOUND', async () => {
    const { service, campaignsService } = build({ scrapeItems: [] });
    await runExecute(service);
    expect(campaignsService.recordPostViewsFromScraper).not.toHaveBeenCalled();
    expect(campaignsService.disqualifyPostFromScraper).not.toHaveBeenCalled();
  });

  it('allows brand refresh when cooldown has elapsed', async () => {
    const { service } = build({ lastManualScrapeAt: new Date(Date.now() - 7 * 60 * 60 * 1000) });
    const result = await service.runScrapeForCampaign('camp-1', 'MANUAL', {
      id: 'brand-1',
      role: 'BRAND',
    });
    expect(result.status).toBe('PENDING');
  });

  it('hasRecentFinalScrape returns false when no run exists', async () => {
    const { service } = build();
    await expect(service.hasRecentFinalScrape('camp-1')).resolves.toBe(false);
  });
});
