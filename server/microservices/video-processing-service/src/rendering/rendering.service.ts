import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../common/database/database.service';
import { BytePlusProvider } from './providers/byteplus.provider';
import { HeyGenVideoProvider } from './providers/heygen-video.provider';
import { VideoCompositorProvider } from './providers/video-compositor.provider';
import { PublicUrlService } from '../common/storage/public-url.service';
import { getRenderingRollbackStep } from '../common/constants/video-steps';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class RenderingService {
  private readonly uploadsDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly bytePlusProvider: BytePlusProvider,
    private readonly heygenVideoProvider: HeyGenVideoProvider,
    private readonly videoCompositor: VideoCompositorProvider,
    private readonly publicUrlService: PublicUrlService,
  ) {
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  /**
   * Convert video style enum to kebab-case directory name
   * HALF_N_HALF -> half-n-half
   * AVATAR_CUTOUT -> avatar-cutout
   * ALTERNATE -> alternate
   */
  private getStyleDirectoryName(style: string | null | undefined): string {
    if (!style) {
      return 'unknown';
    }
    return style.toLowerCase().replace(/_/g, '-');
  }

  /**
   * Generate a hash of file paths and modification times to detect changes
   */
  private generateSourceHash(filePaths: string[]): string {
    const hash = crypto.createHash('sha256');
    
    for (const filePath of filePaths) {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        // Include file path and modification time in hash
        hash.update(`${filePath}:${stats.mtimeMs}:${stats.size}`);
      } else {
        hash.update(`${filePath}:missing`);
      }
    }
    
    return hash.digest('hex');
  }

  /**
   * Get cached intermediate file path from database
   */
  private getCachedIntermediateFile(project: any, fileType: 'stitched_broll' | 'stitched_audio'): { path: string; sourceHash: string } | null {
    const metadata = (project.metadata as any) || {};
    const intermediateFiles = metadata.intermediateFiles || {};
    const cached = intermediateFiles[fileType];
    
    if (cached && cached.path && fs.existsSync(cached.path)) {
      return cached;
    }
    
    return null;
  }

  /**
   * Save cached intermediate file path to database
   */
  private async saveCachedIntermediateFile(
    projectId: string,
    fileType: 'stitched_broll' | 'stitched_audio',
    filePath: string,
    sourceHash: string
  ): Promise<void> {
    const project = await this.databaseService.videoProject.findUnique({
      where: { id: projectId },
    });
    
    if (!project) return;
    
    const metadata = (project.metadata as any) || {};
    const intermediateFiles = metadata.intermediateFiles || {};
    
    intermediateFiles[fileType] = {
      path: filePath,
      sourceHash: sourceHash,
      cachedAt: new Date().toISOString(),
    };
    
    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        metadata: {
          ...metadata,
          intermediateFiles: intermediateFiles,
        } as any,
      },
    });
  }

  /**
   * Public method for AlternateAvatarService and other consumers to fetch avatar details for ALTERNATE style
   */
  async getAvatarDetailsForAlternate(avatarId: string, userId: string, authToken?: string) {
    return this.fetchAvatarDetails(avatarId, userId, authToken, false, true);
  }

  /**
   * Fetch avatar details from ai-content-service or HeyGen API to get talking_photo_id and imageKey
   * First tries to fetch from ai-content-service (for internal IDs) using userId.
   * If that fails with 404, tries HeyGen API as fallback.
   * @param useTransparent If true, will fetch/create transparent imageKey for CUTOUT mode
   * @param useHalfNHalf If true, will fetch imageKeyHalfNHalfWithWhite for HALF_N_HALF Premium mode
   */
  private async fetchAvatarDetails(avatarId: string, userId: string, authToken?: string, useTransparent: boolean = false, useHalfNHalf: boolean = false): Promise<{ providerAvatarId: string; imageKey?: string; imageKeyHalfNHalfWithWhite?: string; isHeyGenId: boolean }> {
    try {
      // First, try to fetch from ai-content-service (for internal IDs)
      const aiContentServiceUrl = this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9001';
      try {
        // IMPORTANT: Pass userId as query parameter to match the avatar correctly
        // authToken from controller already includes "Bearer " prefix, so use it directly
        const headers: Record<string, string> = {};
        if (authToken) {
          // If authToken already has "Bearer ", use it as-is, otherwise add it
          headers.Authorization = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
        }
        
        console.log(`[RenderingService] Fetching avatar ${avatarId} for userId ${userId} from ${aiContentServiceUrl}/api/avatars/${avatarId}`);
        const response = await axios.get(`${aiContentServiceUrl}/api/avatars/${avatarId}`, {
          headers,
          params: { userId }, // Pass userId to find the correct avatar
        });
        
        if (response.data?.success && response.data?.data) {
          // Internal avatar ID found - use providerAvatarId from ai-content-service
          const avatarData = response.data.data;
          let providerAvatarId = avatarData.providerAvatarId;
          
          // If providerAvatarId is not set, check generationMetadata for motionAvatarId
          if (!providerAvatarId) {
            const generationMetadata = avatarData.generationMetadata as any;
            if (generationMetadata) {
              providerAvatarId = generationMetadata.motionAvatarId || generationMetadata.motion_id;
              if (providerAvatarId) {
                console.log(`[RenderingService] Found motionAvatarId in generationMetadata: ${providerAvatarId}`);
              }
            }
          }
          
          if (!providerAvatarId) {
            throw new Error('Provider avatar ID (motion ID) not found in avatar details. Avatar may not be ready yet. Generation status: ' + (avatarData.generationStatus || 'unknown'));
          }
          
          // Get imageKey for Premium mode (Avatar IV)
          // For CUTOUT mode, use transparent imageKey if available (created from processed 1080x1920)
          // For HALF_N_HALF Premium mode, use imageKeyHalfNHalfWithWhite if available
          // For ALTERNATE Premium mode, use imageKey (which should be imageKeyFull - processed 1080x1920)
          // Note: imageKey gets updated to imageKeyFull after processing completes
          let imageKey = avatarData.imageKey;
          let imageKeyHalfNHalfWithWhite: string | undefined;
          
          // For ALTERNATE and CUTOUT Premium modes, ensure we use processed imageKeyFull if available
          // Check if processed images exist (imageKeyFull is stored in imageKey after processing)
          // For old avatars that haven't been processed, imageKey will still be original
          // In that case, we'll use the original (fallback behavior)
          
          if (useHalfNHalf) {
            console.log(`[RenderingService] HALF_N_HALF Premium mode: Checking for processed image key...`);
            
            // Check if HALF_N_HALF processed version exists
            if (avatarData.imageKeyHalfNHalfWithWhite) {
              imageKeyHalfNHalfWithWhite = avatarData.imageKeyHalfNHalfWithWhite;
              console.log(`[RenderingService] HALF_N_HALF Premium mode: Using processed imageKeyHalfNHalfWithWhite: ${imageKeyHalfNHalfWithWhite}`);
            } else {
              // Old avatar - trigger on-demand processing
              console.log(`[RenderingService] HALF_N_HALF Premium mode: ⚠️  Processed image key not found for old avatar, triggering on-demand processing...`);
              try {
                const headers: Record<string, string> = {};
                if (authToken) {
                  headers.Authorization = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
                }
                
                const processResponse = await axios.post(
                  `${aiContentServiceUrl}/api/avatars/${avatarId}/process-images`,
                  {},
                  { 
                    headers,
                    params: { userId },
                    timeout: 5000, // Short timeout - don't wait for completion
                  }
                );
                
                if (processResponse.data?.data?.jobId) {
                  console.log(`[RenderingService] HALF_N_HALF Premium mode: ✅ Image processing job queued (jobId: ${processResponse.data.data.jobId})`);
                  console.log(`[RenderingService] HALF_N_HALF Premium mode: ⚠️  Using default imageKey for now. Processed images will be available for future generations.`);
                }
              } catch (processError: any) {
                console.error(`[RenderingService] HALF_N_HALF Premium mode: ❌ Failed to trigger on-demand processing: ${processError.message}`);
                console.warn(`[RenderingService] HALF_N_HALF Premium mode: ⚠️  Using default imageKey (may not be optimal for HALF_N_HALF)`);
              }
              
              // Fall back to default imageKey
              imageKeyHalfNHalfWithWhite = undefined;
            }
          } else if (useTransparent) {
            console.log(`[RenderingService] CUTOUT mode: Checking for transparent imageKey...`);
            
            // Check if transparent version exists
            if (avatarData.transparentImageKey) {
              imageKey = avatarData.transparentImageKey;
              console.log(`[RenderingService] CUTOUT mode: Using existing transparent imageKey: ${imageKey}`);
            } else {
              // Create transparent version on-demand from processed 1080x1920 image
              // The create-transparent endpoint now uses processed full_9x16_1080x1920.jpg if available
              console.log(`[RenderingService] CUTOUT mode: Transparent version not found, creating from processed 1080x1920 image...`);
              try {
                const aiContentServiceUrl = this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9001';
                const headers: Record<string, string> = {};
                if (authToken) {
                  headers.Authorization = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
                }
                
                const transparentResponse = await axios.post(
                  `${aiContentServiceUrl}/api/avatars/${avatarId}/create-transparent`,
                  {},
                  { headers }
                );
                
                if (transparentResponse.data?.success && transparentResponse.data?.data?.imageKey) {
                  imageKey = transparentResponse.data.data.imageKey;
                  console.log(`[RenderingService] CUTOUT mode: ✅ Transparent version created successfully from processed image. ImageKey: ${imageKey}`);
                } else {
                  console.warn(`[RenderingService] CUTOUT mode: ⚠️  Failed to create transparent version, using processed imageKey`);
                  // Use processed imageKey (imageKeyFull) if available, otherwise fall back to original
                }
              } catch (transparentError: any) {
                console.error(`[RenderingService] CUTOUT mode: ❌ Failed to create transparent version: ${transparentError.message}`);
                console.warn(`[RenderingService] CUTOUT mode: ⚠️  Using processed imageKey (video may have background)`);
                // Use processed imageKey (imageKeyFull) if available, otherwise fall back to original
              }
            }
          } else {
            // ALTERNATE mode (no special params)
            // imageKey should be imageKeyFull (processed 1080x1920) after processing completes
            // For old avatars, it might still be original, but that's acceptable
            console.log(`[RenderingService] ALTERNATE mode: Using imageKey (processed 1080x1920 if available): ${imageKey || 'not available'}`);
          }
          
          console.log(`[RenderingService] Found internal avatar ${avatarId}, using providerAvatarId (motion ID): ${providerAvatarId}, imageKey: ${imageKey || 'not available'}, imageKeyHalfNHalfWithWhite: ${imageKeyHalfNHalfWithWhite || 'not available'}`);
          return { providerAvatarId, imageKey, imageKeyHalfNHalfWithWhite, isHeyGenId: false };
        }
      } catch (aiContentError: any) {
        // Log detailed error information for debugging
        console.error(`[RenderingService] Failed to fetch avatar from ai-content-service:`, {
          avatarId,
          userId,
          status: aiContentError.response?.status,
          statusText: aiContentError.response?.statusText,
          errorMessage: aiContentError.message,
          responseData: aiContentError.response?.data,
          url: `${aiContentServiceUrl}/api/avatars/${avatarId}?userId=${userId}`,
        });
        
        // If 404, try HeyGen API as fallback (for any ID format)
        if (aiContentError.response?.status === 404) {
          console.log(`[RenderingService] Avatar ${avatarId} not found in ai-content-service (404) for userId ${userId}. This could mean:`);
          console.log(`[RenderingService] 1. Avatar doesn't exist in database`);
          console.log(`[RenderingService] 2. Avatar exists but belongs to a different userId`);
          console.log(`[RenderingService] 3. Database mismatch between services`);
          console.log(`[RenderingService] Trying HeyGen API as fallback...`);
          
          try {
            const heygenAvatarDetails = await this.heygenVideoProvider.getAvatarDetails(avatarId);
            console.log(`[RenderingService] Avatar ${avatarId} found in HeyGen API, using directly as talking_photo_id`);
            return { providerAvatarId: avatarId, isHeyGenId: true };
          } catch (heygenError: any) {
            // HeyGen API also failed - provide more detailed error
            const heygenErrorMsg = heygenError.response?.data?.msg || heygenError.response?.data?.error?.message || heygenError.message;
            throw new Error(`Avatar ${avatarId} not found in ai-content-service or HeyGen. AI Content Service: ${aiContentError.message}. HeyGen: ${heygenErrorMsg}`);
          }
        } else {
          // Other error from ai-content-service (not 404)
          throw aiContentError;
        }
      }
      
      throw new Error('Failed to fetch avatar details');
    } catch (error: any) {
      console.error(`[RenderingService] Failed to fetch avatar details for ${avatarId}:`, error.message);
      throw new Error(`Failed to fetch avatar details: ${error.message}`);
    }
  }

  /**
   * Start rendering process for a video project
   */
  async startRendering(projectId: string, userId: string, authToken?: string): Promise<{ success: boolean; message: string }> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    // Update project status to IN_PROGRESS
    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'IN_PROGRESS',
        renderingStatus: 'avatar_generating' as any,
        renderingProgress: 0 as any,
        startedAt: new Date(),
      },
    });

    // Start rendering in background (don't await)
    this.processVideoRendering(projectId, userId, authToken).catch(async (error) => {
      console.error(`[RenderingService] Rendering failed for project ${projectId}:`, error);
      
      // Get current project to determine which step to rollback to
      const currentProject = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });
      
      // Determine rollback step using step configuration
      // Default to step before RENDERING (BROLL_VIDEOS)
      let rollbackStep: string = getRenderingRollbackStep();
      
      // Refine based on project state (more reliable than reading currentStep, since enum update may fail)
      const bRollVideos = (currentProject as any)?.bRollVideoTasks;
      const bRollImages = (currentProject as any)?.bRollImages;
      
      if (bRollVideos && Array.isArray(bRollVideos) && bRollVideos.length > 0) {
        rollbackStep = 'BROLL_VIDEOS';
      } else if (bRollImages && Array.isArray(bRollImages) && bRollImages.length > 0) {
        rollbackStep = 'BROLL_IMAGES';
      }
      
      // Also try to read currentStep as a fallback
      try {
        const currentStep = currentProject?.currentStep as string;
        if (currentStep === 'BROLL_VIDEOS' || currentStep === 'B_ROLL') {
          rollbackStep = 'BROLL_VIDEOS';
        } else if (currentStep === 'BROLL_IMAGES') {
          rollbackStep = 'BROLL_IMAGES';
        }
      } catch (e) {
        // If we can't read currentStep (enum issue), use project state check above
        console.warn(`[RenderingService] Could not read currentStep, using project state instead`);
      }
      
      console.log(`[RenderingService] Rolling back to step: ${rollbackStep}`);
      
      // Update project with error - use multiple fallback strategies
      try {
        // First try normal update
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: {
            status: 'FAILED',
            renderingStatus: 'failed' as any,
            currentStep: rollbackStep as any,
            errorMessage: error.message || 'Video rendering failed',
            errorCode: 'RENDERING_FAILED',
          },
        });
      } catch (updateError: any) {
        // If enum update fails, try raw SQL
        console.warn(`[RenderingService] Normal update failed (enum issue), trying raw SQL: ${updateError.message}`);
        try {
          await this.databaseService.$executeRawUnsafe(`
            UPDATE "video_projects" 
            SET 
              "status" = 'FAILED',
              "renderingStatus" = 'failed',
              "currentStep" = $1::text::"VideoCreationStep",
              "errorMessage" = $2,
              "errorCode" = 'RENDERING_FAILED',
              "updatedAt" = NOW()
            WHERE "id" = $3
          `, rollbackStep, error.message || 'Video rendering failed', projectId);
          console.log(`[RenderingService] Successfully updated project status using raw SQL`);
        } catch (rawSqlError: any) {
          // If raw SQL also fails, store rollback step in metadata
          console.error(`[RenderingService] Raw SQL update also failed: ${rawSqlError.message}`);
          const metadata = (currentProject?.metadata as any) || {};
          metadata.rollbackStep = rollbackStep;
          
          try {
            await this.databaseService.videoProject.update({
              where: { id: projectId },
              data: {
                status: 'FAILED',
                renderingStatus: 'failed' as any,
                errorMessage: error.message || 'Video rendering failed',
                errorCode: 'RENDERING_FAILED',
                metadata: metadata,
              },
            });
            console.log(`[RenderingService] Stored rollback step in metadata: ${rollbackStep}`);
          } catch (metadataError: any) {
            // Last resort: just log the error
            console.error(`[RenderingService] All update methods failed. Rollback step: ${rollbackStep}`, metadataError.message);
          }
        }
      }
    });

    return {
      success: true,
      message: 'Video rendering started',
    };
  }

  /**
   * Main rendering orchestrator - processes all phases based on video style
   */
  private async processVideoRendering(projectId: string, userId: string, authToken?: string): Promise<void> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Get audio files (should already be generated)
    const audioFiles = (project.audioFiles as any[]) || [];
    if (audioFiles.length === 0) {
      throw new Error('Audio files not found. Please generate audio first.');
    }

    // Get b-roll images and videos (should already be generated on broll-images and broll-videos pages)
    const bRollImages = ((project as any).bRollImages as any[]) || [];
    const bRollVideos = ((project as any).bRollVideoTasks as any[]) || [];

    try {
      // Handle different video styles
      if (project.style === 'HALF_N_HALF') {
        await this.processHalfAndHalf(projectId, userId, audioFiles, bRollImages, bRollVideos, project, authToken);
      } else if (project.style === 'AVATAR_CUTOUT') {
        await this.processCutout(projectId, userId, audioFiles, bRollVideos, project, authToken);
      } else if (project.style === 'ALTERNATE') {
        await this.processAlternate(projectId, userId, audioFiles, bRollVideos, project, authToken);
      } else if (project.style === 'AVATAR_ONLY') {
        await this.processAvatarOnly(projectId, userId, audioFiles, project, authToken);
      } else if (project.style === 'PRODUCT_ONLY') {
        await this.processProductOnly(projectId, userId, audioFiles, bRollVideos, project);
      } else if (project.style === 'AVATAR_PRODUCT') {
        await this.processAvatarProduct(projectId, userId, audioFiles, bRollVideos, project, authToken);
      } else {
        throw new Error(`Unsupported video style: ${project.style}`);
      }
    } catch (error: any) {
      console.error(`[RenderingService] Error in rendering process:`, error);
      throw error;
    }
  }

  /**
   * Process HALF_N_HALF style:
   * - B-roll videos are 3:4 ratio (generated from images on broll-images page)
   * - Stitch all b-roll videos together
   * - Stitch all audios together
   * - Generate one avatar video from full audio with greyish background
   * - Stack avatar video below b-roll video for final 9:16 video
   */
  private async processHalfAndHalf(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollImages: any[],
    bRollVideos: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing HALF_N_HALF style for project ${projectId}`);

    if (!project.avatarId) {
      throw new Error('Avatar ID required for HALF_N_HALF style');
    }

    // Sort b-roll videos and audio files by scene number
    const sortedBrollVideos = [...bRollVideos].sort((a, b) => a.sceneNumber - b.sceneNumber);
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);

    await this.updateRenderingStatus(projectId, 'stitching_broll', 20);
    
    // Stitch all b-roll videos together
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    
    // Convert paths to absolute paths before concatenation
    // Log all videos for debugging
    console.log(`[RenderingService] HALF_N_HALF: Processing ${sortedBrollVideos.length} b-roll videos:`, 
      sortedBrollVideos.map(v => ({
        sceneNumber: v.sceneNumber,
        hasLocalPath: !!v.localPath,
        localPath: v.localPath,
        hasLocalUrl: !!v.localUrl,
        localUrl: v.localUrl,
      }))
    );
    
    const brollVideoPaths = sortedBrollVideos
      .map(v => {
        // Try localPath first, then derive from localUrl if needed
        let videoPath: string | null = null;
        
        if (v.localPath) {
          // Convert to absolute path if relative
          videoPath = path.isAbsolute(v.localPath) 
            ? v.localPath 
            : path.resolve(v.localPath);
        } else if (v.localUrl) {
          // If no localPath, try to derive from localUrl
          // localUrl format: /uploads/videos/{userId}/{filename}
          const urlPath = v.localUrl.startsWith('/uploads') ? v.localUrl : v.localUrl;
          const relativePath = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
          videoPath = path.join(userDir, relativePath);
        }
        
        if (!videoPath) {
          console.warn(`[RenderingService] HALF_N_HALF: Scene ${v.sceneNumber} has no localPath or localUrl`);
          return null;
        }
        
        if (!fs.existsSync(videoPath)) {
          console.warn(`[RenderingService] HALF_N_HALF: Video file not found for scene ${v.sceneNumber}: ${videoPath}`);
          return null;
        }
        
        return videoPath;
      })
      .filter((p): p is string => p !== null);
    
    if (brollVideoPaths.length === 0) {
      throw new Error('No valid b-roll video paths found for stitching');
    }
    
    // Check for cached stitched b-roll video
    const sourceHashBroll = this.generateSourceHash(brollVideoPaths);
    const cachedBroll = this.getCachedIntermediateFile(project, 'stitched_broll');
    
    let stitchedBrollPath: string;
    
    if (cachedBroll && cachedBroll.sourceHash === sourceHashBroll) {
      console.log(`[RenderingService] HALF_N_HALF: Reusing cached stitched b-roll video: ${cachedBroll.path}`);
      stitchedBrollPath = cachedBroll.path;
    } else {
      // Generate new stitched b-roll video with consistent filename
      stitchedBrollPath = path.join(userDir, `stitched_broll_${projectId}.mp4`);
      
      console.log(`[RenderingService] HALF_N_HALF: Stitching ${brollVideoPaths.length} videos (filtered from ${sortedBrollVideos.length})...`);
    await this.videoCompositor.concatenateVideos(brollVideoPaths, stitchedBrollPath);
      
      // Save to cache
      await this.saveCachedIntermediateFile(projectId, 'stitched_broll', stitchedBrollPath, sourceHashBroll);
      console.log(`[RenderingService] HALF_N_HALF: Stitched b-roll video cached`);
    }

    await this.updateRenderingStatus(projectId, 'stitching_audio', 40);

    // Stitch all audio files together
    // Convert file paths to absolute paths (same logic as CUTOUT)
    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');
    
    const audioPaths = sortedAudioFiles.map(af => {
      if (!af.filePath) return null;
      
      // Try multiple path resolution strategies
      let resolvedPath: string | null = null;
      
      if (path.isAbsolute(af.filePath) && fs.existsSync(af.filePath)) {
        resolvedPath = af.filePath;
      } else {
        const voiceServicePath = path.join(voiceServiceDir, af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
        if (fs.existsSync(voiceServicePath)) {
          resolvedPath = voiceServicePath;
        } else {
          const serverRootPath = path.join(serverRoot, af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
          if (fs.existsSync(serverRootPath)) {
            resolvedPath = serverRootPath;
          } else {
            const cwdPath = path.join(process.cwd(), af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
            if (fs.existsSync(cwdPath)) {
              resolvedPath = cwdPath;
            }
          }
        }
      }
      
      if (!resolvedPath) {
        console.warn(`[RenderingService] Audio file not found. Tried: ${af.filePath}`);
      }
      return resolvedPath;
    }).filter(p => p !== null && fs.existsSync(p)) as string[];
    
    if (audioPaths.length === 0) {
      throw new Error('No valid audio file paths found for stitching');
    }
    
    // Check for cached stitched audio
    const sourceHashAudio = this.generateSourceHash(audioPaths);
    const cachedAudio = this.getCachedIntermediateFile(project, 'stitched_audio');
    
    let stitchedAudioPath: string;
    
    if (cachedAudio && cachedAudio.sourceHash === sourceHashAudio) {
      console.log(`[RenderingService] HALF_N_HALF: Reusing cached stitched audio: ${cachedAudio.path}`);
      stitchedAudioPath = cachedAudio.path;
    } else {
      // Generate new stitched audio with consistent filename
      stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}.mp3`);
      
      console.log(`[RenderingService] HALF_N_HALF: Stitching ${audioPaths.length} audio files...`);
    await this.videoCompositor.concatenateAudios(audioPaths, stitchedAudioPath);
      
      // Save to cache
      await this.saveCachedIntermediateFile(projectId, 'stitched_audio', stitchedAudioPath, sourceHashAudio);
      console.log(`[RenderingService] HALF_N_HALF: Stitched audio cached`);
    }

    await this.updateRenderingStatus(projectId, 'avatar_generating', 60);

    // Generate one avatar video from full stitched audio with greyish background
    // Check if avatar video already exists from previous attempt
    let avatarVideoPath: string | null = null;
    let originalAvatarVideoPath: string | null = null;
    let imageKeyHalfNHalfWithWhite: string | undefined;
    const existingAvatarVideos = (project.avatarVideos as any) || [];
    const avatarMode = (project.avatarMode as string) || 'BASIC';
    const existingAvatarVideo = existingAvatarVideos.find((av: any) => 
      av.type === 'HALF_N_HALF' && av.mode === avatarMode
    );

    if (existingAvatarVideo && existingAvatarVideo.originalPath && fs.existsSync(existingAvatarVideo.originalPath)) {
      console.log(`[RenderingService] HALF_N_HALF: Reusing existing avatar video from previous attempt: ${existingAvatarVideo.originalPath}`);
      originalAvatarVideoPath = existingAvatarVideo.originalPath;
      avatarVideoPath = existingAvatarVideo.originalPath;
      
      // Check if cropped version exists for Premium mode
      if (avatarMode === 'PREMIUM' && existingAvatarVideo.croppedPath && fs.existsSync(existingAvatarVideo.croppedPath)) {
        console.log(`[RenderingService] HALF_N_HALF Premium: Reusing existing cropped video: ${existingAvatarVideo.croppedPath}`);
        avatarVideoPath = existingAvatarVideo.croppedPath;
      } else if (avatarMode === 'BASIC') {
        // For Basic mode, original is the final processed video
        avatarVideoPath = existingAvatarVideo.originalPath;
      }
      
      // Ensure finalProcessedPath is set if not already set
      if (!existingAvatarVideo.finalProcessedPath) {
        const updatedProject = await this.databaseService.videoProject.findUnique({
          where: { id: projectId },
        });
        const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
        const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
          av.type === 'HALF_N_HALF' && av.mode === avatarMode
        );
        
        if (avatarVideoIndex >= 0) {
          updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = avatarVideoPath;
          updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = avatarMode === 'PREMIUM' && existingAvatarVideo.croppedUrl 
            ? existingAvatarVideo.croppedUrl 
            : existingAvatarVideo.originalUrl;
          
          await this.databaseService.videoProject.update({
            where: { id: projectId },
            data: {
              avatarVideos: updatedAvatarVideos as any,
            },
          });
        }
      }
    } else {
      // Generate new avatar video
      console.log(`[RenderingService] HALF_N_HALF: Generating new avatar video...`);
      
    if (!fs.existsSync(stitchedAudioPath)) {
      throw new Error(`Stitched audio file not found: ${stitchedAudioPath}`);
    }
    const audioBuffer = fs.readFileSync(stitchedAudioPath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `full_audio_${projectId}.mp3`);

    // Fetch avatar details to get talking_photo_id and imageKey
      // For HALF_N_HALF Premium, fetch the processed image key with white top
      const avatarDetails = await this.fetchAvatarDetails(project.avatarId, userId, authToken, false, true);
    const talkingPhotoId = avatarDetails.providerAvatarId; // This is the motion avatar ID
    const imageKey = avatarDetails.imageKey; // For Premium mode (Avatar IV)
      imageKeyHalfNHalfWithWhite = avatarDetails.imageKeyHalfNHalfWithWhite; // For HALF_N_HALF Premium

    console.log(`[RenderingService] HALF_N_HALF: Using avatar mode: ${avatarMode}`);

    let videoResponse: { video_id: string };

    if (avatarMode === 'PREMIUM') {
      // Use Avatar IV API for Premium mode
        // Use processed image key with white top for HALF_N_HALF
        const imageKeyToUse = imageKeyHalfNHalfWithWhite || imageKey;
        
        if (!imageKeyToUse) {
        throw new Error('Image key not found. Avatar IV (Premium) requires image_key from the original upload.');
      }
      
        if (imageKeyHalfNHalfWithWhite) {
          console.log(`[RenderingService] Using Avatar IV (Premium) with processed HALF_N_HALF image_key: ${imageKeyHalfNHalfWithWhite}`);
        } else {
          console.log(`[RenderingService] Using Avatar IV (Premium) with default image_key: ${imageKey} (processed key not available)`);
        }
        
      videoResponse = await this.heygenVideoProvider.generateAvatarIVVideo({
          image_key: imageKeyToUse,
        video_title: `Avatar Video ${projectId}`,
        audio_asset_id: audioAssetId,
        video_orientation: 'portrait', // 9:16 is portrait
        fit: 'cover', // Cover the screen
      });
    } else {
      // Use standard Avatar API for Basic mode
      if (!talkingPhotoId) {
        throw new Error('Avatar motion ID (talking_photo_id) not found. Avatar may not be ready yet.');
      }
      
      console.log(`[RenderingService] Using standard Avatar API (Basic) with talking_photo_id: ${talkingPhotoId}`);
      // Generate avatar video with greyish background (1080x960 for bottom half - direct dimension, no scaling needed)
      videoResponse = await this.heygenVideoProvider.generateAvatarVideo({
        talking_photo_id: talkingPhotoId, // Use motion avatar ID
        audio_asset_id: audioAssetId,
        dimension: {
          width: 1080,
          height: 960, // Direct bottom half dimension (no scaling needed)
        },
        caption: false,
      });
    }

    console.log(`[RenderingService] Created avatar video task ${videoResponse.video_id}`);
    const completedVideo = await this.heygenVideoProvider.pollVideoUntilComplete(videoResponse.video_id);

    if (!completedVideo.data.video_url) {
      throw new Error('Avatar video generation completed but no video URL');
    }

      // Create directory structure: avatars/{projectId}/{styleType}/{avatarType}/
      const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
      const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
      const avatarDir = path.join(userDir, 'avatars', projectId, styleType, avatarType);
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

      // Use consistent filename based on projectId (not timestamp) for retry capability
      const avatarVideoFilename = `avatar_full_${projectId}.mp4`;
      originalAvatarVideoPath = path.join(avatarDir, avatarVideoFilename);
      
      // Only download if file doesn't exist
      if (!fs.existsSync(originalAvatarVideoPath)) {
        await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, originalAvatarVideoPath);
        console.log(`[RenderingService] HALF_N_HALF: Avatar video downloaded to: ${originalAvatarVideoPath}`);
      } else {
        console.log(`[RenderingService] HALF_N_HALF: Avatar video already exists, skipping download: ${originalAvatarVideoPath}`);
      }
      
      avatarVideoPath = originalAvatarVideoPath;
      
      // Save avatar video info to database for future retries
      const avatarVideoInfo = {
        type: 'HALF_N_HALF',
        mode: avatarMode,
        originalPath: originalAvatarVideoPath,
        originalUrl: `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${avatarVideoFilename}`,
        videoId: videoResponse.video_id, // Use the video_id from the response, not from completedVideo.data
        videoUrl: completedVideo.data.video_url,
        generatedAt: new Date().toISOString(),
        dimensions: avatarMode === 'PREMIUM' ? '1080x1920' : '1080x960',
      };
      
      // Update project with avatar video info
      const updatedAvatarVideos = existingAvatarVideos.filter((av: any) => 
        !(av.type === 'HALF_N_HALF' && av.mode === avatarMode)
      );
      updatedAvatarVideos.push(avatarVideoInfo);
      
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          avatarVideos: updatedAvatarVideos as any,
        },
      });
      
      console.log(`[RenderingService] HALF_N_HALF: Avatar video info saved to database for retry capability`);
    }

    // For HALF_N_HALF Premium mode, crop the white top portion (remove top 960px, keep bottom 960px)
    // Fetch avatar details again if we reused existing video (imageKeyHalfNHalfWithWhite not set)
    if (avatarMode === 'PREMIUM' && originalAvatarVideoPath && !imageKeyHalfNHalfWithWhite) {
      const avatarDetails = await this.fetchAvatarDetails(project.avatarId, userId, authToken, false, true);
      imageKeyHalfNHalfWithWhite = avatarDetails.imageKeyHalfNHalfWithWhite;
    }
    
    if (avatarMode === 'PREMIUM' && imageKeyHalfNHalfWithWhite && originalAvatarVideoPath) {
      console.log(`[RenderingService] HALF_N_HALF Premium: Cropping white top portion from avatar video...`);
      
      // Use consistent filename for cropped version
      const croppedAvatarFilename = `avatar_cropped_${projectId}.mp4`;
      const croppedAvatarPath = path.join(path.dirname(originalAvatarVideoPath), croppedAvatarFilename);
      
      // Check if cropped version already exists
      if (!fs.existsSync(croppedAvatarPath)) {
        try {
          // Get video dimensions first to validate crop parameters
          const videoRes = await this.videoCompositor.getVideoResolution(originalAvatarVideoPath);
          if (!videoRes) {
            throw new Error('Failed to get video resolution');
          }
          
          console.log(`[RenderingService] HALF_N_HALF Premium: Video dimensions: ${videoRes.width}x${videoRes.height}`);
          
          // If video is not 1080x1920, scale it first
          if (videoRes.width !== 1080 || videoRes.height !== 1920) {
            console.log(`[RenderingService] HALF_N_HALF Premium: Scaling video from ${videoRes.width}x${videoRes.height} to 1080x1920`);
            const scaledPath = path.join(path.dirname(originalAvatarVideoPath), `avatar_scaled_${projectId}.mp4`);
            await this.videoCompositor.scaleVideoToDimensions(originalAvatarVideoPath, scaledPath, 1080, 1920);
            
            if (fs.existsSync(scaledPath)) {
              // Use scaled version for cropping
              await this.videoCompositor.cropVideo(
                scaledPath,
                croppedAvatarPath,
                0,      // x offset
                960,    // y offset (start from 960px down - skip white top)
                1080,   // width
                960     // height (crop to 1080x960)
              );
              
              // Cleanup scaled version after cropping
              try {
                fs.unlinkSync(scaledPath);
              } catch (e) {
                console.warn(`[RenderingService] Failed to cleanup scaled video: ${e}`);
              }
            } else {
              throw new Error('Video scaling failed');
            }
          } else {
            // Video is already correct size, just crop it
            await this.videoCompositor.cropVideo(
              originalAvatarVideoPath,
              croppedAvatarPath,
              0,      // x offset
              960,    // y offset (start from 960px down - skip white top)
              1080,   // width
              960     // height (crop to 1080x960)
            );
          }
          
          if (fs.existsSync(croppedAvatarPath)) {
            avatarVideoPath = croppedAvatarPath;
            console.log(`[RenderingService] HALF_N_HALF Premium: ✅ Video cropped successfully to 1080x960`);
            
            // Update database with cropped path and final processed path
            // Refetch project to get latest avatarVideos
            const updatedProject = await this.databaseService.videoProject.findUnique({
              where: { id: projectId },
            });
            const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
            const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
              av.type === 'HALF_N_HALF' && av.mode === avatarMode
            );
            
            if (avatarVideoIndex >= 0) {
              const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
              const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
              updatedAvatarVideos[avatarVideoIndex].croppedPath = croppedAvatarPath;
              updatedAvatarVideos[avatarVideoIndex].croppedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${croppedAvatarFilename}`;
              updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = croppedAvatarPath; // Final video used for composition
              updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${croppedAvatarFilename}`;
              
              await this.databaseService.videoProject.update({
                where: { id: projectId },
                data: {
                  avatarVideos: updatedAvatarVideos as any,
                },
              });
              
              console.log(`[RenderingService] HALF_N_HALF Premium: ✅ Cropped video path saved to database`);
            }
          }
        } catch (cropError: any) {
          console.error(`[RenderingService] HALF_N_HALF Premium: ⚠️ Crop failed: ${cropError.message}`);
          console.log(`[RenderingService] HALF_N_HALF Premium: Using original video (cropping can be retried later)`);
          // Don't throw - use original video as fallback
          // The original video is preserved, so user can retry cropping
          avatarVideoPath = originalAvatarVideoPath;
        }
      } else {
        console.log(`[RenderingService] HALF_N_HALF Premium: Cropped video already exists, reusing: ${croppedAvatarPath}`);
        avatarVideoPath = croppedAvatarPath;
      }
    } else if (avatarMode === 'BASIC' && originalAvatarVideoPath) {
      // For Basic mode HALF_N_HALF, the video is already 1080x960, so it's the final processed video
      // Update database to mark this as the final processed path
      const updatedProject = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
      });
      const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
      const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
        av.type === 'HALF_N_HALF' && av.mode === avatarMode
      );
      
      if (avatarVideoIndex >= 0) {
        const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
        const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
        updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = originalAvatarVideoPath;
        updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/avatar_full_${projectId}.mp4`;
        
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: {
            avatarVideos: updatedAvatarVideos as any,
          },
        });
        
        console.log(`[RenderingService] HALF_N_HALF Basic: ✅ Final processed video path saved to database`);
      }
    }

    await this.updateRenderingStatus(projectId, 'stitching', 80);

    // Stack avatar video below b-roll video for final 9:16 video
    const finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.compositeHalfAndHalf(
      stitchedBrollPath,
      avatarVideoPath,
      finalVideoPath,
      1080,
      1920 // 9:16 aspect ratio
    );

    // Add stitched audio to final video
    const finalVideoWithAudioPath = path.join(userDir, `final_with_audio_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.addAudioToVideo(finalVideoPath, stitchedAudioPath, finalVideoWithAudioPath);

    // Calculate total duration
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);

    const localVideoUrl = `/uploads/videos/${userId}/${path.basename(finalVideoWithAudioPath)}`;

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string = localVideoUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        finalVideoWithAudioPath,
        `videos/${userId}`,
        path.basename(finalVideoWithAudioPath),
        'video/mp4'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
      if (gcsUrl) {
        console.log(`[RenderingService] ✅ HALF_N_HALF final video uploaded to GCS: ${gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[RenderingService] GCS upload failed for HALF_N_HALF final video: ${error.message}`);
    }

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        renderingStatus: 'completed' as any,
        renderingProgress: 100 as any,
        videoUrl: publicUrl || localVideoUrl,
        duration: totalDuration,
        currentStep: 'COMPLETED',
        completedAt: new Date(),
      } as any,
    });

    console.log(`[RenderingService] HALF_N_HALF video completed: ${publicUrl || localVideoUrl}`);
  }

  /**
   * Process CUTOUT style:
   * - Stitch all audios together
   * - Generate one avatar video from full audio (with or without green background)
   * - Stitch all b-roll videos together
   * - Overlay avatar video on stitched b-roll (bottom center, max 40% height, remove background)
   *   - Uses AI background removal for non-green backgrounds (works for both Basic and Premium avatars)
   *   - Falls back to chroma key if green screen is detected or AI removal fails
   * - Final 9:16 video
   */
  private async processCutout(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollVideos: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing CUTOUT style for project ${projectId}`);

    if (!project.avatarId) {
      throw new Error('Avatar ID required for CUTOUT style');
    }

    // Sort by scene number
    const sortedBrollVideos = [...bRollVideos].sort((a, b) => a.sceneNumber - b.sceneNumber);
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);

    await this.updateRenderingStatus(projectId, 'stitching_audio', 20);

    // Stitch all audio files together
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    // Convert file paths to absolute paths
    // Audio files from voice service are stored at voice-service/uploads/audio/userId/file.mp3
    // If running from server root, voice service cwd is server/microservices/voice-audio-service
    // If running from voice-service directory, cwd is server/microservices/voice-audio-service
    // We need to resolve paths relative to the server root or voice-service directory
    const serverRoot = path.join(process.cwd(), '..', '..'); // Go up from video-processing-service to server root
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');
    
    const audioPaths = sortedAudioFiles.map(af => {
      if (!af.filePath) return null;
      
      // Try multiple path resolution strategies
      let resolvedPath: string | null = null;
      
      // Strategy 1: If path is already absolute and exists, use it
      if (path.isAbsolute(af.filePath) && fs.existsSync(af.filePath)) {
        resolvedPath = af.filePath;
      }
      // Strategy 2: Try relative to voice-service directory
      else if (!resolvedPath) {
        const voiceServicePath = path.join(voiceServiceDir, af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
        if (fs.existsSync(voiceServicePath)) {
          resolvedPath = voiceServicePath;
        }
      }
      // Strategy 3: Try relative to server root
      else if (!resolvedPath) {
        const serverRootPath = path.join(serverRoot, af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
        if (fs.existsSync(serverRootPath)) {
          resolvedPath = serverRootPath;
        }
      }
      // Strategy 4: Try relative to current working directory
      else if (!resolvedPath) {
        const cwdPath = path.join(process.cwd(), af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
        if (fs.existsSync(cwdPath)) {
          resolvedPath = cwdPath;
        }
      }
      
      if (!resolvedPath) {
        console.warn(`[RenderingService] Audio file not found. Tried: ${af.filePath}`);
      }
      return resolvedPath;
    }).filter(p => p !== null && fs.existsSync(p)) as string[];
    
    if (audioPaths.length === 0) {
      throw new Error('No valid audio file paths found for stitching');
    }
    
    // Check for cached stitched audio
    const sourceHashAudio = this.generateSourceHash(audioPaths);
    const cachedAudio = this.getCachedIntermediateFile(project, 'stitched_audio');
    
    let stitchedAudioPath: string;
    
    if (cachedAudio && cachedAudio.sourceHash === sourceHashAudio) {
      console.log(`[RenderingService] CUTOUT: Reusing cached stitched audio: ${cachedAudio.path}`);
      stitchedAudioPath = cachedAudio.path;
    } else {
      // Generate new stitched audio with consistent filename
      stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}.mp3`);
      
      console.log(`[RenderingService] CUTOUT: Stitching ${audioPaths.length} audio files...`);
    await this.videoCompositor.concatenateAudios(audioPaths, stitchedAudioPath);
      
      // Save to cache
      await this.saveCachedIntermediateFile(projectId, 'stitched_audio', stitchedAudioPath, sourceHashAudio);
      console.log(`[RenderingService] CUTOUT: Stitched audio cached`);
    }

    await this.updateRenderingStatus(projectId, 'avatar_generating', 40);

    // Generate one avatar video from full stitched audio with green background
    // Check if avatar video already exists from previous attempt
    let avatarVideoPath: string | null = null;
    let originalAvatarVideoPath: string | null = null;
    const existingAvatarVideos = (project.avatarVideos as any) || [];
    const avatarMode = (project.avatarMode as string) || 'BASIC';
    const existingAvatarVideo = existingAvatarVideos.find((av: any) => 
      av.type === 'CUTOUT' && av.mode === avatarMode
    );

    if (existingAvatarVideo && existingAvatarVideo.originalPath && fs.existsSync(existingAvatarVideo.originalPath)) {
      console.log(`[RenderingService] CUTOUT: Reusing existing avatar video from previous attempt: ${existingAvatarVideo.originalPath}`);
      originalAvatarVideoPath = existingAvatarVideo.originalPath;
      avatarVideoPath = existingAvatarVideo.originalPath;
      
      // Check if processed (transparent) version exists
      if (existingAvatarVideo.processedPath && fs.existsSync(existingAvatarVideo.processedPath)) {
        console.log(`[RenderingService] CUTOUT: Reusing existing processed video: ${existingAvatarVideo.processedPath}`);
        avatarVideoPath = existingAvatarVideo.processedPath;
      }
      
      // Ensure finalProcessedPath is set if not already set
      if (!existingAvatarVideo.finalProcessedPath) {
        const updatedProject = await this.databaseService.videoProject.findUnique({
          where: { id: projectId },
        });
        const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
        const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
          av.type === 'CUTOUT' && av.mode === avatarMode
        );
        
        if (avatarVideoIndex >= 0) {
          updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = avatarVideoPath;
          updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = existingAvatarVideo.processedUrl || existingAvatarVideo.originalUrl;
          
          await this.databaseService.videoProject.update({
            where: { id: projectId },
            data: {
              avatarVideos: updatedAvatarVideos as any,
            },
          });
        }
      }
    } else {
      // Generate new avatar video
      console.log(`[RenderingService] CUTOUT: Generating new avatar video...`);
      
    const audioBuffer = fs.readFileSync(stitchedAudioPath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `full_audio_${projectId}.mp3`);

    // Fetch avatar details to get talking_photo_id and imageKey
    // For CUTOUT mode, use transparent imageKey if available (creates on-demand if needed)
    const avatarDetails = await this.fetchAvatarDetails(project.avatarId, userId, authToken, true); // useTransparent=true for CUTOUT
    const talkingPhotoId = avatarDetails.providerAvatarId; // This is the motion avatar ID
    const imageKey = avatarDetails.imageKey; // For Premium mode (Avatar IV) - will be transparentImageKey for CUTOUT

    console.log(`[RenderingService] CUTOUT: Using avatar mode: ${avatarMode}, imageKey: ${imageKey ? 'available' : 'not available'}`);

    let videoResponse: { video_id: string };

    if (avatarMode === 'PREMIUM') {
      // Use Avatar IV API for Premium mode
      if (!imageKey) {
        throw new Error('Image key not found. Avatar IV (Premium) requires image_key from the original upload.');
      }
      
      console.log(`[RenderingService] Using Avatar IV (Premium) with image_key: ${imageKey}`);
      videoResponse = await this.heygenVideoProvider.generateAvatarIVVideo({
        image_key: imageKey,
        video_title: `Avatar Video ${projectId}`,
        audio_asset_id: audioAssetId,
        video_orientation: 'portrait', // 9:16 is portrait
        fit: 'cover', // Cover the screen
      });
    } else {
      // Use standard Avatar API for Basic mode
      if (!talkingPhotoId) {
        throw new Error('Avatar motion ID (talking_photo_id) not found. Avatar may not be ready yet.');
      }
      
      console.log(`[RenderingService] Using standard Avatar API (Basic) with talking_photo_id: ${talkingPhotoId}`);
      videoResponse = await this.heygenVideoProvider.generateAvatarVideo({
        talking_photo_id: talkingPhotoId, // Use motion avatar ID
        audio_asset_id: audioAssetId,
        dimension: {
          width: 1080,
          height: 1920, // 9:16
        },
        caption: false,
      });
    }

    console.log(`[RenderingService] Created avatar video task ${videoResponse.video_id}`);
    const completedVideo = await this.heygenVideoProvider.pollVideoUntilComplete(videoResponse.video_id);

    if (!completedVideo.data.video_url) {
      throw new Error('Avatar video generation completed but no video URL');
    }

      // Create directory structure: avatars/{projectId}/{styleType}/{avatarType}/
      const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
      const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
      const avatarDir = path.join(userDir, 'avatars', projectId, styleType, avatarType);
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

      // Use consistent filename based on projectId (not timestamp) for retry capability
      const avatarVideoFilename = `avatar_full_${projectId}.mp4`;
      originalAvatarVideoPath = path.join(avatarDir, avatarVideoFilename);
      
      // Only download if file doesn't exist
      if (!fs.existsSync(originalAvatarVideoPath)) {
        await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, originalAvatarVideoPath);
        console.log(`[RenderingService] CUTOUT: Avatar video downloaded to: ${originalAvatarVideoPath}`);
      } else {
        console.log(`[RenderingService] CUTOUT: Avatar video already exists, skipping download: ${originalAvatarVideoPath}`);
      }
      
      avatarVideoPath = originalAvatarVideoPath;
      
      // Save avatar video info to database for future retries
      const avatarVideoInfo = {
        type: 'CUTOUT',
        mode: avatarMode,
        originalPath: originalAvatarVideoPath,
        originalUrl: `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${avatarVideoFilename}`,
        videoId: videoResponse.video_id, // Use video_id from the generation response
        videoUrl: completedVideo.data.video_url,
        generatedAt: new Date().toISOString(),
        dimensions: '1080x1920',
      };
      
      // Update project with avatar video info
      const updatedAvatarVideos = existingAvatarVideos.filter((av: any) => 
        !(av.type === 'CUTOUT' && av.mode === avatarMode)
      );
      updatedAvatarVideos.push(avatarVideoInfo);
      
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          avatarVideos: updatedAvatarVideos as any,
        },
      });
      
      console.log(`[RenderingService] CUTOUT: Avatar video info saved to database for retry capability`);
    }

    // Check if video has transparent background, if not remove it
    let finalAvatarVideoPath = avatarVideoPath;
    console.log(`[RenderingService] CUTOUT: Checking if avatar video has transparent background...`);
    const hasTransparency = await this.videoCompositor.hasAlphaChannel(avatarVideoPath);

    if (!hasTransparency) {
      console.log(`[RenderingService] CUTOUT: Avatar video doesn't have transparency, removing background using AI...`);
      await this.updateRenderingStatus(projectId, 'avatar_generating', 65);
      
      // Use consistent filename for processed version
      const transparentVideoFilename = `avatar_transparent_${projectId}.mp4`;
      const transparentVideoPath = path.join(path.dirname(avatarVideoPath), transparentVideoFilename);
      
      // Check if processed version already exists
      if (!fs.existsSync(transparentVideoPath)) {
      try {
        // Remove background from video using AI
        await this.videoCompositor.removeBackgroundAI(
          avatarVideoPath,
          transparentVideoPath,
          'u2net_human_seg'
        );
        
          if (fs.existsSync(transparentVideoPath)) {
        finalAvatarVideoPath = transparentVideoPath;
            console.log(`[RenderingService] CUTOUT: ✅ Background removed successfully, using transparent video`);
            
            // Update database with processed path (don't delete original - keep it for retry)
            // Refetch project to get latest avatarVideos
            const updatedProject = await this.databaseService.videoProject.findUnique({
              where: { id: projectId },
            });
            const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
            const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
              av.type === 'CUTOUT' && av.mode === avatarMode
            );
            
            if (avatarVideoIndex >= 0) {
              const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
              const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
              updatedAvatarVideos[avatarVideoIndex].processedPath = transparentVideoPath;
              updatedAvatarVideos[avatarVideoIndex].processedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${transparentVideoFilename}`;
              updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = transparentVideoPath; // Final video used for composition
              updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${transparentVideoFilename}`;
              
              await this.databaseService.videoProject.update({
                where: { id: projectId },
                data: {
                  avatarVideos: updatedAvatarVideos as any,
                },
              });
              
              console.log(`[RenderingService] CUTOUT: ✅ Processed video path saved to database`);
            }
          } else {
            throw new Error('Background removal completed but output file not found');
          }
      } catch (bgRemovalError: any) {
        console.error(`[RenderingService] CUTOUT: ❌ Background removal failed: ${bgRemovalError.message}`);
          console.log(`[RenderingService] CUTOUT: ⚠️  Using original video (may have background, can retry later)`);
        // Continue with original video if background removal fails
          // Original video is preserved, so user can retry background removal
        finalAvatarVideoPath = avatarVideoPath;
          
          // Still save the original as final processed path
          const updatedProject = await this.databaseService.videoProject.findUnique({
            where: { id: projectId },
          });
          const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
          const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
            av.type === 'CUTOUT' && av.mode === avatarMode
          );
          
          if (avatarVideoIndex >= 0) {
            const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
            const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
            updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = avatarVideoPath;
            updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/avatar_full_${projectId}.mp4`;
            
            await this.databaseService.videoProject.update({
              where: { id: projectId },
              data: {
                avatarVideos: updatedAvatarVideos as any,
              },
            });
          }
        }
      } else {
        console.log(`[RenderingService] CUTOUT: Processed video already exists, reusing: ${transparentVideoPath}`);
        finalAvatarVideoPath = transparentVideoPath;
      }
    } else {
      console.log(`[RenderingService] CUTOUT: ✅ Avatar video already has transparent background`);
      // Video already has transparency, so original is the final processed video
      // Update database to mark this as the final processed path
      const updatedProject = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
      });
      const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
      const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
        av.type === 'CUTOUT' && av.mode === avatarMode
      );
      
      if (avatarVideoIndex >= 0) {
        const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
        const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
        updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = avatarVideoPath;
        updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/avatar_full_${projectId}.mp4`;
        
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: {
            avatarVideos: updatedAvatarVideos as any,
          },
        });
        
        console.log(`[RenderingService] CUTOUT: ✅ Final processed video path saved to database (already transparent)`);
      }
    }

    await this.updateRenderingStatus(projectId, 'stitching_broll', 60);

    // Stitch all b-roll videos together
    // Log all videos for debugging
    console.log(`[RenderingService] CUTOUT: Processing ${sortedBrollVideos.length} b-roll videos:`, 
      sortedBrollVideos.map(v => ({
        sceneNumber: v.sceneNumber,
        hasLocalPath: !!v.localPath,
        localPath: v.localPath,
        hasLocalUrl: !!v.localUrl,
        localUrl: v.localUrl,
      }))
    );
    
    // Convert paths to absolute paths before concatenation
    const brollVideoPaths = sortedBrollVideos
      .map(v => {
        // Try localPath first, then derive from localUrl if needed
        let videoPath: string | null = null;
        
        if (v.localPath) {
          // Convert to absolute path if relative
          videoPath = path.isAbsolute(v.localPath) 
            ? v.localPath 
            : path.resolve(v.localPath);
        } else if (v.localUrl) {
          // If no localPath, try to derive from localUrl
          // localUrl format: /uploads/videos/{userId}/{filename}
          const urlPath = v.localUrl.startsWith('/uploads') ? v.localUrl : v.localUrl;
          const relativePath = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
          videoPath = path.join(userDir, relativePath);
        }
        
        if (!videoPath) {
          console.warn(`[RenderingService] CUTOUT: Scene ${v.sceneNumber} has no localPath or localUrl`);
          return null;
        }
        
        if (!fs.existsSync(videoPath)) {
          console.warn(`[RenderingService] CUTOUT: Video file not found for scene ${v.sceneNumber}: ${videoPath}`);
          return null;
        }
        
        return videoPath;
      })
      .filter((p): p is string => p !== null);
    
    if (brollVideoPaths.length === 0) {
      throw new Error('No valid b-roll video paths found for stitching');
    }
    
    // Check for cached stitched b-roll video
    const sourceHashBroll = this.generateSourceHash(brollVideoPaths);
    const cachedBroll = this.getCachedIntermediateFile(project, 'stitched_broll');
    
    let stitchedBrollPath: string;
    
    if (cachedBroll && cachedBroll.sourceHash === sourceHashBroll) {
      console.log(`[RenderingService] CUTOUT: Reusing cached stitched b-roll video: ${cachedBroll.path}`);
      stitchedBrollPath = cachedBroll.path;
    } else {
      // Generate new stitched b-roll video with consistent filename
      stitchedBrollPath = path.join(userDir, `stitched_broll_${projectId}.mp4`);
      
      console.log(`[RenderingService] CUTOUT: Stitching ${brollVideoPaths.length} videos (filtered from ${sortedBrollVideos.length})...`);
    await this.videoCompositor.concatenateVideos(brollVideoPaths, stitchedBrollPath);
      
      // Save to cache
      await this.saveCachedIntermediateFile(projectId, 'stitched_broll', stitchedBrollPath, sourceHashBroll);
      console.log(`[RenderingService] CUTOUT: Stitched b-roll video cached`);
    }

    // Add audio to stitched b-roll
    const stitchedBrollWithAudioPath = path.join(userDir, `stitched_broll_audio_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.addAudioToVideo(stitchedBrollPath, stitchedAudioPath, stitchedBrollWithAudioPath);

    await this.updateRenderingStatus(projectId, 'overlaying', 80);

    // Overlay avatar video on stitched b-roll (bottom center, max 40% height, remove background)
    // For CUTOUT mode, always use AI background removal (works for both Basic and Premium avatars)
    // Use finalAvatarVideoPath which may have been processed to remove background
    const finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    console.log(`[RenderingService] CUTOUT: Overlaying avatar video on b-roll...`);
    await this.videoCompositor.overlayAvatarOnBroll(
      stitchedBrollWithAudioPath,
      finalAvatarVideoPath, // Use processed video (with transparency if available)
      finalVideoPath,
      40, // Max 40% height
      true // useAIBackgroundRemoval: Always use AI removal for CUTOUT mode
    );

    // Calculate total duration
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);

    const localVideoUrl = `/uploads/videos/${userId}/${path.basename(finalVideoPath)}`;

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string = localVideoUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        finalVideoPath,
        `videos/${userId}`,
        path.basename(finalVideoPath),
        'video/mp4'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
      if (gcsUrl) {
        console.log(`[RenderingService] ✅ CUTOUT final video uploaded to GCS: ${gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[RenderingService] GCS upload failed for CUTOUT final video: ${error.message}`);
    }

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        renderingStatus: 'completed' as any,
        renderingProgress: 100 as any,
        videoUrl: publicUrl || localVideoUrl,
        duration: totalDuration,
        currentStep: 'COMPLETED',
        completedAt: new Date(),
      } as any,
    });

    console.log(`[RenderingService] CUTOUT video completed: ${publicUrl || localVideoUrl}`);
  }

  /**
   * Generate a per-scene avatar video for ALTERNATE style (even scenes)
   * Uses the same avatar image logic as HALF_N_HALF for consistency
   */
  private async generateAlternateSceneAvatarVideo(
    projectId: string,
    userId: string,
    sceneNumber: number,
    audioFilePath: string,
    avatarMode: string,
    talkingPhotoId: string,
    imageKey: string | undefined,
    imageKeyHalfNHalfWithWhite: string | undefined,
    avatarDir: string,
    project: any
  ): Promise<string> {
    const audioBuffer = fs.readFileSync(audioFilePath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `scene_${sceneNumber}_audio.mp3`);

    let videoResponse: { video_id: string };

    if (avatarMode === 'PREMIUM') {
      // Use Avatar IV API for Premium mode
      // Use processed image key with white top for HALF_N_HALF-style consistency (same as HALF_N_HALF)
      const imageKeyToUse = imageKeyHalfNHalfWithWhite || imageKey;
      
      if (!imageKeyToUse) {
        throw new Error('Image key not found. Avatar IV (Premium) requires image_key from the original upload.');
      }
      
      if (imageKeyHalfNHalfWithWhite) {
        console.log(`[RenderingService] ALTERNATE: Using Avatar IV (Premium) for scene ${sceneNumber} with processed HALF_N_HALF image_key: ${imageKeyHalfNHalfWithWhite}`);
      } else {
        console.log(`[RenderingService] ALTERNATE: Using Avatar IV (Premium) for scene ${sceneNumber} with default image_key: ${imageKey} (processed key not available)`);
      }
      
      // For Premium mode, we generate 9:16 and crop to bottom 960px (same as HALF_N_HALF)
      videoResponse = await this.heygenVideoProvider.generateAvatarIVVideo({
        image_key: imageKeyToUse,
        video_title: `Avatar Video Scene ${sceneNumber} - ${projectId}`,
        audio_asset_id: audioAssetId,
        video_orientation: 'portrait', // 9:16 is portrait
        fit: 'cover', // Cover the screen
      });
    } else {
      // Use standard Avatar API for Basic mode (generate 1080x960 directly)
      if (!talkingPhotoId) {
        throw new Error('Avatar motion ID (talking_photo_id) not found. Avatar may not be ready yet.');
      }
      
      console.log(`[RenderingService] ALTERNATE: Using standard Avatar API (Basic) for scene ${sceneNumber} with talking_photo_id: ${talkingPhotoId}`);
      videoResponse = await this.heygenVideoProvider.generateAvatarVideo({
        talking_photo_id: talkingPhotoId, // Use motion avatar ID
        audio_asset_id: audioAssetId,
        dimension: {
          width: 1080,
          height: 960, // Bottom half dimension (1080x960)
        },
        caption: false,
      });
    }

    console.log(`[RenderingService] ALTERNATE: Created avatar video task ${videoResponse.video_id} for scene ${sceneNumber}`);
    const completedVideo = await this.heygenVideoProvider.pollVideoUntilComplete(videoResponse.video_id);

    if (!completedVideo.data.video_url) {
      throw new Error(`Avatar video generation completed but no video URL for scene ${sceneNumber}`);
    }

    const avatarVideoPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_${projectId}.mp4`);
    await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, avatarVideoPath);

    // For Premium mode, if video is 9:16, crop to bottom 960px (same as HALF_N_HALF)
    // CRITICAL: Always scale to 1080x1920 first (if needed), then crop to bottom 960px
    // This ensures the white top portion is properly removed, not compressed
    if (avatarMode === 'PREMIUM') {
      const videoRes = await this.videoCompositor.getVideoResolution(avatarVideoPath);
      if (!videoRes) {
        throw new Error('Failed to get video resolution for avatar video');
      }
      
      console.log(`[RenderingService] ALTERNATE: Premium avatar video dimensions for scene ${sceneNumber}: ${videoRes.width}x${videoRes.height}`);
      
      // If video is not 1080x1920, scale it first (same as HALF_N_HALF)
      if (videoRes.width !== 1080 || videoRes.height !== 1920) {
        console.log(`[RenderingService] ALTERNATE: Scaling Premium avatar video for scene ${sceneNumber} from ${videoRes.width}x${videoRes.height} to 1080x1920 before cropping`);
        const scaledPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_scaled_${projectId}.mp4`);
        await this.videoCompositor.scaleVideoToDimensions(avatarVideoPath, scaledPath, 1080, 1920);
        
        if (fs.existsSync(scaledPath)) {
          // Use scaled version for cropping
          const croppedPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_cropped_${projectId}.mp4`);
          await this.videoCompositor.cropVideo(
            scaledPath,
            croppedPath,
            0,      // x offset
            960,    // y offset (start from 960px down - skip white top)
            1080,   // width
            960     // height (crop to 1080x960)
          );
          
          // Cleanup scaled version after cropping
          try {
            fs.unlinkSync(scaledPath);
          } catch (e) {
            console.warn(`[RenderingService] Failed to cleanup scaled video: ${e}`);
          }
          
          // Replace original with cropped version
          if (fs.existsSync(croppedPath)) {
            fs.unlinkSync(avatarVideoPath);
            fs.renameSync(croppedPath, avatarVideoPath);
            console.log(`[RenderingService] ALTERNATE: Cropped Premium avatar video for scene ${sceneNumber} to 1080x960`);
          } else {
            throw new Error('Video cropping failed');
          }
        } else {
          throw new Error('Video scaling failed');
        }
      } else {
        // Video is already correct size, just crop it
        const croppedPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_cropped_${projectId}.mp4`);
        await this.videoCompositor.cropVideo(
          avatarVideoPath,
          croppedPath,
          0,      // x offset
          960,    // y offset (start from 960px down - skip white top)
          1080,   // width
          960     // height (crop to 1080x960)
        );
        
        // Replace original with cropped version
        if (fs.existsSync(croppedPath)) {
          fs.unlinkSync(avatarVideoPath);
          fs.renameSync(croppedPath, avatarVideoPath);
          console.log(`[RenderingService] ALTERNATE: Cropped Premium avatar video for scene ${sceneNumber} to 1080x960`);
        }
      }
    }

    return avatarVideoPath;
  }

  /**
   * Process ALTERNATE style (simplified - avatar and compositing done during Convert to Videos):
   * - Odd scenes: b-roll from bRollVideoTasks, add audio
   * - Even scenes: pre-composed (b-roll+avatar) from bRollVideoTasks, already has audio
   * - Stitch all scene videos together
   */
  private async processAlternate(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollVideos: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing ALTERNATE style for project ${projectId} (stitch-only mode)`);

    if (!project.avatarId) {
      throw new Error('Avatar ID required for ALTERNATE style');
    }

    const script = typeof project.script === 'string' 
      ? JSON.parse(project.script) 
      : project.script;
    const scenes = script.scenes || script.scene_plan || [];
    const sortedScenes = [...scenes].sort((a, b) => 
      (a.scene_number || a.sceneNumber || 1) - (b.scene_number || b.sceneNumber || 1)
    );

    await this.updateRenderingStatus(projectId, 'stitching_broll', 30);

    const userDir = path.join(this.uploadsDir, 'videos', userId);
    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');

    const resolveAudioPath = (audioFile: any): string | null => {
      const p = audioFile.filePath;
      if (!p) return null;
      if (path.isAbsolute(p) && fs.existsSync(p)) return p;
      const rel = p.startsWith('/') ? p.slice(1) : p;
      for (const base of [voiceServiceDir, serverRoot, process.cwd()]) {
        const full = path.join(base, rel);
        if (fs.existsSync(full)) return full;
      }
      return null;
    };

    const sceneVideoPaths: string[] = [];
    const sceneDurations: number[] = [];

    for (const scene of sortedScenes) {
      const sceneNumber = scene.scene_number || scene.sceneNumber || 1;
      const isOdd = sceneNumber % 2 === 1;
      const videoEntry = bRollVideos.find((v: any) => v.sceneNumber === sceneNumber);
      const audioFile = audioFiles.find((af: any) => af.sceneNumber === sceneNumber);

      if (!videoEntry || (!videoEntry.localPath && !videoEntry.localUrl)) {
        throw new Error(`Missing video for scene ${sceneNumber}`);
      }

      let videoPath: string | null = null;
      if (videoEntry.localPath && fs.existsSync(videoEntry.localPath)) {
        videoPath = path.isAbsolute(videoEntry.localPath) ? videoEntry.localPath : path.resolve(videoEntry.localPath);
      } else if (videoEntry.localUrl) {
        const rel = (videoEntry.localUrl as string).replace(/^\/uploads\/videos\/[^/]+\//, '');
        const full = path.join(userDir, rel);
        if (fs.existsSync(full)) videoPath = full;
      }
      if (!videoPath || !fs.existsSync(videoPath)) {
        throw new Error(`Video file not found for scene ${sceneNumber}`);
      }

      const isComposite = !!(videoEntry as any).isComposite;

      if (isComposite) {
        // Even scene: pre-composed (already has audio)
        sceneVideoPaths.push(path.resolve(videoPath));
        sceneDurations.push(audioFile?.duration || 0);
        console.log(`[RenderingService] ALTERNATE: Using pre-composed scene ${sceneNumber}`);
      } else {
        // Odd scene: add audio to b-roll
        if (!audioFile) throw new Error(`Missing audio for scene ${sceneNumber}`);
        const audioPath = resolveAudioPath(audioFile);
        if (!audioPath || !fs.existsSync(audioPath)) {
          throw new Error(`Audio file not found for scene ${sceneNumber}`);
        }
        const brollRes = await this.videoCompositor.getVideoResolution(videoPath);
        if (brollRes && (brollRes.width !== 1080 || brollRes.height !== 1920)) {
          const scaledPath = path.join(userDir, `broll_scaled_${sceneNumber}_${projectId}.mp4`);
          await this.videoCompositor.scaleVideoToDimensions(videoPath, scaledPath, 1080, 1920);
          if (fs.existsSync(scaledPath)) videoPath = scaledPath;
        }
        const completePath = path.join(userDir, `complete_scene_${sceneNumber}_${projectId}_${Date.now()}.mp4`);
        await this.videoCompositor.addAudioToVideo(videoPath, audioPath, completePath);
        sceneVideoPaths.push(path.resolve(completePath));
        sceneDurations.push(audioFile.duration || 0);
        console.log(`[RenderingService] ALTERNATE: Processed odd scene ${sceneNumber} with audio`);
      }
    }

    if (sceneVideoPaths.length === 0) {
      throw new Error('No valid scene videos to stitch together');
    }

    console.log(`[RenderingService] ALTERNATE: Processed ${sceneVideoPaths.length} complete scene videos. Total expected duration: ${sceneDurations.reduce((sum, d) => sum + d, 0).toFixed(2)}s`);

    await this.updateRenderingStatus(projectId, 'stitching', 70);

    // Stitch all complete per-scene videos together (each already has its own audio)
    const finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    const absoluteSceneVideoPaths = sceneVideoPaths
      .map(vp => {
        if (!vp) return null;
        const absolutePath = path.isAbsolute(vp) 
          ? vp 
          : path.resolve(vp);
        return absolutePath;
      })
      .filter(p => p && fs.existsSync(p)) as string[];
    
    if (absoluteSceneVideoPaths.length === 0) {
      throw new Error('No valid scene videos to stitch together');
    }
    
    console.log(`[RenderingService] ALTERNATE: Stitching ${absoluteSceneVideoPaths.length} complete scene videos together...`);
    await this.videoCompositor.concatenateVideos(absoluteSceneVideoPaths, finalVideoPath);

    // Calculate total duration from scenes that made it into the final video
    // Use ffprobe to get actual video duration as the source of truth
    let totalDuration: number;
    try {
      const videoDuration = await this.videoCompositor.getVideoDuration(finalVideoPath);
      totalDuration = videoDuration;
      console.log(`[RenderingService] ALTERNATE: Final video duration (from ffprobe): ${totalDuration.toFixed(2)}s`);
      
      // Log comparison with expected duration
      const expectedDuration = sceneDurations.reduce((sum, d) => sum + d, 0);
      const durationDiff = Math.abs(totalDuration - expectedDuration);
      if (durationDiff > 0.5) {
        console.warn(`[RenderingService] ALTERNATE: Duration mismatch! Expected: ${expectedDuration.toFixed(2)}s, Actual: ${totalDuration.toFixed(2)}s, Diff: ${durationDiff.toFixed(2)}s`);
      } else {
        console.log(`[RenderingService] ALTERNATE: Duration matches expected (${expectedDuration.toFixed(2)}s)`);
      }
    } catch (error: any) {
      console.warn(`[RenderingService] ALTERNATE: Failed to get video duration from ffprobe, using sum of scene durations: ${error.message}`);
      // Fallback to sum of scene durations
      totalDuration = sceneDurations.reduce((sum, d) => sum + d, 0);
    }

    // Final video already has all audio, no need to add stitched audio again
    const finalVideoWithAudioPath = finalVideoPath;

    const localVideoUrl = `/uploads/videos/${userId}/${path.basename(finalVideoWithAudioPath)}`;

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string = localVideoUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        finalVideoWithAudioPath,
        `videos/${userId}`,
        path.basename(finalVideoWithAudioPath),
        'video/mp4'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
      if (gcsUrl) {
        console.log(`[RenderingService] ✅ ALTERNATE final video uploaded to GCS: ${gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[RenderingService] GCS upload failed for ALTERNATE final video: ${error.message}`);
    }

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        renderingStatus: 'completed' as any,
        renderingProgress: 100 as any,
        videoUrl: publicUrl || localVideoUrl,
        duration: totalDuration,
        currentStep: 'COMPLETED',
        completedAt: new Date(),
      } as any,
    });

    console.log(`[RenderingService] ✅ ALTERNATE video completed: ${publicUrl || localVideoUrl}, duration: ${totalDuration.toFixed(2)}s, scenes: ${sceneVideoPaths.length}`);
  }

  /**
   * Process AVATAR_ONLY style:
   * - Generate one full avatar video from stitched audio (9:16)
   * - No b-roll overlay, just the avatar video
   */
  private async processAvatarOnly(
    projectId: string,
    userId: string,
    audioFiles: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing AVATAR_ONLY style for project ${projectId}`);

    if (!project.avatarId) {
      throw new Error('Avatar ID required for AVATAR_ONLY style');
    }

    // Sort audio files by scene number
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);

    await this.updateRenderingStatus(projectId, 'stitching_audio', 20);

    // Stitch all audio files together
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');

    const audioPaths = sortedAudioFiles.map(af => {
      if (!af.filePath) return null;
      
      let resolvedPath: string | null = null;
      
      if (path.isAbsolute(af.filePath) && fs.existsSync(af.filePath)) {
        resolvedPath = af.filePath;
      } else {
        const voiceServicePath = path.join(voiceServiceDir, af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
        if (fs.existsSync(voiceServicePath)) {
          resolvedPath = voiceServicePath;
        } else {
          const serverRootPath = path.join(serverRoot, af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
          if (fs.existsSync(serverRootPath)) {
            resolvedPath = serverRootPath;
          } else {
            const cwdPath = path.join(process.cwd(), af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
            if (fs.existsSync(cwdPath)) {
              resolvedPath = cwdPath;
            }
          }
        }
      }
      
      if (!resolvedPath) {
        console.warn(`[RenderingService] Audio file not found: ${af.filePath}`);
      }
      return resolvedPath;
    }).filter(p => p !== null && fs.existsSync(p)) as string[];

    if (audioPaths.length === 0) {
      throw new Error('No valid audio file paths found for stitching');
    }

    const stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}.mp3`);
    console.log(`[RenderingService] AVATAR_ONLY: Stitching ${audioPaths.length} audio files...`);
    await this.videoCompositor.concatenateAudios(audioPaths, stitchedAudioPath);

    await this.updateRenderingStatus(projectId, 'avatar_generating', 40);

    // Generate avatar video from stitched audio
    const audioBuffer = fs.readFileSync(stitchedAudioPath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `full_audio_${projectId}.mp3`);

    const avatarDetails = await this.fetchAvatarDetails(project.avatarId, userId, authToken);
    const talkingPhotoId = avatarDetails.providerAvatarId;
    const imageKey = avatarDetails.imageKey;

    const avatarMode = (project.avatarMode as string) || 'BASIC';
    console.log(`[RenderingService] AVATAR_ONLY: Using avatar mode: ${avatarMode}`);

      let videoResponse: { video_id: string };

      if (avatarMode === 'PREMIUM') {
        if (!imageKey) {
          throw new Error('Image key not found. Avatar IV (Premium) requires image_key from the original upload.');
        }
        
      console.log(`[RenderingService] Using Avatar IV (Premium) with image_key: ${imageKey}`);
        videoResponse = await this.heygenVideoProvider.generateAvatarIVVideo({
          image_key: imageKey,
        video_title: `Avatar Video ${projectId}`,
          audio_asset_id: audioAssetId,
        video_orientation: 'portrait',
        fit: 'cover',
        });
      } else {
        if (!talkingPhotoId) {
          throw new Error('Avatar motion ID (talking_photo_id) not found. Avatar may not be ready yet.');
        }
        
      console.log(`[RenderingService] Using standard Avatar API (Basic) with talking_photo_id: ${talkingPhotoId}`);
        videoResponse = await this.heygenVideoProvider.generateAvatarVideo({
        talking_photo_id: talkingPhotoId,
          audio_asset_id: audioAssetId,
          dimension: {
            width: 1080,
          height: 1920,
          },
          caption: false,
        });
      }

    console.log(`[RenderingService] AVATAR_ONLY: Created avatar video task ${videoResponse.video_id}`);
    await this.updateRenderingStatus(projectId, 'avatar_generating', 60);

      const completedVideo = await this.heygenVideoProvider.pollVideoUntilComplete(videoResponse.video_id);

      if (!completedVideo.data.video_url) {
      throw new Error('Avatar video generation completed but no video URL returned');
      }

    await this.updateRenderingStatus(projectId, 'stitching', 80);

    const avatarVideoPath = path.join(userDir, `avatar_only_${projectId}_${Date.now()}.mp4`);
      await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, avatarVideoPath);

    // Calculate total duration
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);

    const localVideoUrl = `/uploads/videos/${userId}/${path.basename(avatarVideoPath)}`;

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string = localVideoUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        avatarVideoPath,
        `videos/${userId}`,
        path.basename(avatarVideoPath),
        'video/mp4'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
      if (gcsUrl) {
        console.log(`[RenderingService] ✅ AVATAR_ONLY final video uploaded to GCS: ${gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[RenderingService] GCS upload failed for AVATAR_ONLY final video: ${error.message}`);
    }

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        renderingStatus: 'completed' as any,
        renderingProgress: 100 as any,
        videoUrl: publicUrl || localVideoUrl,
        duration: totalDuration,
        currentStep: 'COMPLETED',
        completedAt: new Date(),
      } as any,
    });

    console.log(`[RenderingService] AVATAR_ONLY video completed: ${publicUrl || localVideoUrl}`);
  }

  /**
   * Process PRODUCT_ONLY style:
   * - Stitch all b-roll videos together
   * - Stitch all audio files together
   * - Combine into final video (no avatar)
   */
  private async processProductOnly(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollVideos: any[],
    project: any
  ): Promise<void> {
    console.log(`[RenderingService] Processing PRODUCT_ONLY style for project ${projectId}`);

    // Sort by scene number
    const sortedBrollVideos = [...bRollVideos].sort((a, b) => a.sceneNumber - b.sceneNumber);
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);

    await this.updateRenderingStatus(projectId, 'stitching_audio', 20);

    // Setup paths
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');

    // Resolve audio paths
    const audioPaths = sortedAudioFiles.map(af => {
      if (!af.filePath) return null;
      
      let resolvedPath: string | null = null;
      
      if (path.isAbsolute(af.filePath) && fs.existsSync(af.filePath)) {
        resolvedPath = af.filePath;
      } else {
        const voiceServicePath = path.join(voiceServiceDir, af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
        if (fs.existsSync(voiceServicePath)) {
          resolvedPath = voiceServicePath;
        } else {
          const serverRootPath = path.join(serverRoot, af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
          if (fs.existsSync(serverRootPath)) {
            resolvedPath = serverRootPath;
          } else {
            const cwdPath = path.join(process.cwd(), af.filePath.startsWith('/') ? af.filePath.slice(1) : af.filePath);
            if (fs.existsSync(cwdPath)) {
              resolvedPath = cwdPath;
            }
          }
        }
      }
      
      if (!resolvedPath) {
        console.warn(`[RenderingService] Audio file not found: ${af.filePath}`);
      }
      return resolvedPath;
    }).filter(p => p !== null && fs.existsSync(p)) as string[];

    if (audioPaths.length === 0) {
      throw new Error('No valid audio file paths found for stitching');
    }

    // Stitch audio
    const stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}.mp3`);
    console.log(`[RenderingService] PRODUCT_ONLY: Stitching ${audioPaths.length} audio files...`);
    await this.videoCompositor.concatenateAudios(audioPaths, stitchedAudioPath);

    await this.updateRenderingStatus(projectId, 'stitching_broll', 40);

    // Resolve b-roll video paths
    const videoPaths = sortedBrollVideos.map(v => {
      let videoPath: string | null = null;
      
      if (v.localPath) {
        videoPath = path.isAbsolute(v.localPath) ? v.localPath : path.resolve(v.localPath);
      } else if (v.localUrl) {
        const urlPath = v.localUrl.startsWith('/uploads') ? v.localUrl : v.localUrl;
        const relativePath = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
        videoPath = path.join(userDir, relativePath);
      }
      
      if (!videoPath || !fs.existsSync(videoPath)) {
        console.warn(`[RenderingService] B-roll video not found for scene ${v.sceneNumber}: ${v.localPath || v.localUrl}`);
        return null;
      }
      return videoPath;
    }).filter(p => p !== null) as string[];

    if (videoPaths.length === 0) {
      throw new Error('No valid b-roll video paths found for stitching');
    }

    // Stitch b-roll videos
    const stitchedBrollPath = path.join(userDir, `stitched_broll_${projectId}_${Date.now()}.mp4`);
    console.log(`[RenderingService] PRODUCT_ONLY: Stitching ${videoPaths.length} b-roll videos...`);
    await this.videoCompositor.concatenateVideos(videoPaths, stitchedBrollPath);

    await this.updateRenderingStatus(projectId, 'stitching', 70);

    // Add stitched audio to stitched video
    const finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.addAudioToVideo(stitchedBrollPath, stitchedAudioPath, finalVideoPath);

    // Calculate total duration
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);

    const localVideoUrl = `/uploads/videos/${userId}/${path.basename(finalVideoPath)}`;

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string = localVideoUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        finalVideoPath,
        `videos/${userId}`,
        path.basename(finalVideoPath),
        'video/mp4'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
      if (gcsUrl) {
        console.log(`[RenderingService] ✅ PRODUCT_ONLY final video uploaded to GCS: ${gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[RenderingService] GCS upload failed for PRODUCT_ONLY final video: ${error.message}`);
    }

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        renderingStatus: 'completed' as any,
        renderingProgress: 100 as any,
        videoUrl: publicUrl || localVideoUrl,
        duration: totalDuration,
        currentStep: 'COMPLETED',
        completedAt: new Date(),
      } as any,
    });

    console.log(`[RenderingService] PRODUCT_ONLY video completed: ${publicUrl || localVideoUrl}`);
  }

  /**
   * Process AVATAR_PRODUCT style:
   * - Similar to ALTERNATE but with product context
   * - B-roll videos already have avatar+product composited (from image generation)
   * - Stitch all scene videos with their audio
   * - Combine into final video
   */
  private async processAvatarProduct(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollVideos: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing AVATAR_PRODUCT style for project ${projectId}`);

    // Parse script to get scene info
    const script = typeof project.script === 'string' 
      ? JSON.parse(project.script) 
      : project.script;
    
    const scenes = script.scenes || script.scene_plan || [];

    // Sort by scene number
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);
    const sortedScenes = [...scenes].sort((a: any, b: any) => 
      (a.scene_number || a.sceneNumber || 1) - (b.scene_number || b.sceneNumber || 1)
    );

    await this.updateRenderingStatus(projectId, 'stitching_audio', 20);

    // Setup paths
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');

    await this.updateRenderingStatus(projectId, 'stitching_broll', 40);

    const sceneVideoPaths: string[] = [];
    const sceneAudioPaths: string[] = [];

    // Process each scene
    for (const scene of sortedScenes) {
      const sceneNumber = scene.scene_number || scene.sceneNumber || 1;
      const brollVideo = bRollVideos.find((v: any) => v.sceneNumber === sceneNumber);
      const audioFile = sortedAudioFiles.find((af: any) => af.sceneNumber === sceneNumber);

      if (!brollVideo || !audioFile) {
        console.warn(`[RenderingService] AVATAR_PRODUCT: Missing video or audio for scene ${sceneNumber}`);
        continue;
      }

      // Resolve b-roll video path
      let brollVideoPath: string | null = null;
        if (brollVideo.localPath) {
          brollVideoPath = path.isAbsolute(brollVideo.localPath) 
            ? brollVideo.localPath 
            : path.resolve(brollVideo.localPath);
        } else if (brollVideo.localUrl) {
          const urlPath = brollVideo.localUrl.startsWith('/uploads') ? brollVideo.localUrl : brollVideo.localUrl;
          const relativePath = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
          brollVideoPath = path.join(userDir, relativePath);
        }
        
        if (!brollVideoPath || !fs.existsSync(brollVideoPath)) {
        console.warn(`[RenderingService] AVATAR_PRODUCT: B-roll video not found for scene ${sceneNumber}`);
          continue;
        }
        
      // Resolve audio path
        let audioFilePath: string | null = null;
        if (path.isAbsolute(audioFile.filePath) && fs.existsSync(audioFile.filePath)) {
          audioFilePath = audioFile.filePath;
        } else {
          const voiceServicePath = path.join(voiceServiceDir, audioFile.filePath.startsWith('/') ? audioFile.filePath.slice(1) : audioFile.filePath);
          if (fs.existsSync(voiceServicePath)) {
            audioFilePath = voiceServicePath;
          } else {
            const serverRootPath = path.join(serverRoot, audioFile.filePath.startsWith('/') ? audioFile.filePath.slice(1) : audioFile.filePath);
            if (fs.existsSync(serverRootPath)) {
              audioFilePath = serverRootPath;
            } else {
              const cwdPath = path.join(process.cwd(), audioFile.filePath.startsWith('/') ? audioFile.filePath.slice(1) : audioFile.filePath);
              if (fs.existsSync(cwdPath)) {
                audioFilePath = cwdPath;
              }
            }
          }
        }
        
        if (!audioFilePath || !fs.existsSync(audioFilePath)) {
        console.warn(`[RenderingService] AVATAR_PRODUCT: Audio not found for scene ${sceneNumber}`);
        continue;
      }

      // Add audio to b-roll video
      const sceneWithAudioPath = path.join(userDir, `scene_${sceneNumber}_with_audio_${projectId}_${Date.now()}.mp4`);
      await this.videoCompositor.addAudioToVideo(brollVideoPath, audioFilePath, sceneWithAudioPath);
      
      sceneVideoPaths.push(sceneWithAudioPath);
            sceneAudioPaths.push(audioFilePath);
          }

    if (sceneVideoPaths.length === 0) {
      throw new Error('No valid scene videos found for AVATAR_PRODUCT style');
    }

    await this.updateRenderingStatus(projectId, 'stitching', 70);

    // Stitch all scene videos together
    const finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.concatenateVideos(sceneVideoPaths, finalVideoPath);

    // Calculate total duration
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);

    const localVideoUrl = `/uploads/videos/${userId}/${path.basename(finalVideoPath)}`;

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string = localVideoUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        finalVideoPath,
        `videos/${userId}`,
        path.basename(finalVideoPath),
        'video/mp4'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
      if (gcsUrl) {
        console.log(`[RenderingService] ✅ AVATAR_PRODUCT final video uploaded to GCS: ${gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[RenderingService] GCS upload failed for AVATAR_PRODUCT final video: ${error.message}`);
    }

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        renderingStatus: 'completed' as any,
        renderingProgress: 100 as any,
        videoUrl: publicUrl || localVideoUrl,
        duration: totalDuration,
        currentStep: 'COMPLETED',
        completedAt: new Date(),
      } as any,
    });

    console.log(`[RenderingService] AVATAR_PRODUCT video completed: ${publicUrl || localVideoUrl}`);
  }

  /**
   * Update rendering status and progress
   */
  private async updateRenderingStatus(
    projectId: string,
    status: string,
    progress: number
  ): Promise<void> {
    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        renderingStatus: status as any,
        renderingProgress: progress as any,
        progressStage: this.getStageDescription(status),
      },
    });
  }

  /**
   * Get human-readable stage description
   */
  private getStageDescription(status: string): string {
    const descriptions: Record<string, string> = {
      'audio_generating': 'Generating audio files...',
      'image_generating': 'Creating images...',
      'video_generating': 'Generating B-roll videos...',
      'avatar_generating': 'Creating avatar videos...',
      'stitching_broll': 'Stitching B-roll videos...',
      'stitching_audio': 'Stitching audio files...',
      'stitching': 'Stitching everything together...',
      'overlaying': 'Overlaying avatar on video...',
      'completed': 'Video rendering completed!',
      'failed': 'Video rendering failed',
    };
    return descriptions[status] || 'Processing...';
  }

  /**
   * Get rendering status for a project
   */
  async getRenderingStatus(projectId: string, userId: string): Promise<any> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    return {
      success: true,
      data: {
        renderingStatus: (project as any).renderingStatus,
        renderingProgress: (project as any).renderingProgress,
        progressStage: project.progressStage,
        status: project.status,
        videoUrl: project.videoUrl,
        errorMessage: project.errorMessage,
      },
    };
  }
}
