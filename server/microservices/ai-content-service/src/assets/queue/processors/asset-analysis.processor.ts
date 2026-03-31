import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetAnalysisService, AnalyzedAsset } from '../../asset-analysis.service';
import { LoggerService } from '../../../common/logger/logger.service';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';

interface AssetAnalysisJobData {
  projectId: string;
  userId: string;
  assets: Array<{
    id: string;
    url: string;
    type: 'image' | 'url';
    userLabel?: string;
  }>;
}

@Processor('asset-analysis', {
  concurrency: 5, // Process 5 analysis jobs concurrently
})
@Injectable()
export class AssetAnalysisProcessor extends WorkerHost {
  private readonly videoProcessingServiceUrl: string;
  private readonly jwtSecret: string;

  constructor(
    private readonly assetAnalysisService: AssetAnalysisService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    super();
    this.videoProcessingServiceUrl = 
      this.configService.get<string>('VIDEO_PROCESSING_SERVICE_URL') || 
      this.configService.get<string>('NEXT_PUBLIC_WS_URL')?.replace('/ws', '') || 
      'http://localhost:9000';
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 
                     'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';
  }

  async process(job: Job<AssetAnalysisJobData>): Promise<any> {
    const { projectId, userId, assets } = job.data;

    this.logger.log(`[AssetAnalysisProcessor] Processing job ${job.id} for project ${projectId} with ${assets.length} assets`, 'AssetAnalysisProcessor');

    try {
      await job.updateProgress(10);

      // Update status to processing
      await this.updateAnalysisStatus(projectId, userId, 'processing', 0, assets.length);

      // Analyze all assets with URL type detection (routes HTML URLs to content extraction)
      this.logger.log(`[AssetAnalysisProcessor] Starting analysis of ${assets.length} assets with URL type detection...`, 'AssetAnalysisProcessor');
      
      // Use analyzeAssetsWithUrlDetection to properly handle both images and HTML URLs
      const { analyzedAssets: detectedAnalyzedAssets, urlContents } = 
        await this.assetAnalysisService.analyzeAssetsWithUrlDetection(assets);

      await job.updateProgress(70);

      // Log URL content extraction results
      if (urlContents.length > 0) {
        this.logger.log(
          `[AssetAnalysisProcessor] Extracted content from ${urlContents.filter(u => !u.error).length} HTML URLs, ${urlContents.filter(u => u.error).length} failed`,
          'AssetAnalysisProcessor'
        );
      }

      await job.updateProgress(90);

      // Build final analyzed assets list with fallbacks for failed items
      const analyzedAssets: AnalyzedAsset[] = [...detectedAnalyzedAssets];
      const failedAssets: Array<{ id: string; error: string }> = [];

      // Handle URL content that couldn't be analyzed as images (these are HTML pages)
      // Store them as reference assets with extracted content in metadata
      for (const urlContent of urlContents) {
        if (urlContent.error) {
          failedAssets.push({
            id: urlContent.id,
            error: urlContent.error,
          });
          this.logger.warn(
            `[AssetAnalysisProcessor] Failed to process URL ${urlContent.id}: ${urlContent.error}`,
            'AssetAnalysisProcessor'
          );
        }
        
        // Create a reference asset for HTML URLs (even if extraction failed, they're still reference URLs)
        const asset = assets.find(a => a.id === urlContent.id);
        if (asset) {
          const extracted = urlContent.extractedContent?.trim();
          analyzedAssets.push({
            id: `analyzed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            originalAsset: {
              id: asset.id,
              url: asset.url,
              originalUrl: asset.url,
              type: 'url',
              userLabel: asset.userLabel,
            },
            category: 'reference',
            confidence: 0.7,
            visualScriptContext: extracted
              ? extracted.slice(0, 2000)
              : undefined,
            analysisMetadata: {
              model: 'url-content-extraction',
              analyzedAt: new Date().toISOString(),
              processingTime: 0,
            },
            // Store HTML URL metadata separately for downstream use
            urlMetadata: {
              isHtmlUrl: true,
              extractedContent: urlContent.extractedContent,
            },
          } as AnalyzedAsset);
        }
      }

      await job.updateProgress(95);

      // Update project metadata with analyzed assets
      await this.updateProjectMetadata(projectId, userId, {
        analyzedAssets,
        assetAnalysis: {
          status: 'completed',
          totalAssets: assets.length,
          completedAssets: analyzedAssets.length,
          failedAssets: failedAssets.length,
          completedAt: new Date().toISOString(),
        },
      });

      await job.updateProgress(100);

      this.logger.log(
        `[AssetAnalysisProcessor] Completed analysis for project ${projectId}: ${analyzedAssets.length}/${assets.length} assets analyzed successfully`,
        'AssetAnalysisProcessor'
      );

      return {
        success: true,
        analyzedAssets,
        completedAssets: analyzedAssets.length,
        totalAssets: assets.length,
        failedAssets: failedAssets.length,
      };
    } catch (error: any) {
      this.logger.error(
        `[AssetAnalysisProcessor] Error processing job ${job.id}: ${error.message}`,
        error.stack,
        'AssetAnalysisProcessor'
      );

      // Update status to failed
      try {
        await this.updateAnalysisStatus(projectId, userId, 'failed', 0, assets.length);
      } catch (updateError) {
        this.logger.error(
          `[AssetAnalysisProcessor] Failed to update analysis status: ${updateError}`,
          'AssetAnalysisProcessor'
        );
      }

      throw error;
    }
  }

  /**
   * Update analysis status in project metadata
   */
  private async updateAnalysisStatus(
    projectId: string,
    userId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    completedAssets: number,
    totalAssets: number
  ): Promise<void> {
    try {
      this.logger.log(
        `[AssetAnalysisProcessor] Updating analysis status for project ${projectId} (userId: ${userId})`,
        'AssetAnalysisProcessor'
      );

      // Add initial delay to handle race conditions (project might not be committed yet)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get current project to merge metadata with retry logic
      const currentProject = await this.retryWithBackoff(
        async () => {
          const token = this.generateServiceToken(userId);
          const projectResponse = await axios.get(
            `${this.videoProcessingServiceUrl}/api/video-projects/${projectId}`,
            {
              headers: {
                'Authorization': `Bearer ${token}`,
              },
              timeout: 10000,
            }
          );

          const project = projectResponse.data?.data;
          if (!project) {
            const error: any = new Error('Project not found in response');
            error.response = {
              status: 404,
              data: projectResponse.data,
            };
            throw error;
          }

          return project;
        },
        `GET project ${projectId}`,
        3,
        1000
      );

      // Verify userId matches
      if (currentProject.userId !== userId) {
        this.logger.error(
          `[AssetAnalysisProcessor] UserId mismatch: project userId=${currentProject.userId}, job userId=${userId}`,
          'AssetAnalysisProcessor'
        );
        throw new Error(`UserId mismatch: project belongs to ${currentProject.userId}, but job is for ${userId}`);
      }

      const currentMetadata = currentProject.metadata || {};
      const updatedMetadata = {
        ...currentMetadata,
        assetAnalysis: {
          ...currentMetadata.assetAnalysis,
          status,
          totalAssets,
          completedAssets,
          updatedAt: new Date().toISOString(),
        },
      };

      // Update project metadata with retry logic
      await this.retryWithBackoff(
        async () => {
          const token = this.generateServiceToken(userId);
          await axios.put(
            `${this.videoProcessingServiceUrl}/api/video-projects/${projectId}`,
            { metadata: updatedMetadata },
            {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              timeout: 10000,
            }
          );
        },
        `PUT project ${projectId} metadata`,
        3,
        1000
      );

      this.logger.log(
        `[AssetAnalysisProcessor] Successfully updated analysis status for project ${projectId}`,
        'AssetAnalysisProcessor'
      );
    } catch (error: any) {
      // Log detailed error information
      const errorDetails = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        userId,
        projectId,
        url: `${this.videoProcessingServiceUrl}/api/video-projects/${projectId}`,
      };
      
      this.logger.warn(
        `[AssetAnalysisProcessor] Failed to update analysis status: ${JSON.stringify(errorDetails)}`,
        'AssetAnalysisProcessor'
      );
      // Don't throw - this is a non-critical update
    }
  }

  /**
   * Update project metadata with analyzed assets
   */
  private async updateProjectMetadata(
    projectId: string,
    userId: string,
    metadataUpdate: {
      analyzedAssets: AnalyzedAsset[];
      assetAnalysis: {
        status: string;
        totalAssets: number;
        completedAssets: number;
        failedAssets: number;
        completedAt: string;
      };
    }
  ): Promise<void> {
    try {
      this.logger.log(
        `[AssetAnalysisProcessor] Updating project metadata for project ${projectId} (userId: ${userId}) with ${metadataUpdate.analyzedAssets.length} analyzed assets`,
        'AssetAnalysisProcessor'
      );

      // Add initial delay to handle race conditions (project might not be committed yet)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get current project to merge metadata with retry logic
      const currentProject = await this.retryWithBackoff(
        async () => {
          const token = this.generateServiceToken(userId);
          const projectResponse = await axios.get(
            `${this.videoProcessingServiceUrl}/api/video-projects/${projectId}`,
            {
              headers: {
                'Authorization': `Bearer ${token}`,
              },
              timeout: 10000,
            }
          );

          const project = projectResponse.data?.data;
          if (!project) {
            const error: any = new Error('Project not found in response');
            error.response = {
              status: 404,
              data: projectResponse.data,
            };
            throw error;
          }

          return project;
        },
        `GET project ${projectId}`,
        3,
        1000
      );

      // Verify userId matches
      if (currentProject.userId !== userId) {
        this.logger.error(
          `[AssetAnalysisProcessor] UserId mismatch: project userId=${currentProject.userId}, job userId=${userId}`,
          'AssetAnalysisProcessor'
        );
        throw new Error(`UserId mismatch: project belongs to ${currentProject.userId}, but job is for ${userId}`);
      }

      const currentMetadata = currentProject.metadata || {};
      const updatedMetadata = {
        ...currentMetadata,
        analyzedAssets: metadataUpdate.analyzedAssets,
        assetAnalysis: {
          ...currentMetadata.assetAnalysis,
          ...metadataUpdate.assetAnalysis,
        },
      };

      // Update project metadata with retry logic
      await this.retryWithBackoff(
        async () => {
          const token = this.generateServiceToken(userId);
          await axios.put(
            `${this.videoProcessingServiceUrl}/api/video-projects/${projectId}`,
            { metadata: updatedMetadata },
            {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              timeout: 10000,
            }
          );
        },
        `PUT project ${projectId} metadata`,
        3,
        1000
      );

      this.logger.log(
        `[AssetAnalysisProcessor] Successfully updated project ${projectId} metadata with ${metadataUpdate.analyzedAssets.length} analyzed assets`,
        'AssetAnalysisProcessor'
      );
    } catch (error: any) {
      // Log detailed error information
      const errorDetails = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        userId,
        projectId,
        url: `${this.videoProcessingServiceUrl}/api/video-projects/${projectId}`,
        stack: error.stack,
      };
      
      this.logger.error(
        `[AssetAnalysisProcessor] Failed to update project metadata: ${JSON.stringify(errorDetails)}`,
        error.stack,
        'AssetAnalysisProcessor'
      );
      throw error;
    }
  }

  /**
   * Generate service token for inter-service communication
   */
  private generateServiceToken(userId: string): string {
    try {
      const tokenPayload = { sub: userId, userId, id: userId, type: 'service' };
      const token = jwt.sign(
        tokenPayload,
        this.jwtSecret,
        { expiresIn: '1h' }
      );
      
      // Log token generation for debugging (without exposing the actual token)
      this.logger.log(
        `[AssetAnalysisProcessor] Generated service token for userId: ${userId}, payload structure: ${JSON.stringify(Object.keys(tokenPayload))}`,
        'AssetAnalysisProcessor'
      );
      
      return token;
    } catch (error: any) {
      this.logger.error(`[AssetAnalysisProcessor] Failed to generate service token: ${error.message}`, 'AssetAnalysisProcessor');
      throw error;
    }
  }

  /**
   * Retry wrapper with exponential backoff for HTTP requests
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        const is404 = error.response?.status === 404 || error.message?.includes('404');
        const isRetryable = is404 || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
        
        if (!isRetryable || attempt === maxRetries - 1) {
          throw error;
        }
        
        const delay = initialDelay * Math.pow(2, attempt);
        this.logger.warn(
          `[AssetAnalysisProcessor] ${operationName} failed (attempt ${attempt + 1}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`,
          'AssetAnalysisProcessor'
        );
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Infer category from user label when analysis fails
   */
  private inferCategoryFromUserLabel(userLabel?: string): AnalyzedAsset['category'] | undefined {
    if (!userLabel) return undefined;
    
    const normalized = userLabel.toLowerCase();
    if (normalized.includes('logo')) return 'logo';
    if (normalized.includes('product')) return 'product';
    if (normalized.includes('background')) return 'background';
    if (normalized.includes('brand')) return 'branding';
    if (normalized.includes('environment') || normalized.includes('setting')) return 'environment';
    
    return undefined;
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`[AssetAnalysisProcessor] Job ${job.id} completed`, 'AssetAnalysisProcessor');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`[AssetAnalysisProcessor] Job ${job.id} failed: ${error.message}`, error.stack, 'AssetAnalysisProcessor');
  }
}

