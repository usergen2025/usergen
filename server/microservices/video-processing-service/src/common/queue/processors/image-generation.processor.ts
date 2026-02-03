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
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';

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

    console.log(`[ImageGenerationProcessor] Processing job ${job.id} for scene ${sceneNumber}, model: ${modelId || 'default'}, style: ${videoStyle || 'default'}`);

    try {
      // Get project to determine video style
      const project = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      const style = videoStyle || project.style;

      // Handle AVATAR_PRODUCT style - create composite images
      if (style === 'AVATAR_PRODUCT') {
        return await this.processAvatarProductStyle(
          job,
          project,
          sceneNumber,
          prompt,
          productImageUrl,
          avatarImageKey,
          modelId,
          userId,
          projectId
        );
      }

      // Handle PRODUCT_ONLY style - use product image in generation
      if (style === 'PRODUCT_ONLY') {
        if (!productImageUrl) {
          throw new Error('Product image URL is required for PRODUCT_ONLY style. Please ensure product image is uploaded in assets.');
        }
        return await this.processProductOnlyStyle(
          job,
          project,
          sceneNumber,
          prompt,
          productImageUrl,
          modelId,
          aspectRatio,
          resolution,
          userId
        );
      }

      // Default processing for other styles
      return await this.processDefaultStyle(
        job,
        project,
        sceneNumber,
        prompt,
        modelId,
        aspectRatio,
        resolution,
        userId
      );
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

      throw error;
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
    userId: string
  ): Promise<any> {
    console.log(`[ImageGenerationProcessor] Processing PRODUCT_ONLY style for scene ${sceneNumber}`);

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

    // Enhance prompt with product image context for reference image generation
    // Add anti-grid instruction to prevent collage/grid layouts
    const enhancedPrompt = `${prompt} [COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images, NO split-screen, NO tiled layout] [Using product reference image to create variations: different angles, lighting, contexts, and compositions. CRITICAL: NO human, NO avatar, NO person in image. Focus entirely on the product, showcase product features and benefits. Generate ONE single image, not a collection or grid of images]`;

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

    // Build request with product image as reference for image-to-image generation
    const request: ImageGenerationRequest = {
      prompt: enhancedPrompt,
      modelId: model.id,
      aspectRatio: selectedAspectRatio,
      resolution: resolution || model.defaultConfig.resolution || '2K',
      numImages: model.defaultConfig.numImages || 1,
      outputFormat: (model.defaultConfig.outputFormat as 'png' | 'jpeg' | 'webp') || 'jpeg',
      referenceImages: [publicProductImageUrl], // ✅ Use image-to-image with product as reference
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
      generationMethod: 'image-to-image', // Mark as image-to-image generation
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

    console.log(`[ImageGenerationProcessor] Completed PRODUCT_ONLY job ${job.id} for scene ${sceneNumber} using image-to-image`);
    
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

    return imageData;
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
    projectId: string
  ): Promise<any> {
    console.log(`[ImageGenerationProcessor] Processing AVATAR_PRODUCT style for scene ${sceneNumber} using image-to-image`);

    if (!productImageUrl) {
      throw new Error('Product image URL is required for AVATAR_PRODUCT style');
    }

    // Extract avatarId from project metadata
    const projectMetadata = (project as any).metadata || {};
    const avatarId = projectMetadata.avatarId || projectMetadata.selectedAvatarId;

    if (!avatarId && !avatarImageKey) {
      throw new Error('Avatar ID is required for AVATAR_PRODUCT style');
    }

    // Get avatar original image path
    // Path format: uploads/avatars/{userId}/{avatarId}/original.jpg
    let avatarImagePath: string | null = null;
    let avatarImageUrl: string | null = null;

    if (avatarId) {
      avatarImagePath = path.join(
        process.cwd(),
        'uploads',
        'avatars',
        userId,
        avatarId,
        'original.jpg'
      );

      // Try alternative paths
      if (!fs.existsSync(avatarImagePath)) {
        const altPaths = [
          path.join(this.uploadsDir, 'avatars', userId, avatarId, 'original.jpg'),
          path.join(process.cwd(), 'microservices', 'ai-content-service', 'uploads', 'avatars', userId, avatarId, 'original.jpg'),
        ];

        for (const altPath of altPaths) {
          if (fs.existsSync(altPath)) {
            avatarImagePath = altPath;
            break;
          }
        }
      }

      if (!fs.existsSync(avatarImagePath)) {
        throw new Error(`Avatar original image not found for avatarId: ${avatarId}`);
      }

      // Get public URL for avatar image
      const avatarLocalUrl = `/uploads/avatars/${userId}/${avatarId}/original.jpg`;
      avatarImageUrl = await this.publicUrlService.getPublicUrl(avatarImagePath, avatarLocalUrl);
    } else {
      throw new Error('Avatar image path could not be determined');
    }

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
      throw new Error('Product image URL is required for AVATAR_PRODUCT style');
    }

    // Enhanced prompt for avatar-product generation with reference images
    const enhancedPrompt = `${prompt} [Using avatar and product reference images to create natural compositions: person interacting with product, demonstrating features, showcasing in context. Professional product showcase with avatar, natural poses and expressions]`;

    // Determine aspect ratio
    const selectedAspectRatio = '9:16'; // Avatar-product uses full 9:16

    // Get model configuration
    // Default to model-4 (nano-banana-pro) for AVATAR_PRODUCT style (supports image-to-image)
    const selectedModelId = modelId || (project as any).defaultImageModel || 'model-4'; // Default to model-4 for product styles
    const model = this.modelRegistry.getModel(selectedModelId) || this.modelRegistry.getDefaultModelForStyle('AVATAR_PRODUCT');

    console.log(`[ImageGenerationProcessor] AVATAR_PRODUCT: Using ${model.displayName} (${model.platform}) for multi-reference image-to-image`);

    // Get provider
    const provider = this.providerFactory.getProviderForModel(model.id);

    // Build request with both avatar and product as reference images for image-to-image
    const request: ImageGenerationRequest = {
      prompt: enhancedPrompt,
      modelId: model.id,
      aspectRatio: selectedAspectRatio,
      resolution: model.defaultConfig.resolution || '2K',
      numImages: model.defaultConfig.numImages || 1,
      outputFormat: (model.defaultConfig.outputFormat as 'png' | 'jpeg' | 'webp') || 'jpeg',
      referenceImages: [avatarImageUrl, publicProductImageUrl], // ✅ Multi-reference image-to-image
    };

    // Validate request
    const validation = provider.validateRequest(request);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid request');
    }

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

    await job.updateProgress(85);

    const localUrl = `/uploads/images/${userId}/${imageFilename}`;

    // Upload to HeyGen to get image_key for Avatar IV generation
    console.log(`[ImageGenerationProcessor] Uploading generated composite to HeyGen for Avatar IV...`);
    let heygenImageKey: string | undefined = undefined;
    try {
      // Read the generated image file
      const imageBuffer = fs.readFileSync(imagePath);
      
      // Upload to HeyGen
      const heygenApiKey = this.configService.get<string>('HEYGEN_API_KEY') || '';
      
      if (heygenApiKey) {
        const formData = new FormData();
        formData.append('file', imageBuffer, {
          filename: imageFilename,
          contentType: 'image/jpeg',
        });

        const uploadResponse = await axios.post(
          'https://upload.heygen.com/v1/asset',
          formData,
          {
            headers: {
              'X-Api-Key': heygenApiKey,
              ...formData.getHeaders(),
            },
            timeout: 60000,
          }
        );

        const uploadData = uploadResponse.data.code !== undefined ? uploadResponse.data.data : (uploadResponse.data as any);
        
        if (uploadData?.image_key) {
          heygenImageKey = uploadData.image_key;
          console.log(`[ImageGenerationProcessor] ✅ Composite uploaded to HeyGen. Image key: ${heygenImageKey}`);
        } else {
          console.warn(`[ImageGenerationProcessor] HeyGen upload succeeded but no image_key returned`);
        }
      } else {
        console.warn(`[ImageGenerationProcessor] HeyGen API key not configured, skipping upload`);
      }
    } catch (error: any) {
      console.error(`[ImageGenerationProcessor] Failed to upload to HeyGen: ${error.message}`);
      // Continue without HeyGen image_key - video generation will use standard method
    }

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
      heygenImageKey: heygenImageKey || undefined, // Store for Avatar IV generation
      prompt: enhancedPrompt,
      modelId: selectedModelId,
      model: model.displayName,
      generationMethod: 'image-to-image-multi-reference', // Mark as multi-reference image-to-image
      compositeType: 'avatar-product',
      avatarImageUrl,
      productImageUrl: publicProductImageUrl,
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

    console.log(`[ImageGenerationProcessor] Completed AVATAR_PRODUCT image-to-image for scene ${sceneNumber}${heygenImageKey ? `, image_key: ${heygenImageKey}` : ''}`);
    
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

    return imageData;
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
    userId: string
  ): Promise<any> {
    // Determine aspect ratio from video style
    let finalAspectRatio: string = '9:16'; // Default
    if (project.style === 'HALF_N_HALF') {
      finalAspectRatio = '3:4';
    } else if (project.style === 'AVATAR_CUTOUT') {
      finalAspectRatio = '9:16';
    } else if (project.style === 'ALTERNATE') {
      // For ALTERNATE style: odd scenes use 9:16 (full b-roll), even scenes use 3:4 (top half for half-n-half)
      finalAspectRatio = (sceneNumber % 2 === 1) ? '9:16' : '3:4';
      console.log(`[ImageGenerationProcessor] ALTERNATE style: Scene ${sceneNumber} is ${sceneNumber % 2 === 1 ? 'odd' : 'even'}, using aspect ratio ${finalAspectRatio}`);
    }

    // Use provided aspect ratio or default from video style
    const selectedAspectRatio = aspectRatio || finalAspectRatio;

    // Get model configuration (from job or project default or system default)
    // Default to model-1 (imagen4) for non-product styles
    const selectedModelId = modelId || (project as any).defaultImageModel || 'model-1';
    const model = this.modelRegistry.getModel(selectedModelId) || this.modelRegistry.getDefaultModel();

    console.log(`[ImageGenerationProcessor] Scene ${sceneNumber}: Style=${project.style}, Model=${model.displayName}, AspectRatio=${selectedAspectRatio}`);

    // Get provider for this model
    const provider = this.providerFactory.getProviderForModel(model.id);

    // Enhance prompt with anti-grid instruction to prevent collage/grid layouts
    const enhancedPrompt = prompt.includes('[COMPOSITION:') 
      ? prompt 
      : `[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images, NO split-screen] ${prompt}`;

    // Build unified request
    const request: ImageGenerationRequest = {
      prompt: enhancedPrompt,
      modelId: model.id,
      aspectRatio: selectedAspectRatio,
      resolution: resolution || model.defaultConfig.resolution || '2K',
      numImages: model.defaultConfig.numImages || 1,
      outputFormat: (model.defaultConfig.outputFormat as 'png' | 'jpeg' | 'webp') || 'png',
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

    console.log(`[ImageGenerationProcessor] Completed job ${job.id} for scene ${sceneNumber}`);
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

