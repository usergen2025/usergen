import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../common/database/database.service';
import { LoggerService } from '../common/logger/logger.service';
import { HeyGenProvider } from './providers/heygen.provider';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

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

@Injectable()
export class AvatarsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
    private readonly heygenProvider: HeyGenProvider,
    private readonly configService: ConfigService,
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

      // Create avatar record with temporary name first
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

      // Start background process: Create group -> Train -> Generate looks -> Add motion
      const createGroupJob = await this.databaseService.avatarGenerationJob.create({
        data: {
          userId: dto.userId,
          avatarId: avatar.id,
          provider: 'heygen',
          jobType: 'CREATE_GROUP',
          status: 'PENDING',
          imageKey: dto.imageKey,
          metadata: {
            step: 'create_group',
            assetId: dto.assetId, // Store assetId for use in createPhotoAvatarGroup
          },
        },
      });

      // Process in background (async, don't wait)
      this.processAvatarGeneration(avatar.id, createGroupJob.id).catch((error) => {
        this.logger.error(`Background avatar generation failed: ${error.message}`, error.stack, 'AvatarsService');
      });

      return {
        avatarId: avatar.id,
        jobId: createGroupJob.id,
      };
    } catch (error: any) {
      this.logger.error(`Failed to create avatar from upload: ${error.message}`, error.stack, 'AvatarsService');
      throw error;
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
        if (!avatar.originalImageUrl) {
          throw new Error('Original image URL not found. Cannot create transparent version.');
        }

        // Get absolute path to original image
        const imagePath = path.join(process.cwd(), avatar.originalImageUrl.replace(/^\/uploads\//, 'uploads/'));
        if (!fs.existsSync(imagePath)) {
          throw new Error(`Original image file not found: ${imagePath}`);
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
    const scriptPath = path.join(process.cwd(), 'scripts', 'remove_image_background.py');
    
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Background removal script not found: ${scriptPath}`);
    }

    const command = `python3 "${scriptPath}" "${inputPath}" "${outputPath}" "u2net_human_seg"`;
    
    this.logger.log(`[TransparentAvatar] Executing background removal: ${command}`, 'AvatarsService');
    
    try {
      execSync(command, { stdio: 'inherit', maxBuffer: 1024 * 1024 * 10 });
      
      if (!fs.existsSync(outputPath)) {
        throw new Error('Background removal completed but output file not found');
      }
      
      this.logger.log(`[TransparentAvatar] Background removal completed: ${outputPath}`, 'AvatarsService');
    } catch (error: any) {
      this.logger.error(`[TransparentAvatar] Background removal failed: ${error.message}`, 'AvatarsService');
      throw new Error(`Background removal failed: ${error.message}`);
    }
  }
}

