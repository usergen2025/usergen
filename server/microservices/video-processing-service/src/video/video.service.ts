import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import {
  CreateVideoProjectDto,
  UpdateVideoProjectDto,
  UpdateVideoProjectStepDto,
} from './dto/video-project.dto';

@Injectable()
export class VideoService {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Create a new video project
   */
  async createProject(userId: string, dto: CreateVideoProjectDto) {
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
        metadata: dto.metadata,
      },
    });

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

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.style !== undefined) updateData.style = dto.style;
    if (dto.avatarId !== undefined) updateData.avatarId = dto.avatarId;
    if (dto.avatarName !== undefined) updateData.avatarName = dto.avatarName;
    if (dto.avatarUrl !== undefined) updateData.avatarUrl = dto.avatarUrl;
    if (dto.script !== undefined) updateData.script = dto.script;
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
    }
    if (dto.audioGenerationConfig !== undefined) updateData.audioGenerationConfig = dto.audioGenerationConfig;
    if (dto.bRollImages !== undefined) updateData.bRollImages = dto.bRollImages;
    if (dto.bRollVideoTasks !== undefined) updateData.bRollVideoTasks = dto.bRollVideoTasks;
    if (dto.avatarVideos !== undefined) updateData.avatarVideos = dto.avatarVideos;
    if (dto.sceneVideos !== undefined) updateData.sceneVideos = dto.sceneVideos;
    if (dto.renderingStatus !== undefined) updateData.renderingStatus = dto.renderingStatus;
    if (dto.renderingProgress !== undefined) updateData.renderingProgress = dto.renderingProgress;
    if (dto.bRollSource !== undefined) updateData.bRollSource = dto.bRollSource;
    if (dto.bRollVideos !== undefined) updateData.bRollVideos = dto.bRollVideos;
    if (dto.bRollPrompt !== undefined) updateData.bRollPrompt = dto.bRollPrompt;
    if (dto.captionSettings !== undefined) updateData.captionSettings = dto.captionSettings;
    if (dto.captionsEnabled !== undefined) updateData.captionsEnabled = dto.captionsEnabled;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.currentStep !== undefined) updateData.currentStep = dto.currentStep;
    if (dto.progress !== undefined) updateData.progress = dto.progress;
    if (dto.progressStage !== undefined) updateData.progressStage = dto.progressStage;
    if (dto.videoUrl !== undefined) updateData.videoUrl = dto.videoUrl;
    if (dto.thumbnailUrl !== undefined) updateData.thumbnailUrl = dto.thumbnailUrl;
    if (dto.duration !== undefined) updateData.duration = dto.duration;
    if (dto.metadata !== undefined) updateData.metadata = dto.metadata;

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

    return {
      success: true,
      data: project,
    };
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

