import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../common/database/database.service';
import {
  CreateVideoProjectDto,
  UpdateVideoProjectDto,
  UpdateVideoProjectStepDto,
} from './dto/video-project.dto';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { ProjectLogService } from '../common/logging/project-log.service';
import { UserNotificationService } from '../notifications/user-notification.service';

@Injectable()
export class VideoService {
  private readonly aiContentServiceUrl: string;
  private readonly jwtSecret: string;
  /** Dedupe concurrent ensureProjectAvatarImage calls per project */
  private readonly ensureAvatarImageInFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly projectLog: ProjectLogService,
    private readonly userNotificationService: UserNotificationService,
  ) {
    this.aiContentServiceUrl = 
      this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 
      'http://localhost:9001';
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 
                     'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';
  }

  /**
   * Create a new video project
   */
  async createProject(userId: string, dto: CreateVideoProjectDto) {
    // Prepare initial metadata with asset analysis status if assets are present
    let initialMetadata = dto.metadata || {};
    const assets = initialMetadata?.assets;
    
    if (assets && Array.isArray(assets) && assets.length > 0) {
      initialMetadata = {
        ...initialMetadata,
        assetAnalysis: {
          status: 'pending',
          totalAssets: assets.length,
          completedAssets: 0,
          startedAt: new Date().toISOString(),
        },
      };
    }

    const project = await this.databaseService.videoProject.create({
      data: {
        userId,
        workspaceId: dto.workspaceId,
        title: dto.title,
        description: dto.description,
        videoType: dto.videoType,
        style: dto.style,
        avatarId: dto.avatarId,
        avatarName: dto.avatarName,
        avatarUrl: dto.avatarUrl,
        script: dto.script,
        scriptGenerated: dto.scriptGenerated || false,
        voiceId: dto.voiceId,
        voiceType: dto.voiceType,
        clonedVoiceId: dto.clonedVoiceId,
        voiceSettings: dto.voiceSettings,
        bRollSource: dto.bRollSource,
        bRollVideos: dto.bRollVideos || [],
        bRollPrompt: dto.bRollPrompt,
        captionSettings: dto.captionSettings,
        captionsEnabled: dto.captionsEnabled || false,
        currentStep: dto.currentStep || 'STYLE_SELECTION',
        status: dto.status || 'DRAFT',
        metadata: initialMetadata,
      },
    });
    await this.projectLog
      .logProject(project.id, 'INFO', 'PROJECT_STARTED', {
        op: 'project-lifecycle',
      })
      .catch(() => {});
    if (dto.style) {
      await this.projectLog
        .logProject(project.id, 'INFO', `STYLE_SELECTED ${dto.style}`, {
          op: 'project-lifecycle',
        })
        .catch(() => {});
    }
    const firstAssetUrl = Array.isArray(assets) && assets.length > 0 ? assets[0]?.url : undefined;
    if (firstAssetUrl) {
      await this.projectLog
        .logProject(project.id, 'INFO', `ASSET_ADDED ${firstAssetUrl}`, {
          op: 'project-assets',
        })
        .catch(() => {});
    }

    // Trigger asset analysis in background (non-blocking)
    if (assets && Array.isArray(assets) && assets.length > 0) {
      this.triggerAssetAnalysis(project.id, userId, assets).catch(error => {
        console.error(`[VideoService] Failed to trigger asset analysis for project ${project.id}:`, error.message);
      });
    }

    return {
      success: true,
      data: project,
    };
  }

  /**
   * Get video project by ID
   */
  async getProject(projectId: string, userId: string) {
    const project = await this.databaseService.videoProject.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!project) {
      throw new NotFoundException('Video project not found');
    }

    return {
      success: true,
      data: project,
    };
  }

  /**
   * Get all video projects for a user
   */
  async getProjects(userId: string, workspaceId?: string) {
    const where: any = { userId };
    if (workspaceId) {
      where.workspaceId = workspaceId;
    }

    const projects = await this.databaseService.videoProject.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      success: true,
      data: projects,
    };
  }

  /**
   * Get paginated lightweight projects list for cards/grid UI.
   */
  async getProjectsPaginated(
    userId: string,
    params: {
      limit?: number;
      cursor?: string;
      status?: string;
      workspaceId?: string;
    } = {},
  ) {
    const limit = Math.min(Math.max(params.limit || 20, 1), 50);
    const where: any = { userId };

    if (params.workspaceId) {
      where.workspaceId = params.workspaceId;
    }
    if (params.status && params.status !== 'all') {
      where.status = params.status;
    }

    if (params.cursor) {
      const cursorProject = await this.databaseService.videoProject.findFirst({
        where: { id: params.cursor, userId },
        select: { createdAt: true, id: true },
      });

      if (cursorProject) {
        where.OR = [
          { createdAt: { lt: cursorProject.createdAt } },
          {
            AND: [
              { createdAt: cursorProject.createdAt },
              { id: { lt: cursorProject.id } },
            ],
          },
        ];
      }
    }

    const items = await this.databaseService.videoProject.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        title: true,
        description: true,
        videoType: true,
        style: true,
        avatarId: true,
        status: true,
        currentStep: true,
        progress: true,
        progressStage: true,
        videoUrl: true,
        thumbnailUrl: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        metadata: true,
      },
    });

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? pageItems[pageItems.length - 1]?.id || null : null;

    return {
      success: true,
      data: {
        items: pageItems,
        nextCursor,
        hasMore,
      },
    };
  }

  /**
   * Update video project
   */
  async updateProject(projectId: string, userId: string, dto: UpdateVideoProjectDto) {
    // Verify project exists and belongs to user
    const existing = await this.databaseService.videoProject.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Video project not found');
    }

    // Build update data (only include fields that are provided)
    const updateData: any = {};
    const changedFields: string[] = [];

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.style !== undefined) {
      updateData.style = dto.style;
      changedFields.push('style');
    }
    if (dto.avatarId !== undefined) updateData.avatarId = dto.avatarId;
    if (dto.avatarName !== undefined) updateData.avatarName = dto.avatarName;
    if (dto.avatarUrl !== undefined) updateData.avatarUrl = dto.avatarUrl;
    if (dto.avatarMode !== undefined) updateData.avatarMode = dto.avatarMode;
    if (dto.script !== undefined) {
      updateData.script = dto.script;
      changedFields.push('script');
    }
    if (dto.scriptGenerated !== undefined) updateData.scriptGenerated = dto.scriptGenerated;
    if (dto.voiceId !== undefined) updateData.voiceId = dto.voiceId;
    if (dto.voiceType !== undefined) updateData.voiceType = dto.voiceType;
    if (dto.clonedVoiceId !== undefined) updateData.clonedVoiceId = dto.clonedVoiceId;
    if (dto.voiceSettings !== undefined) updateData.voiceSettings = dto.voiceSettings;
    if (dto.audioFiles !== undefined) {
      console.log(`[VideoService] Saving audioFiles to project ${projectId}:`, 
        Array.isArray(dto.audioFiles) ? `${dto.audioFiles.length} files` : 'not an array',
        dto.audioFiles
      );
      updateData.audioFiles = dto.audioFiles;
      changedFields.push('audioFiles');
    }
    if (dto.audioGenerationConfig !== undefined) updateData.audioGenerationConfig = dto.audioGenerationConfig;
    if (dto.bRollImages !== undefined) {
      updateData.bRollImages = dto.bRollImages;
      changedFields.push('bRollImages');
    }
    if (dto.bRollVideoTasks !== undefined) {
      updateData.bRollVideoTasks = dto.bRollVideoTasks;
      changedFields.push('bRollVideoTasks');
    }
    if (dto.avatarVideos !== undefined) updateData.avatarVideos = dto.avatarVideos;
    if (dto.sceneVideos !== undefined) updateData.sceneVideos = dto.sceneVideos;
    if (dto.renderingStatus !== undefined) updateData.renderingStatus = dto.renderingStatus;
    if (dto.renderingProgress !== undefined) updateData.renderingProgress = dto.renderingProgress;
    if (dto.bRollSource !== undefined) updateData.bRollSource = dto.bRollSource;
    if (dto.bRollVideos !== undefined) updateData.bRollVideos = dto.bRollVideos;
    if (dto.bRollPrompt !== undefined) updateData.bRollPrompt = dto.bRollPrompt;
    if (dto.captionSettings !== undefined) {
      updateData.captionSettings = dto.captionSettings;
      changedFields.push('captionSettings');
    }
    if (dto.captionsEnabled !== undefined) {
      updateData.captionsEnabled = dto.captionsEnabled;
      changedFields.push('captionsEnabled');
    }
    if (dto.backgroundMusic !== undefined) {
      updateData.backgroundMusic = dto.backgroundMusic;
      changedFields.push('backgroundMusic');
    }
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.currentStep !== undefined) {
      updateData.currentStep = dto.currentStep;
      changedFields.push('currentStep');
    }
    if (dto.progress !== undefined) updateData.progress = dto.progress;
    if (dto.progressStage !== undefined) updateData.progressStage = dto.progressStage;
    if (dto.videoUrl !== undefined) updateData.videoUrl = dto.videoUrl;
    if (dto.thumbnailUrl !== undefined) updateData.thumbnailUrl = dto.thumbnailUrl;
    if (dto.duration !== undefined) updateData.duration = dto.duration;
    // Merge metadata so partial updates (e.g. script, step) don't wipe generationFlow, aiChatStep, assetAnalysis
    if (dto.metadata !== undefined) {
      const existingMeta = existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? (existing.metadata as Record<string, unknown>)
        : {};
      updateData.metadata = { ...existingMeta, ...dto.metadata };
      changedFields.push('metadata');
    }
    // When script or style changes, clear generated avatar image cache so it is regenerated at b-roll step
    if (dto.script !== undefined || dto.style !== undefined) {
      const base = (updateData.metadata ?? existing.metadata) as Record<string, unknown> | null | undefined;
      const meta = base && typeof base === 'object' ? { ...base } : {};
      delete meta.generatedAvatarImageKey;
      delete meta.avatarImageScriptHash;
      // Mirror script.avatar_image_prompt to metadata for use anywhere without parsing script
      if (dto.script !== undefined) {
        try {
          const scriptObj = typeof dto.script === 'string' ? JSON.parse(dto.script) : dto.script;
          const prompt = scriptObj?.avatar_image_prompt;
          if (typeof prompt === 'string' && prompt.trim()) {
            meta.avatarImagePrompt = prompt.trim();
          }
          // Merge music search seed from script when client is not sending full backgroundMusic in the same request
          const seed = scriptObj?.backgroundMusic?.searchSeed;
          if (
            seed &&
            typeof seed === 'object' &&
            (dto as any).backgroundMusic === undefined &&
            (typeof seed.query === 'string' ||
              (Array.isArray(seed.genres) && seed.genres.length > 0) ||
              (Array.isArray(seed.moods) && seed.moods.length > 0))
          ) {
            const prev =
              existing.backgroundMusic && typeof existing.backgroundMusic === 'object'
                ? (existing.backgroundMusic as Record<string, unknown>)
                : {};
            updateData.backgroundMusic = {
              ...prev,
              searchSeed: seed,
            };
            changedFields.push('backgroundMusic');
          }
        } catch {
          // ignore parse errors
        }
      }
      updateData.metadata = meta;
    }

    // Update timestamps
    if (dto.status === 'IN_PROGRESS' && existing.status === 'DRAFT') {
      updateData.startedAt = new Date();
    }
    if (dto.status === 'COMPLETED') {
      updateData.completedAt = new Date();
    }

    const project = await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: updateData,
    });
    if (changedFields.length > 0) {
      const step = dto.currentStep ? ` step=${dto.currentStep}` : '';
      await this.projectLog
        .logProject(
          projectId,
          'INFO',
          `PROJECT_UPDATED fields=${changedFields.join(',')}${step}`,
          { op: 'project-lifecycle' },
        )
        .catch(() => {});
    }
    if (dto.script !== undefined) {
      const scriptPreview = typeof dto.script === 'string' ? dto.script.slice(0, 240) : JSON.stringify(dto.script).slice(0, 240);
      await this.projectLog
        .logProject(projectId, 'INFO', `SCRIPT_INPUT_RECEIVED ${scriptPreview}`, {
          op: 'script',
        })
        .catch(() => {});
    }
    if (dto.scriptGenerated === true && dto.script !== undefined) {
      await this.projectLog
        .logProject(projectId, 'INFO', 'SCRIPT_GENERATED successfully', {
          op: 'script',
        })
        .catch(() => {});
      this.userNotificationService
        .notifyProcessingEvent({
          userId,
          projectId,
          type: 'SCRIPT_GENERATED',
          operation: 'script-generation',
          status: 'completed',
          title: 'Script generated',
          message: 'Your script generation is complete.',
          data: { currentStep: dto.currentStep },
        })
        .catch(() => {});
    }

    // Trigger asset analysis if metadata with assets was updated
    if (dto.metadata?.assets && Array.isArray(dto.metadata.assets) && dto.metadata.assets.length > 0) {
      // Check if analysis hasn't been completed yet
      const currentMetadata = project.metadata as any;
      const analysisStatus = currentMetadata?.assetAnalysis?.status;
      
      if (!analysisStatus || analysisStatus === 'pending' || analysisStatus === 'failed') {
        this.triggerAssetAnalysis(projectId, userId, dto.metadata.assets).catch(error => {
          console.error(`[VideoService] Failed to trigger asset analysis for project ${projectId}:`, error.message);
        });
      }
    }

    return {
      success: true,
      data: project,
    };
  }

  /**
   * Trigger asset analysis in ai-content-service (non-blocking)
   */
  private async triggerAssetAnalysis(
    projectId: string,
    userId: string,
    assets: Array<{ id: string; url: string; type?: string; category?: string }>
  ): Promise<void> {
    try {
      // Generate service token
      const token = jwt.sign(
        { sub: userId, userId, id: userId, type: 'service' },
        this.jwtSecret,
        { expiresIn: '1h' }
      );

      // Prepare assets for analysis
      const assetsForAnalysis = assets.map(asset => ({
        id: asset.id,
        url: asset.url || (asset as any).publicUrl || (asset as any).imageUrl,
        type: asset.type || 'image',
        userLabel: asset.category || (asset as any).label,
      })).filter(asset => {
        // Filter out invalid URLs (empty, placeholder, or non-HTTP(S))
        if (!asset.url) {
          console.warn(`[VideoService] Skipping asset ${asset.id}: no URL provided`);
          return false;
        }
        
        // Filter out placeholder URLs (example.com, placeholder, etc.)
        if (asset.url.includes('example.com') || 
            asset.url.includes('placeholder') || 
            asset.url === 'x.png' ||
            asset.url.endsWith('/x.png')) {
          console.warn(`[VideoService] Skipping asset ${asset.id}: invalid placeholder URL detected: ${asset.url}`);
          return false;
        }
        
        // Allow HTTP(S) URLs
        if (asset.url.startsWith('http://') || asset.url.startsWith('https://')) {
          return true;
        }
        
        // Allow /uploads paths as they'll be converted to public URLs
        if (asset.url.startsWith('/uploads')) {
          return true;
        }
        
        // Reject other invalid formats
        console.warn(`[VideoService] Skipping asset ${asset.id}: invalid URL format: ${asset.url}`);
        return false;
      }); // Only include assets with valid URLs

      if (assetsForAnalysis.length === 0) {
        console.warn(`[VideoService] No valid asset URLs found for analysis in project ${projectId}`);
        return;
      }

      // Call ai-content-service to queue analysis
      await axios.post(
        `${this.aiContentServiceUrl}/api/assets/analyze`,
        {
          projectId,
          assets: assetsForAnalysis,
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        }
      );

      console.log(`[VideoService] Successfully queued asset analysis for project ${projectId} with ${assetsForAnalysis.length} assets`);
    } catch (error: any) {
      // Log but don't throw - this is a background operation
      console.error(`[VideoService] Failed to trigger asset analysis:`, error.message);
    }
  }

  /**
   * Ensure project has a generated avatar image (for Avatar IV). Called when user is on b-roll images step.
   * If script has avatar_image_prompt and cache is missing or script changed, calls ai-content-service to generate and stores in metadata.
   */
  async ensureProjectAvatarImage(projectId: string, userId: string, authToken?: string): Promise<void> {
    const existing = this.ensureAvatarImageInFlight.get(projectId);
    if (existing) return existing;

    const run = (async () => {
      try {
        await this.runEnsureProjectAvatarImage(projectId, userId, authToken);
      } catch (error: any) {
        console.warn(`[VideoService] ensureProjectAvatarImage failed for project ${projectId}:`, error.message);
      }
    })().finally(() => {
      this.ensureAvatarImageInFlight.delete(projectId);
    });

    this.ensureAvatarImageInFlight.set(projectId, run);
    return run;
  }

  private async runEnsureProjectAvatarImage(projectId: string, userId: string, authToken?: string): Promise<void> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });
    if (!project || !project.avatarId || !project.script) return;
    const script = typeof project.script === 'string' ? JSON.parse(project.script) : project.script;
    const preset = (project.metadata as Record<string, unknown>)?.avatarVisualStylePreset as string | undefined;
    if (!preset || preset === 'random') {
      if (!script?.avatar_image_prompt) return;
    }
    const scriptHash = crypto.createHash('sha256').update(JSON.stringify(project.script)).digest('hex');
    const meta = (project.metadata as Record<string, unknown>) || {};
    if (meta.generatedAvatarImageKey && meta.avatarImageScriptHash === scriptHash) return;

    // AI Chat: preview exists but user has not finalized HeyGen upload yet — do not duplicate BytePlus/HeyGen here
    const previewUrl = meta.avatarPreviewUrl;
    if (
      typeof previewUrl === 'string' &&
      previewUrl.length > 0 &&
      !meta.generatedAvatarImageKey
    ) {
      return;
    }

    const token = authToken?.replace(/^Bearer\s+/i, '') ?? jwt.sign(
      { sub: userId, userId, id: userId, type: 'service' },
      this.jwtSecret,
      { expiresIn: '1h' },
    );
    const res = await axios.post<{ success: boolean; data: { imageKey: string } }>(
      `${this.aiContentServiceUrl}/api/avatars/generate-for-project`,
      {
        projectId,
        avatarId: project.avatarId,
        userId,
        script,
        style: project.style ?? undefined,
        avatarVisualStylePreset: preset,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      },
    );
    if (!res.data?.success || !res.data?.data?.imageKey) return;
    const existingMeta = (project.metadata as Record<string, unknown>) || {};
    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        metadata: {
          ...existingMeta,
          generatedAvatarImageKey: res.data.data.imageKey,
          avatarImageScriptHash: scriptHash,
        },
      },
    });
    console.log(`[VideoService] Stored generated avatar image key for project ${projectId}`);
  }

  /**
   * Update video project step (for navigating back/forward in flow)
   */
  async updateProjectStep(projectId: string, userId: string, dto: UpdateVideoProjectStepDto) {
    const existing = await this.databaseService.videoProject.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Video project not found');
    }

    const project = await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        currentStep: dto.step,
        ...(dto.updateData || {}),
      },
    });

    return {
      success: true,
      data: project,
    };
  }

  /**
   * Update B-roll for a specific scene (stock or uploaded content)
   * Source types: 'stock-image' | 'stock-video' | 'upload-image' | 'upload-video' | 'ai-image' | 'ai-video'
   */
  async updateSceneBroll(
    projectId: string,
    userId: string,
    sceneNumber: number,
    data: { 
      brollUrl: string; 
      brollType: 'image' | 'video'; 
      source: string;
      localPath?: string;
      gcsUrl?: string;
      videoPrompt?: string;
      skipConversion?: boolean;
    },
  ) {
    const existing = await this.databaseService.videoProject.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Video project not found');
    }

    const now = new Date().toISOString();
    
    // Determine the full source type based on brollType and source
    // This handles both new format (stock-image, upload-video) and legacy format (freepik, upload)
    let fullSourceType: string;
    if (data.source.includes('-')) {
      // New format: already includes type (e.g., 'stock-image', 'upload-video')
      fullSourceType = data.source;
    } else {
      // Legacy format: convert 'freepik' -> 'stock-X', 'upload' -> 'upload-X'
      const sourceBase = data.source === 'freepik' ? 'stock' : data.source;
      fullSourceType = `${sourceBase}-${data.brollType}`;
    }
    
    const isUpload = fullSourceType.startsWith('upload-');
    
    if (data.brollType === 'image') {
      // Update bRollImages array
      const currentImages = (existing.bRollImages as any[]) || [];
      const existingIndex = currentImages.findIndex(
        (img: any) => img.sceneNumber === sceneNumber,
      );

      const newImageEntry = {
        sceneNumber,
        imageUrl: data.brollUrl,
        localPath: data.localPath || null,
        localUrl: data.localPath ? `/uploads/stock/${projectId}/${data.localPath.split('/').pop()}` : data.brollUrl,
        gcsUrl: data.gcsUrl || null,
        publicUrl: data.gcsUrl || data.brollUrl,
        source: fullSourceType,
        contentType: 'image',
        customUpload: isUpload,
        videoPrompt: data.videoPrompt || null, // Generated prompt for video conversion
        createdAt: now,
      };

      let updatedImages: any[];
      if (existingIndex >= 0) {
        updatedImages = [...currentImages];
        updatedImages[existingIndex] = { ...currentImages[existingIndex], ...newImageEntry };
      } else {
        updatedImages = [...currentImages, newImageEntry];
      }

      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: { bRollImages: updatedImages },
      });
    } else {
      // Update bRollVideoTasks array for video
      const currentVideos = (existing.bRollVideoTasks as any[]) || [];
      const existingIndex = currentVideos.findIndex(
        (vid: any) => vid.sceneNumber === sceneNumber,
      );

      const newVideoEntry = {
        sceneNumber,
        videoUrl: data.brollUrl,
        localPath: data.localPath || null,
        localUrl: data.localPath ? `/uploads/stock/${projectId}/${data.localPath.split('/').pop()}` : data.brollUrl,
        gcsUrl: data.gcsUrl || null,
        publicUrl: data.gcsUrl || data.brollUrl,
        source: fullSourceType,
        contentType: 'video',
        customUpload: isUpload,
        skipConversion: data.skipConversion || isUpload, // Skip conversion for uploaded videos
        status: 'completed', // Stock/upload videos are ready
        createdAt: now,
      };

      let updatedVideos: any[];
      if (existingIndex >= 0) {
        updatedVideos = [...currentVideos];
        updatedVideos[existingIndex] = { ...currentVideos[existingIndex], ...newVideoEntry };
      } else {
        updatedVideos = [...currentVideos, newVideoEntry];
      }

      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: { bRollVideoTasks: updatedVideos },
      });
    }

    return {
      success: true,
      message: `Scene ${sceneNumber} B-roll updated successfully`,
      data: {
        sceneNumber,
        brollType: data.brollType,
        source: fullSourceType,
      },
    };
  }

  /**
   * Delete video project
   */
  async deleteProject(projectId: string, userId: string) {
    const existing = await this.databaseService.videoProject.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Video project not found');
    }

    await this.databaseService.videoProject.delete({
      where: { id: projectId },
    });

    return {
      success: true,
      message: 'Video project deleted successfully',
    };
  }

  /**
   * Get user's active project (most recent draft or in-progress)
   */
  async getActiveProject(userId: string) {
    const project = await this.databaseService.videoProject.findFirst({
      where: {
        userId,
        status: {
          in: ['DRAFT', 'IN_PROGRESS'],
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return {
      success: true,
      data: project,
    };
  }
}

