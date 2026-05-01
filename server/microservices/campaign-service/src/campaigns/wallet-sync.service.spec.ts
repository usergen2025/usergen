import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { WalletSyncService } from './wallet-sync.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
  },
}));

describe('WalletSyncService contract calls', () => {
  let service: WalletSyncService;
  const mockedAxios = axios as unknown as { post: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    const configService = {
      get: jest.fn().mockReturnValue('http://wallet-service:9005/api'),
    } as unknown as ConfigService;
    service = new WalletSyncService(configService);
  });

  it('sends idempotency key header for brand budget debit', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as never);

    await service.deductBrandBudget('brand-1', 1200, 'CAMPAIGN_BUDGET_TOPUP', { campaignId: 'camp-1' }, 'idem-xyz');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://wallet-service:9005/api/transactions/deduct',
      {
        userId: 'brand-1',
        amount: 1200,
        activityName: 'CAMPAIGN_BUDGET_TOPUP',
        metadata: { campaignId: 'camp-1' },
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-idempotency-key': 'idem-xyz',
        }),
      }),
    );
  });

  it('throws BadRequestException when wallet request exhausts retries', async () => {
    mockedAxios.post.mockRejectedValue(new Error('wallet unavailable'));

    await expect(
      service.addCreatorEarning('creator-1', 500, 'approved', { submissionId: 'sub-1' }, 'idem-earn-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('getUserCreditsBalance returns wallet credits from payment service', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { success: true, data: { credits: 1000, contextType: 'INDIVIDUAL', userId: 'brand-1' } },
    } as never);

    const bal = await service.getUserCreditsBalance('brand-1');
    expect(bal).toBe(1000);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://wallet-service:9005/api/transactions/balance',
      { params: { userId: 'brand-1' }, timeout: 8000 },
    );
  });

  it('does not retry non-retryable 4xx wallet errors', async () => {
    mockedAxios.post.mockRejectedValue({
      response: {
        status: 400,
        data: { message: 'Insufficient credits. Balance: 0, Required: 100' },
      },
      message: 'Request failed with status code 400',
    } as never);

    await expect(
      service.deductBrandBudget('brand-1', 100, 'CAMPAIGN_BUDGET_RESERVE', { campaignId: 'camp-1' }, 'idem-400'),
    ).rejects.toThrow(
      'Failed to sync budget deduction with wallet service: Insufficient credits. Balance: 0, Required: 100',
    );

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
