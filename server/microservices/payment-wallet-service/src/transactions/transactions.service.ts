import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { LoggerService } from '../common/logger/logger.service';
import { MessageQueueService } from '../common/message-queue/message-queue.service';
import { ContextType, TransactionType, TransactionStatus, EntityType } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class TransactionsService {
  private readonly idempotentResponses = new Map<string, any>();
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
    private readonly messageQueueService: MessageQueueService,
  ) {}

  async deductCredits(params: {
    userId: string;
    workspaceId?: string;
    amount: number;
    activityName: string;
    resourceId?: string;
    metadata?: Record<string, any>;
    idempotencyKey?: string;
  }) {
    const { userId, workspaceId, amount, activityName, resourceId, metadata, idempotencyKey } = params;
    if (idempotencyKey && this.idempotentResponses.has(idempotencyKey)) {
      return this.idempotentResponses.get(idempotencyKey);
    }
    const contextType = workspaceId ? ContextType.TEAM : ContextType.INDIVIDUAL;

    // Validate workspace membership if in team context
    if (workspaceId) {
      try {
        await axios.get(
          `${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/${workspaceId}/user/${userId}`,
          { headers: { 'x-service-request': 'true' } },
        );
      } catch (error) {
        throw new NotFoundException('Workspace not found or user not a member');
      }
    }

    // Get or create credit balance
    let creditsRecord;
    let balance: number;

    if (workspaceId) {
      creditsRecord = await this.databaseService.workspaceCredits.upsert({
        where: { workspaceId },
        create: { workspaceId, credits: 0 },
        update: {},
      });
      balance = creditsRecord.credits;
    } else {
      creditsRecord = await this.databaseService.userCredits.upsert({
        where: { userId },
        create: { userId, credits: 0 },
        update: {},
      });
      balance = creditsRecord.credits;
    }

    // Check balance
    if (balance < amount) {
      throw new BadRequestException(`Insufficient credits. Balance: ${balance}, Required: ${amount}`);
    }

    // Deduct credits
    const updatedCredits = workspaceId
      ? await this.databaseService.workspaceCredits.update({
          where: { workspaceId },
          data: { credits: { decrement: amount } },
        })
      : await this.databaseService.userCredits.update({
          where: { userId },
          data: { credits: { decrement: amount } },
        });

    const balanceAfter = updatedCredits.credits;

    // Create transaction
    const transaction = await this.databaseService.transaction.create({
      data: {
        type: TransactionType.SPENT,
        amount: -amount,
        contextType,
        userId: contextType === ContextType.INDIVIDUAL ? userId : null,
        workspaceId: contextType === ContextType.TEAM ? workspaceId : null,
        actorUserId: contextType === ContextType.TEAM ? userId : null,
        activityName,
        resourceId,
        status: TransactionStatus.COMPLETED,
        metadata,
      },
    });

    // Create ledger entry
    await this.databaseService.creditLedger.create({
      data: {
        entityType: workspaceId ? EntityType.WORKSPACE : EntityType.USER,
        entityId: workspaceId || userId,
        transactionId: transaction.id,
        balanceBefore: balance,
        balanceAfter,
        change: -amount,
        description: `Credits spent: ${activityName}`,
      },
    });

    this.logger.log(`Credits deducted: ${amount} from ${contextType}`, 'TransactionsService');

    await this.messageQueueService.publish('credits.events', 'credits.deducted', {
      transactionId: transaction.id,
      contextType,
      entityId: workspaceId || userId,
      amount,
      balanceAfter,
    });

    const response = { success: true, transactionId: transaction.id, balanceAfter, contextType };
    if (idempotencyKey) {
      this.idempotentResponses.set(idempotencyKey, response);
    }
    return response;
  }

  async addCredits(params: {
    userId: string;
    workspaceId?: string;
    amount: number;
    type: TransactionType;
    description: string;
    metadata?: Record<string, any>;
    idempotencyKey?: string;
  }) {
    const { userId, workspaceId, amount, type, description, metadata, idempotencyKey } = params;
    if (idempotencyKey && this.idempotentResponses.has(idempotencyKey)) {
      return this.idempotentResponses.get(idempotencyKey);
    }
    const contextType = workspaceId ? ContextType.TEAM : ContextType.INDIVIDUAL;

    // Validate workspace if applicable
    if (workspaceId) {
      try {
        await axios.get(
          `${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/${workspaceId}`,
          { headers: { 'x-service-request': 'true' } },
        );
      } catch {
        throw new NotFoundException('Workspace not found');
      }
    }

    // Get or create credit balance
    const creditsRecord = workspaceId
      ? await this.databaseService.workspaceCredits.upsert({
          where: { workspaceId },
          create: { workspaceId, credits: 0 },
          update: {},
        })
      : await this.databaseService.userCredits.upsert({
          where: { userId },
          create: { userId, credits: 0 },
          update: {},
        });

    const balance = creditsRecord.credits;

    // Add credits
    const updatedCredits = workspaceId
      ? await this.databaseService.workspaceCredits.update({
          where: { workspaceId },
          data: { credits: { increment: amount } },
        })
      : await this.databaseService.userCredits.update({
          where: { userId },
          data: { credits: { increment: amount } },
        });

    const balanceAfter = updatedCredits.credits;

    // Create transaction
    const transaction = await this.databaseService.transaction.create({
      data: {
        type,
        amount,
        contextType,
        userId: contextType === ContextType.INDIVIDUAL ? userId : null,
        workspaceId: contextType === ContextType.TEAM ? workspaceId : null,
        actorUserId: contextType === ContextType.TEAM ? userId : null,
        status: TransactionStatus.COMPLETED,
        metadata,
      },
    });

    // Create ledger entry
    await this.databaseService.creditLedger.create({
      data: {
        entityType: workspaceId ? EntityType.WORKSPACE : EntityType.USER,
        entityId: workspaceId || userId,
        transactionId: transaction.id,
        balanceBefore: balance,
        balanceAfter,
        change: amount,
        description,
      },
    });

    this.logger.log(`Credits added: ${amount} to ${contextType}`, 'TransactionsService');

    await this.messageQueueService.publish('credits.events', 'credits.added', {
      transactionId: transaction.id,
      contextType,
      entityId: workspaceId || userId,
      amount,
      balanceAfter,
    });

    const response = { success: true, transactionId: transaction.id, balanceAfter, contextType };
    if (idempotencyKey) {
      this.idempotentResponses.set(idempotencyKey, response);
    }
    return response;
  }

  async checkBalance(userId: string, workspaceId?: string) {
    if (workspaceId) {
      const membership = await axios.get(
        `${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/${workspaceId}/members?userId=${userId}`,
        { headers: { 'x-service-request': 'true' } },
      ).catch(() => null);

      if (!membership) {
        throw new NotFoundException('You are not a member of this workspace');
      }

      const credits = await this.databaseService.workspaceCredits.findUnique({
        where: { workspaceId },
      });

      return {
        contextType: 'TEAM',
        workspaceId,
        credits: credits?.credits || 0,
      };
    } else {
      const credits = await this.databaseService.userCredits.findUnique({
        where: { userId },
      });

      return {
        contextType: 'INDIVIDUAL',
        userId,
        credits: credits?.credits || 0,
      };
    }
  }

  async getTransactionHistory(userId: string, workspaceId?: string, limit = 50) {
    const where: any = {};

    if (workspaceId) {
      where.workspaceId = workspaceId;
    } else {
      where.userId = userId;
    }

    const transactions = await this.databaseService.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return transactions;
  }

  async getCreditLedger(entityType: EntityType, entityId: string, limit = 100) {
    const ledger = await this.databaseService.creditLedger.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        transaction: true,
      },
    });

    return ledger;
  }
}


