import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';

// Default pricing configuration (used for seeding)
export const DEFAULT_PRICING: Array<{
  operationType: string;
  displayName: string;
  description: string;
  creditCost: number;
}> = [
  {
    operationType: 'SCRIPT_GENERATION',
    displayName: 'Script Generation',
    description: 'AI-powered script generation for video content',
    creditCost: 10,
  },
  {
    operationType: 'SCENE_REGENERATION',
    displayName: 'Scene Regeneration',
    description: 'Regenerate a single scene in the script',
    creditCost: 5,
  },
  {
    operationType: 'AUDIO_GENERATION',
    displayName: 'Audio Generation',
    description: 'Text-to-speech voice generation per scene',
    creditCost: 5,
  },
  {
    operationType: 'IMAGE_GENERATION',
    displayName: 'Image Generation',
    description: 'AI-generated B-roll image',
    creditCost: 10,
  },
  {
    operationType: 'VIDEO_GENERATION',
    displayName: 'Video Generation',
    description: 'Image-to-video conversion',
    creditCost: 20,
  },
  {
    operationType: 'AVATAR_VIDEO',
    displayName: 'Avatar Video',
    description: 'AI avatar video generation',
    creditCost: 25,
  },
  {
    operationType: 'STOCK_FOOTAGE',
    displayName: 'Stock Footage',
    description: 'Stock video download and processing',
    creditCost: 5,
  },
  {
    operationType: 'FINAL_RENDER',
    displayName: 'Final Render',
    description: 'Final video stitching and rendering',
    creditCost: 15,
  },
  {
    operationType: 'WATERMARK_REMOVAL',
    displayName: 'Watermark Removal',
    description: 'Remove watermark from final video',
    creditCost: 100,
  },
];

@Injectable()
export class PricingService {
  constructor(private readonly databaseService: DatabaseService) {}

  async seedDefaultPricing(): Promise<void> {
    console.log('[PricingService] Seeding default pricing configuration...');
    
    for (const pricing of DEFAULT_PRICING) {
      const existing = await this.databaseService.operationPricing.findUnique({
        where: { operationType: pricing.operationType },
      });

      if (!existing) {
        await this.databaseService.operationPricing.create({
          data: pricing,
        });
        console.log(`[PricingService] Created pricing for ${pricing.operationType}: ${pricing.creditCost} credits`);
      }
    }
    
    console.log('[PricingService] Default pricing seeding complete');
  }

  async getAllPricing() {
    const pricing = await this.databaseService.operationPricing.findMany({
      where: { isActive: true },
      orderBy: { operationType: 'asc' },
    });

    // If no pricing exists, seed defaults first
    if (pricing.length === 0) {
      await this.seedDefaultPricing();
      return this.databaseService.operationPricing.findMany({
        where: { isActive: true },
        orderBy: { operationType: 'asc' },
      });
    }

    return pricing;
  }

  async getPricingByType(operationType: string) {
    const pricing = await this.databaseService.operationPricing.findUnique({
      where: { operationType },
    });

    if (!pricing) {
      // Try to find default pricing
      const defaultPricing = DEFAULT_PRICING.find(p => p.operationType === operationType);
      if (defaultPricing) {
        return this.databaseService.operationPricing.create({
          data: defaultPricing,
        });
      }
      throw new NotFoundException(`Pricing not found for operation type: ${operationType}`);
    }

    return pricing;
  }

  async getCreditCost(operationType: string): Promise<number> {
    const pricing = await this.getPricingByType(operationType);
    return pricing.creditCost;
  }

  async updatePricing(
    operationType: string,
    newCost: number,
    adminUserId: string,
    reason?: string
  ) {
    const existing = await this.databaseService.operationPricing.findUnique({
      where: { operationType },
    });

    if (!existing) {
      throw new NotFoundException(`Pricing not found for operation type: ${operationType}`);
    }

    // Create pricing history record
    await this.databaseService.pricingHistory.create({
      data: {
        operationPricingId: existing.id,
        previousCost: existing.creditCost,
        newCost,
        changedBy: adminUserId,
        reason,
      },
    });

    // Update the pricing
    return this.databaseService.operationPricing.update({
      where: { operationType },
      data: {
        creditCost: newCost,
        updatedBy: adminUserId,
      },
    });
  }

  async getPricingHistory(operationType: string, limit = 50) {
    const pricing = await this.databaseService.operationPricing.findUnique({
      where: { operationType },
    });

    if (!pricing) {
      throw new NotFoundException(`Pricing not found for operation type: ${operationType}`);
    }

    return this.databaseService.pricingHistory.findMany({
      where: { operationPricingId: pricing.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async recordGenerationCost(data: {
    projectId: string;
    userId: string;
    sceneNumber?: number;
    operationType: string;
    operationName: string;
    metadata?: Record<string, any>;
  }) {
    // Get current pricing at time of generation
    const creditCost = await this.getCreditCost(data.operationType);

    return this.databaseService.generationCostSnapshot.create({
      data: {
        projectId: data.projectId,
        userId: data.userId,
        sceneNumber: data.sceneNumber,
        operationType: data.operationType,
        operationName: data.operationName,
        creditCost,
        metadata: data.metadata,
      },
    });
  }

  async getProjectCostBreakdown(projectId: string) {
    const snapshots = await this.databaseService.generationCostSnapshot.findMany({
      where: { projectId },
      orderBy: [{ sceneNumber: 'asc' }, { createdAt: 'asc' }],
    });

    const totalCost = snapshots.reduce((sum, s) => sum + s.creditCost, 0);

    // Group by operation type
    const byOperationType: Record<string, { count: number; totalCost: number }> = {};
    for (const snapshot of snapshots) {
      if (!byOperationType[snapshot.operationType]) {
        byOperationType[snapshot.operationType] = { count: 0, totalCost: 0 };
      }
      byOperationType[snapshot.operationType].count++;
      byOperationType[snapshot.operationType].totalCost += snapshot.creditCost;
    }

    // Group by scene
    const byScene: Record<number, { operations: typeof snapshots; totalCost: number }> = {};
    for (const snapshot of snapshots) {
      const sceneNum = snapshot.sceneNumber ?? 0;
      if (!byScene[sceneNum]) {
        byScene[sceneNum] = { operations: [], totalCost: 0 };
      }
      byScene[sceneNum].operations.push(snapshot);
      byScene[sceneNum].totalCost += snapshot.creditCost;
    }

    return {
      projectId,
      totalCost,
      operationCount: snapshots.length,
      byOperationType,
      byScene,
      snapshots,
    };
  }

  async getUserGenerationHistory(userId: string, limit = 100) {
    return this.databaseService.generationCostSnapshot.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
