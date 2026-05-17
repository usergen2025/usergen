import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class WalletSyncService {
  private readonly logger = new Logger(WalletSyncService.name);
  private readonly paymentUrl: string;
  private readonly maxAttempts = 3;

  constructor(private readonly configService: ConfigService) {
    this.paymentUrl = this.configService.get<string>('PAYMENT_SERVICE_URL', 'http://localhost:9005/api');
  }

  private extractErrorMessage(error: any): string {
    const responseMessage = error?.response?.data?.message;
    if (Array.isArray(responseMessage) && responseMessage.length > 0) {
      return String(responseMessage[0]);
    }
    if (typeof responseMessage === 'string' && responseMessage.trim().length > 0) {
      return responseMessage;
    }
    return error?.message || 'unknown error';
  }

  private isNonRetryableStatus(error: any): boolean {
    const status = Number(error?.response?.status);
    return status >= 400 && status < 500;
  }

  /**
   * Read the canonical wallet balance (credits) for a user from payment-wallet.
   * Used for brand stats and any balance display that must match ledger deductions.
   */
  async getUserCreditsBalance(userId: string): Promise<number> {
    if (!userId) {
      return 0;
    }
    const { data } = await axios.get<{ success?: boolean; data?: { credits?: number } }>(
      `${this.paymentUrl}/transactions/balance`,
      { params: { userId }, timeout: 8000 },
    );
    const c = data?.data?.credits;
    if (typeof c === 'number' && !Number.isNaN(c)) {
      return c;
    }
    return 0;
  }

  private async postWithRetry(endpoint: string, payload: Record<string, any>, idempotencyKey?: string) {
    let lastError: any = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await axios.post(`${this.paymentUrl}${endpoint}`, payload, {
          headers: {
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
          },
          timeout: 8000,
        });
        return;
      } catch (error: any) {
        lastError = error;
        const reason = this.extractErrorMessage(error);
        const status = error?.response?.status;
        this.logger.warn(
          `Wallet sync attempt ${attempt}/${this.maxAttempts} failed for ${endpoint}: ${
            status ? `[${status}] ${reason}` : reason
          }`,
        );
        if (this.isNonRetryableStatus(error)) {
          throw error;
        }
        if (attempt < this.maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
    }
    throw lastError;
  }

  async deductBrandBudget(
    userId: string,
    amount: number,
    activityName: string,
    metadata?: Record<string, any>,
    idempotencyKey?: string,
  ) {
    if (!amount || amount <= 0) return;
    try {
      await this.postWithRetry(
        '/transactions/deduct',
        {
        userId,
        amount,
        activityName,
        metadata,
        },
        idempotencyKey,
      );
    } catch (error: any) {
      const reason = this.extractErrorMessage(error);
      this.logger.error(`Failed to deduct brand budget: ${reason}`);
      throw new BadRequestException(`Failed to sync budget deduction with wallet service: ${reason}`);
    }
  }

  async addCreatorEarning(
    userId: string,
    amount: number,
    description: string,
    metadata?: Record<string, any>,
    idempotencyKey?: string,
  ) {
    if (!amount || amount <= 0) return;
    try {
      await this.postWithRetry(
        '/transactions/add',
        {
        userId,
        amount,
        type: 'EARNED',
        description,
        metadata,
        },
        idempotencyKey,
      );
    } catch (error: any) {
      const reason = this.extractErrorMessage(error);
      this.logger.error(`Failed to sync creator earning: ${reason}`);
      throw new BadRequestException(`Failed to sync creator earning with wallet service: ${reason}`);
    }
  }

  async deductCreatorWithdrawal(
    userId: string,
    amount: number,
    metadata?: Record<string, any>,
    idempotencyKey?: string,
  ) {
    if (!amount || amount <= 0) return;
    try {
      await this.postWithRetry(
        '/transactions/deduct',
        {
        userId,
        amount,
        activityName: 'CREATOR_WITHDRAWAL',
        metadata,
        },
        idempotencyKey,
      );
    } catch (error: any) {
      const reason = this.extractErrorMessage(error);
      this.logger.error(`Failed to sync creator withdrawal: ${reason}`);
      throw new BadRequestException(`Failed to sync withdrawal with wallet service: ${reason}`);
    }
  }

  /**
   * Refund a brand budget back into the wallet — used for the zero-qualifier exception path
   * during pool finalization, and for admin-initiated refunds.
   */
  async refundBrandBudget(
    userId: string,
    amount: number,
    description: string,
    metadata?: Record<string, any>,
    idempotencyKey?: string,
  ) {
    if (!amount || amount <= 0) return;
    try {
      await this.postWithRetry(
        '/transactions/add',
        {
          userId,
          amount,
          type: 'REFUNDED',
          description,
          metadata,
        },
        idempotencyKey,
      );
    } catch (error: any) {
      const reason = this.extractErrorMessage(error);
      this.logger.error(`Failed to refund brand budget: ${reason}`);
      throw new BadRequestException(`Failed to sync brand refund with wallet service: ${reason}`);
    }
  }
}
