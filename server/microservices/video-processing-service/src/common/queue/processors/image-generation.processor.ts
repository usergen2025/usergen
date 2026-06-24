import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { ProviderFactory } from '../../../rendering/providers/provider-factory.service';
import { ModelRegistryService } from '../../../rendering/providers/model-registry.service';
import { ImageGenerationRequest } from '../../../rendering/providers/interfaces/image-generation.interface';
import { FalProviderError } from '../../../rendering/providers/fal/fal-errors';
import { JobStatusGateway } from '../../websocket/job-status.gateway';
import { PublicUrlService } from '../../storage/public-url.service';
import { AssetProcessorService, AnalyzedAsset } from '../../services/asset-processor.service';
import { ProjectLogService } from '../../logging/project-log.service';
import { UserNotificationService } from '../../../notifications/user-notification.service';
import { preWarmUrl } from '@shared/storage';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import axios from 'axios';
import sharp from 'sharp';
import FormData from 'form-data';
import {
  getScenePresentationFromScript,
} from '../../../video/product-presentation.types';
import {
  buildProductOnlyPromptSuffix,
  buildProductOnlyReferenceImages,
  extractPrimaryProductType,
  extractVisualScriptContext,
  getEphemeralPresenterUrl,
  getProductPresentationPlanFromMetadata,
  sanitizeProductOnlyScenePrompt,
} from '../../../video/product-only-prompt.util';

export interface ImageGenerationJobData {
  projectId: string;
  userId: string;
  sceneNumber: number;
  prompt: string;
  modelId?: string; // e.g., "model-1", "model-2", etc.
  aspectRatio?: string; // Override default
  resolution?: string; // Override default
  productImageUrl?: string; // Product image URL for product-focused styles
  avatarImageKey?: string; // Avatar image key for avatar-product style
  videoStyle?: string; // Video style to determine generation method
}

@Processor('image-generation', {
  concurrency: 10, // Process 10 image generation jobs concurrently per worker
})
@Injectable()
export class ImageGenerationProcessor extends WorkerHost {
  private readonly uploadsDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly providerFactory: ProviderFactory,
    private readonly modelRegistry: ModelRegistryService,
    private readonly jobStatusGateway: JobStatusGateway,
    private readonly publicUrlService: PublicUrlService,
    private readonly assetProcessor: AssetProcessorService,
    private readonly projectLog: ProjectLogService,
    private readonly userNotificationService: UserNotificationService,
  ) {
    super();
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  async process(job: Job<ImageGenerationJobData>): Promise<any> {
    const { 
      projectId, 
      userId, 
      sceneNumber, 
      prompt, 
      modelId, 
      aspectRatio, 
      resolution,
      productImageUrl,
      avatarImageKey,
      videoStyle
    } = job.data;

    await this.projectLog
      .logProject(projectId, 'INFO', 'image-generation started', {
        op: 'image-generation',
        scene: sceneNumber,
        jobId: String(job.id),
      })
      .catch(() => {});

    // ✅ Enhanced logging for debugging
    console.log(`[ImageGenerationProcessor] ========== JOB START ==========`);
    console.log(`[ImageGenerationProcessor] Job ID: ${job.id}`);
    console.log(`[ImageGenerationProcessor] Scene: ${sceneNumber}`);
    console.log(`[ImageGenerationProcessor] Job data:`, {
      videoStyle,
      modelId,
      hasProductImageUrl: !!productImageUrl,
      hasAvatarImageKey: !!avatarImageKey,
      productImageUrl,
      avatarImageKey,
    });

    try {
      // Get project to determine video style
      const project = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      // Extract analyzed assets from project metadata
      const analyzedAssets = this.extractAnalyzedAssets(project);

      const style = videoStyle || project.style;
      // ✅ Enhanced style normalization to handle multiple format variations
      let normalizedStyle: string;
      if (typeof style === 'string') {
        // Convert to uppercase and normalize separators (handle avatar-product, avatar_product, AVATAR_PRODUCT)
        normalizedStyle = style.toUpperCase().replace(/[-_]/g, '_');
      } else {
        normalizedStyle = style;
      }

      // ✅ Enhanced logging for style detection
      console.log(`[ImageGenerationProcessor] ========== STYLE DETECTION ==========`);
      console.log(`[ImageGenerationProcessor] Style check:`, {
        videoStyleFromJob: videoStyle,
        projectStyle: project.style,
        styleVariable: style,
        normalizedStyle,
        willMatchAVATAR_PRODUCT: normalizedStyle === 'AVATAR_PRODUCT',
        avatarId: (project as any).avatarId,
        metadataAvatarId: (project as any).metadata?.avatarId,
        metadataSelectedAvatarId: (project as any).metadata?.selectedAvatarId,
      });

      // Handle AVATAR_PRODUCT style - create composite images
      if (normalizedStyle === 'AVATAR_PRODUCT') {
        console.log(`[ImageGenerationProcessor] ✅✅✅ AVATAR_PRODUCT DETECTED! Processing composite image generation...`);
        const result = await this.processAvatarProductStyle(
          job,
          project,
          sceneNumber,
          prompt,
          productImageUrl,
          avatarImageKey,
          modelId,
          userId,
          projectId,
          analyzedAssets
        );
        await this.recordOperationCharge(projectId, userId, sceneNumber, normalizedStyle, job.id);
        return result;
      } else {
        console.log(`[ImageGenerationProcessor] ❌ NOT AVATAR_PRODUCT (${normalizedStyle}), falling through to ${normalizedStyle === 'PRODUCT_ONLY' ? 'PRODUCT_ONLY' : 'default'} processing`);
      }

      // Extract analyzed assets; build reference images in order (product(s) first, logo last) for Seedream
      const sceneAssets = analyzedAssets ? this.assetProcessor.getAssetsForScene(analyzedAssets, sceneNumber, normalizedStyle) : [];
      let referenceImagesOrdered = analyzedAssets ? this.assetProcessor.buildReferenceImagesInOrder(analyzedAssets) : [];
      // If buildReferenceImagesInOrder returned empty but we have analyzed assets (e.g. legacy stored URLs), resolve to public URLs
      if (referenceImagesOrdered.length === 0 && analyzedAssets && analyzedAssets.length > 0) {
        referenceImagesOrdered = await this.resolveReferenceUrlsToPublic(analyzedAssets);
        if (referenceImagesOrdered.length > 0) {
          console.log(`[ImageGenerationProcessor] Resolved ${referenceImagesOrdered.length} reference URL(s) for provider (legacy fallback)`);
        }
      }
      // When no refs from analyzed assets but job has productImageUrl (e.g. ALTERNATE), use it so we get model-4 + refs
      if (referenceImagesOrdered.length === 0 && productImageUrl && (productImageUrl.startsWith('http://') || productImageUrl.startsWith('https://'))) {
        referenceImagesOrdered = [productImageUrl];
        console.log(`[ImageGenerationProcessor] Using productImageUrl as single reference (model-4 with refs)`);
      }
      if (analyzedAssets?.length && referenceImagesOrdered.length > 0) {
        console.log(`[ImageGenerationProcessor] Using ${referenceImagesOrdered.length} reference image(s) from analyzed assets (model-4 with refs)`);
      }
      const enhancedPrompt = analyzedAssets ? this.assetProcessor.enhancePromptWithAssets(prompt, sceneAssets) : prompt;

      // Handle PRODUCT_ONLY style - use product image in generation (always model-4)
      if (normalizedStyle === 'PRODUCT_ONLY') {
        if (!productImageUrl) {
          throw new Error('Product image URL is required for PRODUCT_ONLY style. Please ensure product image is uploaded in assets.');
        }
        const result = await this.processProductOnlyStyle(
          job,
          project,
          sceneNumber,
          prompt,
          productImageUrl,
          modelId,
          aspectRatio,
          resolution,
          userId,
          analyzedAssets
        );
        await this.recordOperationCharge(projectId, userId, sceneNumber, normalizedStyle, job.id);
        return result;
      }

      // Default processing for other styles (use Seedream when we have reference assets)
      const result = await this.processDefaultStyle(
        job,
        project,
        sceneNumber,
        enhancedPrompt,
        modelId,
        aspectRatio,
        resolution,
        userId,
        analyzedAssets,
        referenceImagesOrdered
      );
      await this.recordOperationCharge(projectId, userId, sceneNumber, normalizedStyle, job.id);
      return result;
    } catch (error: any) {
      console.error(`[ImageGenerationProcessor] Error processing job ${job.id}:`, error);
      
      // Enhanced error reporting for FAL errors
      let isRetryable = false;
      let errorMessage = error.message || 'Unknown error';

      if (error instanceof FalProviderError) {
        isRetryable = error.isRetryable();
        errorMessage = error.getUserMessage();
      }

      // Emit WebSocket error event
      try {
        await this.jobStatusGateway.notifyJobStatus(userId, {
          jobId: job.id!,
          state: 'failed',
          progress: 0,
          error: errorMessage,
          queueType: 'image-generation',
        });
      } catch (err: any) {
        console.error(`[ImageGenerationProcessor] Failed to emit WebSocket event:`, err);
      }
      this.userNotificationService
        .notifyProcessingEvent({
          userId,
          projectId,
          type: 'PROCESSING_FAILED',
          operation: 'image-generation',
          status: 'failed',
          title: 'Image generation failed',
          message: `Image generation failed for scene ${sceneNumber}.`,
          data: { sceneNumber, jobId: job.id, queueType: 'image-generation', error: errorMessage },
        })
        .catch(() => {});

      await this.projectLog
        .logProject(projectId, 'ERROR', errorMessage, {
          op: 'image-generation',
          scene: sceneNumber,
          jobId: String(job.id),
        })
        .catch(() => {});

      throw error;
    } finally {
      await this.projectLog.flushProjectToGcs(projectId).catch(() => {});
    }
  }

  private async recordOperationCharge(
    projectId: string,
    userId: string,
    sceneNumber: number,
    style: string,
    jobId?: string | number,
  ) {
    const idempotencyKey = `image:${projectId}:${sceneNumber}:${jobId ?? 'na'}`;
    try {
      const project = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
        select: { metadata: true },
      });
      const baseMetadata =
        project?.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
          ? ({ ...(project.metadata as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const billedKeys = Array.isArray(baseMetadata.billedOperationKeys)
        ? (baseMetadata.billedOperationKeys as string[])
        : [];
      if (billedKeys.includes(idempotencyKey)) {
        return;
      }
      const paymentServiceUrl = (this.configService.get<string>('PAYMENT_SERVICE_URL') || 'http://localhost:9005').replace(/\/api\/?$/, '');
      const response = await axios.post(
        `${paymentServiceUrl}/api/pricing/record-cost`,
        {
          projectId,
          userId,
          sceneNumber,
          operationType: 'IMAGE_GENERATION',
          operationName: 'Image Generation',
          metadata: { idempotencyKey, style, jobId },
        },
        { timeout: 10000 },
      );
      if (response.data?.skipped || !response.data?.data) {
        return;
      }
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          metadata: {
            ...baseMetadata,
            billedOperationKeys: [...billedKeys, idempotencyKey],
          } as any,
        },
      });
    } catch (error: any) {
      console.warn(`[ImageGenerationProcessor] Billing hook failed: ${error.message}`);
    }
  }

  /**
   * Process PRODUCT_ONLY style - use product image in generation
   */
  private async processProductOnlyStyle(
    job: Job<ImageGenerationJobData>,
    project: any,
    sceneNumber: number,
    prompt: string,
    productImageUrl: string,
    modelId: string | undefined,
    aspectRatio: string | undefined,
    resolution: string | undefined,
    userId: string,
    analyzedAssets?: AnalyzedAsset[]
  ): Promise<any> {
    console.log(`[ImageGenerationProcessor] Processing PRODUCT_ONLY style for scene ${sceneNumber}`);

    const script =
      typeof project.script === 'string' ? JSON.parse(project.script) : project.script;
    const scenePresentation = getScenePresentationFromScript(script, sceneNumber);
    const presentationMode = scenePresentation.presentation_mode || 'hero_flat_lay';
    const requiresHuman = Boolean(scenePresentation.requires_human);
    const cameraShot = scenePresentation.camera_shot;
    const metadata = project.metadata as Record<string, unknown> | undefined;
    const presentationPlan = getProductPresentationPlanFromMetadata(metadata);
    const ephemeralPresenterUrl = getEphemeralPresenterUrl(metadata);
    const productType = extractPrimaryProductType(analyzedAssets, presentationPlan, metadata);
    const visualScriptContext = extractVisualScriptContext(analyzedAssets, metadata);

    console.log(
      `[ImageGenerationProcessor] PRODUCT_ONLY scene ${sceneNumber}: mode=${presentationMode}, profile=${presentationPlan?.profile || 'unknown'}, productType=${productType || 'unknown'}, productForm=${presentationPlan?.productForm || 'unknown'}, refs=presenter:${Boolean(ephemeralPresenterUrl)}`,
    );

    // Ensure product image is publicly accessible (for 3rd party API calls like FAL)
    let publicProductImageUrl = productImageUrl;
    if (productImageUrl) {
      if (!productImageUrl.startsWith('http://') && !productImageUrl.startsWith('https://')) {
        // If it's a local file path, convert to public URL using GCS if available
        const localUrl = productImageUrl.startsWith('/') ? productImageUrl : `/${productImageUrl}`;
        try {
          publicProductImageUrl = await this.publicUrlService.getPublicUrl(productImageUrl, localUrl);
          console.log(`[ImageGenerationProcessor] Converted product image to public URL: ${publicProductImageUrl}`);
        } catch (error: any) {
          console.error(`[ImageGenerationProcessor] Failed to get public URL for product image: ${error.message}`);
          throw new Error(`Product image URL must be publicly accessible for 3rd party API calls. Failed to convert: ${error.message}`);
        }
      } else {
        // Already a public URL, verify it's accessible
        console.log(`[ImageGenerationProcessor] Using provided public product image URL: ${publicProductImageUrl}`);
      }
    } else {
      throw new Error('Product image URL is required for PRODUCT_ONLY style');
    }

    // Mode-aware prompt suffix and reference images
    const sanitizedPrompt = sanitizeProductOnlyScenePrompt(
      prompt,
      presentationPlan,
      productType || presentationPlan?.productType,
      visualScriptContext,
    );

    const modeSuffix = buildProductOnlyPromptSuffix(
      presentationMode,
      presentationPlan,
      cameraShot,
      productType || presentationPlan?.productType,
      visualScriptContext,
    );
    const baseEnhancedPrompt = `${sanitizedPrompt} [COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images, NO split-screen, NO tiled layout] ${modeSuffix}${this.fullProductFramingPromptSuffix()}`;
    
    // Get scene-specific assets and enhance prompt
    const sceneAssets = analyzedAssets ? this.assetProcessor.getAssetsForScene(analyzedAssets, sceneNumber, 'PRODUCT_ONLY') : [];
    const assetEnhancedPrompt = analyzedAssets ? this.assetProcessor.enhancePromptWithAssets(baseEnhancedPrompt, sceneAssets) : baseEnhancedPrompt;
    
    // Prepare reference images (product + optional presenter + assets)
    const assetReferenceImages = analyzedAssets ? this.assetProcessor.prepareReferenceImages(sceneAssets, sceneNumber) : [];
    const allReferenceImages = buildProductOnlyReferenceImages(
      presentationMode,
      publicProductImageUrl,
      assetReferenceImages,
      ephemeralPresenterUrl,
      requiresHuman,
    );
    
    const enhancedPrompt = assetEnhancedPrompt;

    // Determine aspect ratio
    const selectedAspectRatio = aspectRatio || '9:16';

    // Get model configuration
    // Default to model-4 (nano-banana-pro) for PRODUCT_ONLY style (supports image-to-image)
    let selectedModelId = modelId || (project as any).defaultImageModel || 'model-4'; // Default to model-4 for product styles
    let model = this.modelRegistry.getModel(selectedModelId);

    // Validate model supports reference images for PRODUCT_ONLY style
    // If model doesn't support reference images and productImageUrl is provided, fallback to model-4
    if (!model || (selectedModelId === 'model-1' && productImageUrl)) {
      // imagen4 doesn't support reference images, fallback to model-4
      console.warn(`[ImageGenerationProcessor] Model ${selectedModelId} doesn't support reference images for PRODUCT_ONLY, using model-4 (nano-banana-pro) instead`);
      model = this.modelRegistry.getDefaultModelForStyle('PRODUCT_ONLY');
      selectedModelId = 'model-4';
    }

    console.log(`[ImageGenerationProcessor] PRODUCT_ONLY: Using ${model.displayName} (${model.platform}) for image-to-image generation`);

    // Get provider
    const provider = this.providerFactory.getProviderForModel(model.id);

    // Build request with product image and asset images as reference for image-to-image generation
    const request: ImageGenerationRequest = {
      prompt: enhancedPrompt,
      modelId: model.id,
      aspectRatio: selectedAspectRatio,
      resolution: resolution || model.defaultConfig.resolution || '2K',
      numImages: model.defaultConfig.numImages || 1,
      outputFormat: (model.defaultConfig.outputFormat as 'png' | 'jpeg' | 'webp') || 'jpeg',
      referenceImages: allReferenceImages, // ✅ Use image-to-image with product + assets as reference
    };

    // Validate request
    const validation = provider.validateRequest(request);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid request');
    }

    // Create user directory
    const userDir = path.join(this.uploadsDir, 'images', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    await job.updateProgress(10);

    // Generate image
    let imageResponse;
    try {
      imageResponse = await provider.generateImage(
        request,
        (progress) => {
          const mappedProgress = 10 + (progress * 0.8);
          job.updateProgress(mappedProgress);
        }
      );
    } catch (error) {
      if (error instanceof FalProviderError) {
        console.error(`[ImageGenerationProcessor] FAL error for job ${job.id}:`, {
          type: error.type,
          statusCode: error.statusCode,
          retryable: error.isRetryable(),
          message: error.getUserMessage(),
        });

        if (error.isRetryable() && (job.attemptsMade || 0) < 3) {
          throw error;
        }

        throw new Error(`Image generation failed: ${error.getUserMessage()}`);
      }
      throw error;
    }

    await job.updateProgress(90);

    // Download and save image
    const imageUrl = imageResponse.imageUrl;
    const imageFilename = `scene_${sceneNumber}_${project.id}_${Date.now()}.jpg`;
    const imagePath = path.join(userDir, imageFilename);
    await this.downloadImage(imageUrl, imagePath);

    await job.updateProgress(92);
    await this.maybeApplyLogoCornerOverlay(imagePath, analyzedAssets);

    await job.updateProgress(93);

    const localUrl = `/uploads/images/${userId}/${imageFilename}`;

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string = localUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        imagePath,
        `images/${userId}`,
        imageFilename,
        'image/jpeg'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
      if (gcsUrl) {
        console.log(`[ImageGenerationProcessor] ✅ PRODUCT_ONLY image uploaded to GCS: ${gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[ImageGenerationProcessor] GCS upload failed for ${imageFilename}: ${error.message}`);
    }

    await job.updateProgress(95);

    // Update project
    const latestProject = await this.databaseService.videoProject.findUnique({
      where: { id: project.id },
    });

    if (!latestProject) {
      throw new Error('Project not found');
    }

    const imageData = {
      sceneNumber,
      jobId: job.id!,
      imageUrl,
      localPath: imagePath,
      localUrl,
      gcsUrl,
      publicUrl,
      prompt: enhancedPrompt,
      modelId: selectedModelId,
      model: model.displayName,
      productImageUrl: publicProductImageUrl, // Store product image URL used
      presentation_mode: presentationMode,
      generationMethod: 'image-to-image', // Mark as image-to-image generation
      source: 'ai-image', // Content source type for tracking
      contentType: 'image',
    };

    const bRollImages = ((latestProject as any).bRollImages as any[]) || [];
    const existingIndex = bRollImages.findIndex((img: any) => img.sceneNumber === sceneNumber);

    if (existingIndex >= 0) {
      bRollImages[existingIndex] = imageData;
    } else {
      bRollImages.push(imageData);
    }

    await this.databaseService.videoProject.update({
      where: { id: project.id },
      data: {
        bRollImages: bRollImages as any,
      } as any,
    });

    await job.updateProgress(100);

    console.log(`[ImageGenerationProcessor] Completed PRODUCT_ONLY job ${job.id} for scene ${sceneNumber} using image-to-image (source: ai-image)`);
    
    // Emit WebSocket event
    await this.jobStatusGateway.notifyJobStatus(userId, {
      jobId: job.id!,
      state: 'completed',
      progress: 100,
      result: {
        image: imageData,
      },
      queueType: 'image-generation',
    });
    this.userNotificationService
      .notifyProcessingEvent({
        userId,
        projectId: project.id,
        type: 'BROLL_IMAGE_READY',
        operation: 'image-generation',
        status: 'completed',
        title: 'B-roll image ready',
        message: `Scene ${sceneNumber} image was generated successfully.`,
        data: { sceneNumber, jobId: job.id, queueType: 'image-generation' },
      })
      .catch(() => {});

    return imageData;
  }

  /**
   * Ensure avatar image has a valid public URL (with GCS upload if needed)
   * This method handles:
   * 1. Checking cached public URL from metadata
   * 2. Validating cached URL with pre-warming
   * 3. If invalid/missing: finding local file, uploading to GCS, caching URL
   * 
   * @param avatarId - Avatar ID
   * @param userId - User ID
   * @param projectId - Project ID
   * @param projectMetadata - Project metadata object
   * @returns Public URL for the avatar image
   */
  private async ensureAvatarPublicUrl(
    avatarId: string,
    userId: string,
    projectId: string,
    projectMetadata: any
  ): Promise<string> {
    // 1) Check for cached public URL in metadata
    const cachedAvatarUrl: string | undefined = projectMetadata?.avatarPublicImageUrl;
    
    if (cachedAvatarUrl && (cachedAvatarUrl.startsWith('http://') || cachedAvatarUrl.startsWith('https://'))) {
      console.log(`[ImageGenerationProcessor] Found cached avatarPublicImageUrl: ${cachedAvatarUrl}`);
      
      // 2) Validate cached URL with pre-warming (this validates accessibility)
      console.log(`[ImageGenerationProcessor] Validating cached avatar URL with pre-warming...`);
      const isValid = await preWarmUrl(cachedAvatarUrl, 3);
      
      if (isValid) {
        console.log(`[ImageGenerationProcessor] ✅ Cached avatar URL is valid and accessible`);
        return cachedAvatarUrl;
      } else {
        console.warn(`[ImageGenerationProcessor] ⚠️ Cached avatar URL failed validation, will re-upload to GCS`);
        // Continue to re-upload logic below
      }
    }

    // 3) Cached URL doesn't exist or is invalid - fetch from API and upload to GCS
    console.log(`[ImageGenerationProcessor] Fetching avatar ${avatarId} from ai-content-service...`);
    
    const aiContentServiceUrl = this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9001';
    let avatarImagePath: string | null = null;
    
    try {
      const avatarResponse = await axios.get(`${aiContentServiceUrl}/api/avatars/${avatarId}`, {
        params: { userId },
        timeout: 10000,
      });
      
      if (!avatarResponse.data?.success || !avatarResponse.data?.data) {
        throw new Error(`Avatar ${avatarId} not found in ai-content-service database`);
      }
      
      const avatarData = avatarResponse.data.data;
      const originalImageUrl = avatarData.originalImageUrl;
      const avatarUserId = avatarData.userId;
      
      // 4) If originalImageUrl is already a public URL, validate and use it
      if (originalImageUrl && (originalImageUrl.startsWith('http://') || originalImageUrl.startsWith('https://'))) {
        console.log(`[ImageGenerationProcessor] Avatar has public URL in database: ${originalImageUrl}`);
        const isValid = await preWarmUrl(originalImageUrl, 3);
        if (isValid) {
          // Cache it in metadata for future use
          await this.cacheAvatarPublicUrl(projectId, projectMetadata, originalImageUrl);
          return originalImageUrl;
        }
        console.warn(`[ImageGenerationProcessor] ⚠️ Avatar public URL from database failed validation, will find local file`);
      }
      
      // 5) Find local file path
      if (originalImageUrl) {
        const relativePath = originalImageUrl.replace(/^\/uploads\//, 'uploads/');
        const possiblePaths = [
          path.join(process.cwd(), relativePath),
          path.join(this.uploadsDir, relativePath.replace(/^uploads\//, '')),
          path.join(process.cwd(), '..', relativePath),
          path.join(process.cwd(), '..', '..', relativePath),
          path.join(process.cwd(), '..', 'ai-content-service', relativePath),
          path.join(process.cwd(), '..', '..', 'ai-content-service', relativePath),
          path.join(process.cwd(), '..', 'ai-content-service', 'uploads', 'avatars', avatarUserId, avatarId, 'original.jpg'),
          path.join(process.cwd(), '..', '..', 'ai-content-service', 'uploads', 'avatars', avatarUserId, avatarId, 'original.jpg'),
          path.join(process.cwd(), '..', 'ai-content-service', 'uploads', 'avatars', userId, avatarId, 'original.jpg'),
          path.join(process.cwd(), '..', '..', 'ai-content-service', 'uploads', 'avatars', userId, avatarId, 'original.jpg'),
        ];
        
        for (const possiblePath of possiblePaths) {
          if (fs.existsSync(possiblePath)) {
            avatarImagePath = possiblePath;
            break;
          }
        }
      }
      
      // Fallback: try standard paths
      if (!avatarImagePath) {
        const fallbackPaths = [
          path.join(process.cwd(), 'uploads', 'avatars', avatarUserId || userId, avatarId, 'original.jpg'),
          path.join(this.uploadsDir, 'avatars', avatarUserId || userId, avatarId, 'original.jpg'),
          path.join(process.cwd(), '..', 'ai-content-service', 'uploads', 'avatars', avatarUserId || userId, avatarId, 'original.jpg'),
          path.join(process.cwd(), '..', '..', 'ai-content-service', 'uploads', 'avatars', avatarUserId || userId, avatarId, 'original.jpg'),
        ];
        
        for (const p of fallbackPaths) {
          if (fs.existsSync(p)) {
            avatarImagePath = p;
            break;
          }
        }
      }
      
      if (!avatarImagePath || !fs.existsSync(avatarImagePath)) {
        throw new Error(
          `Avatar original image file not found for avatarId: ${avatarId}. ` +
          `Please ensure the avatar's original image exists on disk or re-upload the avatar.`
        );
      }
      
      // 6) Upload to GCS and get public URL
      console.log(`[ImageGenerationProcessor] Uploading avatar image to GCS from: ${avatarImagePath}`);
      const localUrl = `/uploads/avatars/${avatarUserId || userId}/${avatarId}/original.jpg`;
      const storageResult = await this.publicUrlService.uploadFromPath(
        avatarImagePath,
        `avatars/${avatarUserId || userId}/${avatarId}`,
        path.basename(avatarImagePath),
        'image/jpeg'
      );
      
      const publicUrl = storageResult.publicUrl;
      console.log(`[ImageGenerationProcessor] ✅ Avatar image uploaded, public URL: ${publicUrl}`);
      
      // 7) Cache the public URL in metadata for future use
      await this.cacheAvatarPublicUrl(projectId, projectMetadata, publicUrl);
      
      // 8) Optional: Update avatar.originalImageUrl in ai-content-service DB with GCS URL
      if (storageResult.gcsUploaded && publicUrl !== originalImageUrl) {
        try {
          await axios.put(`${aiContentServiceUrl}/api/avatars/${avatarId}`, 
            { originalImageUrl: publicUrl, userId: avatarUserId },
            { timeout: 5000 }
          );
          console.log(`[ImageGenerationProcessor] ✅ Updated avatar ${avatarId} originalImageUrl to GCS URL in DB`);
        } catch (updateError: any) {
          console.warn(`[ImageGenerationProcessor] ⚠️ Failed to update avatar originalImageUrl in DB: ${updateError.message}`);
        }
      }
      
      return publicUrl;
      
    } catch (apiError: any) {
      console.error(`[ImageGenerationProcessor] ❌ Failed to fetch avatar from ai-content-service:`, {
        avatarId,
        userId,
        error: apiError.message,
      });
      throw new Error(`Failed to retrieve avatar image: ${apiError.message}`);
    }
  }

  /**
   * Cache avatar public URL in project metadata
   */
  private async cacheAvatarPublicUrl(
    projectId: string,
    projectMetadata: any,
    publicUrl: string
  ): Promise<void> {
    try {
      const updatedMetadata = {
        ...(projectMetadata || {}),
        avatarPublicImageUrl: publicUrl,
      };
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: { metadata: updatedMetadata as any } as any,
      });
      console.log(`[ImageGenerationProcessor] ✅ Cached avatarPublicImageUrl in project metadata`);
    } catch (cacheError: any) {
      console.warn(`[ImageGenerationProcessor] ⚠️ Failed to cache avatarPublicImageUrl: ${cacheError.message}`);
    }
  }

  /**
   * Process AVATAR_PRODUCT style - use image-to-image with avatar and product as references
   */
  private async processAvatarProductStyle(
    job: Job<ImageGenerationJobData>,
    project: any,
    sceneNumber: number,
    prompt: string,
    productImageUrl: string | undefined,
    avatarImageKey: string | undefined,
    modelId: string | undefined,
    userId: string,
    projectId: string,
    analyzedAssets?: AnalyzedAsset[]
  ): Promise<any> {
    console.log(`[ImageGenerationProcessor] Processing AVATAR_PRODUCT style for scene ${sceneNumber} using image-to-image`);

    if (!productImageUrl) {
      throw new Error('Product image URL is required for AVATAR_PRODUCT style');
    }

    // Extract avatarId from project (check project.avatarId first, then metadata)
    const avatarId = (project as any).avatarId || 
                     (project as any).metadata?.avatarId || 
                     (project as any).metadata?.selectedAvatarId;

    console.log(`[ImageGenerationProcessor] AVATAR_PRODUCT: Looking for avatarId. Found:`, {
      projectAvatarId: (project as any).avatarId,
      metadataAvatarId: (project as any).metadata?.avatarId,
      metadataSelectedAvatarId: (project as any).metadata?.selectedAvatarId,
      finalAvatarId: avatarId,
      avatarImageKey,
    });

    if (!avatarId && !avatarImageKey) {
      console.error(`[ImageGenerationProcessor] AVATAR_PRODUCT: Avatar ID not found. Project data:`, {
        projectId,
        projectAvatarId: (project as any).avatarId,
        metadata: (project as any).metadata,
        style: project.style,
      });
      throw new Error('Avatar ID is required for AVATAR_PRODUCT style. Please ensure an avatar is selected for this project.');
    }

    // ✅ NEW: Use the helper method to ensure we have a valid public URL
    const projectMetadata = ((project as any).metadata || {}) as any;
    const avatarImageUrl = await this.ensureAvatarPublicUrl(avatarId, userId, projectId, projectMetadata);

    // Validate avatar URL is public
    if (!avatarImageUrl || (!avatarImageUrl.startsWith('http://') && !avatarImageUrl.startsWith('https://'))) {
      throw new Error(`Avatar image URL must be a public HTTP/HTTPS URL. Got: ${avatarImageUrl}`);
    }

    console.log(`[ImageGenerationProcessor] ========== AVATAR IMAGE RETRIEVAL ==========`);
    console.log(`[ImageGenerationProcessor] Avatar image URL: ${avatarImageUrl}`);
    console.log(`[ImageGenerationProcessor] Avatar image URL valid: true`);

    // Ensure product image is publicly accessible (for 3rd party API calls like FAL)
    let publicProductImageUrl = productImageUrl;
    if (productImageUrl) {
      // ✅ Enhanced logging for product image URL
      console.log(`[ImageGenerationProcessor] ========== PRODUCT IMAGE URL ==========`);
      console.log(`[ImageGenerationProcessor] Original product image URL: ${productImageUrl}`);
      console.log(`[ImageGenerationProcessor] Is public URL: ${productImageUrl.startsWith('http://') || productImageUrl.startsWith('https://')}`);
      
      if (!productImageUrl.startsWith('http://') && !productImageUrl.startsWith('https://')) {
        // If it's a local file path, convert to public URL using GCS if available
        const localUrl = productImageUrl.startsWith('/') ? productImageUrl : `/${productImageUrl}`;
        try {
          publicProductImageUrl = await this.publicUrlService.getPublicUrl(productImageUrl, localUrl);
          console.log(`[ImageGenerationProcessor] ✅ Converted product image to public URL: ${publicProductImageUrl}`);
        } catch (error: any) {
          console.error(`[ImageGenerationProcessor] ❌ Failed to get public URL for product image: ${error.message}`);
          throw new Error(`Product image URL must be publicly accessible for 3rd party API calls. Failed to convert: ${error.message}`);
        }
      } else {
        // Already a public URL, verify it's accessible
        console.log(`[ImageGenerationProcessor] ✅ Using provided public product image URL: ${publicProductImageUrl}`);
      }
    } else {
      console.error(`[ImageGenerationProcessor] ❌ Product image URL is required for AVATAR_PRODUCT style`);
      throw new Error('Product image URL is required for AVATAR_PRODUCT style');
    }

    // Enhanced prompt for avatar-product generation with reference images and asset context
    // Include STRONG product consistency requirements
    const baseEnhancedPrompt = `${prompt} [CRITICAL PRODUCT CONSISTENCY: The product MUST be IDENTICAL to the product reference image - same exact product, same shape, same colors, same design, same packaging, same branding. DO NOT generate a different or modified product.] [Using avatar and product reference images to create natural compositions: person interacting with product, demonstrating features, showcasing in context. Professional product showcase with avatar, natural poses and expressions]${this.fullProductFramingPromptSuffix()}`;
    
    // Get scene-specific assets and enhance prompt
    const sceneAssets = analyzedAssets ? this.assetProcessor.getAssetsForScene(analyzedAssets, sceneNumber, 'AVATAR_PRODUCT') : [];
    const assetEnhancedPrompt = analyzedAssets ? this.assetProcessor.enhancePromptWithAssets(baseEnhancedPrompt, sceneAssets) : baseEnhancedPrompt;
    
    // Prepare reference images (avatar + product + assets)
    const assetReferenceImages = analyzedAssets ? this.assetProcessor.prepareReferenceImages(sceneAssets, sceneNumber) : [];
    const allReferenceImages = [avatarImageUrl, publicProductImageUrl, ...assetReferenceImages].filter(Boolean);
    
    const enhancedPrompt = assetEnhancedPrompt;

    // Determine aspect ratio
    const selectedAspectRatio = '9:16'; // Avatar-product uses full 9:16

    // Get model configuration
    // Default to model-4 (nano-banana-pro) for AVATAR_PRODUCT style (supports image-to-image)
    const selectedModelId = modelId || (project as any).defaultImageModel || 'model-4'; // Default to model-4 for product styles
    const model = this.modelRegistry.getModel(selectedModelId) || this.modelRegistry.getDefaultModelForStyle('AVATAR_PRODUCT');

    console.log(`[ImageGenerationProcessor] AVATAR_PRODUCT: Using ${model.displayName} (${model.platform}) for multi-reference image-to-image`);

    // Get provider
    const provider = this.providerFactory.getProviderForModel(model.id);

    // Build request with avatar, product, and asset images as reference for image-to-image
    const request: ImageGenerationRequest = {
      prompt: enhancedPrompt,
      modelId: model.id,
      aspectRatio: selectedAspectRatio,
      resolution: model.defaultConfig.resolution || '2K',
      numImages: model.defaultConfig.numImages || 1,
      outputFormat: (model.defaultConfig.outputFormat as 'png' | 'jpeg' | 'webp') || 'jpeg',
      referenceImages: allReferenceImages, // ✅ Multi-reference image-to-image with assets
    };

    // ✅ Enhanced logging for reference images
    console.log(`[ImageGenerationProcessor] ========== REFERENCE IMAGES ==========`);
    console.log(`[ImageGenerationProcessor] Avatar image URL:`, {
      url: avatarImageUrl,
      isValid: !!(avatarImageUrl && (avatarImageUrl.startsWith('http://') || avatarImageUrl.startsWith('https://'))),
      isNull: avatarImageUrl === null,
      isUndefined: avatarImageUrl === undefined,
      length: avatarImageUrl?.length || 0,
    });
    console.log(`[ImageGenerationProcessor] Product image URL:`, {
      url: publicProductImageUrl,
      isValid: !!(publicProductImageUrl && (publicProductImageUrl.startsWith('http://') || publicProductImageUrl.startsWith('https://'))),
      isNull: publicProductImageUrl === null,
      isUndefined: publicProductImageUrl === undefined,
      length: publicProductImageUrl?.length || 0,
    });
    console.log(`[ImageGenerationProcessor] Reference images array:`, {
      count: request.referenceImages?.length || 0,
      urls: request.referenceImages,
      allValid: request.referenceImages?.every(url => url && (url.startsWith('http://') || url.startsWith('https://'))) || false,
    });
    console.log(`[ImageGenerationProcessor] Request details:`, {
      modelId: model.id,
      modelPlatform: model.platform,
      modelDisplayName: model.displayName,
      aspectRatio: selectedAspectRatio,
      resolution: request.resolution,
    });

    // Validate request
    const validation = provider.validateRequest(request);
    if (!validation.valid) {
      console.error(`[ImageGenerationProcessor] ❌ Request validation failed:`, validation.error);
      throw new Error(validation.error || 'Invalid request');
    }
    console.log(`[ImageGenerationProcessor] ✅ Request validation passed`);

    await job.updateProgress(10);

    // Generate composite image using image-to-image
    let imageResponse;
    try {
      imageResponse = await provider.generateImage(
        request,
        (progress) => {
          const mappedProgress = 10 + (progress * 0.7); // 10% to 80%
          job.updateProgress(mappedProgress);
        }
      );
    } catch (error: any) {
      console.error(`[ImageGenerationProcessor] Image-to-image generation error:`, error);
      throw error;
    }

    await job.updateProgress(80);

    // Download and save generated composite image
    const userDir = path.join(this.uploadsDir, 'images', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const imageUrl = imageResponse.imageUrl;
    const imageFilename = `avatar_product_scene_${sceneNumber}_${projectId}_${Date.now()}.jpg`;
    const imagePath = path.join(userDir, imageFilename);
    await this.downloadImage(imageUrl, imagePath);

    await job.updateProgress(82);
    await this.maybeApplyLogoCornerOverlay(imagePath, analyzedAssets);

    await job.updateProgress(85);

    const localUrl = `/uploads/images/${userId}/${imageFilename}`;

    // NOTE: We intentionally do NOT upload to HeyGen here anymore.
    // Avatar IV (image_key) upload is now handled lazily in the video-generation
    // processor when we actually convert this composite into a video.

    await job.updateProgress(90);

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string = localUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        imagePath,
        `images/${userId}`,
        imageFilename,
        'image/jpeg'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
      if (gcsUrl) {
        console.log(`[ImageGenerationProcessor] ✅ AVATAR_PRODUCT image uploaded to GCS: ${gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[ImageGenerationProcessor] GCS upload failed for ${imageFilename}: ${error.message}`);
    }

    await job.updateProgress(93);

    // Update project with generated image data
    const latestProject = await this.databaseService.videoProject.findUnique({
      where: { id: projectId },
    });

    if (!latestProject) {
      throw new Error('Project not found');
    }

    const imageData = {
      sceneNumber,
      jobId: job.id!,
      imageUrl,
      localPath: imagePath,
      localUrl,
      gcsUrl,
      publicUrl,
      // heygenImageKey will be populated later by the video-generation processor
      prompt: enhancedPrompt,
      modelId: selectedModelId,
      model: model.displayName,
      generationMethod: 'image-to-image-multi-reference', // Mark as multi-reference image-to-image
      compositeType: 'avatar-product',
      avatarImageUrl,
      productImageUrl: publicProductImageUrl,
      source: 'ai-image', // Content source type for tracking
      contentType: 'image',
    };

    const bRollImages = ((latestProject as any).bRollImages as any[]) || [];
    const existingIndex = bRollImages.findIndex((img: any) => img.sceneNumber === sceneNumber);

    if (existingIndex >= 0) {
      bRollImages[existingIndex] = imageData;
    } else {
      bRollImages.push(imageData);
    }

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        bRollImages: bRollImages as any,
      } as any,
    });

    await job.updateProgress(100);

    console.log(
      `[ImageGenerationProcessor] Completed AVATAR_PRODUCT image-to-image for scene ${sceneNumber} (source: ai-image)`,
    );
    
    // Emit WebSocket event
    await this.jobStatusGateway.notifyJobStatus(userId, {
      jobId: job.id!,
      queueType: 'image-generation',
      state: 'completed',
      result: {
        image: imageData,
      },
      progress: 100,
    });
    this.userNotificationService
      .notifyProcessingEvent({
        userId,
        projectId,
        type: 'AVATAR_PREVIEW_READY',
        operation: 'avatar-preview-generation',
        status: 'completed',
        title: 'Avatar preview ready',
        message: `Avatar + product preview is ready for scene ${sceneNumber}.`,
        data: { sceneNumber, jobId: job.id, queueType: 'image-generation' },
      })
      .catch(() => {});

    return imageData;
  }

  private fullProductFramingPromptSuffix(): string {
    return ` [FULL PRODUCT IN FRAME: Entire physical product visible in the composition (full pack or object; primary label readable). Do NOT default to a tight crop of partial product. Do NOT invent occluded packaging, sides, or label text not present in the reference.]`;
  }

  private logoEligibleForCornerOverlay(logo: AnalyzedAsset | null | undefined): boolean {
    if (!logo || logo.category !== 'logo') return false;
    if (logo.suitableForTopRightBug === false) return false;
    if (logo.suitableForTopRightBug === true) return true;
    return logo.suitableForReferenceOverlay === true;
  }

  private async resolveAssetUrlForDownload(rawUrl: string): Promise<string | null> {
    if (!rawUrl) return null;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
    const localUrl = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
    const relativePath = localUrl.replace(/^\/uploads\/?/, '');
    const localPath = path.join(this.uploadsDir, relativePath);
    try {
      if (fs.existsSync(localPath)) {
        return await this.publicUrlService.getPublicUrl(localPath, localUrl);
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private async imageBufferHasUsefulAlpha(buf: Buffer): Promise<boolean> {
    try {
      const meta = await sharp(buf).metadata();
      return meta.hasAlpha === true && (meta.format === 'png' || meta.format === 'webp');
    } catch {
      return false;
    }
  }

  private runLogoRembg(inputPath: string, outputPath: string): boolean {
    const scriptPath = path.join(process.cwd(), 'scripts', 'remove_image_background.py');
    if (!fs.existsSync(scriptPath)) {
      console.warn(`[ImageGenerationProcessor] remove_image_background.py not found at ${scriptPath}`);
      return false;
    }
    try {
      execSync(`python3 "${scriptPath}" "${inputPath}" "${outputPath}" u2net`, {
        stdio: 'pipe',
        maxBuffer: 25 * 1024 * 1024,
        timeout: 120000,
      });
      return fs.existsSync(outputPath);
    } catch (e: any) {
      console.warn(`[ImageGenerationProcessor] Logo rembg failed: ${e?.message || e}`);
      return false;
    }
  }

  /**
   * Optional top-right logo overlay when analysis says the mark is suitable and alpha can be obtained.
   */
  private async maybeApplyLogoCornerOverlay(
    imagePath: string,
    analyzedAssets: AnalyzedAsset[] | undefined,
  ): Promise<void> {
    if (this.configService.get<string>('BROLL_STILL_LOGO_OVERLAY') !== 'true') {
      return;
    }
    if (!analyzedAssets?.length) return;
    const logo = this.assetProcessor.getLogoAsset(analyzedAssets);
    if (!this.logoEligibleForCornerOverlay(logo)) return;

    const rawUrl = logo!.originalAsset?.publicUrl ?? logo!.url ?? logo!.originalAsset?.url;
    if (!rawUrl) return;

    const fetchUrl = await this.resolveAssetUrlForDownload(rawUrl);
    if (!fetchUrl) return;

    let logoBuf: Buffer;
    try {
      const res = await axios.get(fetchUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 15 * 1024 * 1024,
      });
      logoBuf = Buffer.from(res.data);
    } catch (e: any) {
      console.warn(`[ImageGenerationProcessor] Logo download failed: ${e?.message}`);
      return;
    }

    const tmpDir = path.join(this.uploadsDir, 'temp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const ts = Date.now();
    const tmpIn = path.join(tmpDir, `logo_corner_in_${ts}.bin`);
    const tmpOut = path.join(tmpDir, `logo_corner_out_${ts}.png`);

    try {
      let logoPngBuf: Buffer | null = null;
      const hasAlpha = await this.imageBufferHasUsefulAlpha(logoBuf);
      if (hasAlpha) {
        logoPngBuf = await sharp(logoBuf).png().toBuffer();
      } else {
        fs.writeFileSync(tmpIn, logoBuf);
        const ok = this.runLogoRembg(tmpIn, tmpOut);
        if (ok) {
          logoPngBuf = fs.readFileSync(tmpOut);
        }
      }
      if (!logoPngBuf || logoPngBuf.length < 32) return;

      const baseMeta = await sharp(imagePath).metadata();
      const W = baseMeta.width || 1080;
      const H = baseMeta.height || 1920;
      const maxW = Math.max(48, Math.round(W * 0.11));
      const margin = Math.max(8, Math.round(W * 0.025));

      const resizedLogo = await sharp(logoPngBuf)
        .resize({ width: maxW, height: Math.round(maxW * 2.5), fit: 'inside' })
        .png()
        .toBuffer();
      const lm = await sharp(resizedLogo).metadata();
      const lw = lm.width || maxW;
      const lh = lm.height || maxW;
      const left = W - lw - margin;
      const top = margin;
      if (left < 0 || top < 0 || lw > W || lh > H) return;

      const outBuf = await sharp(imagePath)
        .composite([{ input: resizedLogo, left, top }])
        .jpeg({ quality: 95 })
        .toBuffer();
      fs.writeFileSync(imagePath, outBuf);
      console.log(`[ImageGenerationProcessor] Applied gated corner logo overlay`);
    } catch (e: any) {
      console.warn(`[ImageGenerationProcessor] Logo corner overlay skipped: ${e?.message}`);
    } finally {
      for (const p of [tmpIn, tmpOut]) {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * Extract analyzed assets from project metadata
   */
  private extractAnalyzedAssets(project: any): AnalyzedAsset[] | undefined {
    try {
      const metadata = project.metadata as any;
      const analyzedAssets = metadata?.analyzedAssets;
      
      if (analyzedAssets && Array.isArray(analyzedAssets) && analyzedAssets.length > 0) {
        return analyzedAssets.map((asset: any) => ({
          id: asset.originalAsset?.id || asset.id,
          category: asset.category,
          extractedText: asset.extractedText,
          productInfo: asset.productInfo,
          url: asset.originalAsset?.publicUrl || asset.originalAsset?.url || asset.url,
          originalAsset: asset.originalAsset,
          visualScriptContext:
            typeof asset.visualScriptContext === 'string' ? asset.visualScriptContext : undefined,
          suitableForReferenceOverlay:
            typeof asset.suitableForReferenceOverlay === 'boolean' ? asset.suitableForReferenceOverlay : undefined,
          suitableForTopRightBug:
            typeof asset.suitableForTopRightBug === 'boolean' ? asset.suitableForTopRightBug : undefined,
        }));
      }
      
      return undefined;
    } catch (error: any) {
      console.warn(`[ImageGenerationProcessor] Failed to extract analyzed assets: ${error.message}`);
      return undefined;
    }
  }

  /**
   * Resolve analyzed asset URLs to public URLs when they are stored as relative or /uploads/ paths,
   * so providers (BytePlus, FAL, etc.) can access them. Order: product(s) first, then logo, then rest (same as buildReferenceImagesInOrder).
   */
  private async resolveReferenceUrlsToPublic(analyzedAssets: AnalyzedAsset[], maxRefs: number = 6): Promise<string[]> {
    const productAssets = this.assetProcessor.getProductAssets(analyzedAssets);
    const logoAssets = analyzedAssets.filter(a => a.category === 'logo');
    const restAssets = analyzedAssets.filter(a => a.category !== 'product' && a.category !== 'logo');
    const orderedAssets = [...productAssets, ...logoAssets, ...restAssets].slice(0, maxRefs);
    const resolved: string[] = [];
    for (const asset of orderedAssets) {
      const url = asset.originalAsset?.publicUrl ?? asset.url ?? asset.originalAsset?.url;
      if (!url) continue;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        resolved.push(url);
        continue;
      }
      const localUrl = url.startsWith('/') ? url : `/${url}`;
      const relativePath = localUrl.replace(/^\/uploads\/?/, '');
      const localPath = path.join(this.uploadsDir, relativePath);
      try {
        if (fs.existsSync(localPath)) {
          const publicUrl = await this.publicUrlService.getPublicUrl(localPath, localUrl);
          resolved.push(publicUrl);
        }
      } catch (err: any) {
        console.warn(`[ImageGenerationProcessor] Could not resolve reference URL to public: ${localUrl}`, err?.message);
      }
    }
    return resolved;
  }

  /**
   * Process default style (existing logic)
   */
  private async processDefaultStyle(
    job: Job<ImageGenerationJobData>,
    project: any,
    sceneNumber: number,
    prompt: string,
    modelId: string | undefined,
    aspectRatio: string | undefined,
    resolution: string | undefined,
    userId: string,
    analyzedAssets?: AnalyzedAsset[],
    referenceImages?: string[]
  ): Promise<any> {
    // Determine aspect ratio from video style
    let finalAspectRatio: string = '9:16'; // Default
    if (project.style === 'HALF_N_HALF') {
      finalAspectRatio = '3:4';
    } else if (project.style === 'AVATAR_CUTOUT') {
      finalAspectRatio = '9:16';
    } else if (project.style === 'ALTERNATE') {
      // ALTERNATE b-roll scenes use full 9:16 (avatar scenes don't generate b-roll images)
      finalAspectRatio = '9:16';
      console.log(`[ImageGenerationProcessor] ALTERNATE style: Scene ${sceneNumber} using aspect ratio ${finalAspectRatio}`);
    }

    // Use provided aspect ratio or default from video style
    const selectedAspectRatio = aspectRatio || finalAspectRatio;

    const hasReferenceAssets = referenceImages && referenceImages.length > 0;
    // Use model-4 (nano-banana-pro) when we have asset references – same as AVATAR_PRODUCT/PRODUCT_ONLY; use model-1 (imagen4) when no assets (text-to-image).
    let selectedModelId: string;
    if (hasReferenceAssets) {
      selectedModelId = 'model-4'; // FAL nano-banana-pro: multi-reference image-to-image for all styles
    } else {
      selectedModelId = modelId || (project as any).defaultImageModel || 'model-1'; // No assets: text-to-image with model-1 (imagen4)
    }
    const model = this.modelRegistry.getModel(selectedModelId) || this.modelRegistry.getDefaultModelForStyle(project.style);

    console.log(`[ImageGenerationProcessor] Scene ${sceneNumber}: Style=${project.style}, Model=${model.displayName}, AspectRatio=${selectedAspectRatio}, refImages=${referenceImages?.length ?? 0}`);

    const provider = this.providerFactory.getProviderForModel(model.id);

    let finalPrompt = prompt;
    // Safety net: prepend video topic context so every scene keeps global theme (e.g. work from home)
    try {
      const script = typeof project.script === 'string' ? JSON.parse(project.script) : project.script;
      const videoTopic = script?.video_topic || script?.theme_context;
      if (videoTopic && typeof videoTopic === 'string' && videoTopic.trim()) {
        const topic = videoTopic.trim();
        if (!finalPrompt.includes('[Video topic:') && !finalPrompt.includes('[Video context:')) {
          finalPrompt = `[Video context: ${topic}. ] ${finalPrompt}`;
        }
      }
    } catch {
      // ignore script parse errors
    }
    // Prepend photorealism for b-roll images if not already present (safety net for script prompts that lack it)
    // Skip photorealism for topics that warrant stylized/artistic visuals (space, sci-fi, fantasy, abstract)
    const lowerPrompt = finalPrompt.toLowerCase();
    const stylizedTopicKeywords = ['space', 'sci-fi', 'science fiction', 'fantasy', 'galaxy', 'alien', 'abstract art', 'cosmic', 'surreal'];
    const isStylizedTopic = stylizedTopicKeywords.some((kw) => lowerPrompt.includes(kw));
    const PHOTOREALISM_PREFIX = 'Photorealistic, documentary photograph, real-world, ';
    if (!isStylizedTopic && !lowerPrompt.includes('photorealistic') && !lowerPrompt.includes('documentary')) {
      finalPrompt = PHOTOREALISM_PREFIX + finalPrompt;
    }
    finalPrompt = finalPrompt.includes('[COMPOSITION:')
      ? finalPrompt
      : `[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images, NO split-screen] ${finalPrompt}`;

    if (analyzedAssets && analyzedAssets.length > 0) {
      const sceneAssets = this.assetProcessor.getAssetsForScene(analyzedAssets, sceneNumber, project.style || 'HALF_N_HALF');
      finalPrompt = this.assetProcessor.enhancePromptWithAssets(finalPrompt, sceneAssets);
    }

    // When using reference images, add semantic instructions (by role: product/logo reference image) so the model finds the right ref
    if (hasReferenceAssets) {
      const hasProduct = analyzedAssets?.some(a => a.category === 'product');
      const hasReferenceCategory = analyzedAssets?.some(a => a.category === 'reference');
      const hasLogo = analyzedAssets?.some(a => a.category === 'logo');
      const refInstructions: string[] = [];
      refInstructions.push(
        'REFERENCE HERO IDENTITY: Any main product, garment, or wearable in the scene MUST be the SAME physical item as in the primary reference image(s). Do not replace it with a different design, color, cut, or style described only in marketing text — follow the reference pixels.',
      );
      if (hasProduct) {
        refInstructions.push('CRITICAL PRODUCT CONSISTENCY: The product in this image MUST be IDENTICAL to the product in the reference image. DO NOT change, modify, redesign, or reimagine the product.');
        refInstructions.push('Product aspects that MUST remain EXACTLY the same: shape, form, size, colors, materials, textures, labels, logos, branding, packaging, and ALL visual details.');
        refInstructions.push('You may ONLY change: camera angle, lighting, background/environment, staging. The product MUST look like the EXACT SAME physical item.');
        refInstructions.push('DO NOT: generate a similar product, create a styled version, add/remove features, change colors, alter packaging, or modify branding.');
      } else if (hasReferenceCategory) {
        refInstructions.push(
          'The hero object or outfit in the reference image (e.g. apparel on model) must stay visually identical; you may only change environment, pose within reason, lighting, and camera — not a different garment or product.',
        );
      } else {
        refInstructions.push(
          'Match the subject, product, and style from the reference image(s) where applicable; only change angle, lighting, or background as needed.',
        );
      }
      // DISABLED: Scene-basis logo integration
      // if (hasLogo) {
      //   refInstructions.push('Use the logo from the logo reference image. Place it naturally in the scene (e.g. on the product, packaging, or as a subtle lower-third). Do not redraw or recreate the logo – use the exact logo from the logo reference image. Spell the brand name exactly as in the reference logo; do not add or change letters.');
      // }
      if (refInstructions.length > 0) {
        finalPrompt = `${finalPrompt}\n\n${refInstructions.join(' ')}`;
      }
    }

    if (hasReferenceAssets) {
      console.log(
        `[ImageGenerationProcessor] scene ${sceneNumber} finalBrollPrompt len=${finalPrompt.length} preview=${JSON.stringify(finalPrompt.slice(0, 420))}…`,
      );
    }

    const request: ImageGenerationRequest = {
      prompt: finalPrompt,
      modelId: model.id,
      aspectRatio: selectedAspectRatio,
      resolution: resolution || model.defaultConfig.resolution || '2K',
      numImages: model.defaultConfig.numImages || 1,
      outputFormat: (model.defaultConfig.outputFormat as 'png' | 'jpeg' | 'webp') || 'png',
      referenceImages: hasReferenceAssets ? referenceImages : undefined,
    };

    // Validate request
    const validation = provider.validateRequest(request);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid request');
    }

    // Create user-specific directory for images
    const userDir = path.join(this.uploadsDir, 'images', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    await job.updateProgress(10);

    // Generate image using unified interface
    let imageResponse;
    try {
      imageResponse = await provider.generateImage(
        request,
        (progress) => {
          // Map provider progress (0-100) to job progress (10-90)
          const mappedProgress = 10 + (progress * 0.8);
          job.updateProgress(mappedProgress);
        }
      );
    } catch (error) {
      // Handle FAL-specific errors
      if (error instanceof FalProviderError) {
        console.error(`[ImageGenerationProcessor] FAL error for job ${job.id}:`, {
          type: error.type,
          statusCode: error.statusCode,
          retryable: error.isRetryable(),
          message: error.getUserMessage(),
        });

        // If retryable and we haven't exceeded max attempts, let BullMQ retry
        if (error.isRetryable() && (job.attemptsMade || 0) < 3) {
          throw error;
        }

        // Non-retryable or max attempts reached - fail the job
        throw new Error(`Image generation failed: ${error.getUserMessage()}`);
      }

      // Re-throw other errors
      throw error;
    }

    await job.updateProgress(90);

    // Download image (works for all providers - they all return URLs)
    const imageUrl = imageResponse.imageUrl;
    const imageFilename = `scene_${sceneNumber}_${project.id}_${Date.now()}.jpg`;
    const imagePath = path.join(userDir, imageFilename);

    await this.downloadImage(imageUrl, imagePath);

    await job.updateProgress(93);

    const localUrl = `/uploads/images/${userId}/${imageFilename}`;

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string = localUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        imagePath,
        `images/${userId}`,
        imageFilename,
        'image/jpeg'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
      if (gcsUrl) {
        console.log(`[ImageGenerationProcessor] ✅ Image uploaded to GCS: ${gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[ImageGenerationProcessor] GCS upload failed for ${imageFilename}: ${error.message}`);
    }

    await job.updateProgress(95);

    // CRITICAL: Re-fetch project data right before updating to avoid race conditions
    // Multiple workers may be updating concurrently, so we need the latest state
    const latestProject = await this.databaseService.videoProject.findUnique({
      where: { id: project.id },
    });

    if (!latestProject) {
      throw new Error('Project not found');
    }

    const imageData = {
      sceneNumber,
      jobId: job.id!, // Include jobId for unique identification
      imageUrl,
      localPath: imagePath,
      localUrl,
      gcsUrl,
      publicUrl,
      prompt,
      modelId: selectedModelId, // Store which model was used
      model: model.displayName, // Store display name
      source: 'ai-image', // Content source type for tracking
      contentType: 'image',
    };

    // Get latest bRollImages array from database to avoid race conditions
    const bRollImages = ((latestProject as any).bRollImages as any[]) || [];
    const existingIndex = bRollImages.findIndex((img: any) => img.sceneNumber === sceneNumber);

    if (existingIndex >= 0) {
      bRollImages[existingIndex] = imageData;
    } else {
      bRollImages.push(imageData);
    }

    // Atomic update with latest data
    await this.databaseService.videoProject.update({
      where: { id: project.id },
      data: {
        bRollImages: bRollImages as any,
      } as any,
    });

    await job.updateProgress(100);

    console.log(`[ImageGenerationProcessor] Completed job ${job.id} for scene ${sceneNumber} (source: ai-image)`);
    console.log(`[ImageGenerationProcessor] 📤 Sending WebSocket update - Scene: ${sceneNumber}, JobId: ${job.id}, LocalUrl: ${localUrl}, LocalPath: ${imagePath}`);
    
    // Emit WebSocket event for job completion
    await this.jobStatusGateway.notifyJobStatus(userId, {
      jobId: job.id!,
      state: 'completed',
      progress: 100,
      result: {
        image: imageData,
      },
      queueType: 'image-generation',
    });
    this.userNotificationService
      .notifyProcessingEvent({
        userId,
        projectId: project.id,
        type: 'BROLL_IMAGE_READY',
        operation: 'image-generation',
        status: 'completed',
        title: 'B-roll image ready',
        message: `Scene ${sceneNumber} image was generated successfully.`,
        data: { sceneNumber, jobId: job.id, queueType: 'image-generation' },
      })
      .catch(() => {});
    
    return imageData;
  }

  /**
   * Download image from URL (works for all providers)
   */
  private async downloadImage(imageUrl: string, outputPath: string): Promise<string> {
    try {
      console.log(`[ImageGenerationProcessor] Downloading image from ${imageUrl} to ${outputPath}`);

      const response = await axios.get(imageUrl, {
        responseType: 'stream',
        timeout: 60000,
      });

      const writer = fs.createWriteStream(outputPath);

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`[ImageGenerationProcessor] Image downloaded successfully to ${outputPath}`);
          resolve(outputPath);
        });
        writer.on('error', (err) => {
          writer.destroy();
          reject(err);
        });
        // Handle response stream errors (EPIPE, connection closed, etc.)
        response.data.on('error', (err) => {
          writer.destroy();
          reject(err);
        });
      });
    } catch (error: any) {
      console.error(`[ImageGenerationProcessor] Failed to download image:`, error.message);
      throw new Error(`Failed to download image: ${error.message}`);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`[ImageGenerationProcessor] Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`[ImageGenerationProcessor] Job ${job.id} failed:`, error.message);
  }
}

