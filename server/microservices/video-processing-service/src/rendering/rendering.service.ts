import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../common/database/database.service';
import { BytePlusProvider } from './providers/byteplus.provider';
import { HeyGenVideoProvider } from './providers/heygen-video.provider';
import { VideoCompositorProvider } from './providers/video-compositor.provider';
import { getRenderingRollbackStep } from '../common/constants/video-steps';
import * as path from 'path';
import * as fs from 'fs';
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
  ) {
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  /**
   * Fetch avatar details from ai-content-service or HeyGen API to get talking_photo_id and imageKey
   * First tries to fetch from ai-content-service (for internal IDs) using userId.
   * If that fails with 404, tries HeyGen API as fallback.
   */
  private async fetchAvatarDetails(avatarId: string, userId: string, authToken?: string): Promise<{ providerAvatarId: string; imageKey?: string; isHeyGenId: boolean }> {
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
          const imageKey = avatarData.imageKey;
          
          console.log(`[RenderingService] Found internal avatar ${avatarId}, using providerAvatarId (motion ID): ${providerAvatarId}, imageKey: ${imageKey || 'not available'}`);
          return { providerAvatarId, imageKey, isHeyGenId: false };
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
    const stitchedBrollPath = path.join(userDir, `stitched_broll_${projectId}_${Date.now()}.mp4`);
    
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
    
    console.log(`[RenderingService] HALF_N_HALF: Stitching ${brollVideoPaths.length} videos (filtered from ${sortedBrollVideos.length})`);
    
    if (brollVideoPaths.length === 0) {
      throw new Error('No valid b-roll video paths found for stitching');
    }
    
    await this.videoCompositor.concatenateVideos(brollVideoPaths, stitchedBrollPath);

    await this.updateRenderingStatus(projectId, 'stitching_audio', 40);

    // Stitch all audio files together
    const stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}_${Date.now()}.mp3`);
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
    
    await this.videoCompositor.concatenateAudios(audioPaths, stitchedAudioPath);

    await this.updateRenderingStatus(projectId, 'avatar_generating', 60);

    // Generate one avatar video from full stitched audio with greyish background
    if (!fs.existsSync(stitchedAudioPath)) {
      throw new Error(`Stitched audio file not found: ${stitchedAudioPath}`);
    }
    const audioBuffer = fs.readFileSync(stitchedAudioPath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `full_audio_${projectId}.mp3`);

    // Fetch avatar details to get talking_photo_id and imageKey
    const avatarDetails = await this.fetchAvatarDetails(project.avatarId, userId, authToken);
    const talkingPhotoId = avatarDetails.providerAvatarId; // This is the motion avatar ID
    const imageKey = avatarDetails.imageKey; // For Premium mode (Avatar IV)

    // Get avatar mode (BASIC or PREMIUM) - default to BASIC
    const avatarMode = (project.avatarMode as string) || 'BASIC';
    console.log(`[RenderingService] HALF_N_HALF: Using avatar mode: ${avatarMode}`);

    let videoResponse: { video_id: string };

    if (avatarMode === 'PREMIUM') {
      // Use Avatar IV API for Premium mode
      // Note: Avatar IV generates full 9:16 portrait video, compositor will handle positioning
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
      // Generate avatar video with greyish background (1080x1440 for bottom half of 9:16)
      videoResponse = await this.heygenVideoProvider.generateAvatarVideo({
        talking_photo_id: talkingPhotoId, // Use motion avatar ID
        audio_asset_id: audioAssetId,
        dimension: {
          width: 1080,
          height: 1440, // Bottom half of 1920 (9:16)
        },
        caption: false,
      });
    }

    console.log(`[RenderingService] Created avatar video task ${videoResponse.video_id}`);
    const completedVideo = await this.heygenVideoProvider.pollVideoUntilComplete(videoResponse.video_id);

    if (!completedVideo.data.video_url) {
      throw new Error('Avatar video generation completed but no video URL');
    }

    const avatarDir = path.join(userDir, 'avatars');
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

    const avatarVideoPath = path.join(avatarDir, `avatar_full_${projectId}_${Date.now()}.mp4`);
    await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, avatarVideoPath);

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

    const finalVideoUrl = `/uploads/videos/${userId}/${path.basename(finalVideoWithAudioPath)}`;

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        renderingStatus: 'completed' as any,
        renderingProgress: 100 as any,
        videoUrl: finalVideoUrl,
        duration: totalDuration,
        currentStep: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    console.log(`[RenderingService] HALF_N_HALF video completed: ${finalVideoUrl}`);
  }

  /**
   * Process CUTOUT style:
   * - Stitch all audios together
   * - Generate one avatar video from full audio with green background
   * - Stitch all b-roll videos together
   * - Overlay avatar video on stitched b-roll (bottom center, max 40% height, remove green background)
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
    const stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}_${Date.now()}.mp3`);
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
    await this.videoCompositor.concatenateAudios(audioPaths, stitchedAudioPath);

    await this.updateRenderingStatus(projectId, 'avatar_generating', 40);

    // Generate one avatar video from full stitched audio with green background
    const audioBuffer = fs.readFileSync(stitchedAudioPath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `full_audio_${projectId}.mp3`);

    // Fetch avatar details to get talking_photo_id and imageKey
    const avatarDetails = await this.fetchAvatarDetails(project.avatarId, userId, authToken);
    const talkingPhotoId = avatarDetails.providerAvatarId; // This is the motion avatar ID
    const imageKey = avatarDetails.imageKey; // For Premium mode (Avatar IV)

    // Get avatar mode (BASIC or PREMIUM) - default to BASIC
    const avatarMode = (project.avatarMode as string) || 'BASIC';
    console.log(`[RenderingService] CUTOUT: Using avatar mode: ${avatarMode}`);

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

    const avatarDir = path.join(userDir, 'avatars');
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

    const avatarVideoPath = path.join(avatarDir, `avatar_full_${projectId}_${Date.now()}.mp4`);
    await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, avatarVideoPath);

    await this.updateRenderingStatus(projectId, 'stitching_broll', 60);

    // Stitch all b-roll videos together
    const stitchedBrollPath = path.join(userDir, `stitched_broll_${projectId}_${Date.now()}.mp4`);
    
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
    
    console.log(`[RenderingService] CUTOUT: Stitching ${brollVideoPaths.length} videos (filtered from ${sortedBrollVideos.length})`);
    
    if (brollVideoPaths.length === 0) {
      throw new Error('No valid b-roll video paths found for stitching');
    }
    
    await this.videoCompositor.concatenateVideos(brollVideoPaths, stitchedBrollPath);

    // Add audio to stitched b-roll
    const stitchedBrollWithAudioPath = path.join(userDir, `stitched_broll_audio_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.addAudioToVideo(stitchedBrollPath, stitchedAudioPath, stitchedBrollWithAudioPath);

    await this.updateRenderingStatus(projectId, 'overlaying', 80);

    // Overlay avatar video on stitched b-roll (bottom center, max 40% height, remove green background)
    const finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.overlayAvatarOnBroll(
      stitchedBrollWithAudioPath,
      avatarVideoPath,
      finalVideoPath,
      40 // Max 40% height
    );

    // Calculate total duration
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);

    const finalVideoUrl = `/uploads/videos/${userId}/${path.basename(finalVideoPath)}`;

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        renderingStatus: 'completed' as any,
        renderingProgress: 100 as any,
        videoUrl: finalVideoUrl,
        duration: totalDuration,
        currentStep: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    console.log(`[RenderingService] CUTOUT video completed: ${finalVideoUrl}`);
  }

  /**
   * Process ALTERNATE style:
   * - Generate avatar videos only for avatar scenes (not b-roll scenes), 9:16 ratio
   * - Stitch b-roll videos with audio (for b-roll scenes)
   * - Stitch avatar videos (for avatar scenes)
   * - Stitch everything together in order
   */
  private async processAlternate(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollVideos: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing ALTERNATE style for project ${projectId}`);

    if (!project.avatarId) {
      throw new Error('Avatar ID required for ALTERNATE style');
    }

    // Parse script to determine which scenes are avatar vs b-roll
    const script = typeof project.script === 'string' 
      ? JSON.parse(project.script) 
      : project.script;
    
    const scenes = script.scenes || script.scene_plan || [];
    
    // Log all videos for debugging
    console.log(`[RenderingService] ALTERNATE: Processing ${bRollVideos.length} b-roll videos:`, 
      bRollVideos.map(v => ({
        sceneNumber: v.sceneNumber,
        hasLocalPath: !!v.localPath,
        localPath: v.localPath,
        hasLocalUrl: !!v.localUrl,
        localUrl: v.localUrl,
      }))
    );
    
    // Identify avatar scenes (scenes that don't have b-roll)
    const avatarScenes = scenes.filter((scene: any) => {
      const sceneNumber = scene.scene_number || scene.sceneNumber || 1;
      return !bRollVideos.some(v => v.sceneNumber === sceneNumber);
    }).map((scene: any) => ({
      sceneNumber: scene.scene_number || scene.sceneNumber || 1,
      audioFile: audioFiles.find(af => af.sceneNumber === (scene.scene_number || scene.sceneNumber || 1)),
    })).filter((s: any) => s.audioFile);

    await this.updateRenderingStatus(projectId, 'avatar_generating', 30);

    // Fetch avatar details to get talking_photo_id and imageKey
    const avatarDetails = await this.fetchAvatarDetails(project.avatarId, userId, authToken);
    const talkingPhotoId = avatarDetails.providerAvatarId; // This is the motion avatar ID
    const imageKey = avatarDetails.imageKey; // For Premium mode (Avatar IV)

    // Get avatar mode (BASIC or PREMIUM) - default to BASIC
    const avatarMode = (project.avatarMode as string) || 'BASIC';
    console.log(`[RenderingService] ALTERNATE: Using avatar mode: ${avatarMode}`);

    // Generate avatar videos for avatar scenes only (9:16 ratio)
    const avatarDir = path.join(this.uploadsDir, 'videos', userId, 'avatars');
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

    const avatarVideos: any[] = [];
    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');
    
    for (const scene of avatarScenes) {
      // Resolve audio file path (same logic as above)
      let audioPath: string | null = null;
      const originalPath = scene.audioFile.filePath;
      
      if (path.isAbsolute(originalPath) && fs.existsSync(originalPath)) {
        audioPath = originalPath;
      } else {
        const voiceServicePath = path.join(voiceServiceDir, originalPath.startsWith('/') ? originalPath.slice(1) : originalPath);
        if (fs.existsSync(voiceServicePath)) {
          audioPath = voiceServicePath;
        } else {
          const serverRootPath = path.join(serverRoot, originalPath.startsWith('/') ? originalPath.slice(1) : originalPath);
          if (fs.existsSync(serverRootPath)) {
            audioPath = serverRootPath;
          } else {
            const cwdPath = path.join(process.cwd(), originalPath.startsWith('/') ? originalPath.slice(1) : originalPath);
            if (fs.existsSync(cwdPath)) {
              audioPath = cwdPath;
            }
          }
        }
      }
      
      if (!audioPath || !fs.existsSync(audioPath)) {
        console.warn(`[RenderingService] Audio file not found for scene ${scene.sceneNumber}: ${originalPath}, skipping`);
        continue;
      }

      const audioBuffer = fs.readFileSync(audioPath);
      const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `scene_${scene.sceneNumber}_audio.mp3`);

      let videoResponse: { video_id: string };

      if (avatarMode === 'PREMIUM') {
        // Use Avatar IV API for Premium mode
        if (!imageKey) {
          throw new Error('Image key not found. Avatar IV (Premium) requires image_key from the original upload.');
        }
        
        console.log(`[RenderingService] Using Avatar IV (Premium) for scene ${scene.sceneNumber} with image_key: ${imageKey}`);
        videoResponse = await this.heygenVideoProvider.generateAvatarIVVideo({
          image_key: imageKey,
          video_title: `Avatar Video Scene ${scene.sceneNumber} - ${projectId}`,
          audio_asset_id: audioAssetId,
          video_orientation: 'portrait', // 9:16 is portrait
          fit: 'cover', // Cover the screen
        });
      } else {
        // Use standard Avatar API for Basic mode
        if (!talkingPhotoId) {
          throw new Error('Avatar motion ID (talking_photo_id) not found. Avatar may not be ready yet.');
        }
        
        console.log(`[RenderingService] Using standard Avatar API (Basic) for scene ${scene.sceneNumber} with talking_photo_id: ${talkingPhotoId}`);
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

      console.log(`[RenderingService] Created avatar video task ${videoResponse.video_id} for scene ${scene.sceneNumber}`);
      const completedVideo = await this.heygenVideoProvider.pollVideoUntilComplete(videoResponse.video_id);

      if (!completedVideo.data.video_url) {
        throw new Error(`Avatar video generation completed but no video URL for scene ${scene.sceneNumber}`);
      }

      const avatarVideoPath = path.join(avatarDir, `avatar_scene_${scene.sceneNumber}_${projectId}_${Date.now()}.mp4`);
      await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, avatarVideoPath);

      avatarVideos.push({
        sceneNumber: scene.sceneNumber,
        localPath: avatarVideoPath,
        duration: scene.audioFile.duration,
      });
    }

    await this.updateRenderingStatus(projectId, 'stitching', 70);

    // Sort all scenes by scene number and create final video sequence
    const sortedScenes = [...scenes].sort((a, b) => 
      (a.scene_number || a.sceneNumber || 1) - (b.scene_number || b.sceneNumber || 1)
    );

    const userDir = path.join(this.uploadsDir, 'videos', userId);
    const sceneVideoPaths: string[] = [];
    const sceneAudioPaths: string[] = [];

    for (const scene of sortedScenes) {
      const sceneNumber = scene.scene_number || scene.sceneNumber || 1;
      const brollVideo = bRollVideos.find(v => v.sceneNumber === sceneNumber);
      const avatarVideo = avatarVideos.find(v => v.sceneNumber === sceneNumber);
      const audioFile = audioFiles.find(af => af.sceneNumber === sceneNumber);

      if (brollVideo && audioFile) {
        // B-roll scene: add audio to b-roll video
        // Resolve b-roll video path (try localPath first, then derive from localUrl)
        let brollVideoPath: string | null = null;
        
        if (brollVideo.localPath) {
          brollVideoPath = path.isAbsolute(brollVideo.localPath) 
            ? brollVideo.localPath 
            : path.resolve(brollVideo.localPath);
        } else if (brollVideo.localUrl) {
          // If no localPath, try to derive from localUrl
          // localUrl format: /uploads/videos/{userId}/{filename}
          const urlPath = brollVideo.localUrl.startsWith('/uploads') ? brollVideo.localUrl : brollVideo.localUrl;
          const relativePath = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
          brollVideoPath = path.join(userDir, relativePath);
        }
        
        if (!brollVideoPath || !fs.existsSync(brollVideoPath)) {
          console.warn(`[RenderingService] ALTERNATE: B-roll video not found for scene ${sceneNumber}, localPath: ${brollVideo.localPath}, localUrl: ${brollVideo.localUrl}`);
          // Skip this scene if video doesn't exist
          continue;
        }
        
        const brollWithAudioPath = path.join(userDir, `broll_audio_${sceneNumber}_${projectId}_${Date.now()}.mp4`);
        // Convert audio file path to absolute (same logic as above)
        const serverRoot = path.join(process.cwd(), '..', '..');
        const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');
        
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
          throw new Error(`Audio file not found for scene ${sceneNumber}: ${audioFile.filePath}`);
        }
        await this.videoCompositor.addAudioToVideo(brollVideoPath, audioFilePath, brollWithAudioPath);
        // Ensure brollWithAudioPath is absolute
        const absoluteBrollPath = path.isAbsolute(brollWithAudioPath) 
          ? brollWithAudioPath 
          : path.resolve(brollWithAudioPath);
        sceneVideoPaths.push(absoluteBrollPath);
        sceneAudioPaths.push(audioFilePath);
      } else if (avatarVideo) {
        // Avatar scene
        // Ensure avatarVideo.localPath is absolute
        const absoluteAvatarPath = avatarVideo.localPath && path.isAbsolute(avatarVideo.localPath)
          ? avatarVideo.localPath
          : avatarVideo.localPath ? path.resolve(avatarVideo.localPath) : null;
        if (absoluteAvatarPath && fs.existsSync(absoluteAvatarPath)) {
          sceneVideoPaths.push(absoluteAvatarPath);
        }
        if (audioFile && audioFile.filePath) {
          // Convert audio file path to absolute (same logic as above)
          const serverRoot = path.join(process.cwd(), '..', '..');
          const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');
          
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
          
          if (audioFilePath && fs.existsSync(audioFilePath)) {
            sceneAudioPaths.push(audioFilePath);
          }
        }
      }
    }

    // Stitch all scene videos together
    const finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    // Ensure all scene video paths are absolute before concatenation
    const absoluteSceneVideoPaths = sceneVideoPaths
      .map(vp => {
        if (!vp) return null;
        // Convert to absolute path if relative
        const absolutePath = path.isAbsolute(vp) 
          ? vp 
          : path.resolve(vp);
        return absolutePath;
      })
      .filter(p => p && fs.existsSync(p)) as string[];
    await this.videoCompositor.concatenateVideos(absoluteSceneVideoPaths, finalVideoPath);

    // Stitch all audio files together
    const stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}_${Date.now()}.mp3`);
    await this.videoCompositor.concatenateAudios(sceneAudioPaths, stitchedAudioPath);

    // Add final stitched audio to final video
    const finalVideoWithAudioPath = path.join(userDir, `final_with_audio_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.addAudioToVideo(finalVideoPath, stitchedAudioPath, finalVideoWithAudioPath);

    // Calculate total duration
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);

    const finalVideoUrl = `/uploads/videos/${userId}/${path.basename(finalVideoWithAudioPath)}`;

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        renderingStatus: 'completed' as any,
        renderingProgress: 100 as any,
        videoUrl: finalVideoUrl,
        duration: totalDuration,
        currentStep: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    console.log(`[RenderingService] ALTERNATE video completed: ${finalVideoUrl}`);
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
