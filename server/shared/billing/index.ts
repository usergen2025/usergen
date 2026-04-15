/**
 * Billing/Cost Tracking Utilities for UserGen.ai
 * 
 * This module provides utilities to record operation costs and deduct credits
 * from users when operations are performed (image generation, video generation, etc.)
 */

import axios from 'axios';

// Operation types that can be tracked
export enum OperationType {
  SCRIPT_GENERATION = 'SCRIPT_GENERATION',
  SCENE_REGENERATION = 'SCENE_REGENERATION',
  AUDIO_GENERATION = 'AUDIO_GENERATION',
  IMAGE_GENERATION = 'IMAGE_GENERATION',
  VIDEO_GENERATION = 'VIDEO_GENERATION',
  AVATAR_VIDEO = 'AVATAR_VIDEO',
  STOCK_FOOTAGE = 'STOCK_FOOTAGE',
  FINAL_RENDER = 'FINAL_RENDER',
  WATERMARK_REMOVAL = 'WATERMARK_REMOVAL',
}

// Human-readable names for operation types
export const OperationDisplayNames: Record<OperationType, string> = {
  [OperationType.SCRIPT_GENERATION]: 'Script Generation',
  [OperationType.SCENE_REGENERATION]: 'Scene Regeneration',
  [OperationType.AUDIO_GENERATION]: 'Audio Generation',
  [OperationType.IMAGE_GENERATION]: 'Image Generation',
  [OperationType.VIDEO_GENERATION]: 'Video Generation',
  [OperationType.AVATAR_VIDEO]: 'Avatar Video',
  [OperationType.STOCK_FOOTAGE]: 'Stock Footage',
  [OperationType.FINAL_RENDER]: 'Final Render',
  [OperationType.WATERMARK_REMOVAL]: 'Watermark Removal',
};

// Default pricing (fallback if payment service is unavailable)
export const DefaultPricing: Record<OperationType, number> = {
  [OperationType.SCRIPT_GENERATION]: 10,
  [OperationType.SCENE_REGENERATION]: 5,
  [OperationType.AUDIO_GENERATION]: 5,
  [OperationType.IMAGE_GENERATION]: 10,
  [OperationType.VIDEO_GENERATION]: 20,
  [OperationType.AVATAR_VIDEO]: 25,
  [OperationType.STOCK_FOOTAGE]: 5,
  [OperationType.FINAL_RENDER]: 15,
  [OperationType.WATERMARK_REMOVAL]: 100,
};

export interface CostTrackingParams {
  projectId: string;
  userId: string;
  operationType: OperationType;
  sceneNumber?: number;
  metadata?: Record<string, any>;
}

export interface CostTrackingResult {
  success: boolean;
  snapshotId?: string;
  creditCost?: number;
  error?: string;
}

// Payment service URL - can be overridden via environment
const getPaymentServiceUrl = () => {
  return process.env.PAYMENT_SERVICE_URL || 'http://localhost:9005';
};

/**
 * Track cost for an operation and optionally deduct credits
 * 
 * @param params Cost tracking parameters
 * @param deductCredits Whether to deduct credits (default: true)
 * @returns Result of the operation
 */
export async function trackOperationCost(
  params: CostTrackingParams,
  deductCredits: boolean = true
): Promise<CostTrackingResult> {
  const { projectId, userId, operationType, sceneNumber, metadata } = params;
  const paymentServiceUrl = getPaymentServiceUrl();
  const operationName = OperationDisplayNames[operationType];

  try {
    if (deductCredits) {
      // Call the combined record-and-deduct endpoint
      const response = await axios.post(
        `${paymentServiceUrl}/api/credits/record-and-deduct`,
        {
          projectId,
          userId,
          sceneNumber,
          operationType,
          operationName,
          metadata,
        },
        { timeout: 10000 }
      );

      if (response.data?.success) {
        console.log(
          `[CostTracking] Recorded and deducted ${response.data.data.creditCost} credits for ${operationType} on project ${projectId} scene ${sceneNumber ?? 'N/A'}`
        );
        return {
          success: true,
          snapshotId: response.data.data.id,
          creditCost: response.data.data.creditCost,
        };
      }

      return {
        success: false,
        error: response.data?.message || 'Unknown error',
      };
    } else {
      // Just record the cost without deducting (for dry runs or already-deducted scenarios)
      // This would call a separate endpoint that only records the snapshot
      const response = await axios.post(
        `${paymentServiceUrl}/api/pricing/record-cost`,
        {
          projectId,
          userId,
          sceneNumber,
          operationType,
          operationName,
          metadata,
        },
        { timeout: 10000 }
      );

      if (response.data?.success) {
        return {
          success: true,
          snapshotId: response.data.data.id,
          creditCost: response.data.data.creditCost,
        };
      }

      return {
        success: false,
        error: response.data?.message || 'Unknown error',
      };
    }
  } catch (error: any) {
    // Log but don't fail the operation if billing tracking fails
    console.error(
      `[CostTracking] Failed to track cost for ${operationType}: ${error.message}`
    );
    
    // Return the default cost even if tracking failed
    return {
      success: false,
      creditCost: DefaultPricing[operationType],
      error: error.message,
    };
  }
}

/**
 * Get the current price for an operation type
 */
export async function getOperationPrice(operationType: OperationType): Promise<number> {
  const paymentServiceUrl = getPaymentServiceUrl();

  try {
    const response = await axios.get(
      `${paymentServiceUrl}/api/pricing/${operationType}/cost`,
      { timeout: 5000 }
    );

    if (response.data?.success && response.data?.data?.creditCost !== undefined) {
      return response.data.data.creditCost;
    }
  } catch (error: any) {
    console.warn(
      `[CostTracking] Failed to get price for ${operationType}, using default: ${error.message}`
    );
  }

  // Return default price as fallback
  return DefaultPricing[operationType];
}

/**
 * Check if user has sufficient credits for an operation
 */
export async function checkUserCredits(
  userId: string,
  requiredCredits: number
): Promise<{ sufficient: boolean; currentBalance: number }> {
  const paymentServiceUrl = getPaymentServiceUrl();

  try {
    const response = await axios.get(
      `${paymentServiceUrl}/api/transactions/balance?userId=${userId}`,
      { timeout: 5000 }
    );

    if (response.data?.success) {
      const balance = response.data.data.credits ?? response.data.data ?? 0;
      return {
        sufficient: balance >= requiredCredits,
        currentBalance: balance,
      };
    }
  } catch (error: any) {
    console.warn(`[CostTracking] Failed to check balance for user ${userId}: ${error.message}`);
  }

  // Default to allowing the operation if we can't check balance
  return {
    sufficient: true,
    currentBalance: 0,
  };
}
