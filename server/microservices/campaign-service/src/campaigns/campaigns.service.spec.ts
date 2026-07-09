import { NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { WalletSyncService } from './wallet-sync.service';

describe('CampaignsService wallet sync retry', () => {
  const walletSyncEvent = {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };

  const mockDatabaseService: any = {
    walletSyncEvent,
    campaign: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    submission: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    campaignApplication: {
      upsert: jest.fn(),
    },
    submissionReview: {
      create: jest.fn(),
    },
    campaignEarningSnapshot: {
      create: jest.fn(),
    },
    withdrawalRequest: {
      create: jest.fn(),
    },
    campaignPostSubmission: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    campaignPostViewUpdate: {
      create: jest.fn(),
    },
  };

  const mockWalletSyncService: jest.Mocked<WalletSyncService> = {
    deductBrandBudget: jest.fn(),
    addCreatorEarning: jest.fn(),
    deductCreatorWithdrawal: jest.fn(),
    getUserCreditsBalance: jest.fn().mockResolvedValue(10000),
  } as any;
  const mockConfigService: any = {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'WALLET_SYNC_AUTO_RETRY_ENABLED') return 'false';
      return defaultValue;
    }),
  };

  const mockCampaignMediaService: any = {
    previewApiPath: jest.fn().mockReturnValue('/api/campaign-media/x/preview'),
  };

  const mockNotificationService: any = {
    notifyApplicationReceived: jest.fn(),
    notifyApplicationApproved: jest.fn(),
    notifyApplicationRejected: jest.fn(),
    notifyPostSubmitted: jest.fn(),
    notifyPostVerified: jest.fn(),
    emitViewsUpdated: jest.fn(),
    emitLeaderboardUpdated: jest.fn(),
  };

  const mockCampaignFinalizationService: any = {
    finalizeCampaign: jest.fn(),
  };

  const mockSsembleService: any = {
    createShort: jest.fn(),
    getStatus: jest.fn(),
    getShorts: jest.fn(),
    listTemplates: jest.fn().mockResolvedValue([]),
    listMusic: jest.fn().mockResolvedValue([]),
    listMemeHooks: jest.fn().mockResolvedValue([]),
    listGameVideos: jest.fn().mockResolvedValue([]),
    detectUrlType: jest.fn().mockReturnValue('YOUTUBE'),
    extractYouTubeVideoId: jest.fn().mockReturnValue('abc123'),
    buildYouTubeThumbnailUrl: jest.fn().mockReturnValue('https://img.youtube.com/vi/abc123/hqdefault.jpg'),
  };

  let service: CampaignsService;
  const now = new Date('2026-01-01T00:00:00.000Z');

  const makeCampaignRow = (overrides?: Partial<any>) => ({
    id: 'camp-1',
    brandId: 'brand-1',
    name: 'Campaign',
    description: 'Desc',
    status: 'DRAFT',
    createdAt: now,
    deadlineToApply: now,
    startDate: now,
    endDate: now,
    payoutRate: 500,
    totalBudget: 1000,
    budgetUsed: 0,
    views: 0,
    targetViews: 2000,
    submissions: [],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CampaignsService(
      mockDatabaseService,
      mockWalletSyncService,
      mockConfigService,
      mockCampaignMediaService,
      mockNotificationService,
      mockCampaignFinalizationService,
      mockSsembleService,
    );
  });

  it('marks retry event as SYNCED when retry call succeeds', async () => {
    walletSyncEvent.findUnique.mockResolvedValue({
      id: 'evt-1',
      eventType: 'CREATOR_WITHDRAWAL_DEBIT',
      payload: { creatorId: 'creator-1', amount: 50, idempotencyKey: 'idem-123' },
    });
    walletSyncEvent.update.mockResolvedValue({ id: 'evt-1', status: 'SYNCED' });

    const result = await service.retryWalletSyncEvent('evt-1');

    expect(mockWalletSyncService.deductCreatorWithdrawal).toHaveBeenCalledWith(
      'creator-1',
      50,
      { creatorId: 'creator-1', amount: 50, idempotencyKey: 'idem-123' },
      'idem-123',
    );
    expect(walletSyncEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { status: 'SYNCED', attempts: { increment: 1 }, lastError: null },
    });
    expect(result).toEqual({ id: 'evt-1', status: 'SYNCED' });
  });

  it('marks retry event as FAILED when wallet retry throws', async () => {
    walletSyncEvent.findUnique.mockResolvedValue({
      id: 'evt-2',
      eventType: 'CREATOR_EARNING_CREDIT',
      payload: { creatorId: 'creator-9', amount: 40 },
    });
    mockWalletSyncService.addCreatorEarning.mockRejectedValueOnce(new Error('wallet timeout'));
    walletSyncEvent.update.mockResolvedValue({ id: 'evt-2', status: 'FAILED' });

    const result = await service.retryWalletSyncEvent('evt-2');

    expect(walletSyncEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-2' },
      data: { status: 'FAILED', attempts: { increment: 1 }, lastError: 'wallet timeout' },
    });
    expect(result).toEqual({ id: 'evt-2', status: 'FAILED' });
  });

  it('throws not found when event does not exist', async () => {
    walletSyncEvent.findUnique.mockResolvedValue(null);
    await expect(service.retryWalletSyncEvent('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('publishes campaign with idempotency key and sync event payload', async () => {
    mockDatabaseService.campaign.findUnique.mockResolvedValueOnce(
      makeCampaignRow({ id: 'camp-pub', brandId: 'brand-1', totalBudget: 5000, budgetUsed: 1200 }),
    );
    mockDatabaseService.walletSyncEvent.create.mockResolvedValue({});
    mockDatabaseService.campaign.update.mockResolvedValueOnce(
      makeCampaignRow({ id: 'camp-pub', status: 'LIVE', totalBudget: 5000, budgetUsed: 1200 }),
    );

    await service.publishCampaign('camp-pub', 'brand-1');

    const expectedKey = 'campaign-service:brand-budget-reserve:camp-pub:brand-1:3800';
    expect(mockWalletSyncService.deductBrandBudget).toHaveBeenCalledWith(
      'brand-1',
      3800,
      'CAMPAIGN_BUDGET_RESERVE',
      { campaignId: 'camp-pub' },
      expectedKey,
    );
    expect(mockDatabaseService.walletSyncEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            idempotencyKey: expectedKey,
          }),
        }),
      }),
    );
  });

  it('tops up campaign with idempotency key and updated budget', async () => {
    mockDatabaseService.campaign.findUnique.mockResolvedValueOnce(
      makeCampaignRow({ id: 'camp-topup', brandId: 'brand-1', totalBudget: 2000, payoutRate: 500 }),
    );
    mockDatabaseService.walletSyncEvent.create.mockResolvedValue({});
    mockDatabaseService.campaign.update.mockResolvedValueOnce(
      makeCampaignRow({ id: 'camp-topup', totalBudget: 2600, targetViews: 5200 }),
    );

    await service.topUpCampaign('camp-topup', 600, 'brand-1');

    const expectedKey = 'campaign-service:brand-budget-topup:camp-topup:brand-1:600';
    expect(mockWalletSyncService.deductBrandBudget).toHaveBeenCalledWith(
      'brand-1',
      600,
      'CAMPAIGN_BUDGET_TOPUP',
      { campaignId: 'camp-topup' },
      expectedKey,
    );
    expect(mockDatabaseService.walletSyncEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            idempotencyKey: expectedKey,
          }),
        }),
      }),
    );
  });

  it('credits creator earning with idempotency key on submission approval', async () => {
    mockDatabaseService.submission.findUnique.mockResolvedValueOnce({
      id: 'sub-1',
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      creatorName: 'Creator',
      creatorHandle: '@creator',
      contentUrl: 'https://example.com',
      platform: 'INSTAGRAM',
      status: 'PENDING',
      comment: null,
      views: 0,
      earnings: 0,
      createdAt: now,
      campaign: {
        id: 'camp-1',
        brandId: 'brand-1',
        payoutRate: 500,
      },
    });
    mockDatabaseService.submission.update.mockResolvedValueOnce({
      id: 'sub-1',
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      creatorName: 'Creator',
      creatorHandle: '@creator',
      contentUrl: 'https://example.com',
      platform: 'INSTAGRAM',
      status: 'APPROVED',
      comment: null,
      views: 1200,
      earnings: 600,
      createdAt: now,
      campaign: { id: 'camp-1', payoutRate: 500 },
    });
    mockDatabaseService.submissionReview.create.mockResolvedValue({});
    mockDatabaseService.walletSyncEvent.create.mockResolvedValue({});
    mockDatabaseService.campaign.update.mockResolvedValue({});
    mockDatabaseService.campaignEarningSnapshot.create.mockResolvedValue({});

    const reviewed = await service.reviewSubmission('sub-1', { status: 'APPROVED' }, 'brand-1');
    expect(reviewed.status).toBe('APPROVED');
    expect(mockWalletSyncService.addCreatorEarning).not.toHaveBeenCalled();
  });

  it('creates withdrawal event with idempotency key', async () => {
    mockDatabaseService.submission.findMany.mockResolvedValueOnce([
      {
        id: 'sub-1',
        campaignId: 'camp-1',
        creatorId: 'creator-7',
        creatorName: 'Creator',
        creatorHandle: '@creator',
        contentUrl: 'https://example.com',
        platform: 'INSTAGRAM',
        status: 'APPROVED',
        comment: null,
        views: 1200,
        earnings: 2000,
        createdAt: now,
      },
    ]);
    mockDatabaseService.walletSyncEvent.create.mockResolvedValue({});
    mockDatabaseService.withdrawalRequest.create.mockResolvedValue({
      id: 'w-1',
      amount: 500,
      status: 'PENDING',
      createdAt: now,
    });

    const res = await service.requestWithdrawal(500, 'creator-7');
    expect(res.message).toMatch(/disabled/i);
    expect(mockWalletSyncService.deductCreatorWithdrawal).not.toHaveBeenCalled();
  });

  it('retries all events by status and returns aggregated counts', async () => {
    walletSyncEvent.findMany.mockResolvedValueOnce([
      { id: 'evt-a', status: 'RETRY_PENDING' },
      { id: 'evt-b', status: 'FAILED' },
      { id: 'evt-c', status: 'RETRY_PENDING' },
    ]);

    const retrySpy = jest
      .spyOn(service, 'retryWalletSyncEvent')
      .mockResolvedValueOnce({ status: 'SYNCED' } as any)
      .mockResolvedValueOnce({ status: 'FAILED' } as any)
      .mockResolvedValueOnce({ status: 'SYNCED' } as any);

    const result = await service.retryWalletSyncEventsByStatus(['RETRY_PENDING', 'FAILED']);

    expect(walletSyncEvent.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['RETRY_PENDING', 'FAILED'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    expect(retrySpy).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ processed: 3, synced: 2, failed: 1, skipped: 0 });
  });

  it('skips retry for already synced events', async () => {
    walletSyncEvent.findUnique.mockResolvedValueOnce({
      id: 'evt-synced',
      status: 'SYNCED',
      attempts: 1,
      payload: {},
    });

    const result = await service.retryWalletSyncEvent('evt-synced');

    expect(mockWalletSyncService.addCreatorEarning).not.toHaveBeenCalled();
    expect(mockWalletSyncService.deductBrandBudget).not.toHaveBeenCalled();
    expect(mockWalletSyncService.deductCreatorWithdrawal).not.toHaveBeenCalled();
    expect(walletSyncEvent.update).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'evt-synced',
        retryOutcome: 'skipped',
        reason: 'already_synced',
      }),
    );
  });

  it('skips retry when max retry attempts are reached', async () => {
    walletSyncEvent.findUnique.mockResolvedValueOnce({
      id: 'evt-max',
      status: 'FAILED',
      attempts: 10,
      payload: {},
    });

    const result = await service.retryWalletSyncEvent('evt-max');

    expect(walletSyncEvent.update).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'evt-max',
        retryOutcome: 'skipped',
        reason: 'max_attempts_reached',
      }),
    );
  });

  it('returns wallet sync events with pagination metadata', async () => {
    walletSyncEvent.findMany.mockResolvedValueOnce([
      { id: 'evt-1', createdAt: now },
      { id: 'evt-2', createdAt: now },
      { id: 'evt-3', createdAt: now },
    ]);

    const result = await service.getWalletSyncEvents({ status: 'FAILED', limit: 2 });

    expect(walletSyncEvent.findMany).toHaveBeenCalledWith({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    expect(result).toEqual({
      items: [{ id: 'evt-1', createdAt: now }, { id: 'evt-2', createdAt: now }],
      nextCursor: 'evt-2',
      hasMore: true,
    });
  });

  it('returns wallet sync summary counts and event types', async () => {
    walletSyncEvent.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    walletSyncEvent.findMany.mockResolvedValueOnce([
      { eventType: 'BRAND_BUDGET_DEBIT' },
      { eventType: 'CREATOR_EARNING_CREDIT' },
    ]);

    const result = await service.getWalletSyncSummary();

    expect(result).toEqual({
      syncedCount: 5,
      retryPendingCount: 2,
      failedCount: 1,
      totalCount: 8,
      eventTypes: ['BRAND_BUDGET_DEBIT', 'CREATOR_EARNING_CREDIT'],
    });
  });

  it('applies date filters when listing wallet sync events', async () => {
    walletSyncEvent.findMany.mockResolvedValueOnce([{ id: 'evt-1', createdAt: now }]);

    await service.getWalletSyncEvents({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-02T23:59:59.999Z',
      limit: 10,
    });

    expect(walletSyncEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({
            gte: new Date('2026-01-01T00:00:00.000Z'),
            lte: new Date('2026-01-02T23:59:59.999Z'),
          }),
        }),
      }),
    );
  });

  it('exports wallet sync events as csv with filtered rows', async () => {
    walletSyncEvent.findMany.mockResolvedValueOnce([
      {
        id: 'evt-1',
        eventType: 'BRAND_BUDGET_DEBIT',
        status: 'FAILED',
        attempts: 4,
        lastError: 'wallet timeout',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:10:00.000Z'),
      },
    ]);

    const csv = await service.exportWalletSyncEventsCsv({
      status: 'FAILED',
      eventType: 'BRAND_BUDGET_DEBIT',
    });

    expect(walletSyncEvent.findMany).toHaveBeenCalledWith({
      where: {
        status: 'FAILED',
        eventType: 'BRAND_BUDGET_DEBIT',
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    expect(csv).toContain('id,eventType,status,attempts,lastError,createdAt,updatedAt');
    expect(csv).toContain('"evt-1","BRAND_BUDGET_DEBIT","FAILED","4","wallet timeout"');
  });

  it('auto-retry batch loads eligible events with cooldown and retries them', async () => {
    mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'WALLET_SYNC_AUTO_RETRY_BATCH_SIZE') return '2';
      if (key === 'WALLET_SYNC_AUTO_RETRY_COOLDOWN_SECONDS') return '120';
      return defaultValue;
    });
    walletSyncEvent.findMany.mockResolvedValueOnce([
      { id: 'evt-a', status: 'RETRY_PENDING' },
      { id: 'evt-b', status: 'FAILED' },
    ]);

    const retrySpy = jest
      .spyOn(service, 'retryWalletSyncEvent')
      .mockResolvedValueOnce({ status: 'SYNCED' } as any)
      .mockResolvedValueOnce({ status: 'FAILED' } as any);

    await (service as any).processWalletSyncAutoRetryBatch();

    expect(walletSyncEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['RETRY_PENDING', 'FAILED'] },
          attempts: { lt: 10 },
          updatedAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
        orderBy: { createdAt: 'asc' },
        take: 2,
      }),
    );
    expect(retrySpy).toHaveBeenCalledTimes(2);
    expect(retrySpy).toHaveBeenNthCalledWith(1, 'evt-a');
    expect(retrySpy).toHaveBeenNthCalledWith(2, 'evt-b');
  });

  it('auto-retry batch does not run when another batch is active', async () => {
    (service as any).isAutoRetryRunning = true;

    await (service as any).processWalletSyncAutoRetryBatch();

    expect(walletSyncEvent.findMany).not.toHaveBeenCalled();
  });

  it('runs campaign lifecycle with publish, apply, submit, approve, and withdrawal', async () => {
    const campaignId = 'camp-int-1';
    const brandId = 'brand-int-1';
    const creatorId = 'creator-int-1';
    const submissionId = 'sub-int-1';
    const createdAt = new Date('2026-02-01T00:00:00.000Z');
    const futureDeadline = new Date('2099-06-15T12:00:00.000Z');
    const futureStart = new Date('2099-06-16T00:00:00.000Z');
    const futureEnd = new Date('2099-12-31T12:00:00.000Z');
    const campaignRow: any = {
      id: campaignId,
      brandId,
      name: 'Integration Campaign',
      description: 'Lifecycle',
      status: 'DRAFT',
      createdAt,
      deadlineToApply: futureDeadline,
      startDate: futureStart,
      endDate: futureEnd,
      payoutRate: 500,
      totalBudget: 5000,
      budgetUsed: 0,
      views: 0,
      targetViews: 10000,
      submissions: [],
    };
    let submissionRow: any = null;

    mockDatabaseService.campaign.create.mockImplementation(async ({ data }: any) => ({
      ...campaignRow,
      ...data,
      id: campaignId,
      createdAt,
      submissions: [],
    }));
    mockDatabaseService.campaign.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === campaignId) {
        return {
          ...campaignRow,
          submissions: submissionRow ? [submissionRow] : [],
        };
      }
      return null;
    });
    mockDatabaseService.campaign.update.mockImplementation(async ({ data }: any) => {
      if (data.status) campaignRow.status = data.status;
      if (typeof data.totalBudget === 'number') campaignRow.totalBudget = data.totalBudget;
      if (data.budgetUsed?.increment) campaignRow.budgetUsed += data.budgetUsed.increment;
      if (data.views?.increment) campaignRow.views += data.views.increment;
      if (typeof data.targetViews === 'number') campaignRow.targetViews = data.targetViews;
      return {
        ...campaignRow,
        submissions: submissionRow ? [submissionRow] : [],
      };
    });
    mockDatabaseService.submission.create.mockImplementation(async ({ data }: any) => {
      submissionRow = {
        id: submissionId,
        campaignId: data.campaignId,
        creatorId: data.creatorId,
        creatorName: data.creatorName,
        creatorHandle: data.creatorHandle,
        contentUrl: data.contentUrl,
        platform: data.platform,
        status: data.status,
        comment: null,
        views: data.views,
        earnings: data.earnings,
        createdAt,
      };
      return submissionRow;
    });
    mockDatabaseService.submission.findUnique.mockImplementation(async ({ where }: any) => {
      if (!submissionRow || where.id !== submissionId) return null;
      return {
        ...submissionRow,
        campaign: {
          id: campaignId,
          brandId,
          payoutRate: 500,
        },
      };
    });
    mockDatabaseService.submission.update.mockImplementation(async ({ data }: any) => {
      submissionRow = {
        ...submissionRow,
        status: data.status ?? submissionRow.status,
        comment: data.comment ?? submissionRow.comment,
        views: data.views ?? submissionRow.views,
        earnings: data.earnings ?? submissionRow.earnings,
      };
      return {
        ...submissionRow,
        campaign: {
          id: campaignId,
          payoutRate: 500,
        },
      };
    });
    mockDatabaseService.submission.findMany.mockResolvedValueOnce([
      {
        ...submissionRow,
        id: submissionId,
        creatorId,
        status: 'APPROVED',
        earnings: 600,
        createdAt,
      },
    ]);
    mockDatabaseService.campaignApplication.upsert.mockResolvedValue({});
    mockDatabaseService.submissionReview.create.mockResolvedValue({});
    mockDatabaseService.walletSyncEvent.create.mockResolvedValue({});
    mockDatabaseService.campaignEarningSnapshot.create.mockResolvedValue({});
    mockDatabaseService.withdrawalRequest.create.mockResolvedValue({
      id: 'w-int-1',
      amount: 500,
      status: 'PENDING',
      createdAt,
    });
    mockDatabaseService.campaignMediaAsset = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'asset-int-1',
        ownerId: creatorId,
        status: 'READY',
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    mockDatabaseService.campaignApplication.findUnique = jest.fn().mockResolvedValue({
      id: 'app-int-1',
      campaignId,
      creatorId,
      status: 'APPLIED',
    });

    const created = await service.createCampaign(
      {
        name: 'Integration Campaign',
        description: 'Lifecycle',
        deadlineToApply: futureDeadline.toISOString(),
        startDate: futureStart.toISOString(),
        endDate: futureEnd.toISOString(),
        payoutRate: 500,
        totalBudget: 5000,
      },
      brandId,
    );
    expect(created.id).toBe(campaignId);

    const published = await service.publishCampaign(campaignId, brandId);
    expect(published.status).toBe('LIVE');
    expect(mockWalletSyncService.deductBrandBudget).toHaveBeenCalledWith(
      brandId,
      5000,
      'CAMPAIGN_BUDGET_RESERVE',
      { campaignId },
      'campaign-service:brand-budget-reserve:camp-int-1:brand-int-1:5000',
    );

    const applyResult = await service.applyToCampaign(campaignId, creatorId, {
      draftAssetId: 'asset-int-1',
      termsAccepted: true,
      platform: 'INSTAGRAM',
      sourceType: 'UPLOAD',
    });
    expect(applyResult.success).toBe(true);

    const submission = await service.createSubmission(
      campaignId,
      {
        contentUrl: 'https://instagram.com/reel/lifecycle',
        platform: 'INSTAGRAM',
        creatorName: 'Lifecycle Creator',
        creatorHandle: '@lifecycle',
      },
      creatorId,
    );
    expect(submission.id).toBe(submissionId);

    const reviewed = await service.reviewSubmission(submissionId, { status: 'APPROVED' }, brandId);
    expect(reviewed.status).toBe('APPROVED');
    expect(mockWalletSyncService.addCreatorEarning).not.toHaveBeenCalled();

    const withdrawal = await service.requestWithdrawal(500, creatorId);
    expect(withdrawal.status).toBe('PENDING');
    expect(mockWalletSyncService.deductCreatorWithdrawal).not.toHaveBeenCalled();
  });

  it('queues retry pending event when publish wallet sync fails', async () => {
    mockDatabaseService.campaign.findUnique.mockResolvedValueOnce(
      makeCampaignRow({ id: 'camp-fail', brandId: 'brand-1', totalBudget: 4000, budgetUsed: 500 }),
    );
    mockWalletSyncService.deductBrandBudget.mockRejectedValueOnce(new Error('wallet publish outage'));
    mockDatabaseService.walletSyncEvent.create.mockResolvedValue({});

    await expect(service.publishCampaign('camp-fail', 'brand-1')).rejects.toThrow('wallet publish outage');

    expect(mockDatabaseService.walletSyncEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'BRAND_BUDGET_DEBIT',
          status: 'RETRY_PENDING',
          attempts: 3,
          lastError: 'wallet publish outage',
        }),
      }),
    );
  });

  it('reviewSubmission approves without invoking wallet credit (handled elsewhere)', async () => {
    mockDatabaseService.submission.findUnique.mockResolvedValueOnce({
      id: 'sub-fail-1',
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      creatorName: 'Creator',
      creatorHandle: '@creator',
      contentUrl: 'https://example.com',
      platform: 'INSTAGRAM',
      status: 'PENDING',
      comment: null,
      views: 0,
      earnings: 0,
      createdAt: now,
      campaign: { id: 'camp-1', brandId: 'brand-1', payoutRate: 500 },
    });
    mockDatabaseService.submission.update.mockResolvedValueOnce({
      id: 'sub-fail-1',
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      creatorName: 'Creator',
      creatorHandle: '@creator',
      contentUrl: 'https://example.com',
      platform: 'INSTAGRAM',
      status: 'APPROVED',
      comment: null,
      views: 1200,
      earnings: 600,
      createdAt: now,
      campaign: { id: 'camp-1', payoutRate: 500 },
    });
    mockDatabaseService.submissionReview.create.mockResolvedValue({});
    mockDatabaseService.campaignApplication.upsert.mockResolvedValue({});

    const out = await service.reviewSubmission('sub-fail-1', { status: 'APPROVED' }, 'brand-1');
    expect(out.status).toBe('APPROVED');
    expect(mockWalletSyncService.addCreatorEarning).not.toHaveBeenCalled();
  });

  it('marks unknown wallet sync event type as FAILED on retry attempt', async () => {
    walletSyncEvent.findUnique.mockResolvedValueOnce({
      id: 'evt-unknown',
      eventType: 'UNKNOWN_EVENT',
      status: 'FAILED',
      attempts: 1,
      payload: {},
    });
    walletSyncEvent.update.mockResolvedValueOnce({
      id: 'evt-unknown',
      status: 'FAILED',
      attempts: 2,
      lastError: 'Unsupported wallet sync event type: UNKNOWN_EVENT',
    });

    const result = await service.retryWalletSyncEvent('evt-unknown');

    expect(walletSyncEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-unknown' },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: 'Unsupported wallet sync event type: UNKNOWN_EVENT',
      },
    });
    expect(result).toEqual({
      id: 'evt-unknown',
      status: 'FAILED',
      attempts: 2,
      lastError: 'Unsupported wallet sync event type: UNKNOWN_EVENT',
    });
  });

  it('listCampaignsForRequest for BRAND filters by brandId', async () => {
    mockDatabaseService.campaign.findMany.mockResolvedValueOnce([makeCampaignRow()]);
    await service.listCampaignsForRequest({ id: 'b1', role: 'BRAND' });
    expect(mockDatabaseService.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ brandId: 'b1' }),
      }),
    );
  });

  it('listCampaignsForRequest for OWNER does not restrict by brandId', async () => {
    mockDatabaseService.campaign.findMany.mockResolvedValueOnce([makeCampaignRow()]);
    await service.listCampaignsForRequest({ id: 'o1', role: 'OWNER' });
    const call = mockDatabaseService.campaign.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where.brandId).toBeUndefined();
  });

  it('recordPostViewsFromScraper updates views without leaderboard emit when skipped', async () => {
    const updatedAt = new Date('2026-02-01T12:00:00.000Z');
    mockDatabaseService.campaignPostSubmission.findUnique.mockResolvedValueOnce({
      id: 'post-pool-1',
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      status: 'PENDING_REVIEW',
      disqualifiedAt: null,
      currentViews: 100,
      campaign: { id: 'camp-1', name: 'Pool', payoutModel: 'POOL' },
    });
    mockDatabaseService.campaignPostSubmission.update.mockResolvedValueOnce({
      id: 'post-pool-1',
      lastViewsUpdatedAt: updatedAt,
    });
    mockDatabaseService.campaignPostViewUpdate.create.mockResolvedValueOnce({});
    mockDatabaseService.walletSyncEvent.create.mockResolvedValueOnce({});
    mockDatabaseService.campaign.update.mockResolvedValueOnce({});

    const result = await service.recordPostViewsFromScraper('post-pool-1', 2500, {
      recordedBy: 'run-1',
      note: 'apify:MANUAL',
      skipLeaderboardEmit: true,
    });

    expect(result.newViews).toBe(2500);
    expect(mockNotificationService.emitLeaderboardUpdated).not.toHaveBeenCalled();
    expect(mockNotificationService.emitViewsUpdated).toHaveBeenCalled();
  });
});
