import { Injectable } from '@nestjs/common';
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
    // Record the generation cost snapshot
    const snapshot = await this.pricingService.recordGenerationCost(data);

    // Deduct credits from user
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
