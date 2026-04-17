import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { PricingService } from '../pricing/pricing.service';
import { TransactionsService } from '../transactions/transactions.service';

@Injectable()
export class CreditsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly pricingService: PricingService,
    private readonly transactionsService: TransactionsService
  ) {}

  async getProjectCostBreakdown(projectId: string) {
    return this.pricingService.getProjectCostBreakdown(projectId);
  }

  async getUserProjectsCosts(userId: string, limit = 50) {
    // Get all unique projects for this user
    const snapshots = await this.databaseService.generationCostSnapshot.findMany({
      where: { userId },
      select: { projectId: true },
      distinct: ['projectId'],
      take: limit,
    });

    const projectIds = snapshots.map(s => s.projectId);

    // Get cost breakdown for each project
    const projectCosts = await Promise.all(
      projectIds.map(async (projectId) => {
        const breakdown = await this.getProjectCostBreakdown(projectId);
        return {
          projectId,
          totalCost: breakdown.totalCost,
          operationCount: breakdown.operationCount,
        };
      })
    );

    return projectCosts;
  }

  async recordAndDeductCredits(data: {
    projectId: string;
    userId: string;
    sceneNumber?: number;
    operationType: string;
    operationName: string;
    metadata?: Record<string, any>;
  }) {
    const snapshot = await this.pricingService.recordGenerationCost(data);
    if (!snapshot) {
      return null;
    }

    await this.transactionsService.deductCredits({
      userId: data.userId,
      amount: snapshot.creditCost,
      activityName: data.operationName,
      resourceId: data.projectId,
      metadata: {
        operationType: data.operationType,
        sceneNumber: data.sceneNumber,
        snapshotId: snapshot.id,
        ...data.metadata,
      },
    });

    return snapshot;
  }

  /**
   * Pre-export check: unsettled snapshots + FINAL_RENDER fee vs wallet balance.
   */
  async checkExportAffordability(userId: string, projectId: string) {
    const { totalDue } = await this.pricingService.getUnsettledProjectTotalPlusFinalRender(projectId);
    const balance = await this.transactionsService.checkBalance(userId);
    const currentBalance = balance.credits ?? 0;
    const affordable = currentBalance >= totalDue;
    return {
      affordable,
      requiredCredits: totalDue,
      currentBalance,
      message: affordable
        ? 'OK'
        : `Insufficient credits. This export requires ${totalDue} credits; you have ${currentBalance}.`,
    };
  }

  /**
   * After successful final video: add FINAL_RENDER snapshot, then deduct once for all unsettled rows.
   * Optional settlementNonce prevents duplicate debits if the video service retries the same completion.
   */
  async settleProjectWallet(userId: string, projectId: string, settlementNonce?: string) {
    if (settlementNonce) {
      const finals = await this.databaseService.generationCostSnapshot.findMany({
        where: { projectId, userId, operationType: 'FINAL_RENDER' },
      });
      const alreadySettled = finals.some(
        (s) =>
          s.walletSettledAt != null &&
          (s.metadata as Record<string, unknown> | null)?.settlementNonce === settlementNonce,
      );
      if (alreadySettled) {
        return { settled: true, amount: 0, snapshotIds: [] as string[], duplicate: true };
      }
    }

    const finalFee = await this.pricingService.getCreditCost('FINAL_RENDER');
    if (finalFee > 0) {
      await this.pricingService.recordGenerationCost({
        projectId,
        userId,
        operationType: 'FINAL_RENDER',
        operationName: 'Final Render',
        metadata: { settlement: true, ...(settlementNonce ? { settlementNonce } : {}) },
      });
    }

    const pending = await this.databaseService.generationCostSnapshot.findMany({
      where: { projectId, userId, walletSettledAt: null },
    });

    if (pending.length === 0) {
      return { settled: true, amount: 0, snapshotIds: [] as string[] };
    }

    const amount = pending.reduce((s, p) => s + p.creditCost, 0);
    if (amount <= 0) {
      await this.databaseService.generationCostSnapshot.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { walletSettledAt: new Date() },
      });
      return { settled: true, amount: 0, snapshotIds: pending.map((p) => p.id) };
    }

    const balance = await this.transactionsService.checkBalance(userId);
    if ((balance.credits ?? 0) < amount) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_CREDITS',
        message: `Settlement requires ${amount} credits; balance is ${balance.credits ?? 0}.`,
        requiredCredits: amount,
        currentBalance: balance.credits ?? 0,
      });
    }

    await this.transactionsService.deductCredits({
      userId,
      amount,
      activityName: 'Project export settlement',
      resourceId: projectId,
      metadata: {
        settlement: true,
        snapshotIds: pending.map((p) => p.id),
      },
    });

    const now = new Date();
    await this.databaseService.generationCostSnapshot.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { walletSettledAt: now },
    });

    return {
      settled: true,
      amount,
      snapshotIds: pending.map((p) => p.id),
    };
  }

  async getUserBillingSummary(userId: string, startDate?: Date, endDate?: Date) {
    const where: any = { userId };
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const snapshots = await this.databaseService.generationCostSnapshot.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Get balance
    const balance = await this.transactionsService.checkBalance(userId);

    // Calculate totals
    const totalSpent = snapshots.reduce((sum, s) => sum + s.creditCost, 0);

    // Group by project
    const projectMap: Record<string, {
      projectId: string;
      totalCost: number;
      operations: number;
      firstOperation: Date;
      lastOperation: Date;
    }> = {};

    for (const snapshot of snapshots) {
      if (!projectMap[snapshot.projectId]) {
        projectMap[snapshot.projectId] = {
          projectId: snapshot.projectId,
          totalCost: 0,
          operations: 0,
          firstOperation: snapshot.createdAt,
          lastOperation: snapshot.createdAt,
        };
      }
      projectMap[snapshot.projectId].totalCost += snapshot.creditCost;
      projectMap[snapshot.projectId].operations++;
      if (snapshot.createdAt < projectMap[snapshot.projectId].firstOperation) {
        projectMap[snapshot.projectId].firstOperation = snapshot.createdAt;
      }
      if (snapshot.createdAt > projectMap[snapshot.projectId].lastOperation) {
        projectMap[snapshot.projectId].lastOperation = snapshot.createdAt;
      }
    }

    const projects = Object.values(projectMap).sort(
      (a, b) => b.lastOperation.getTime() - a.lastOperation.getTime()
    );

    // Group by operation type
    const byOperationType: Record<string, { count: number; totalCost: number }> = {};
    for (const snapshot of snapshots) {
      if (!byOperationType[snapshot.operationType]) {
        byOperationType[snapshot.operationType] = { count: 0, totalCost: 0 };
      }
      byOperationType[snapshot.operationType].count++;
      byOperationType[snapshot.operationType].totalCost += snapshot.creditCost;
    }

    return {
      userId,
      currentBalance: balance.credits,
      totalSpent,
      projectCount: projects.length,
      operationCount: snapshots.length,
      projects,
      byOperationType,
    };
  }
}
