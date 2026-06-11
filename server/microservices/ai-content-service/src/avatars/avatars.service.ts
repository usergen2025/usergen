import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../common/database/database.service';
import { LoggerService } from '../common/logger/logger.service';
import { PublicUrlService } from '../common/storage/public-url.service';
import { HeyGenProvider } from './providers/heygen.provider';
import { BytePlusImageProvider } from './providers/byteplus-image.provider';
import { FalImageProvider } from './providers/fal-image.provider';
import { AvatarQueueService } from './queue/avatar-queue.service';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import axios from 'axios';
import sharp from 'sharp';

export interface UploadImageDto {
  imageBuffer: Buffer;
  contentType: 'image/jpeg' | 'image/png';
  filename?: string;
}

export interface CreateAvatarFromUploadDto {
  userId: string;
  imageKey: string;
  assetId?: string; // Asset ID from upload (used as generation_id)
  name?: string;
  description?: string;
  originalImageUrl?: string; // Local URL for the uploaded image
}

/**
 * Normalize video style to backend format (UPPER_SNAKE_CASE).
 * Handles both frontend format ('avatar-cutout') and backend format ('AVATAR_CUTOUT').
 */
function normalizeStyleToBackend(style?: string): string | undefined {
  if (!style) return undefined;
  
  // Style mapping from frontend (kebab-case) to backend (UPPER_SNAKE_CASE)
  const styleMap: Record<string, string> = {
    'half-n-half': 'HALF_N_HALF',
    'alternate': 'ALTERNATE',
    'avatar-cutout': 'AVATAR_CUTOUT',
    'avatar-only': 'AVATAR_ONLY',
    'product-only': 'PRODUCT_ONLY',
    'avatar-product': 'AVATAR_PRODUCT',
    'animated-avatar': 'ANIMATED_AVATAR',
    'broll-only': 'B_ROLL_ONLY',
  };
  
  // If it's already in backend format (uppercase with underscores), return as-is
  if (style === style.toUpperCase() && style.includes('_')) {
    return style;
  }
  
  // Convert from frontend format
  return styleMap[style.toLowerCase()] || style.toUpperCase().replace(/-/g, '_');
}

/** Preset pose/framing prompts only (no lighting/background). */
const PRESET_POSE_PROMPTS: Record<string, string> = {
  'front-facing': 'Front-facing waist-up portrait, person looking directly at camera, professional video look, simple talking-to-camera style',
  'wide-angle-front': 'Wide-angle front shot, natural creator look, person facing camera, casual professional aesthetic',
  'standing-with-mic': 'Person standing with microphone, presenter stage vibe, front-facing',
  'side-camera-angle': 'Person at slight angle to camera, cinematic conversational feel',
  'podcast-setup': 'Person seated at desk with microphone and headphones, studio look',
};

/** Fixed indoor/studio backgrounds per preset — never b-roll locations. */
const PRESET_BACKGROUND_PROMPTS: Record<string, string> = {
  'front-facing': 'neutral soft gray studio backdrop, indoor, no outdoor elements',
  'wide-angle-front': 'clean minimal creator studio background, soft gradient wall',
  'standing-with-mic':
    'indoor presentation stage or neutral studio wall, professional microphone visible, no audience, no street, no windows to city',
  'side-camera-angle': 'neutral indoor studio, shallow depth, plain backdrop',
  'podcast-setup':
    'indoor podcast studio, desk, broadcast microphone, headphones, acoustic panels or bookshelf blur, no outdoor scenery, no market, no traffic',
};

const AVATAR_PLATE_STUDIO_SUFFIX =
  ', avatar plate background must be studio or indoor only, no outdoor street scene, no crowd';

const INDIAN_APPEARANCE_MENTIONED =
  /\b(indian|south\s*asian|desi|brown\s*skin|hindi|punjabi|bengali|tamil|telugu|marathi|gujarati|north\s*indian|south\s*indian)\b/i;

/** Strip location-heavy mood phrases from style guide before using on avatar lighting. */
const LOCATION_MOOD_PATTERN =
  /\b(street|market|outdoor|cityscape|traffic|festival|crowd|bustling|urban\s+street|indian\s+street|road|highway|village\s+lane)\b/gi;

@Injectable()
export class AvatarsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
    private readonly publicUrlService: PublicUrlService,
    private readonly heygenProvider: HeyGenProvider,
    private readonly bytePlusImageProvider: BytePlusImageProvider,
    private readonly falImageProvider: FalImageProvider,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AvatarQueueService))
    private readonly avatarQueueService: AvatarQueueService,
  ) {}

  /**
   * Upload image to HeyGen and get image_key
   */
  async uploadImageToHeyGen(dto: UploadImageDto & { localFilePath?: string; userId?: string }): Promise<{ imageKey: string; assetId: string; localUrl?: string }> {
    try {
      this.logger.log(`Uploading image to HeyGen for user`, 'AvatarsService');

      const uploadResponse = await this.heygenProvider.uploadImage(
        dto.imageBuffer,
        dto.contentType,
        dto.filename
      );

      if (!uploadResponse.image_key) {
        throw new BadRequestException('Failed to get image_key from HeyGen upload');
      }

      this.logger.log(`Image uploaded successfully. Image key: ${uploadResponse.image_key}`, 'AvatarsService');

      const result: { imageKey: string; assetId: string; localUrl?: string } = {
        imageKey: uploadResponse.image_key,
        assetId: uploadResponse.id,
      };

      // If local file was saved, return the local URL
      if (dto.localFilePath && dto.userId) {
        const pathParts = dto.localFilePath.split(/[/\\]/);
        const fileName = pathParts[pathParts.length - 1];
        result.localUrl = `/uploads/avatars/${dto.userId}/${fileName}`;
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Image upload to HeyGen failed: ${error.message}`, error.stack, 'AvatarsService');
      throw error;
    }
  }

  /**
   * Create avatar from uploaded image (starts background process)
   */
  async createAvatarFromUpload(dto: CreateAvatarFromUploadDto): Promise<{ avatarId: string; jobId: string }> {
    try {
      this.logger.log(`Creating avatar from upload for user ${dto.userId}`, 'AvatarsService');

      // Get original image buffer for processing
      let imageBuffer: Buffer | null = null;
      let originalImagePath: string | null = null;
      
      if (dto.originalImageUrl) {
        // Try to read from local file path
        try {
          // originalImageUrl format: /uploads/avatars/{userId}/{filename}
          // OR new format: /uploads/avatars/{userId}/{avatarId}/{filename}
          const urlMatch = dto.originalImageUrl.match(/\/uploads\/avatars\/([^\/]+)\/(.+)$/);
          
          if (urlMatch) {
            const [, urlUserId, filename] = urlMatch;
            
            // Try multiple possible locations for uploads directory
            const uploadsBasePaths = [
              path.join(process.cwd(), 'uploads', 'avatars', urlUserId, filename), // Primary location
              path.join(process.cwd(), 'microservices', 'ai-content-service', 'uploads', 'avatars', urlUserId, filename),
              path.join(process.cwd(), '..', '..', 'uploads', 'avatars', urlUserId, filename),
              path.join(process.cwd(), '..', 'uploads', 'avatars', urlUserId, filename),
            ];
            
            for (const filePath of uploadsBasePaths) {
              if (fs.existsSync(filePath)) {
                imageBuffer = fs.readFileSync(filePath);
                originalImagePath = filePath;
                this.logger.log(`Read image buffer from: ${filePath}`, 'AvatarsService');
                break;
              }
            }
            
            if (!imageBuffer) {
              this.logger.warn(`Image file not found. Tried paths: ${uploadsBasePaths.join(', ')}`, 'AvatarsService');
            }
          } else {
            // Try direct path if URL format doesn't match
            const directPath = dto.originalImageUrl.startsWith('/') 
              ? dto.originalImageUrl.slice(1)
              : dto.originalImageUrl;
            
            const possiblePaths = [
              path.join(process.cwd(), directPath),
              path.join(process.cwd(), 'microservices', 'ai-content-service', directPath),
              path.join(process.cwd(), '..', '..', directPath),
              directPath,
            ];
            
            for (const possiblePath of possiblePaths) {
              if (fs.existsSync(possiblePath)) {
                imageBuffer = fs.readFileSync(possiblePath);
                originalImagePath = possiblePath;
                this.logger.log(`Read image buffer from: ${possiblePath}`, 'AvatarsService');
                break;
              }
            }
          }
        } catch (error: any) {
          this.logger.warn(`Failed to read image from local path: ${error.message}`, 'AvatarsService');
        }
      }

      // If we couldn't get buffer from local file, log warning but continue
      // Image processing will be skipped for this avatar (will use default imageKey)
      if (!imageBuffer) {
        this.logger.warn(`Image buffer not available for avatar ${dto.userId}, image processing will be skipped. originalImageUrl: ${dto.originalImageUrl}`, 'AvatarsService');
      }

      // Create avatar record first (avatarId will be available after this)
      const avatar = await this.databaseService.avatar.create({
        data: {
          userId: dto.userId,
          name: `Avatar_${dto.userId}_temp`, // Temporary name, will be updated below
          description: dto.description,
          source: 'UPLOAD',
          provider: 'heygen',
          imageKey: dto.imageKey,
          originalImageUrl: dto.originalImageUrl, // Save local image URL
          generationStatus: 'PENDING',
          generationMetadata: dto.assetId ? { assetId: dto.assetId } : undefined, // Store assetId in metadata
        },
      });

      // Update name with actual format: Avatar_{userId}_{avatarId}
      await this.databaseService.avatar.update({
        where: { id: avatar.id },
        data: {
          name: `Avatar_${dto.userId}_${avatar.id}`,
        },
      });

      // NOW avatarId is available - move original image to avatarId directory
      if (originalImagePath && fs.existsSync(originalImagePath)) {
        try {
          const avatarDir = path.join(process.cwd(), 'uploads', 'avatars', dto.userId, avatar.id);
          if (!fs.existsSync(avatarDir)) {
            fs.mkdirSync(avatarDir, { recursive: true });
          }
          
          const newImagePath = path.join(avatarDir, 'original.jpg');
          
          // Use copy instead of rename to avoid issues if file is in use
          fs.copyFileSync(originalImagePath, newImagePath);
          
          // Optionally delete old file after successful copy
          try {
            fs.unlinkSync(originalImagePath);
          } catch (unlinkError) {
            this.logger.warn(`Failed to delete old image file: ${unlinkError}`, 'AvatarsService');
          }
          
          // Update originalImageUrl to new path
          const newImageUrl = `/uploads/avatars/${dto.userId}/${avatar.id}/original.jpg`;
          await this.databaseService.avatar.update({
            where: { id: avatar.id },
            data: {
              originalImageUrl: newImageUrl,
            },
          });

          // Minimal post-processing: upload to GCS if available, get public URL, store in avatarUrl/thumbnailUrl
          try {
            const subPath = `avatars/${dto.userId}/${avatar.id}`;
            const result = await this.publicUrlService.uploadFromPath(newImagePath, subPath, 'original.jpg');
            await this.databaseService.avatar.update({
              where: { id: avatar.id },
              data: {
                avatarUrl: result.publicUrl,
                thumbnailUrl: result.publicUrl,
              },
            });
            this.logger.log(`Post-upload: avatarUrl set to ${result.publicUrl}`, 'AvatarsService');
          } catch (uploadErr: any) {
            this.logger.warn(`Post-upload processing failed, using relative URL: ${uploadErr.message}`, 'AvatarsService');
            await this.databaseService.avatar.update({
              where: { id: avatar.id },
              data: {
                avatarUrl: newImageUrl,
                thumbnailUrl: newImageUrl,
              },
            });
          }
          
          // Update imageBuffer to use new path for processing
          imageBuffer = fs.readFileSync(newImagePath);
          
          this.logger.log(`Moved original image to: ${newImagePath}`, 'AvatarsService');
        } catch (moveError: any) {
          this.logger.error(`Failed to move original image: ${moveError.message}`, moveError.stack, 'AvatarsService');
          // Continue even if move fails - image processing can still use original path
        }
      }

      // When file move skipped (originalImagePath null): use dto.originalImageUrl as avatarUrl fallback
      if (!originalImagePath && dto.originalImageUrl) {
        try {
          await this.databaseService.avatar.update({
            where: { id: avatar.id },
            data: {
              avatarUrl: dto.originalImageUrl,
              thumbnailUrl: dto.originalImageUrl,
            },
          });
        } catch {
          // Ignore - avatar already has originalImageUrl
        }
      }

      // Create initial job for uploading image
      const uploadJob = await this.databaseService.avatarGenerationJob.create({
        data: {
          userId: dto.userId,
          avatarId: avatar.id,
          provider: 'heygen',
          jobType: 'UPLOAD_IMAGE',
          status: 'COMPLETED', // Image already uploaded
          imageKey: dto.imageKey,
          metadata: {
            step: 'image_uploaded',
          },
        },
      });

      // [SIMPLIFIED FLOW] Commented out: style variants, HeyGen group creation, and motion ID.
      // Avatar image is now generated per-project when user moves to b-roll images step (see generate-for-project).
      // if (imageBuffer) {
      //   try {
      //     await this.avatarQueueService.addImageProcessingJob({
      //       avatarId: avatar.id,
      //       userId: dto.userId,
      //       imageBuffer: imageBuffer,
      //       originalImageKey: dto.imageKey,
      //     });
      //     this.logger.log(`Added image processing job to queue for avatar ${avatar.id}`, 'AvatarsService');
      //   } catch (error: any) {
      //     this.logger.error(`Failed to add image processing job: ${error.message}`, error.stack, 'AvatarsService');
      //   }
      // }
      // const createGroupJob = await this.databaseService.avatarGenerationJob.create({
      //   data: {
      //     userId: dto.userId,
      //     avatarId: avatar.id,
      //     provider: 'heygen',
      //     jobType: 'CREATE_GROUP',
      //     status: 'PENDING',
      //     imageKey: dto.imageKey,
      //     metadata: { step: 'create_group', assetId: dto.assetId },
      //   },
      // });
      // this.processAvatarGeneration(avatar.id, createGroupJob.id).catch((error) => {
      //   this.logger.error(`Background avatar generation failed: ${error.message}`, error.stack, 'AvatarsService');
      // });

      // Mark avatar as ready (no group/motion needed for Avatar IV flow)
      await this.databaseService.avatar.update({
        where: { id: avatar.id },
        data: { generationStatus: 'COMPLETED' },
      });

      return {
        avatarId: avatar.id,
        jobId: uploadJob.id,
      };
    } catch (error: any) {
      this.logger.error(`Failed to create avatar from upload: ${error.message}`, error.stack, 'AvatarsService');
      throw error;
    }
  }

  /**
   * Lighting / palette / abstract mood only — for avatar image prompts (not b-roll locations).
   */
  private formatAvatarLightingFromStyleGuide(visualStyleGuide: any): string {
    if (!visualStyleGuide || typeof visualStyleGuide !== 'object') {
      return 'soft even studio lighting';
    }
    const parts: string[] = [];
    const lighting = String(visualStyleGuide.lighting || visualStyleGuide.Lighting || '').trim();
    const palette = String(
      visualStyleGuide.color_palette || visualStyleGuide.colorPalette || '',
    ).trim();
    let mood = String(visualStyleGuide.mood || visualStyleGuide.Mood || '').trim();
    if (mood) {
      mood = mood.replace(LOCATION_MOOD_PATTERN, '').replace(/\s+/g, ' ').trim();
    }
    if (lighting) parts.push(lighting);
    else parts.push('soft even studio lighting');
    if (palette) parts.push(`color palette ${palette}`);
    if (mood) parts.push(`${mood} mood`);
    return parts.join(', ');
  }

  private buildNamedPresetAvatarPrompt(
    presetId: string,
    visualStyleGuide: any,
  ): string {
    const pose = PRESET_POSE_PROMPTS[presetId] || PRESET_POSE_PROMPTS['front-facing'];
    const background =
      PRESET_BACKGROUND_PROMPTS[presetId] || PRESET_BACKGROUND_PROMPTS['front-facing'];
    const lighting = this.formatAvatarLightingFromStyleGuide(visualStyleGuide);
    return `${pose}, ${background}, ${lighting}, solid controlled background, no outdoor street scene, no crowd`;
  }

  /**
   * Default Indian appearance when user description does not specify ethnicity.
   */
  private resolveIndianAppearanceSuffix(
    appearancePrompt: string,
    opts?: { language?: string },
  ): string {
    const mode = (this.configService.get<string>('DEFAULT_AVATAR_ETHNICITY') || 'indian')
      .trim()
      .toLowerCase();
    if (mode === 'off') return '';
    if (INDIAN_APPEARANCE_MENTIONED.test(appearancePrompt)) return '';

    const lang = (opts?.language || '').toLowerCase();
    const langImpliesIndian = lang === 'hindi' || lang === 'hinglish';
    if (mode === 'auto' && !langImpliesIndian) return '';

    return ', South Asian Indian appearance, natural Indian facial features and skin tone';
  }

  private appendAvatarStyleSuffixes(
    effectivePrompt: string,
    style: string | undefined,
    useBottomHalfFraming: boolean,
  ): string {
    let prompt = effectivePrompt;
    const norm = normalizeStyleToBackend(style);
    if (norm !== 'ANIMATED_AVATAR') {
      prompt =
        'Photorealistic, real person, real-life photograph, preserve face and appearance, do NOT stylize or animate, documentary style. ' +
        prompt;
    }
    if (norm === 'AVATAR_CUTOUT') {
      prompt +=
        ', solid plain background, simple uniform background, no complex background elements, studio lighting with clean backdrop';
    }
    if (useBottomHalfFraming && norm !== 'AVATAR_CUTOUT') {
      prompt +=
        ' Person faces the camera directly, front-facing, looking straight ahead.' +
        AVATAR_PLATE_STUDIO_SUFFIX;
    }
    return prompt;
  }

  /**
   * Build BytePlus image-variant prompt from script + visual preset (project/preview paths).
   */
  private buildAvatarVariantEffectivePrompt(params: {
    style?: string;
    avatarVisualStylePreset?: string | null;
    script?: { avatar_image_prompt?: string; visual_style_guide?: any };
    useBottomHalfFraming: boolean;
    sceneHint?: string;
  }): string {
    const { style, avatarVisualStylePreset, script, useBottomHalfFraming, sceneHint = '' } = params;
    const avatarImagePrompt = script?.avatar_image_prompt;
    const visualGuide = script?.visual_style_guide;
    let effectivePrompt: string;

    if (style === 'ANIMATED_AVATAR') {
      if (!avatarImagePrompt || typeof avatarImagePrompt !== 'string') {
        throw new BadRequestException(
          'Script must include avatar_image_prompt (string) for Animated Avatar style. Regenerate the script.',
        );
      }
      const presetForPose =
        avatarVisualStylePreset && PRESET_POSE_PROMPTS[avatarVisualStylePreset]
          ? avatarVisualStylePreset
          : 'front-facing';
      effectivePrompt = `${avatarImagePrompt}, ${this.buildNamedPresetAvatarPrompt(presetForPose, visualGuide)}`;
    } else if (
      avatarVisualStylePreset === 'random' ||
      !avatarVisualStylePreset ||
      !PRESET_POSE_PROMPTS[avatarVisualStylePreset]
    ) {
      if (!avatarImagePrompt || typeof avatarImagePrompt !== 'string') {
        throw new BadRequestException(
          'Script must include avatar_image_prompt (string). Regenerate the script with avatar selected, or choose a visual style preset.',
        );
      }
      const lighting = this.formatAvatarLightingFromStyleGuide(visualGuide);
      const frontFacingSuffix = useBottomHalfFraming
        ? ' Person faces the camera directly, front-facing, looking straight ahead.'
        : '';
      effectivePrompt = `${avatarImagePrompt}, ${lighting}${frontFacingSuffix}${sceneHint}`;
    } else {
      effectivePrompt =
        this.buildNamedPresetAvatarPrompt(avatarVisualStylePreset, visualGuide) + sceneHint;
    }

    return this.appendAvatarStyleSuffixes(effectivePrompt, style, useBottomHalfFraming);
  }

  private buildAvatarProductPreviewSceneHint(script: any, previewSceneIndex: number): string {
    const scenes = script?.scenes || script?.scene_plan || [];
    if (!Array.isArray(scenes) || scenes.length === 0) return '';
    const idx = Math.min(Math.max(0, previewSceneIndex), scenes.length - 1);
    const s = scenes[idx];
    if (!s || typeof s !== 'object') return '';
    const raw =
      (typeof s.broll_image_prompt === 'string' && s.broll_image_prompt) ||
      (typeof s.broll_visual_description === 'string' && s.broll_visual_description) ||
      '';
    const t = raw.trim();
    if (!t) return '';
    const clipped = t.length > 700 ? `${t.slice(0, 700)}…` : t;
    return ` Align with this scene intent: ${clipped}`;
  }

  private async downloadImageBufferForPreview(url: string): Promise<Buffer | null> {
    try {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const res = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 90000,
          maxContentLength: 25 * 1024 * 1024,
        });
        return Buffer.from(res.data);
      }
      const clean = url.startsWith('/') ? url.slice(1) : url;
      const candidates = [
        path.join(process.cwd(), clean),
        path.join(process.cwd(), 'microservices', 'ai-content-service', clean),
        path.join(process.cwd(), 'uploads', clean.replace(/^uploads\/?/, '')),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          return fs.readFileSync(p);
        }
      }
      const base =
        this.configService.get<string>('BACKEND_BASE_URL') ||
        this.configService.get<string>('NEXT_PUBLIC_WS_URL')?.replace(/\/ws$/, '') ||
        '';
      if (base && url.startsWith('/')) {
        const res = await axios.get(`${base.replace(/\/$/, '')}${url}`, {
          responseType: 'arraybuffer',
          timeout: 90000,
          maxContentLength: 25 * 1024 * 1024,
        });
        return Buffer.from(res.data);
      }
    } catch (e: any) {
      this.logger.warn(`downloadImageBufferForPreview failed: ${e?.message}`, 'AvatarsService');
    }
    return null;
  }

  /**
   * Ensure avatar original image is accessible via public HTTP URL for FAL multi-reference generation.
   */
  private async ensureAvatarPublicUrl(
    avatar: { id: string; userId: string; originalImageUrl?: string | null },
    localImagePath?: string | null,
  ): Promise<string> {
    const originalImageUrl = avatar.originalImageUrl;
    if (originalImageUrl && (originalImageUrl.startsWith('http://') || originalImageUrl.startsWith('https://'))) {
      return originalImageUrl;
    }

    const buffer = localImagePath && fs.existsSync(localImagePath)
      ? fs.readFileSync(localImagePath)
      : null;

    if (!buffer) {
      throw new BadRequestException('Avatar original image not found for public URL resolution');
    }

    const uploadResult = await this.publicUrlService.uploadFromBuffer(
      buffer,
      `avatars/${avatar.userId}/${avatar.id}`,
      `original_${Date.now()}.jpg`,
      'image/jpeg',
    );

    const publicUrl = uploadResult.gcsUrl || uploadResult.publicUrl || uploadResult.localUrl;
    if (!publicUrl || (!publicUrl.startsWith('http://') && !publicUrl.startsWith('https://'))) {
      const backendBase =
        this.configService.get<string>('BACKEND_BASE_URL') ||
        this.configService.get<string>('NEXT_PUBLIC_WS_URL')?.replace(/\/ws$/, '') ||
        'http://localhost:9001';
      if (publicUrl?.startsWith('/')) {
        return `${backendBase.replace(/\/$/, '')}${publicUrl}`;
      }
      throw new BadRequestException('Failed to resolve public URL for avatar original image');
    }

    return publicUrl;
  }

  /**
   * Ensure product image URL is publicly accessible for FAL multi-reference generation.
   */
  private async ensureProductPublicUrl(productImageUrl: string): Promise<string> {
    const trimmed = productImageUrl.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }

    const productBuf = await this.downloadImageBufferForPreview(trimmed);
    if (!productBuf) {
      throw new BadRequestException(`Product image not accessible: ${trimmed}`);
    }

    const uploadResult = await this.publicUrlService.uploadFromBuffer(
      productBuf,
      'avatars/previews/product-refs',
      `product_ref_${Date.now()}.jpg`,
      'image/jpeg',
    );

    const publicUrl = uploadResult.gcsUrl || uploadResult.publicUrl || uploadResult.localUrl;
    if (publicUrl && (publicUrl.startsWith('http://') || publicUrl.startsWith('https://'))) {
      return publicUrl;
    }

    const backendBase =
      this.configService.get<string>('BACKEND_BASE_URL') ||
      this.configService.get<string>('NEXT_PUBLIC_WS_URL')?.replace(/\/ws$/, '') ||
      'http://localhost:9001';
    if (publicUrl?.startsWith('/')) {
      return `${backendBase.replace(/\/$/, '')}${publicUrl}`;
    }

    throw new BadRequestException('Failed to resolve public URL for product image');
  }

  /**
   * Rough avatar+product layout as a single JPEG reference for BytePlus (avatar-product preview).
   */
  private async buildAvatarProductPreviewComposite(
    avatarBuffer: Buffer,
    productBuffer: Buffer,
  ): Promise<Buffer | null> {
    try {
      const W = 1080;
      const H = 1920;
      const bg = await sharp(productBuffer)
        .resize(W, H, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 92 })
        .toBuffer();
      const fg = await sharp(avatarBuffer)
        .resize(Math.round(W * 0.88), Math.round(H * 0.58), { fit: 'cover', position: 'north' })
        .jpeg({ quality: 92 })
        .toBuffer();
      const fgMeta = await sharp(fg).metadata();
      const fw = fgMeta.width || W;
      const fh = fgMeta.height || 900;
      const left = Math.max(0, Math.floor((W - fw) / 2));
      const top = Math.max(72, Math.floor(H * 0.1));
      return await sharp(bg)
        .composite([{ input: fg, left, top }])
        .jpeg({ quality: 93 })
        .toBuffer();
    } catch (e: any) {
      this.logger.warn(`buildAvatarProductPreviewComposite failed: ${e?.message}`, 'AvatarsService');
      return null;
    }
  }

  /**
   * Build BytePlus text-to-image prompt from appearance description + visual style preset (AI Chat).
   * Library originals stay the resized JPEG from this output — not preview composites or cutouts.
   */
  private buildEnhancedPromptForTextToImage(params: {
    appearancePrompt: string;
    avatarVisualStylePreset?: string | null;
    script?: { avatar_image_prompt?: string; visual_style_guide?: any };
    videoStyle?: string;
    language?: string;
  }): string {
    const { appearancePrompt, avatarVisualStylePreset, script, videoStyle, language } = params;
    const appearance =
      appearancePrompt.trim() +
      this.resolveIndianAppearanceSuffix(appearancePrompt, { language });
    let base = `Professional portrait photograph of ${appearance}. High quality, realistic, clear facial features, good lighting, studio quality, suitable for video presentation. Upper body visible, looking at camera.`;

    const preset = avatarVisualStylePreset || 'original';
    const visualGuide = script?.visual_style_guide;
    if (preset === 'original') {
      // Keep base portrait; video framing handled in preview pipeline
    } else if (preset === 'random') {
      const fromScript =
        script?.avatar_image_prompt && typeof script.avatar_image_prompt === 'string'
          ? script.avatar_image_prompt.trim()
          : '';
      if (fromScript) {
        base = `${base} ${fromScript}, ${this.formatAvatarLightingFromStyleGuide(visualGuide)}`;
      } else {
        base = `${base} Natural varied professional framing and composition, ${this.formatAvatarLightingFromStyleGuide(visualGuide)}`;
      }
    } else if (PRESET_POSE_PROMPTS[preset]) {
      base = `${base} ${this.buildNamedPresetAvatarPrompt(preset, visualGuide)}`;
    }

    const norm = normalizeStyleToBackend(videoStyle);
    const useBottomHalfFraming = norm === 'HALF_N_HALF' || norm === 'ALTERNATE';
    return this.appendAvatarStyleSuffixes(base, videoStyle, useBottomHalfFraming);
  }

  /**
   * Generate avatar image for a project from the avatar's original image.
   * Preset types: original (Sharp only), random (script prompt), named preset (hybrid: preset pose + script theme).
   */
  async generateAvatarImageForProject(params: {
    projectId: string;
    avatarId: string;
    userId: string;
    script: { avatar_image_prompt?: string; visual_style_guide?: any };
    style?: string;
    avatarVisualStylePreset?: string | null;
  }): Promise<{ imageKey: string }> {
    const { projectId, avatarId, userId, script, style: rawStyle, avatarVisualStylePreset } = params;
    
    // Normalize style to backend format (handles both 'avatar-cutout' and 'AVATAR_CUTOUT')
    const style = normalizeStyleToBackend(rawStyle);
    
    this.logger.log(
      `Generating avatar image for project ${projectId}, avatar ${avatarId}, preset: ${avatarVisualStylePreset ?? 'null'}, style: ${style ?? 'none'}`,
      'AvatarsService',
    );

    const avatar = await this.databaseService.avatar.findFirst({
      where: { id: avatarId, userId },
    });
    if (!avatar) {
      throw new NotFoundException(`Avatar ${avatarId} not found or does not belong to user`);
    }

    const originalImageUrl = avatar.originalImageUrl;
    if (!originalImageUrl) {
      throw new BadRequestException('Avatar has no original image. Re-upload the avatar.');
    }

    const urlMatch = originalImageUrl.match(/\/uploads\/avatars\/([^/]+)\/(.+)$/);
    const possiblePaths = urlMatch
      ? [
          path.join(process.cwd(), 'uploads', 'avatars', urlMatch[1], urlMatch[2]),
          path.join(process.cwd(), 'microservices', 'ai-content-service', 'uploads', 'avatars', urlMatch[1], urlMatch[2]),
        ]
      : [path.join(process.cwd(), originalImageUrl.replace(/^\//, ''))];
    let imagePath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        imagePath = p;
        break;
      }
    }
    if (!imagePath) {
      throw new BadRequestException(`Avatar original image not found at: ${originalImageUrl}`);
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const useBottomHalfFraming = style === 'HALF_N_HALF' || style === 'ALTERNATE';

    let resultImageBuffer: Buffer;

    if (avatarVisualStylePreset === 'original' && style !== 'ANIMATED_AVATAR') {
      // Original: Sharp resize/crop only, no BytePlus
      if (useBottomHalfFraming) {
        const halfBuffer = await sharp(imageBuffer)
          .resize(1080, 960, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
        const whiteHeight = 960;
        const whiteTop = await sharp({
          create: { width: 1080, height: whiteHeight, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .jpeg()
          .toBuffer();
        resultImageBuffer = await sharp({
          create: { width: 1080, height: 1920, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .composite([
            { input: whiteTop, top: 0, left: 0 },
            { input: halfBuffer, top: whiteHeight, left: 0 },
          ])
          .jpeg()
          .toBuffer();
      } else {
        resultImageBuffer = await sharp(imageBuffer)
          .resize(1080, 1920, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
      }
    } else {
      const effectivePrompt = this.buildAvatarVariantEffectivePrompt({
        style,
        avatarVisualStylePreset,
        script,
        useBottomHalfFraming,
      });

      const imageBase64 = imageBuffer.toString('base64');
      const base64DataUri = `data:image/jpeg;base64,${imageBase64}`;

      if (useBottomHalfFraming) {
        const bytePlusSize = '2304x2048';
        const result = await this.bytePlusImageProvider.generateImageVariant(
          base64DataUri,
          effectivePrompt,
          bytePlusSize,
        );
        const downloaded = await axios.get(result.imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
        let halfBuffer = Buffer.from(downloaded.data);
        halfBuffer = await sharp(halfBuffer)
          .resize(1080, 960, { fit: 'fill', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
        const whiteHeight = 960;
        const whiteTop = await sharp({
          create: { width: 1080, height: whiteHeight, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .jpeg()
          .toBuffer();
        resultImageBuffer = await sharp({
          create: { width: 1080, height: 1920, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .composite([
            { input: whiteTop, top: 0, left: 0 },
            { input: halfBuffer, top: whiteHeight, left: 0 },
          ])
          .jpeg()
          .toBuffer();
      } else {
        const bytePlusSize = '1440x2560';
        const result = await this.bytePlusImageProvider.generateImageVariant(
          base64DataUri,
          effectivePrompt,
          bytePlusSize,
        );
        const downloaded = await axios.get(result.imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
        const largeBuffer = Buffer.from(downloaded.data);
        resultImageBuffer = await sharp(largeBuffer)
          .resize(1080, 1920, { fit: 'fill', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
      }
    }

    const uploadResponse = await this.heygenProvider.uploadImage(
      resultImageBuffer,
      'image/jpeg',
      `project_${projectId}_avatar.jpg`,
    );
    if (!uploadResponse.image_key) {
      throw new Error('HeyGen upload did not return image_key');
    }
    this.logger.log(`Avatar image for project ${projectId} generated, image_key: ${uploadResponse.image_key}`, 'AvatarsService');
    return { imageKey: uploadResponse.image_key };
  }

  /**
   * Generate avatar preview image for immediate display.
   * Similar to generateAvatarImageForProject but also stores locally and returns public URL.
   * Used in the avatar preview step so user can see the generated avatar before proceeding.
   */
  async generateAvatarPreview(params: {
    projectId: string;
    avatarId: string;
    userId: string;
    script: { avatar_image_prompt?: string; visual_style_guide?: any; scenes?: any[]; scene_plan?: any[] };
    style?: string;
    avatarVisualStylePreset?: string | null;
    /** Public or absolute URL to product image (avatar-product preview composite). */
    productImageUrl?: string;
    previewSceneIndex?: number;
  }): Promise<{ publicUrl: string; imageKey?: string; originalImageUrl?: string }> {
    const { projectId, avatarId, userId, script, style: rawStyle, avatarVisualStylePreset, productImageUrl, previewSceneIndex } = params;
    
    // Normalize style to backend format (handles both 'avatar-cutout' and 'AVATAR_CUTOUT')
    const style = normalizeStyleToBackend(rawStyle);
    
    this.logger.log(
      `Generating avatar preview for project ${projectId}, avatar ${avatarId}, preset: ${avatarVisualStylePreset ?? 'null'}, style: ${style ?? 'none'}`,
      'AvatarsService',
    );

    const avatar = await this.databaseService.avatar.findFirst({
      where: { id: avatarId, userId },
    });
    if (!avatar) {
      throw new NotFoundException(`Avatar ${avatarId} not found or does not belong to user`);
    }

    const avatarOriginalImageUrl = avatar.originalImageUrl;
    if (!avatarOriginalImageUrl) {
      throw new BadRequestException('Avatar has no original image. Re-upload the avatar.');
    }

    const urlMatch = avatarOriginalImageUrl.match(/\/uploads\/avatars\/([^/]+)\/(.+)$/);
    const possiblePaths = urlMatch
      ? [
          path.join(process.cwd(), 'uploads', 'avatars', urlMatch[1], urlMatch[2]),
          path.join(process.cwd(), 'microservices', 'ai-content-service', 'uploads', 'avatars', urlMatch[1], urlMatch[2]),
        ]
      : [path.join(process.cwd(), avatarOriginalImageUrl.replace(/^\//, ''))];
    let imagePath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        imagePath = p;
        break;
      }
    }
    if (!imagePath) {
      throw new BadRequestException(`Avatar original image not found at: ${avatarOriginalImageUrl}`);
    }

    let imageBuffer = fs.readFileSync(imagePath);

    const useBottomHalfFraming = style === 'HALF_N_HALF' || style === 'ALTERNATE';
    const useFalMultiReference =
      style === 'AVATAR_PRODUCT' && !!productImageUrl?.trim() && avatarVisualStylePreset !== 'original';

    let resultImageBuffer: Buffer;

    if (avatarVisualStylePreset === 'original' && style !== 'ANIMATED_AVATAR') {
      if (useBottomHalfFraming) {
        const halfBuffer = await sharp(imageBuffer)
          .resize(1080, 960, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
        const whiteHeight = 960;
        const whiteTop = await sharp({
          create: { width: 1080, height: whiteHeight, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .jpeg()
          .toBuffer();
        resultImageBuffer = await sharp({
          create: { width: 1080, height: 1920, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .composite([
            { input: whiteTop, top: 0, left: 0 },
            { input: halfBuffer, top: whiteHeight, left: 0 },
          ])
          .jpeg()
          .toBuffer();
      } else {
        resultImageBuffer = await sharp(imageBuffer)
          .resize(1080, 1920, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
      }
    } else {
      const sceneHint =
        style === 'AVATAR_PRODUCT'
          ? this.buildAvatarProductPreviewSceneHint(script, previewSceneIndex ?? 0)
          : '';
      let effectivePrompt = this.buildAvatarVariantEffectivePrompt({
        style,
        avatarVisualStylePreset,
        script,
        useBottomHalfFraming,
        sceneHint,
      });

      if (useFalMultiReference) {
        const avatarPublicUrl = await this.ensureAvatarPublicUrl(avatar, imagePath);
        const productPublicUrl = await this.ensureProductPublicUrl(productImageUrl!.trim());
        effectivePrompt +=
          ' [CRITICAL PRODUCT CONSISTENCY: The product MUST be IDENTICAL to the product reference image - same exact product, same shape, same colors, same design, same packaging, same branding. DO NOT generate a different or modified product.] [Using avatar and product reference images to create natural compositions: person interacting with product, demonstrating features, showcasing in context. Professional product showcase with avatar, natural poses and expressions. Keep the same person identity and the same product; natural interaction; full product visible in frame.]';

        this.logger.log(
          `Avatar preview AVATAR_PRODUCT: using FAL nano-banana-pro with multi-reference (avatar + product)`,
          'AvatarsService',
        );

        const falResult = await this.falImageProvider.generateImage({
          prompt: effectivePrompt,
          modelId: 'fal-ai/nano-banana-pro',
          aspectRatio: '9:16',
          resolution: '2K',
          referenceImages: [avatarPublicUrl, productPublicUrl],
        });

        const downloaded = await axios.get(falResult.imageUrl, {
          responseType: 'arraybuffer',
          timeout: 90000,
        });
        const largeBuffer = Buffer.from(downloaded.data);
        resultImageBuffer = await sharp(largeBuffer)
          .resize(1080, 1920, { fit: 'fill', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
      } else if (useBottomHalfFraming) {
        const imageBase64 = imageBuffer.toString('base64');
        const base64DataUri = `data:image/jpeg;base64,${imageBase64}`;
        const bytePlusSize = '2304x2048';
        const result = await this.bytePlusImageProvider.generateImageVariant(
          base64DataUri,
          effectivePrompt,
          bytePlusSize,
        );
        const downloaded = await axios.get(result.imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
        let halfBuffer = Buffer.from(downloaded.data);
        halfBuffer = await sharp(halfBuffer)
          .resize(1080, 960, { fit: 'fill', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
        const whiteHeight = 960;
        const whiteTop = await sharp({
          create: { width: 1080, height: whiteHeight, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .jpeg()
          .toBuffer();
        resultImageBuffer = await sharp({
          create: { width: 1080, height: 1920, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .composite([
            { input: whiteTop, top: 0, left: 0 },
            { input: halfBuffer, top: whiteHeight, left: 0 },
          ])
          .jpeg()
          .toBuffer();
      } else {
        const imageBase64 = imageBuffer.toString('base64');
        const base64DataUri = `data:image/jpeg;base64,${imageBase64}`;
        const bytePlusSize = '1440x2560';
        const result = await this.bytePlusImageProvider.generateImageVariant(
          base64DataUri,
          effectivePrompt,
          bytePlusSize,
        );
        const downloaded = await axios.get(result.imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
        const largeBuffer = Buffer.from(downloaded.data);
        resultImageBuffer = await sharp(largeBuffer)
          .resize(1080, 1920, { fit: 'fill', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
      }
    }

    // For AVATAR_CUTOUT style, remove background to create transparent PNG
    let finalImageBuffer = resultImageBuffer;
    let mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg';
    let fileExtension = 'jpg';
    let originalImageUrl: string | undefined;

    if (style === 'AVATAR_CUTOUT') {
      this.logger.log(`[AvatarPreview] AVATAR_CUTOUT style detected, uploading original JPEG for HeyGen and creating transparent PNG for preview`, 'AvatarsService');
      
      // Upload original JPEG with white background for HeyGen BEFORE background removal
      // HeyGen Avatar IV cannot process transparent PNGs, so we preserve the original JPEG
      const jpegTimestamp = Date.now();
      const jpegFilename = `avatar_preview_original_${jpegTimestamp}.jpg`;
      const subPathJpeg = `avatars/previews/${projectId}`;
      const jpegStorageResult = await this.publicUrlService.uploadFromBuffer(
        resultImageBuffer,
        subPathJpeg,
        jpegFilename,
        'image/jpeg',
      );
      originalImageUrl = jpegStorageResult.gcsUrl || jpegStorageResult.publicUrl || jpegStorageResult.localUrl;
      this.logger.log(`[AvatarPreview] AVATAR_CUTOUT: Uploaded original JPEG for HeyGen: ${originalImageUrl}`, 'AvatarsService');
      
      // Now remove background to create transparent PNG for preview display
      try {
        const tempDir = path.join(process.cwd(), 'uploads', 'temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempInputPath = path.join(tempDir, `avatar_preview_input_${Date.now()}.jpg`);
        const tempOutputPath = path.join(tempDir, `avatar_preview_output_${Date.now()}.png`);
        
        fs.writeFileSync(tempInputPath, resultImageBuffer);
        
        await this.removeImageBackground(tempInputPath, tempOutputPath);
        
        if (fs.existsSync(tempOutputPath)) {
          finalImageBuffer = fs.readFileSync(tempOutputPath);
          mimeType = 'image/png';
          fileExtension = 'png';
          this.logger.log(`[AvatarPreview] Background removed successfully, PNG size: ${finalImageBuffer.length} bytes`, 'AvatarsService');
          
          if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
          if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
        } else {
          this.logger.warn(`[AvatarPreview] Background removal output not found, using original image`, 'AvatarsService');
        }
      } catch (bgRemovalError: any) {
        this.logger.warn(`[AvatarPreview] Background removal failed: ${bgRemovalError.message}, using original image for preview`, 'AvatarsService');
      }
    }

    const timestamp = Date.now();
    const previewFilename = `avatar_preview_${timestamp}.${fileExtension}`;
    const subPath = `avatars/previews/${projectId}`;
    const storageResult = await this.publicUrlService.uploadFromBuffer(
      finalImageBuffer,
      subPath,
      previewFilename,
      mimeType,
    );

    const publicUrl = storageResult.gcsUrl || storageResult.publicUrl || `${storageResult.localUrl}`;

    this.logger.log(
      `Avatar preview for project ${projectId} generated (GCS only; HeyGen on finalize), publicUrl: ${publicUrl}${originalImageUrl ? `, originalImageUrl: ${originalImageUrl}` : ''}`,
      'AvatarsService',
    );

    return { publicUrl, originalImageUrl };
  }

  /**
   * Upload the chosen preview image to HeyGen once when the user proceeds past avatar preview (AI Chat).
   */
  async finalizeAvatarPreview(params: {
    userId: string;
    avatarId: string;
    previewImageUrl: string;
    originalImageUrl?: string;
  }): Promise<{ imageKey: string }> {
    const { userId, avatarId, previewImageUrl, originalImageUrl } = params;

    const avatar = await this.databaseService.avatar.findFirst({
      where: { id: avatarId, userId },
    });
    if (!avatar) {
      throw new NotFoundException(`Avatar ${avatarId} not found or does not belong to user`);
    }

    // Use originalImageUrl if provided (AVATAR_CUTOUT), otherwise use previewImageUrl
    // This ensures HeyGen receives a JPEG with solid background, not a transparent PNG
    const imageUrlForHeyGen = originalImageUrl || previewImageUrl;
    
    this.logger.log(
      `[finalizeAvatarPreview] Using ${originalImageUrl ? 'original JPEG' : 'preview image'} for HeyGen upload: ${imageUrlForHeyGen}`,
      'AvatarsService',
    );

    if (!imageUrlForHeyGen || (!imageUrlForHeyGen.startsWith('http://') && !imageUrlForHeyGen.startsWith('https://'))) {
      throw new BadRequestException('Image URL must be a valid http(s) URL');
    }

    const imageResponse = await axios.get(imageUrlForHeyGen, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 50 * 1024 * 1024,
      maxBodyLength: 50 * 1024 * 1024,
    });
    const imageBuffer = Buffer.from(imageResponse.data);
    const ct = (imageResponse.headers['content-type'] || '').toLowerCase();
    const mimeType: 'image/jpeg' | 'image/png' = ct.includes('png') ? 'image/png' : 'image/jpeg';
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';

    const uploadResponse = await this.heygenProvider.uploadImage(
      imageBuffer,
      mimeType,
      `avatar_finalize_${avatarId}.${ext}`,
    );
    if (!uploadResponse.image_key) {
      throw new Error('HeyGen upload did not return image_key');
    }

    await this.databaseService.avatar.update({
      where: { id: avatarId },
      data: {
        imageKey: uploadResponse.image_key,
        generationStatus: 'COMPLETED',
      },
    });

    this.logger.log(`Avatar ${avatarId} finalized with HeyGen image_key`, 'AvatarsService');
    return { imageKey: uploadResponse.image_key };
  }

  /**
   * Generate avatar from text description using BytePlus text-to-image
   * Creates a new avatar record with the generated image
   */
  async generateAvatarFromText(params: {
    prompt: string;
    userId: string;
    projectId?: string;
    style?: string;
    avatarVisualStylePreset?: string | null;
    script?: { avatar_image_prompt?: string; visual_style_guide?: any };
    language?: 'english' | 'hindi' | 'hinglish';
  }): Promise<{
    success: boolean;
    avatarId?: string;
    thumbnailUrl?: string;
    avatarUrl?: string;
    originalImageUrl?: string;
    error?: string;
  }> {
    const { prompt, userId, projectId, style, avatarVisualStylePreset, script, language } = params;

    this.logger.log(
      `Generating avatar from text for user ${userId}, preset: ${avatarVisualStylePreset ?? 'default'}, prompt: ${prompt.substring(0, 50)}...`,
      'AvatarsService',
    );

    try {
      const enhancedPrompt = this.buildEnhancedPromptForTextToImage({
        appearancePrompt: prompt,
        avatarVisualStylePreset,
        script,
        videoStyle: style,
        language,
      });

      const backendStyle = normalizeStyleToBackend(style);
      const useBottomHalfFraming = backendStyle === 'HALF_N_HALF' || backendStyle === 'ALTERNATE';

      let imageBuffer: Buffer;

      if (useBottomHalfFraming) {
        const generationResult = await this.bytePlusImageProvider.generateImageFromText(
          enhancedPrompt,
          '2304x2048',
        );
        if (!generationResult.imageUrl) {
          throw new Error('Failed to generate image from text');
        }
        const imageResponse = await axios.get(generationResult.imageUrl, {
          responseType: 'arraybuffer',
        });
        let halfBuffer = Buffer.from(imageResponse.data);
        halfBuffer = await sharp(halfBuffer)
          .resize(1080, 960, { fit: 'fill', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
        const whiteHeight = 960;
        const whiteTop = await sharp({
          create: { width: 1080, height: whiteHeight, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .jpeg()
          .toBuffer();
        imageBuffer = await sharp({
          create: { width: 1080, height: 1920, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .composite([
            { input: whiteTop, top: 0, left: 0 },
            { input: halfBuffer, top: whiteHeight, left: 0 },
          ])
          .jpeg({ quality: 95 })
          .toBuffer();
      } else {
        // BytePlus requires min ~3.69M pixels; generate large then resize to 1080x1920 (same as image-to-image path)
        const generationResult = await this.bytePlusImageProvider.generateImageFromText(
          enhancedPrompt,
          '1440x2560',
        );

        if (!generationResult.imageUrl) {
          throw new Error('Failed to generate image from text');
        }

        const imageResponse = await axios.get(generationResult.imageUrl, {
          responseType: 'arraybuffer',
        });
        imageBuffer = Buffer.from(imageResponse.data);
        imageBuffer = await sharp(imageBuffer)
          .resize(1080, 1920, { fit: 'fill', position: 'center' })
          .jpeg({ quality: 95 })
          .toBuffer();
      }

      // Create thumbnail using sharp
      const thumbnailBuffer = await sharp(imageBuffer)
        .resize(200, 267, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Save images locally
      const timestamp = Date.now();
      const userDir = path.join(process.cwd(), 'uploads', 'avatars', userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      const originalFilename = `ai_generated_${timestamp}.jpg`;
      const thumbnailFilename = `ai_generated_${timestamp}_thumb.jpg`;
      const originalPath = path.join(userDir, originalFilename);
      const thumbnailPath = path.join(userDir, thumbnailFilename);

      fs.writeFileSync(originalPath, imageBuffer);
      fs.writeFileSync(thumbnailPath, thumbnailBuffer);

      // HeyGen upload deferred until user confirms avatar preview (finalize-preview)

      // Upload to public storage (GCS/local)
      const subPath = `avatars/${userId}`;
      const storageResult = await this.publicUrlService.uploadFromBuffer(
        imageBuffer,
        subPath,
        originalFilename,
        'image/jpeg',
      );

      const thumbnailStorageResult = await this.publicUrlService.uploadFromBuffer(
        thumbnailBuffer,
        subPath,
        thumbnailFilename,
        'image/jpeg',
      );

      // Create avatar record in database
      const avatar = await this.databaseService.avatar.create({
        data: {
          userId,
          name: `AI Generated - ${prompt.substring(0, 30)}...`,
          imageKey: null,
          source: 'UPLOAD', // Treat as upload since user provided the prompt
          generationStatus: 'COMPLETED',
          thumbnailUrl: thumbnailStorageResult.gcsUrl || thumbnailStorageResult.publicUrl || `/uploads/avatars/${userId}/${thumbnailFilename}`,
          avatarUrl: storageResult.gcsUrl || storageResult.publicUrl || `/uploads/avatars/${userId}/${originalFilename}`,
          originalImageUrl: `/uploads/avatars/${userId}/${originalFilename}`,
          generationMetadata: {
            generatedFromText: true,
            originalPrompt: prompt,
            enhancedPrompt,
            projectId,
            style,
            avatarVisualStylePreset: avatarVisualStylePreset ?? undefined,
          },
        },
      });

      this.logger.log(
        `Avatar generated from text successfully: ${avatar.id}`,
        'AvatarsService',
      );

      return {
        success: true,
        avatarId: avatar.id,
        thumbnailUrl: avatar.thumbnailUrl,
        avatarUrl: avatar.avatarUrl,
        originalImageUrl: avatar.originalImageUrl,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to generate avatar from text: ${error.message}`,
        error.stack,
        'AvatarsService',
      );
      return {
        success: false,
        error: error.message || 'Failed to generate avatar from text',
      };
    }
  }

  /**
   * Background process to generate avatar via HeyGen
   * Flow: Create Group -> Train -> Generate Looks -> Add Motion
   */
  private async processAvatarGeneration(avatarId: string, currentJobId: string): Promise<void> {
    try {
      const avatar = await this.databaseService.avatar.findUnique({
        where: { id: avatarId },
      });

      if (!avatar) {
        throw new NotFoundException(`Avatar ${avatarId} not found`);
      }

      const currentJob = await this.databaseService.avatarGenerationJob.findUnique({
        where: { id: currentJobId },
      });

      if (!currentJob) {
        throw new NotFoundException(`Job ${currentJobId} not found`);
      }

      // Step 1: Create Photo Avatar Group
      if (currentJob.jobType === 'CREATE_GROUP' && currentJob.status === 'PENDING') {
        await this.databaseService.avatarGenerationJob.update({
          where: { id: currentJobId },
          data: { status: 'PROCESSING' },
        });

        try {
          // Get assetId from avatar metadata or job metadata
          const assetId = (avatar.generationMetadata as any)?.assetId || 
                         (currentJob.metadata as any)?.assetId;
          
          if (!assetId) {
            throw new Error('Asset ID (generation_id) is required but not found');
          }

          const { avatarId: heygenAvatarId, groupId } = await this.heygenProvider.createPhotoAvatarGroup(
            avatar.imageKey!,
            assetId,
            avatar.name
          );

          // Update avatar record with group ID and HeyGen avatar ID
          await this.databaseService.avatar.update({
            where: { id: avatarId },
            data: {
              providerGroupId: groupId,
              providerAvatarId: heygenAvatarId, // Store HeyGen avatar ID
              generationStatus: 'PROCESSING',
              generationMetadata: {
                ...((avatar.generationMetadata as object) || {}),
                heygenAvatarId,
                groupId,
                assetId,
              },
            },
          });

          // Create transparent version in background (async, don't wait)
          // This will be used for CUTOUT mode video generation
          this.createTransparentAvatarVersion(avatarId).catch((error) => {
            // Ignore EPIPE and connection errors as they're handled by axios interceptors
            if (error?.code === 'EPIPE' || error?.code === 'ECONNRESET' || error?.code === 'ECONNABORTED') {
              this.logger.warn(`[TransparentAvatar] Connection error during transparent version creation (${error.code}): ${error.message}`, 'AvatarsService');
            } else {
              this.logger.warn(`[TransparentAvatar] Failed to create transparent version during avatar creation: ${error.message}`, 'AvatarsService');
            }
            // Don't fail avatar creation if transparent version fails
          });

          await this.databaseService.avatarGenerationJob.update({
            where: { id: currentJobId },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              avatarIdResult: heygenAvatarId, // Store HeyGen avatar ID in job
              metadata: {
                ...((currentJob.metadata as object) || {}),
                groupId,
                heygenAvatarId,
              },
            },
          });

          // Skip training - go directly to add motion
          const addMotionJob = await this.databaseService.avatarGenerationJob.create({
            data: {
              userId: avatar.userId,
              avatarId: avatar.id,
              provider: 'heygen',
              jobType: 'ADD_MOTION',
              status: 'PENDING',
              groupId,
              avatarIdResult: heygenAvatarId, // Store HeyGen avatar ID for motion
              metadata: {
                step: 'add_motion',
                heygenAvatarId,
                groupId,
              },
            },
          });

          // Continue to add motion
          await this.processAvatarGeneration(avatarId, addMotionJob.id);
        } catch (error: any) {
          await this.databaseService.avatarGenerationJob.update({
            where: { id: currentJobId },
            data: {
              status: 'FAILED',
              errorMessage: error.message,
            },
          });
          throw error;
        }
      }

      // Step 2: Train Photo Avatar Group
      else if (currentJob.jobType === 'TRAIN' && currentJob.status === 'PENDING') {
        await this.databaseService.avatarGenerationJob.update({
          where: { id: currentJobId },
          data: { status: 'PROCESSING' },
        });

        try {
          const trainJobId = await this.heygenProvider.trainPhotoAvatarGroup(
            currentJob.groupId!
          );

          await this.databaseService.avatarGenerationJob.update({
            where: { id: currentJobId },
            data: {
              providerJobId: trainJobId,
              status: 'PROCESSING',
              metadata: {
                ...((currentJob.metadata as object) || {}),
                trainJobId,
              },
            },
          });

          // Poll for training status
          await this.pollTrainingStatus(avatarId, currentJobId, trainJobId);
        } catch (error: any) {
          await this.databaseService.avatarGenerationJob.update({
            where: { id: currentJobId },
            data: {
              status: 'FAILED',
              errorMessage: error.message,
            },
          });
          throw error;
        }
      }

      // Step 3: Generate Looks (after training completes)
      else if (currentJob.jobType === 'GENERATE_LOOKS' && currentJob.status === 'PENDING') {
        await this.databaseService.avatarGenerationJob.update({
          where: { id: currentJobId },
          data: { status: 'PROCESSING' },
        });

        try {
          const generateJobId = await this.heygenProvider.generatePhotoAvatarLooks(
            currentJob.groupId!
          );

          await this.databaseService.avatarGenerationJob.update({
            where: { id: currentJobId },
            data: {
              providerJobId: generateJobId,
              status: 'PROCESSING',
              metadata: {
                ...((currentJob.metadata as object) || {}),
                generateJobId,
              },
            },
          });

          // Poll for generation status
          await this.pollGenerationStatus(avatarId, currentJobId, generateJobId);
        } catch (error: any) {
          await this.databaseService.avatarGenerationJob.update({
            where: { id: currentJobId },
            data: {
              status: 'FAILED',
              errorMessage: error.message,
            },
          });
          throw error;
        }
      }

      // Step 2: Add Motion (after group creation, skipping training)
      else if (currentJob.jobType === 'ADD_MOTION' && currentJob.status === 'PENDING') {
        await this.databaseService.avatarGenerationJob.update({
          where: { id: currentJobId },
          data: { status: 'PROCESSING' },
        });

        try {
          // Use HeyGen avatar ID from job metadata or avatar record
          const heygenAvatarId = (currentJob.metadata as any)?.heygenAvatarId || 
                                currentJob.avatarIdResult || 
                                avatar.providerAvatarId;

          if (!heygenAvatarId) {
            throw new Error('HeyGen avatar ID is required but not found');
          }

          // Poll avatar status until it's completed before adding motion
          this.logger.log(`Polling avatar status for ${heygenAvatarId} before adding motion`, 'AvatarsService');
          await this.heygenProvider.pollAvatarStatus(heygenAvatarId, 60, 5000); // 60 attempts, 5 seconds each = 5 minutes max

          // Add motion to the avatar
          const motionAvatarId = await this.heygenProvider.addMotion(
            heygenAvatarId,
            undefined, // No prompt for now
            'consistent' // Default motion type
          );

          this.logger.log(`Motion generation started. Polling for completion: ${motionAvatarId}`, 'AvatarsService');

          // Poll motion avatar status until it's completed
          const avatarDetails = await this.heygenProvider.pollMotionAvatarStatus(motionAvatarId, 120, 5000); // 120 attempts, 5 seconds each = 10 minutes max

          this.logger.log(`Motion generation completed for avatar: ${motionAvatarId}`, 'AvatarsService');

          // Update avatar record with final motion avatar ID and details
          await this.databaseService.avatar.update({
            where: { id: avatarId },
            data: {
              providerAvatarId: motionAvatarId, // Update with motion avatar ID
              avatarUrl: avatarDetails.url || avatarDetails.avatar_url || avatarDetails.image_url || avatarDetails.video_url,
              thumbnailUrl: avatarDetails.thumbnail_url || avatarDetails.thumbnailUrl || avatarDetails.thumbnail,
              generationStatus: 'COMPLETED',
              generationMetadata: {
                ...((avatar.generationMetadata as object) || {}),
                motionAvatarId,
                originalAvatarId: heygenAvatarId,
                groupId: (currentJob.metadata as any)?.groupId || avatar.providerGroupId,
                motionCompletedAt: new Date().toISOString(),
              },
            },
          });

          await this.databaseService.avatarGenerationJob.update({
            where: { id: currentJobId },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              avatarIdResult: motionAvatarId, // Store final motion avatar ID
              metadata: {
                ...((currentJob.metadata as object) || {}),
                motionAvatarId,
                originalAvatarId: heygenAvatarId,
              },
            },
          });

          this.logger.log(`Avatar generation with motion completed: ${avatarId}, Motion Avatar ID: ${motionAvatarId}`, 'AvatarsService');
        } catch (error: any) {
          await this.databaseService.avatarGenerationJob.update({
            where: { id: currentJobId },
            data: {
              status: 'FAILED',
              errorMessage: error.message,
            },
          });
          throw error;
        }
      }
    } catch (error: any) {
      this.logger.error(`Avatar generation process failed: ${error.message}`, error.stack, 'AvatarsService');
      
      // Update avatar status to failed
      await this.databaseService.avatar.update({
        where: { id: avatarId },
        data: {
          generationStatus: 'FAILED',
          generationError: error.message,
        },
      });

      throw error;
    }
  }

  /**
   * Poll training status until complete
   */
  private async pollTrainingStatus(avatarId: string, jobId: string, trainJobId: string): Promise<void> {
    const maxAttempts = 60; // 5 minutes max (5 second intervals)
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

      try {
        const status = await this.heygenProvider.getTrainingStatus(trainJobId);

        await this.databaseService.avatarGenerationJob.update({
          where: { id: jobId },
          data: {
            metadata: {
              status: status.status,
              progress: status.progress,
            },
          },
        });

        if (status.status === 'completed' || status.status === 'success') {
          // Training complete, create next job: Generate Looks
          const generateJob = await this.databaseService.avatarGenerationJob.create({
            data: {
              userId: (await this.databaseService.avatar.findUnique({ where: { id: avatarId } }))!.userId,
              avatarId,
              provider: 'heygen',
              jobType: 'GENERATE_LOOKS',
              status: 'PENDING',
              groupId: (await this.databaseService.avatarGenerationJob.findUnique({ where: { id: jobId } }))!.groupId,
              metadata: {
                step: 'generate_looks',
              },
            },
          });

          await this.processAvatarGeneration(avatarId, generateJob.id);
          return;
        }

        if (status.status === 'failed' || status.status === 'error') {
          throw new Error('Training failed');
        }

        attempts++;
      } catch (error: any) {
        if (error.message === 'Training failed') {
          throw error;
        }
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error('Training status polling timeout');
        }
      }
    }
  }

  /**
   * Poll generation status until complete
   */
  private async pollGenerationStatus(avatarId: string, jobId: string, generateJobId: string): Promise<void> {
    const maxAttempts = 60; // 5 minutes max
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      try {
        const status = await this.heygenProvider.getTrainingStatus(generateJobId); // Same endpoint

        if (status.status === 'completed' || status.status === 'success') {
          const avatarIdFromGeneration = status.avatar_id;

          // Generation complete, create next job: Add Motion
          const motionJob = await this.databaseService.avatarGenerationJob.create({
            data: {
              userId: (await this.databaseService.avatar.findUnique({ where: { id: avatarId } }))!.userId,
              avatarId,
              provider: 'heygen',
              jobType: 'ADD_MOTION',
              status: 'PENDING',
              avatarIdResult: avatarIdFromGeneration,
              metadata: {
                step: 'add_motion',
              },
            },
          });

          await this.databaseService.avatarGenerationJob.update({
            where: { id: jobId },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              avatarIdResult: avatarIdFromGeneration,
            },
          });

          await this.processAvatarGeneration(avatarId, motionJob.id);
          return;
        }

        if (status.status === 'failed' || status.status === 'error') {
          throw new Error('Look generation failed');
        }

        attempts++;
      } catch (error: any) {
        if (error.message === 'Look generation failed') {
          throw error;
        }
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error('Generation status polling timeout');
        }
      }
    }
  }

  /**
   * Get user's avatars
   */
  async getUserAvatars(userId: string, filters?: { source?: string; category?: string }): Promise<any[]> {
    try {
      const where: Prisma.AvatarWhereInput = {
        userId,
        isActive: true,
        generationStatus: 'COMPLETED', // Only show completed avatars
      };

      if (filters?.source) {
        where.source = filters.source as any;
      }

      if (filters?.category) {
        where.category = filters.category as any;
      }

      const avatars = await this.databaseService.avatar.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      return avatars;
    } catch (error: any) {
      this.logger.error(`Failed to get user avatars: ${error.message}`, error.stack, 'AvatarsService');
      throw error;
    }
  }

  /**
   * Get avatar by ID
   */
  async getAvatarById(avatarId: string, userId: string): Promise<any> {
    try {
      const avatar = await this.databaseService.avatar.findFirst({
        where: {
          id: avatarId,
          userId,
        },
      });

      if (!avatar) {
        throw new NotFoundException(`Avatar ${avatarId} not found`);
      }

      return avatar;
    } catch (error: any) {
      this.logger.error(`Failed to get avatar: ${error.message}`, error.stack, 'AvatarsService');
      throw error;
    }
  }

  /**
   * Get avatar generation job status
   */
  async getJobStatus(jobId: string, userId: string): Promise<any> {
    try {
      const job = await this.databaseService.avatarGenerationJob.findFirst({
        where: {
          id: jobId,
          userId,
        },
        include: {
          avatar: true,
        },
      });

      if (!job) {
        throw new NotFoundException(`Job ${jobId} not found`);
      }

      return job;
    } catch (error: any) {
      this.logger.error(`Failed to get job status: ${error.message}`, error.stack, 'AvatarsService');
      throw error;
    }
  }

  /**
   * Get public library avatars
   */
  async getLibraryAvatars(filters?: { category?: string; search?: string }): Promise<any[]> {
    try {
      const where: Prisma.PublicAvatarWhereInput = {
        isActive: true,
      };

      if (filters?.category) {
        where.category = filters.category as any;
      }

      const avatars = await this.databaseService.publicAvatar.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      // Simple search filter
      if (filters?.search) {
        const searchLower = filters.search.toLowerCase();
        return avatars.filter(
          (avatar) =>
            avatar.name.toLowerCase().includes(searchLower) ||
            avatar.description?.toLowerCase().includes(searchLower)
        );
      }

      return avatars;
    } catch (error: any) {
      this.logger.error(`Failed to get library avatars: ${error.message}`, error.stack, 'AvatarsService');
      throw error;
    }
  }

  /**
   * Create transparent background version of avatar image
   * Removes background using AI and uploads to HeyGen
   * Uses database locking to prevent concurrent processing
   */
  async createTransparentAvatarVersion(avatarId: string): Promise<{ imageKey: string; assetId: string }> {
    try {
      this.logger.log(`[TransparentAvatar] Starting transparent version creation for avatar ${avatarId}`, 'AvatarsService');
      
      // Use transaction with locking to prevent concurrent processing
      const result = await this.databaseService.$transaction(async (tx) => {
        const avatar = await tx.avatar.findUnique({
          where: { id: avatarId },
        });

        if (!avatar) {
          throw new NotFoundException(`Avatar ${avatarId} not found`);
        }

        // Check if transparent version already exists
        const avatarWithTransparent = avatar as any; // Type assertion for new field
        if (avatarWithTransparent.transparentImageKey) {
          this.logger.log(`[TransparentAvatar] Transparent version already exists for avatar ${avatarId}`, 'AvatarsService');
          const metadata = (avatar.generationMetadata as any) || {};
          return {
            imageKey: avatarWithTransparent.transparentImageKey,
            assetId: metadata.transparentAssetId || '',
          };
        }

        // Check if currently being processed (by checking metadata)
        const metadata = (avatar.generationMetadata as any) || {};
        if (metadata.transparentProcessing === true) {
          this.logger.log(`[TransparentAvatar] Transparent version is already being processed for avatar ${avatarId}`, 'AvatarsService');
          throw new BadRequestException('Transparent version is already being processed. Please wait.');
        }

        // Mark as processing
        await tx.avatar.update({
          where: { id: avatarId },
          data: {
            generationMetadata: {
              ...metadata,
              transparentProcessing: true,
            },
          },
        });

        return { avatar, metadata };
      }, {
        isolationLevel: 'Serializable', // Highest isolation to prevent concurrent updates
      });

      // If result has imageKey, it means it already existed
      if ('imageKey' in result) {
        return result as { imageKey: string; assetId: string };
      }

      const { avatar, metadata } = result as { avatar: any; metadata: any };

      try {
        // Try to use processed 1080x1920 image first (for Premium avatars)
        const processedImagePath = path.join(
          process.cwd(),
          'uploads',
          'avatars',
          avatar.userId,
          avatarId,
          'full_9x16_1080x1920.jpg'
        );
        
        let imagePath: string;
        
        if (fs.existsSync(processedImagePath)) {
          imagePath = processedImagePath;
          this.logger.log(`[TransparentAvatar] Using processed 1080x1920 image: ${imagePath}`, 'AvatarsService');
        } else {
          // Fallback to original for old avatars
          if (!avatar.originalImageUrl) {
            throw new Error('Neither processed nor original image found. Cannot create transparent version.');
          }
          imagePath = path.join(process.cwd(), avatar.originalImageUrl.replace(/^\/uploads\//, 'uploads/'));
          if (!fs.existsSync(imagePath)) {
            throw new Error(`Original image file not found: ${imagePath}`);
          }
          this.logger.log(`[TransparentAvatar] Processed image not found, using original: ${imagePath}`, 'AvatarsService');
        }

        this.logger.log(`[TransparentAvatar] Removing background from image: ${imagePath}`, 'AvatarsService');

        // Remove background using Python script
        const transparentImagePath = imagePath.replace(/\.(jpg|jpeg|png)$/i, '_transparent.png');
        await this.removeImageBackground(imagePath, transparentImagePath);

        // Read transparent image buffer
        const transparentImageBuffer = fs.readFileSync(transparentImagePath);

        this.logger.log(`[TransparentAvatar] Uploading transparent image to HeyGen...`, 'AvatarsService');

        // Upload transparent image to HeyGen
        let uploadResponse;
        try {
          uploadResponse = await this.heygenProvider.uploadImage(
            transparentImageBuffer,
            'image/png', // PNG preserves alpha channel
            `transparent_${avatar.name}.png`
          );
        } catch (error: any) {
          // Handle connection errors gracefully
          if (error?.code === 'EPIPE' || error?.code === 'ECONNRESET' || error?.code === 'ECONNABORTED') {
            this.logger.warn(`[TransparentAvatar] Connection error during upload (${error.code}): ${error.message}`, 'AvatarsService');
            throw new Error(`Upload connection failed: ${error.message}`);
          }
          throw error;
        }

        if (!uploadResponse.image_key) {
          throw new Error('Failed to get image_key from HeyGen upload');
        }

        this.logger.log(`[TransparentAvatar] Transparent image uploaded. Image key: ${uploadResponse.image_key}`, 'AvatarsService');

        // Update avatar with transparent imageKey
        await this.databaseService.avatar.update({
          where: { id: avatarId },
          data: {
            transparentImageKey: uploadResponse.image_key as any, // Type assertion for new field
            generationMetadata: {
              ...metadata,
              transparentAssetId: uploadResponse.id,
              transparentProcessing: false, // Mark as completed
            },
          } as any,
        });

        // Cleanup temporary file
        if (fs.existsSync(transparentImagePath)) {
          fs.unlinkSync(transparentImagePath);
        }

        this.logger.log(`[TransparentAvatar] ✅ Transparent version created successfully for avatar ${avatarId}`, 'AvatarsService');
        
        return {
          imageKey: uploadResponse.image_key,
          assetId: uploadResponse.id,
        };
      } catch (error: any) {
        // Remove processing flag on error
        await this.databaseService.avatar.update({
          where: { id: avatarId },
          data: {
            generationMetadata: {
              ...metadata,
              transparentProcessing: false,
            },
          },
        });
        throw error;
      }
    } catch (error: any) {
      this.logger.error(`[TransparentAvatar] Failed to create transparent version: ${error.message}`, error.stack, 'AvatarsService');
      throw error;
    }
  }

  /**
   * Remove background from image using Python script
   */
  private async removeImageBackground(inputPath: string, outputPath: string): Promise<void> {
    // Resolve paths from service root (works regardless of process cwd / PM2)
    // This service builds with webpack into dist/main.js, so __dirname is
    // typically <serviceRoot>/dist at runtime. Walk up one level.
    const serviceRoot = path.resolve(__dirname, '..');
    const scriptPath = path.join(serviceRoot, 'scripts', 'remove_image_background.py');
    
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Background removal script not found: ${scriptPath}`);
    }

    // Try to use venv Python if available, otherwise fall back to system python3
    const venvPython = path.join(serviceRoot, 'venv', 'bin', 'python3');
    const pythonCommand = fs.existsSync(venvPython) ? venvPython : 'python3';
    
    const command = `${pythonCommand} "${scriptPath}" "${inputPath}" "${outputPath}" "u2net_human_seg"`;
    
    this.logger.log(`[TransparentAvatar] Executing background removal: ${command}`, 'AvatarsService');
    
    try {
      execSync(command, { stdio: 'inherit', maxBuffer: 1024 * 1024 * 10 });
      
      if (!fs.existsSync(outputPath)) {
        throw new Error('Background removal completed but output file not found');
      }
      
      this.logger.log(`[TransparentAvatar] Background removal completed: ${outputPath}`, 'AvatarsService');
    } catch (error: any) {
      this.logger.error(`[TransparentAvatar] Background removal failed: ${error.message}`, 'AvatarsService');
      
      // Provide helpful error message if rembg is not installed
      if (error.message && error.message.includes('No module named \'rembg\'')) {
        const venvPath = path.join(serviceRoot, 'venv');
        const requirementsPath = path.join(serviceRoot, 'scripts', 'requirements.txt');
        throw new Error(
          `rembg module not found. Please install Python dependencies:\n` +
          `1. Create virtual environment: python3 -m venv venv\n` +
          `2. Activate it: source venv/bin/activate\n` +
          `3. Install dependencies: pip install -r ${requirementsPath}\n` +
          `Note: Python 3.8-3.13 is recommended (Python 3.14 may not be compatible with onnxruntime)`
        );
      }
      
      throw new Error(`Background removal failed: ${error.message}`);
    }
  }

  /**
   * Process images on-demand for old avatars that don't have processed images
   */
  async processAvatarImagesOnDemand(avatarId: string, userId: string): Promise<{ jobId: string; message: string }> {
    try {
      // Fetch avatar record
      const avatar = await this.databaseService.avatar.findFirst({
        where: { id: avatarId, userId },
      });

      if (!avatar) {
        throw new NotFoundException(`Avatar ${avatarId} not found for user ${userId}`);
      }

      // Check if processed images already exist
      if (avatar.imageKeyHalfNHalf && avatar.imageKeyHalfNHalfWithWhite) {
        this.logger.log(`Avatar ${avatarId} already has processed images`, 'AvatarsService');
        return {
          jobId: '',
          message: 'Avatar already has processed images',
        };
      }

      // Get original image buffer
      let imageBuffer: Buffer | null = null;
      let originalImagePath: string | null = null;
      
      if (avatar.originalImageUrl) {
        // Try both old and new path formats
        const urlMatch = avatar.originalImageUrl.match(/\/uploads\/avatars\/([^\/]+)\/([^\/]+)\/(.+)$/) ||
                         avatar.originalImageUrl.match(/\/uploads\/avatars\/([^\/]+)\/(.+)$/);
        
        if (urlMatch) {
          let filePath: string | null = null;
          
          if (urlMatch.length === 4) {
            // New format: /uploads/avatars/{userId}/{avatarId}/{filename}
            const [, urlUserId, avatarIdFromUrl, filename] = urlMatch;
            const possiblePaths = [
              path.join(process.cwd(), 'uploads', 'avatars', urlUserId, avatarIdFromUrl, filename),
              path.join(process.cwd(), 'microservices', 'ai-content-service', 'uploads', 'avatars', urlUserId, avatarIdFromUrl, filename),
            ];
            
            for (const possiblePath of possiblePaths) {
              if (fs.existsSync(possiblePath)) {
                filePath = possiblePath;
                break;
              }
            }
          } else {
            // Old format: /uploads/avatars/{userId}/{filename}
            const [, urlUserId, filename] = urlMatch;
            const possiblePaths = [
              path.join(process.cwd(), 'uploads', 'avatars', urlUserId, filename),
              path.join(process.cwd(), 'microservices', 'ai-content-service', 'uploads', 'avatars', urlUserId, filename),
              path.join(process.cwd(), '..', '..', 'uploads', 'avatars', urlUserId, filename),
              path.join(process.cwd(), '..', 'uploads', 'avatars', urlUserId, filename),
            ];
            
            for (const possiblePath of possiblePaths) {
              if (fs.existsSync(possiblePath)) {
                filePath = possiblePath;
                break;
              }
            }
          }
          
          if (filePath && fs.existsSync(filePath)) {
            imageBuffer = fs.readFileSync(filePath);
            originalImagePath = filePath;
          }
        }
      }

      if (!imageBuffer) {
        throw new BadRequestException('Cannot process images: Original image file not found locally. Please ensure originalImageUrl is valid.');
      }

      // Ensure avatar directory exists (new structure)
      const avatarDir = path.join(process.cwd(), 'uploads', 'avatars', userId, avatarId);
      if (!fs.existsSync(avatarDir)) {
        fs.mkdirSync(avatarDir, { recursive: true });
      }

      // Move original image to new structure if it's in old location
      if (originalImagePath && avatar.originalImageUrl && !avatar.originalImageUrl.includes(`/${avatarId}/`)) {
        const oldPathMatch = avatar.originalImageUrl.match(/\/uploads\/avatars\/([^\/]+)\/(.+)$/);
        if (oldPathMatch) {
          const [, urlUserId, filename] = oldPathMatch;
          const oldPath = path.join(process.cwd(), 'uploads', 'avatars', urlUserId, filename);
          
          if (fs.existsSync(oldPath)) {
            const newImagePath = path.join(avatarDir, 'original.jpg');
            fs.copyFileSync(oldPath, newImagePath);
            
            await this.databaseService.avatar.update({
              where: { id: avatarId },
              data: {
                originalImageUrl: `/uploads/avatars/${userId}/${avatarId}/original.jpg`,
              },
            });
            
            imageBuffer = fs.readFileSync(newImagePath);
            this.logger.log(`Moved original image to new structure: ${newImagePath}`, 'AvatarsService');
          }
        }
      }

      // Queue image processing job
      const jobId = await this.avatarQueueService.addImageProcessingJob({
        avatarId: avatarId,
        userId: userId,
        imageBuffer: imageBuffer,
        originalImageKey: avatar.imageKey || '',
      });

      this.logger.log(`Queued image processing for old avatar ${avatarId}`, 'AvatarsService');

      return {
        jobId,
        message: 'Image processing job queued successfully',
      };
    } catch (error: any) {
      this.logger.error(`Failed to process images on-demand: ${error.message}`, error.stack, 'AvatarsService');
      throw error;
    }
  }
}

