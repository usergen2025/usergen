import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Request,
  HttpCode,
  HttpStatus,
  HttpException,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ServiceUnavailableException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';
import { VideoService } from './video.service';
import { RenderingService } from '../rendering/rendering.service';
import { VideoCompositorProvider } from '../rendering/providers/video-compositor.provider';
import { QueueManagerService } from '../common/queue/queue-manager.service';
import { ModelRegistryService } from '../rendering/providers/model-registry.service';
import { PublicUrlService } from '../common/storage/public-url.service';
import {
  CreateVideoProjectDto,
  UpdateVideoProjectDto,
  UpdateVideoProjectStepDto,
} from './dto/video-project.dto';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { buildAudioGenerationConfig, shouldRegenerateAudio } from '../common/utils/audio-config.util';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import type { Multer } from 'multer';
import axios from 'axios';
import { BrandPackagingService } from '../brand/brand-packaging.service';

@ApiTags('video-projects')
@Controller('video-projects')
export class VideoController {
  constructor(
    private readonly videoService: VideoService,
    private readonly renderingService: RenderingService,
    private readonly queueManager: QueueManagerService,
    private readonly configService: ConfigService,
    private readonly modelRegistry: ModelRegistryService,
    private readonly publicUrlService: PublicUrlService,
    private readonly videoCompositor: VideoCompositorProvider,
    private readonly brandPackagingService: BrandPackagingService,
  ) {}

  /**
   * Returns true if the URL is reachable by external services (e.g. BytePlus).
   * Must be a full URL and must not be localhost.
   */
  private isPubliclyReachableUrl(url: string | undefined): boolean {
    if (!url || typeof url !== 'string') return false;
    const u = url.trim();
    return (u.startsWith('http://') || u.startsWith('https://')) && !u.includes('localhost');
  }

  /**
   * Extract userId from JWT token
   * Handles both user tokens and service tokens (with type: 'service')
   */
  private extractUserIdFromToken(req: any): string | null {
    try {
      const authHeader = req.headers?.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('[VideoController] Missing or invalid Authorization header');
        return null;
      }

      const token = authHeader.replace('Bearer ', '');
      const jwtSecret = this.configService.get<string>('JWT_SECRET') || 
                       'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';
      
      if (!jwtSecret || jwtSecret === 'your-jwt-secret') {
        console.error('[VideoController] JWT_SECRET is not configured properly');
        return null;
      }
      
      const decoded = jwt.verify(token, jwtSecret) as any;
      
      // Log decoded token for debugging (without sensitive data)
      const tokenType = decoded.type || 'user';
      console.log(`[VideoController] Token decoded - type: ${tokenType}, has sub: ${!!decoded.sub}, has userId: ${!!decoded.userId}, has id: ${!!decoded.id}`);
      
      // Extract userId - support both user tokens and service tokens
      // Service tokens have type: 'service' but still contain userId in sub/userId/id fields
      const userId = decoded.sub || decoded.userId || decoded.id || null;
      
      if (!userId) {
        console.warn('[VideoController] Token decoded but no userId found in payload', {
          tokenType,
          decodedKeys: Object.keys(decoded),
          hasSub: !!decoded.sub,
          hasUserId: !!decoded.userId,
          hasId: !!decoded.id,
        });
        return null;
      }
      
      // Log successful extraction
      if (tokenType === 'service') {
        console.log(`[VideoController] Successfully extracted userId from service token: ${userId}`);
      }
      
      return userId;
    } catch (error: any) {
      if (error.name === 'JsonWebTokenError') {
        console.warn('[VideoController] Invalid JWT token:', error.message);
      } else if (error.name === 'TokenExpiredError') {
        console.warn('[VideoController] JWT token has expired');
      } else {
        console.error('[VideoController] Error verifying token:', error.message, error.stack);
      }
      return null;
    }
  }

  /** Parse script scenes from project data */
  private getScriptScenes(projectData: any): any[] {
    const script = typeof projectData.script === 'string'
      ? JSON.parse(projectData.script)
      : projectData.script;
    return script?.scenes || script?.scene_plan || [];
  }

  private getSceneFromScript(projectData: any, sceneNumber: number): any | undefined {
    return this.getScriptScenes(projectData).find(
      (s: any) => (s.scene_number || s.sceneNumber) === sceneNumber,
    );
  }

  /**
   * ALTERNATE scene role: b-roll (full 9:16) or avatar (full 9:16 talking head).
   * Uses script scene.type when present; falls back to odd=b-roll, even=avatar.
   */
  private getAlternateSceneRole(projectData: any, sceneNumber: number): 'b-roll' | 'avatar' {
    const scene = this.getSceneFromScript(projectData, sceneNumber);
    const sceneType = (scene?.type || '').toLowerCase();
    if (sceneType === 'avatar') return 'avatar';
    if (sceneType === 'b-roll' || sceneType === 'broll' || sceneType === 'half-n-half') {
      return 'b-roll';
    }
    return sceneNumber % 2 === 1 ? 'b-roll' : 'avatar';
  }

  private isAlternateAvatarScene(projectData: any, sceneNumber: number): boolean {
    return projectData?.style === 'ALTERNATE'
      && this.getAlternateSceneRole(projectData, sceneNumber) === 'avatar';
  }

  private isAlternateBrollScene(projectData: any, sceneNumber: number): boolean {
    return projectData?.style === 'ALTERNATE'
      && this.getAlternateSceneRole(projectData, sceneNumber) === 'b-roll';
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new video project', description: 'Create a new video project with initial configuration' })
  @ApiResponse({ status: 201, description: 'Video project created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createProject(@Request() req: any, @Body() dto: CreateVideoProjectDto) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      console.error('[VideoController] Failed to extract userId from token. Auth header:', req.headers?.authorization ? 'present' : 'missing');
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    return await this.videoService.createProject(userId, dto);
  }

  @Get()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get all video projects', description: 'Get all video projects for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Video projects retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProjects(
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('status') status?: string,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
    }

    if (limit || cursor || status) {
      return await this.videoService.getProjectsPaginated(userId, {
        limit: limit ? parseInt(limit, 10) : undefined,
        cursor,
        status,
      });
    }

    return await this.videoService.getProjects(userId);
  }

  @Get('active')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get active project', description: 'Get the most recent draft or in-progress project' })
  @ApiResponse({ status: 200, description: 'Active project retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getActiveProject(@Request() req: any) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      console.error('[VideoController] Failed to extract userId from token for active project');
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    return await this.videoService.getActiveProject(userId);
  }

  @Get('image-generation-models')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get available image generation models', description: 'Returns list of all available image generation models' })
  @ApiResponse({ status: 200, description: 'Models retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getImageGenerationModels(@Request() req: any) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    // Get models with their keys (Map keys like 'model-1', 'model-2', etc.)
    const modelsWithKeys = this.modelRegistry.getAllModelsWithKeys();
    return {
      success: true,
      data: {
        models: modelsWithKeys.map(([key, model]) => ({
          id: key, // Use Map key ('model-1', 'model-2', etc.) as the id
          displayName: model.displayName, // "Model 1"
          platform: model.platform,
          defaultConfig: model.defaultConfig,
          capabilities: {
            supportsAspectRatio: model.capabilities.supportsAspectRatio,
            supportsResolution: model.capabilities.supportsResolution,
            supportsNumImages: model.capabilities.supportsNumImages,
            isAsync: model.capabilities.isAsync,
          },
        })),
        default: 'model-1',
      },
    };
  }

  @Get('video-generation-models')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get available video generation models', description: 'Returns list of all available video generation models' })
  @ApiResponse({ status: 200, description: 'Models retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getVideoGenerationModels(@Request() req: any) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    // Get video models with their keys (Map keys like 'video-model-1', 'video-model-2', etc.)
    const modelsWithKeys = this.modelRegistry.getAllVideoModelsWithKeys();
    return {
      success: true,
      data: {
        models: modelsWithKeys.map(([key, model]) => ({
          id: key, // Use Map key ('video-model-1', 'video-model-2', etc.) as the id
          displayName: model.displayName, // "Model 1"
          platform: model.platform,
          defaultConfig: model.defaultConfig,
          capabilities: {
            supportsAspectRatio: model.capabilities.supportsAspectRatio,
            supportsResolution: model.capabilities.supportsResolution,
            supportsDuration: model.capabilities.supportsDuration,
            supportedDurations: model.capabilities.supportedDurations,
            minDuration: model.capabilities.minDuration,
            maxDuration: model.capabilities.maxDuration,
            isAsync: model.capabilities.isAsync,
          },
        })),
        default: 'video-model-1',
      },
    };
  }

  @Get(':projectId/download-url')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({
    summary: 'Get clean final video download URL',
    description:
      'Returns a short-lived signed GCS URL or same-origin proxy path for browser download',
  })
  @ApiResponse({ status: 200, description: 'Download URL' })
  @ApiResponse({ status: 404, description: 'Video not found' })
  async getFinalVideoDownloadUrl(
    @Request() req: any,
    @Param('projectId') projectId: string,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
    }
    const data = await this.videoService.getFinalVideoDownloadUrl(
      projectId,
      userId,
    );
    return { success: true, data };
  }

  @Get(':projectId/download')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({
    summary: 'Download clean final video',
    description: 'Streams the final rendered video (no preview watermark) as an attachment',
  })
  @ApiResponse({ status: 200, description: 'Video stream' })
  @ApiResponse({ status: 404, description: 'Video not found' })
  async downloadFinalVideo(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
    }
    const mode = disposition === 'inline' ? 'inline' : 'attachment';
    await this.videoService.streamFinalVideoDownload(projectId, userId, res, mode);
  }

  @Post(':projectId/regenerate-preview')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({
    summary: 'Regenerate watermarked preview',
    description: 'Enqueues preview-derivatives job with forceRegenerate',
  })
  async regeneratePreview(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
    }
    const projectResult = await this.videoService.getProject(projectId, userId);
    const project = projectResult.data;
    if (!project.videoUrl) {
      throw new BadRequestException('Project has no final video to build preview from');
    }
    await this.queueManager.addPreviewDerivativesJob({
      projectId,
      userId,
      videoUrl: project.videoUrl,
      forceRegenerate: true,
    });
    return { success: true, message: 'Preview regeneration queued' };
  }

  @Get(':projectId')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ summary: 'Get video project by ID', description: 'Get a specific video project by its ID' })
  @ApiResponse({ status: 200, description: 'Video project retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Video project not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProject(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
    }

    return await this.videoService.getProject(projectId, userId);
  }

  @Put(':projectId')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ summary: 'Update video project', description: 'Update video project configuration' })
  @ApiResponse({ status: 200, description: 'Video project updated successfully' })
  @ApiResponse({ status: 404, description: 'Video project not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateProject(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateVideoProjectDto,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      console.error('[VideoController] Failed to extract userId from token for project update:', projectId);
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    return await this.videoService.updateProject(projectId, userId, dto);
  }

  @Put(':projectId/step')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ summary: 'Update project step', description: 'Update the current step in the video creation flow' })
  @ApiResponse({ status: 200, description: 'Project step updated successfully' })
  @ApiResponse({ status: 404, description: 'Video project not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateStep(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateVideoProjectStepDto,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
    }

    return await this.videoService.updateProjectStep(projectId, userId, dto);
  }

  @Put(':projectId/scenes/:sceneNumber/broll')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiParam({ name: 'sceneNumber', description: 'Scene number (1-based)' })
  @ApiOperation({ summary: 'Update scene B-roll', description: 'Update B-roll image or video for a specific scene with stock or uploaded content' })
  @ApiResponse({ status: 200, description: 'Scene B-roll updated successfully' })
  @ApiResponse({ status: 404, description: 'Video project not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        brollUrl: { type: 'string', description: 'URL of the B-roll media (stock or uploaded)' },
        brollType: { type: 'string', enum: ['image', 'video'], description: 'Type of B-roll media' },
        source: { 
          type: 'string', 
          enum: ['stock-image', 'stock-video', 'upload-image', 'upload-video', 'freepik', 'upload'], 
          description: 'Source type of the B-roll (generic types preferred: stock-image, stock-video, upload-image, upload-video)' 
        },
        localPath: { type: 'string', description: 'Local file path for downloaded stock content (optional)' },
        gcsUrl: { type: 'string', description: 'GCS URL for uploaded stock content (optional)' },
        videoPrompt: { type: 'string', description: 'Video generation prompt for uploaded images (optional)' },
        skipConversion: { type: 'boolean', description: 'Skip video conversion if already a video (optional)' },
      },
      required: ['brollUrl', 'brollType', 'source'],
    },
  })
  async updateSceneBroll(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Param('sceneNumber') sceneNumber: string,
    @Body() body: { brollUrl: string; brollType: 'image' | 'video'; source: string; localPath?: string; gcsUrl?: string; videoPrompt?: string; skipConversion?: boolean },
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
    }

    const sceneNum = parseInt(sceneNumber, 10);
    if (isNaN(sceneNum) || sceneNum < 1) {
      throw new BadRequestException('Invalid scene number');
    }

    return await this.videoService.updateSceneBroll(projectId, userId, sceneNum, body);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ summary: 'Delete video project', description: 'Delete a video project' })
  @ApiResponse({ status: 200, description: 'Video project deleted successfully' })
  @ApiResponse({ status: 404, description: 'Video project not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteProject(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
    }

    return await this.videoService.deleteProject(projectId, userId);
  }

  // Legacy endpoints for backward compatibility
  @Post('generate')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Generate video (legacy)', description: 'Generate video from script and assets - use video-projects endpoints instead' })
  @ApiResponse({ status: 201, description: 'Video generation started' })
  async generateVideo(@Body() dto: any) {
    return { success: true, message: 'Use /video-projects endpoints for video project management' };
  }

  @Get('jobs/:jobId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get video job status (legacy)', description: 'Get status of video generation job - use video-projects/:id instead' })
  @ApiResponse({ status: 200, description: 'Job status retrieved' })
  async getJobStatus() {
    return { success: true, message: 'Use /video-projects/:id to get project status' };
  }

  @Post(':projectId/brand-packaging/start')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ summary: 'Start brand packaging', description: 'Queue Phase B brand asset preparation (end-card plate)' })
  async startBrandPackaging(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    const prepared = await this.brandPackagingService.prepareStart(projectId, userId);
    if (prepared.skipQueue) {
      return {
        success: true,
        data: { jobId: prepared.jobId, status: prepared.status },
        message: `Brand packaging ${prepared.status}`,
      };
    }

    const jobId = await this.queueManager.addBrandPackagingJob({ projectId, userId });
    return {
      success: true,
      data: { jobId, status: 'processing' },
      message: 'Brand packaging queued',
    };
  }

  @Post(':projectId/repair-brand-metadata')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({
    summary: 'Repair stringified metadata.assets and re-queue brand pipeline',
  })
  async repairBrandMetadata(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    const repair = await this.videoService.repairBrandMetadata(projectId, userId);
    let brandPackagingStatus: string | undefined;
    if (repair.hasLogo) {
      const prepared = await this.brandPackagingService.prepareStart(projectId, userId);
      brandPackagingStatus = prepared.status;
      if (!prepared.skipQueue) {
        await this.queueManager.addBrandPackagingJob({ projectId, userId });
        brandPackagingStatus = 'processing';
      }
    }

    return {
      success: true,
      data: { ...repair, brandPackagingStatus },
      message: 'Brand metadata repaired',
    };
  }

  @Get(':projectId/brand-packaging/status')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ summary: 'Get brand packaging status' })
  async getBrandPackagingStatus(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    const status = await this.brandPackagingService.getStatus(projectId, userId);
    return { success: true, data: status };
  }

  @Post(':projectId/start-rendering')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ summary: 'Start video rendering', description: 'Start the video rendering process for a project' })
  @ApiResponse({ status: 200, description: 'Video rendering started successfully' })
  @ApiResponse({ status: 404, description: 'Video project not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async startRendering(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    // Extract auth token from request header
    const authToken = req.headers?.authorization || null;

    return await this.renderingService.startRendering(projectId, userId, authToken);
  }

  @Post(':projectId/post-process-export')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({
    summary: 'Post-process export (single-clip avatar)',
    description:
      'Apply background music, captions, and brand packaging to an existing avatar video without re-running HeyGen',
  })
  @ApiResponse({ status: 200, description: 'Post-process export started successfully' })
  async postProcessExport(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    const authToken = req.headers?.authorization || null;
    return await this.renderingService.postProcessExport(projectId, userId, authToken);
  }

  @Get(':projectId/rendering-status')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ summary: 'Get rendering status', description: 'Get the current rendering status and progress' })
  @ApiResponse({ status: 200, description: 'Rendering status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Video project not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getRenderingStatus(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    return await this.renderingService.getRenderingStatus(projectId, userId);
  }

  @Post(':projectId/generate-audio')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ summary: 'Generate audio files', description: 'Queue audio generation for all scenes. Skips regeneration if config matches existing audio.' })
  @ApiResponse({ status: 200, description: 'Audio generation queued successfully or existing audio returned' })
  async generateAudio(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    // Fetch project to check current state
    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success || !project.data) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const projectData = project.data;
    const existingAudioFiles = (projectData.audioFiles as any[]) || null;
    const storedConfig = (projectData.audioGenerationConfig as any) || null;

    // If project is explicitly in MANUAL voice mode and already has audioFiles, avoid regenerating
    const voiceMode = (projectData.metadata as any)?.voiceMode;
    if (voiceMode === 'MANUAL' && existingAudioFiles && existingAudioFiles.length > 0) {
      console.log(`[VideoController] Manual voice mode detected for project ${projectId}, using existing manual audio files`);
      return {
        success: true,
        data: {
          existing: true,
          audioFiles: existingAudioFiles,
          message: 'Manual audio already uploaded for this project',
        },
        message: 'Using existing manual audio files',
      };
    }

    // Build current config from project data
    const currentConfig = buildAudioGenerationConfig(
      projectData.voiceId,
      projectData.voiceType,
      projectData.script,
      'eleven_multilingual_v2', // Default model
      'mp3_44100_128', // Default format
      existingAudioFiles?.length || 0,
    );

    // Check if regeneration is needed
    const needsRegeneration = shouldRegenerateAudio(currentConfig, storedConfig, existingAudioFiles);

    if (!needsRegeneration && existingAudioFiles && existingAudioFiles.length > 0) {
      // No regeneration needed, return existing audio
      console.log(`[VideoController] Audio already generated with matching config for project ${projectId}, skipping regeneration`);
      return {
        success: true,
        data: {
          existing: true,
          audioFiles: existingAudioFiles,
          message: 'Audio already generated with matching configuration',
        },
        message: 'Using existing audio files',
      };
    }

    // Regeneration needed, queue job
    const authToken = req.headers?.authorization || null;
    const jobId = await this.queueManager.addAudioGenerationJob({
      projectId,
      userId,
      authToken,
    });

    return {
      success: true,
      data: { jobId },
      message: 'Audio generation queued successfully',
    };
  }

  @Post(':projectId/queue-stock-downloads')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ 
    summary: 'Queue stock video downloads', 
    description: 'Queue stock video downloads for multiple scenes. Returns job IDs for WebSocket tracking.' 
  })
  @ApiBody({
    description: 'Stock download request',
    schema: {
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sceneNumber: { type: 'number', example: 1 },
              searchTerm: { type: 'string', example: 'professional business meeting' },
            },
            required: ['sceneNumber', 'searchTerm'],
          },
        },
      },
      required: ['scenes'],
    },
  })
  @ApiResponse({ status: 200, description: 'Stock downloads queued successfully' })
  async queueStockDownloads(
    @Request() req: any, 
    @Param('projectId') projectId: string,
    @Body() body: { scenes: Array<{ sceneNumber: number; searchTerm: string }> }
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    // Verify project exists
    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success || !project.data) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    if (!body.scenes || !Array.isArray(body.scenes) || body.scenes.length === 0) {
      throw new BadRequestException('scenes array is required and cannot be empty');
    }

    const authToken = req.headers?.authorization || null;
    const jobIds: Array<{ sceneNumber: number; jobId: string }> = [];

    // Queue a job for each scene
    for (const scene of body.scenes) {
      const jobId = await this.queueManager.addStockDownloadJob({
        projectId,
        userId,
        sceneNumber: scene.sceneNumber,
        searchTerm: scene.searchTerm,
        authToken,
      });
      jobIds.push({ sceneNumber: scene.sceneNumber, jobId });
    }

    console.log(`[VideoController] Queued ${jobIds.length} stock download jobs for project ${projectId}`);

    return {
      success: true,
      data: { jobIds },
      message: `Stock downloads queued for ${jobIds.length} scenes`,
    };
  }

  @Post(':projectId/manual-audio/:sceneNumber')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiParam({ name: 'sceneNumber', description: 'Scene number' })
  @ApiOperation({
    summary: 'Upload manual audio for a single scene',
    description: 'Stores a user-recorded audio file for a specific scene and updates project audioFiles.',
  })
  @ApiBody({
    description: 'Manual scene audio upload',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        duration: { type: 'string', example: '3.5' },
        voiceover: { type: 'string', example: 'Scene dialogue text' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadManualSceneAudio(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Param('sceneNumber') sceneNumber: string,
    @UploadedFile() file: Multer.File,
    @Body() body: { duration?: string; voiceover?: string } = {},
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    if (!file) {
      throw new BadRequestException('Audio file is required');
    }

    const sceneNum = parseInt(sceneNumber, 10);
    if (Number.isNaN(sceneNum) || sceneNum <= 0) {
      throw new BadRequestException('Invalid sceneNumber');
    }

    // Resolve uploads directory (same base used for static assets)
    const uploadsDir = this.configService.get<string>('UPLOADS_DIR') || join(process.cwd(), 'uploads');
    const audioDir = join(uploadsDir, 'audio', userId);
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    const originalExt = file.originalname && file.originalname.includes('.') ? file.originalname.substring(file.originalname.lastIndexOf('.')) : '.webm';
    const filename = `manual_scene_${sceneNum}_${projectId}_${Date.now()}${originalExt}`;
    const filePath = join(audioDir, filename);

    fs.writeFileSync(filePath, file.buffer);

    const localUrl = `/uploads/audio/${userId}/${filename}`;
    let duration = body.duration ? parseFloat(body.duration) : undefined;
    if (duration == null || !Number.isFinite(duration) || duration <= 0) {
      // Robust duration extraction for WebM and other formats
      // WebM files from browser MediaRecorder often have missing/incomplete duration metadata
      let parsed: number | undefined;

      // Strategy 1: Try format.duration (works for most formats)
      try {
        const output = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
          { encoding: 'utf-8' },
        ).trim();
        parsed = parseFloat(output);
        if (Number.isFinite(parsed) && parsed > 0) {
          console.log(`[VideoController] Duration from format.duration: ${parsed.toFixed(2)}s`);
          duration = parsed;
        }
      } catch (e: any) {
        console.warn(`[VideoController] format.duration extraction failed: ${e?.message}`);
      }

      // Strategy 2: If format.duration failed, try stream duration (more reliable for WebM)
      if (duration == null || !Number.isFinite(duration) || duration <= 0) {
        try {
          const output = execSync(
            `ffprobe -v error -select_streams a:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
            { encoding: 'utf-8' },
          ).trim();
          parsed = parseFloat(output);
          if (Number.isFinite(parsed) && parsed > 0) {
            console.log(`[VideoController] Duration from stream.duration: ${parsed.toFixed(2)}s`);
            duration = parsed;
          }
        } catch (e: any) {
          console.warn(`[VideoController] stream.duration extraction failed: ${e?.message}`);
        }
      }

      // Strategy 3: Decode and measure (last resort, always works but slower)
      if (duration == null || !Number.isFinite(duration) || duration <= 0) {
        try {
          console.log(`[VideoController] Decoding audio to measure duration for ${filename}...`);
          const output = execSync(
            `sh -c "ffmpeg -i '${filePath}' -f null - 2>&1"`,
            { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
          );
          const matches = output.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
          if (matches && matches.length > 0) {
            const last = matches[matches.length - 1];
            const parts = last.replace('time=', '').split(':');
            parsed = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
            if (Number.isFinite(parsed) && parsed > 0) {
              console.log(`[VideoController] Duration from decode: ${parsed.toFixed(2)}s`);
              duration = parsed;
            }
          }
        } catch (e: any) {
          console.warn(`[VideoController] decode-and-measure failed: ${e?.message}`);
        }
      }

      if (duration == null || !Number.isFinite(duration) || duration <= 0) {
        console.warn(`[VideoController] Could not determine duration for ${filename}, leaving undefined`);
      }
    }
    const voiceover = body.voiceover || '';

    // Attempt to upload to GCS / public storage
    let gcsUrl: string | undefined;
    let publicUrl: string | undefined;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        filePath,
        `audio/${userId}`,
        filename,
        'audio/mpeg',
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
    } catch (error: any) {
      console.warn(
        `[VideoController] GCS upload failed for manual audio ${filename}: ${error?.message || error}`,
      );
      publicUrl = localUrl;
    }

    // Fetch existing project and audioFiles
    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success || !project.data) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const existingData = project.data as any;
    const existingAudioFiles = (existingData.audioFiles as any[]) || [];

    const newEntry = {
      sceneNumber: sceneNum,
      filePath,
      localUrl,
      voiceover,
      duration,
      gcsUrl,
      publicUrl,
    };

    const updatedAudioFiles = [
      ...existingAudioFiles.filter((af: any) => af.sceneNumber !== sceneNum),
      newEntry,
    ].sort((a, b) => a.sceneNumber - b.sceneNumber);

    await this.videoService.updateProject(projectId, userId, {
      audioFiles: updatedAudioFiles,
      metadata: {
        // Mark that manual audio is being used for this project
        voiceMode: 'MANUAL',
      } as any,
    });

    return {
      success: true,
      data: newEntry,
      message: 'Manual audio uploaded successfully',
    };
  }

  @Post(':projectId/process-manual-audio')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({
    summary: 'Process manual audio for last scene',
    description: 'Apply padding and fade-out to the last scene manual audio (same as AI path), then update project.',
  })
  @ApiResponse({ status: 200, description: 'Manual audio processed successfully' })
  async processManualAudio(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success || !project.data) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const projectData = project.data as any;
    const voiceMode = (projectData.metadata as any)?.voiceMode;
    const audioFiles = (projectData.audioFiles as any[]) || [];

    if (voiceMode !== 'MANUAL' || !audioFiles.length) {
      throw new HttpException(
        'Project must be in MANUAL voice mode with existing audio files',
        HttpStatus.BAD_REQUEST,
      );
    }

    const lastEntry = audioFiles.reduce((a: any, b: any) =>
      (a.sceneNumber ?? 0) >= (b.sceneNumber ?? 0) ? a : b,
    );
    const audioUrl = lastEntry.publicUrl || lastEntry.gcsUrl;
    if (!audioUrl) {
      throw new HttpException(
        'Last scene audio has no public URL',
        HttpStatus.BAD_REQUEST,
      );
    }

    const voiceServiceUrl =
      this.configService.get<string>('VOICE_AUDIO_SERVICE_URL') || 'http://localhost:9002/api';
    const token = req.headers?.authorization || null;

    let response: {
      data: {
        success: boolean;
        data?: { publicUrl: string; gcsUrl?: string; duration: number };
        message?: string;
      };
    };

    try {
      response = await axios.post<{
        success: boolean;
        data?: { publicUrl: string; gcsUrl?: string; duration: number };
        message?: string;
      }>(
        `${voiceServiceUrl}/voice/process-last-scene-audio`,
        {
          audioUrl,
          userId,
          projectId,
          sceneNumber: lastEntry.sceneNumber,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token } : {}),
          },
        },
      );
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new ServiceUnavailableException(
          'Voice audio service is not available. Please ensure the voice-audio-service is running.',
        );
      }
      throw new HttpException(
        error.response?.data?.message || error.message || 'Failed to connect to voice service',
        error.response?.status || HttpStatus.BAD_GATEWAY,
      );
    }

    if (!response.data?.success || !response.data?.data) {
      const errMsg = (response.data as { message?: string })?.message || 'Failed to process manual audio';
      throw new HttpException(errMsg, HttpStatus.BAD_GATEWAY);
    }

    const { publicUrl, gcsUrl, duration } = response.data.data;

    const updatedAudioFiles = audioFiles.map((af: any) =>
      af.sceneNumber === lastEntry.sceneNumber
        ? { ...af, publicUrl, gcsUrl: gcsUrl ?? af.gcsUrl, duration }
        : af,
    );

    await this.videoService.updateProject(projectId, userId, {
      audioFiles: updatedAudioFiles,
    });

    return {
      success: true,
      data: { audioFiles: updatedAudioFiles },
      message: 'Manual audio processed successfully',
    };
  }

  @Post(':projectId/transform-voice')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({
    summary: 'Transform voice using speech-to-speech',
    description: 'Transform recorded audio to a different voice using ElevenLabs Speech-to-Speech API',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        voiceId: { type: 'string', description: 'Target voice ID' },
        settings: {
          type: 'object',
          properties: {
            stability: { type: 'number', description: '0.0 - 1.0' },
            similarityBoost: { type: 'number', description: '0.0 - 1.0' },
            style: { type: 'number', description: '0.0 - 1.0' },
            useSpeakerBoost: { type: 'boolean' },
            removeBackgroundNoise: { type: 'boolean' },
          },
        },
        sceneNumbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional - if not provided, transform all scenes',
        },
      },
      required: ['voiceId', 'settings'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Voice transformation completed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sceneNumber: { type: 'number' },
                  status: { type: 'string', enum: ['success', 'error'] },
                  originalUrl: { type: 'string' },
                  transformedUrl: { type: 'string' },
                  duration: { type: 'number' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  })
  async transformVoice(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: {
      voiceId: string;
      settings: {
        stability?: number;
        similarityBoost?: number;
        style?: number;
        useSpeakerBoost?: boolean;
        removeBackgroundNoise?: boolean;
      };
      sceneNumbers?: number[];
    },
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    if (!body.voiceId) {
      throw new HttpException('voiceId is required', HttpStatus.BAD_REQUEST);
    }

    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success || !project.data) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const projectData = project.data as any;
    const audioFiles = projectData.audioFiles || [];

    if (!audioFiles.length) {
      throw new HttpException('No audio files found for this project', HttpStatus.BAD_REQUEST);
    }

    // Filter scenes to transform
    const scenesToTransform = body.sceneNumbers
      ? audioFiles.filter((af: any) => body.sceneNumbers?.includes(af.sceneNumber))
      : audioFiles;

    if (scenesToTransform.length === 0) {
      throw new HttpException('No matching scenes found to transform', HttpStatus.BAD_REQUEST);
    }

    const voiceServiceUrl = this.configService.get<string>('VOICE_SERVICE_URL') || 'http://localhost:9002/api';
    const token = req.headers?.authorization;

    // Get or create stsSeed for consistent voice across scenes (ElevenLabs deterministic sampling)
    let stsSeed = projectData.metadata?.stsSeed;
    if (stsSeed == null || !Number.isInteger(stsSeed) || stsSeed < 0 || stsSeed > 4294967295) {
      stsSeed = Math.floor(Math.random() * 4294967296);
      await this.videoService.updateProject(projectId, userId, {
        metadata: { ...(projectData.metadata || {}), stsSeed } as any,
      });
      projectData.metadata = projectData.metadata || {};
      (projectData.metadata as any).stsSeed = stsSeed;
    }

    console.log(`[VideoController] Starting voice transformation for ${scenesToTransform.length} scenes (per-scene, seed=${stsSeed})`);

    // Helper function to transform a single scene with retry logic
    const transformScene = async (audioFile: any, retryCount = 0): Promise<{
      sceneNumber: number;
      status: 'success' | 'error';
      originalUrl?: string;
      transformedUrl?: string;
      transformedFilePath?: string;
      transformedLocalUrl?: string;
      duration?: number;
      error?: string;
    }> => {
      const audioUrl = audioFile.publicUrl || audioFile.gcsUrl || audioFile.localUrl;
      if (!audioUrl) {
        return {
          sceneNumber: audioFile.sceneNumber,
          status: 'error',
          error: 'No audio URL found for scene',
        };
      }

      const MAX_RETRIES = 2;
      const RETRY_DELAY_MS = 3000;

      try {
        const response = await axios.post<{
          success: boolean;
          data?: {
            sceneNumber: number;
            originalUrl: string;
            transformedUrl: string;
            transformedFilePath: string;
            transformedLocalUrl: string;
            duration: number;
          };
          message?: string;
        }>(
          `${voiceServiceUrl}/voice/speech-to-speech`,
          {
            audioUrl,
            voiceId: body.voiceId,
            projectId,
            sceneNumber: audioFile.sceneNumber,
            settings: body.settings,
            seed: (projectData.metadata as any)?.stsSeed ?? stsSeed,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: token } : {}),
            },
            timeout: 180000, // 3 minute timeout per scene (increased from 2 minutes)
          },
        );

        if (response.data?.success && response.data?.data) {
          return {
            sceneNumber: audioFile.sceneNumber,
            status: 'success',
            originalUrl: audioUrl,
            transformedUrl: response.data.data.transformedUrl,
            transformedFilePath: response.data.data.transformedFilePath,
            transformedLocalUrl: response.data.data.transformedLocalUrl,
            duration: response.data.data.duration,
          };
        } else {
          return {
            sceneNumber: audioFile.sceneNumber,
            status: 'error',
            error: response.data?.message || 'Transformation failed',
          };
        }
      } catch (error: any) {
        const statusCode = error.response?.status;
        const isRetryable = statusCode === 502 || statusCode === 503 || statusCode === 504 || error.code === 'ECONNRESET';
        
        if (isRetryable && retryCount < MAX_RETRIES) {
          console.warn(`[VideoController] Retryable error for scene ${audioFile.sceneNumber} (status: ${statusCode}, attempt ${retryCount + 1}/${MAX_RETRIES}). Retrying in ${RETRY_DELAY_MS}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
          return transformScene(audioFile, retryCount + 1);
        }
        
        console.error(`[VideoController] STS error for scene ${audioFile.sceneNumber}:`, error.message);
        return {
          sceneNumber: audioFile.sceneNumber,
          status: 'error',
          error: error.message || 'Transformation failed',
        };
      }
    };

    // Process scenes with limited concurrency (2 at a time to avoid rate limiting)
    const CONCURRENCY_LIMIT = 2;
    const results: Array<{
      sceneNumber: number;
      status: 'success' | 'error';
      originalUrl?: string;
      transformedUrl?: string;
      transformedFilePath?: string;
      transformedLocalUrl?: string;
      duration?: number;
      error?: string;
    }> = [];

    for (let i = 0; i < scenesToTransform.length; i += CONCURRENCY_LIMIT) {
      const batch = scenesToTransform.slice(i, i + CONCURRENCY_LIMIT);
      console.log(`[VideoController] Processing batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1} of ${Math.ceil(scenesToTransform.length / CONCURRENCY_LIMIT)} (scenes: ${batch.map((af: any) => af.sceneNumber).join(', ')})`);
      
      const batchResults = await Promise.all(batch.map((audioFile: any) => transformScene(audioFile)));
      results.push(...batchResults);
    }

    // Update project audioFiles with transformed URLs for successful transformations
    // Store original and transformed audio separately so user can choose which to use
    const successfulTransforms = results.filter((r) => r.status === 'success');
    if (successfulTransforms.length > 0) {
      const updatedAudioFiles = audioFiles.map((af: any) => {
        const transform = successfulTransforms.find((t) => t.sceneNumber === af.sceneNumber);
        if (transform) {
          // Store original audio data if not already stored
          const original = af.original || {
            filePath: af.filePath,
            localUrl: af.localUrl,
            publicUrl: af.publicUrl || af.gcsUrl,
            gcsUrl: af.gcsUrl,
            duration: af.duration,
          };
          
          // Store transformed audio data
          const transformed = {
            filePath: transform.transformedFilePath,
            localUrl: transform.transformedLocalUrl,
            publicUrl: transform.transformedUrl,
            gcsUrl: transform.transformedUrl,
            duration: transform.duration,
          };
          
          return {
            ...af,
            original,
            transformed,
            useTransformed: true, // Default to using transformed audio after transformation
            isTransformed: true,
            transformSettings: body.settings,
          };
        }
        return af;
      });

      await this.videoService.updateProject(projectId, userId, {
        audioFiles: updatedAudioFiles,
        metadata: {
          ...(projectData.metadata || {}),
          transformedVoiceId: body.voiceId,
        } as any,
      });
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    console.log(`[VideoController] Voice transformation complete: ${successCount} success, ${errorCount} errors`);

    return {
      success: true,
      data: { results },
      message: `Voice transformation completed: ${successCount} scenes transformed${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
    };
  }

  @Post(':projectId/set-audio-preference')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({
    summary: 'Set audio preference for rendering',
    description: 'Choose whether to use original or transformed audio for video rendering',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        useTransformed: { type: 'boolean', description: 'If true, use transformed audio; if false, use original audio' },
        sceneNumbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional - if not provided, applies to all scenes',
        },
      },
      required: ['useTransformed'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Audio preference updated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            audioFiles: { type: 'array' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  async setAudioPreference(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: {
      useTransformed: boolean;
      sceneNumbers?: number[];
    },
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    if (body.useTransformed === undefined || body.useTransformed === null) {
      throw new HttpException('useTransformed is required', HttpStatus.BAD_REQUEST);
    }

    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success || !project.data) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const projectData = project.data as any;
    const audioFiles = projectData.audioFiles || [];

    if (!audioFiles.length) {
      throw new HttpException('No audio files found for this project', HttpStatus.BAD_REQUEST);
    }

    // Update useTransformed flag for specified scenes (or all scenes if not specified)
    const updatedAudioFiles = audioFiles.map((af: any) => {
      // Only update scenes that have been transformed
      if (!af.transformed) {
        return af;
      }

      // If specific scenes are provided, only update those
      if (body.sceneNumbers && body.sceneNumbers.length > 0) {
        if (body.sceneNumbers.includes(af.sceneNumber)) {
          return { ...af, useTransformed: body.useTransformed };
        }
        return af;
      }

      // Update all transformed scenes
      return { ...af, useTransformed: body.useTransformed };
    });

    await this.videoService.updateProject(projectId, userId, {
      audioFiles: updatedAudioFiles,
    });

    const updatedCount = updatedAudioFiles.filter((af: any) => af.transformed).length;

    console.log(`[VideoController] Audio preference updated: useTransformed=${body.useTransformed} for ${updatedCount} scenes`);

    return {
      success: true,
      data: { audioFiles: updatedAudioFiles },
      message: `Audio preference updated: ${body.useTransformed ? 'transformed' : 'original'} audio will be used for rendering`,
    };
  }

  @Post(':projectId/regenerate-image/:sceneNumber')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiParam({ name: 'sceneNumber', description: 'Scene number' })
  @ApiOperation({ summary: 'Regenerate B-roll image', description: 'Queue image regeneration for a specific scene' })
  @ApiResponse({ status: 200, description: 'Image generation queued successfully' })
  async regenerateImage(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Param('sceneNumber') sceneNumber: string,
    @Body() body: { 
      prompt?: string; 
      force?: boolean;
      modelId?: string; // e.g., "model-1", "model-2", etc.
      aspectRatio?: string; // Optional override
      resolution?: string; // Optional override
      productImageUrl?: string; // Product image URL for product-focused styles
      videoStyle?: string; // Video style to determine generation method
    } = {},
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    // Get project to find prompt
    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const sceneNum = parseInt(sceneNumber, 10);
    const projectData = project.data as any;
    const style = body.videoStyle || projectData.style;
    // ✅ Enhanced style normalization to handle multiple format variations
    let normalizedStyle: string;
    if (typeof style === 'string') {
      // Convert to uppercase and normalize separators (handle avatar-product, avatar_product, AVATAR_PRODUCT)
      normalizedStyle = style.toUpperCase().replace(/[-_]/g, '_');
    } else {
      normalizedStyle = style;
    }
    
    // ✅ Enhanced logging for regenerate endpoint
    console.log(`[VideoController] ========== REGENERATE IMAGE ==========`);
    console.log(`[VideoController] Project ID: ${projectId}, Scene: ${sceneNum}`);
    console.log(`[VideoController] Style detection:`, {
      bodyVideoStyle: body.videoStyle,
      projectStyle: projectData.style,
      styleVariable: style,
      normalizedStyle,
      isAvatarProduct: normalizedStyle === 'AVATAR_PRODUCT',
    });

    // Check if image already exists for this scene
    const bRollImages = ((projectData).bRollImages as any[]) || [];
    const existingImage = bRollImages.find((img: any) => 
      img.sceneNumber === sceneNum && 
      (img.localUrl || img.localPath || img.imageUrl)
    );

    if (existingImage && !body.force) {
      // Image already exists, return existing data without queuing new job
      return {
        success: true,
        data: { 
          jobId: existingImage.jobId || null,
          existing: true,
          image: existingImage,
        },
        message: 'Image already exists for this scene',
      };
    }

    const script = typeof projectData.script === 'string' 
      ? JSON.parse(projectData.script) 
      : projectData.script;
    const scenes = script.scenes || script.scene_plan || [];
    const scene = scenes.find((s: any) => (s.scene_number || s.sceneNumber) === sceneNum);
    
    // For ALTERNATE style, only b-roll-type scenes need b-roll images
    let prompt = body.prompt || scene?.broll_image_prompt || scene?.broll_prompt || scene?.broll_visual_description;

    if (normalizedStyle === 'ALTERNATE' && this.isAlternateAvatarScene(projectData, sceneNum)) {
      throw new HttpException(
        'Avatar scenes in ALTERNATE style do not require b-roll images',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!prompt && normalizedStyle === 'ALTERNATE') {
      prompt = scene?.broll_visual_description || `Scene ${sceneNum} full-screen b-roll for ALTERNATE style`;
    }

    if (!prompt) {
      throw new HttpException('Image prompt not found for this scene', HttpStatus.BAD_REQUEST);
    }

    // Extract product image URL from body, metadata or project assets if not provided
    let productImageUrl = body.productImageUrl;
    if (!productImageUrl && (style === 'PRODUCT_ONLY' || style === 'AVATAR_PRODUCT')) {
      // 1) Check if product image URL is stored directly in metadata (preferred for regenerate flow)
      if (projectData.metadata?.productImageUrl) {
        productImageUrl = projectData.metadata.productImageUrl;
        console.log(`[VideoController] Found product image URL in metadata: ${productImageUrl}`);
      } else {
        // 2) Check both projectData.assets and projectData.metadata.assets
        let assets: any[] = [];
        
        // First, try projectData.assets (for old projects)
        if (projectData.assets) {
          assets = typeof projectData.assets === 'string' 
            ? JSON.parse(projectData.assets) 
            : projectData.assets;
        }
        
        // If not found, try metadata.assets (for AI chat flow projects)
        if (assets.length === 0 && projectData.metadata?.assets) {
          const metadataAssets = typeof projectData.metadata.assets === 'string'
            ? JSON.parse(projectData.metadata.assets)
            : projectData.metadata.assets;
          assets = Array.isArray(metadataAssets) ? metadataAssets : [];
        }
        
        // Find product image - check multiple possible structures
        const productImage = assets.find((asset: any) => {
          if (asset.type !== 'image') return false;
          // Check multiple identifiers
          return asset.id?.startsWith('product-') || 
                 asset.name?.toLowerCase().includes('product') ||
                 // For AI chat flow, if there's only one image asset, it's likely the product
                 (assets.filter((a: any) => a.type === 'image').length === 1);
        });
        
        // Extract URL - check multiple possible URL fields
        productImageUrl = productImage?.url || 
                          productImage?.publicUrl || 
                          productImage?.imageUrl ||
                          null;

        if (!productImageUrl && (style === 'PRODUCT_ONLY' || style === 'AVATAR_PRODUCT')) {
          console.error('[VideoController] Product image not found in assets or metadata:', {
            assetsCount: assets.length,
            imageAssets: assets.filter((a: any) => a.type === 'image'),
            projectMetadata: projectData.metadata,
            hasMetadataProductImageUrl: !!projectData.metadata?.productImageUrl,
          });
          throw new HttpException(
            'Product image is required for this video style. Please provide productImageUrl in the request body or ensure it is stored in project metadata.',
            HttpStatus.BAD_REQUEST
          );
        }
      }
      
      console.log(`[VideoController] Extracted product image URL: ${productImageUrl}`);
    }

    // Get model ID from body or use style-appropriate default
    let modelId = body.modelId;
    if (!modelId) {
      // Use model-4 for product styles; model-1 for non-product (processor overrides to model-4 when project has reference assets)
      const normalizedStyle = typeof style === 'string' ? style.toUpperCase() : style;
      if (normalizedStyle === 'PRODUCT_ONLY' || normalizedStyle === 'AVATAR_PRODUCT') {
        modelId = 'model-4'; // nano-banana-pro for product styles (supports image-to-image)
      } else {
        modelId = 'model-1'; // FAL imagen4 for non-product; processor uses model-4 when refs present
      }
    }

    // Validate AVATAR_PRODUCT style requirements
    if (normalizedStyle === 'AVATAR_PRODUCT') {
      if (!productImageUrl) {
        throw new HttpException('Product image URL is required for AVATAR_PRODUCT style', HttpStatus.BAD_REQUEST);
      }
      // Log avatarId for debugging
      console.log(`[VideoController] AVATAR_PRODUCT: Project avatarId: ${projectData.avatarId}, metadata:`, {
        metadataAvatarId: projectData.metadata?.avatarId,
        metadataSelectedAvatarId: projectData.metadata?.selectedAvatarId,
      });
      if (!projectData.avatarId && !projectData.metadata?.avatarId && !projectData.metadata?.selectedAvatarId) {
        console.warn(`[VideoController] AVATAR_PRODUCT: Warning - No avatarId found in project. Image generation may fail.`);
      }
    }

    // ✅ Enhanced logging before queuing job
    console.log(`[VideoController] Queuing image generation job with:`, {
      projectId,
      sceneNumber: sceneNum,
      modelId,
      hasProductImageUrl: !!productImageUrl,
      videoStyle: style,
      normalizedStyle,
    });

    // When on b-roll images step: ensure project has generated avatar image (for Avatar IV) in background
    const authToken = req.headers?.authorization;
    this.videoService.ensureProjectAvatarImage(projectId, userId, authToken).catch(() => {});

    const jobId = await this.queueManager.addImageGenerationJob({
      projectId,
      userId,
      sceneNumber: sceneNum,
      prompt,
      modelId, // Pass model selection
      aspectRatio: body.aspectRatio, // Optional override
      resolution: body.resolution, // Optional override
      productImageUrl: productImageUrl || undefined, // Pass product image URL
      videoStyle: style, // Pass video style (will be normalized in processor)
    });
    
    console.log(`[VideoController] ✅ Image generation job queued: ${jobId}`);

    return {
      success: true,
      data: { jobId },
      message: 'Image generation queued successfully',
    };
  }

  @Post(':projectId/regenerate-video/:sceneNumber')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiParam({ name: 'sceneNumber', description: 'Scene number' })
  @ApiOperation({ summary: 'Regenerate B-roll video', description: 'Queue video regeneration for a specific scene' })
  @ApiResponse({ status: 200, description: 'Video generation queued successfully' })
  async regenerateVideo(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Param('sceneNumber') sceneNumber: string,
    @Body() body: { force?: boolean; modelId?: string } = {},
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    // Get project to find image and audio
    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const sceneNum = parseInt(sceneNumber, 10);
    const projectData = project.data as any;
    const style = projectData.style;
    const authToken = req.headers?.authorization;

    // ALTERNATE avatar scenes: queue avatar video generation (no b-roll image required)
    if (style === 'ALTERNATE' && this.isAlternateAvatarScene(projectData, sceneNum)) {
      const avatarVideos = (projectData.avatarVideos as any[]) || [];
      const metadata = (projectData.metadata as any) || {};
      const avatarVideoCache = metadata.avatarVideoCache || {};
      const existingAvatar = avatarVideos.find(
        (v: any) => v.sceneNumber === sceneNum && (v.localUrl || v.localPath),
      );
      const cachedAvatar = avatarVideoCache[sceneNum]?.localPath;

      if ((existingAvatar || cachedAvatar) && !body.force) {
        return {
          success: true,
          data: {
            jobId: existingAvatar?.jobId || null,
            existing: true,
            video: existingAvatar || { sceneNumber: sceneNum, localPath: cachedAvatar },
          },
          message: 'Avatar video already exists for this scene',
        };
      }

      const jobId = await this.queueManager.addAvatarVideoGenerationJob({
        projectId,
        userId,
        sceneNumber: sceneNum,
        authToken,
      });

      return {
        success: true,
        data: { jobId, type: 'avatar' },
        message: 'Avatar video generation queued for ALTERNATE avatar scene',
      };
    }

    // Check if video already exists for this scene
    const bRollVideoTasks = ((project.data as any).bRollVideoTasks as any[]) || [];
    const existingVideo = bRollVideoTasks.find((vid: any) => 
      vid.sceneNumber === sceneNum && 
      (vid.localUrl || vid.localPath || vid.videoUrl)
    );

    // IMPORTANT: Only skip if NOT forcing regeneration
    if (existingVideo && !body.force) {
      console.log(`[VideoController] Video already exists for scene ${sceneNum}, returning existing data`);
      // Video already exists, return existing data without queuing new job
      return {
        success: true,
        data: { 
          jobId: existingVideo.jobId || null,
          existing: true,
          video: existingVideo,
        },
        message: 'Video already exists for this scene',
      };
    }

    const bRollImages = (project.data.bRollImages as any[]) || [];
    const image = bRollImages.find((img: any) => img.sceneNumber === sceneNum);

    if (!image) {
      throw new HttpException('Image not found for this scene', HttpStatus.BAD_REQUEST);
    }

    // For AVATAR_PRODUCT style, we prefer to use a HeyGen image_key if already cached
    // on the image data, but we no longer require it here. The video-generation worker
    // will lazily upload the composite image to HeyGen and cache the key if needed.
    let heygenImageKey: string | undefined = undefined;
    if (style === 'AVATAR_PRODUCT') {
      heygenImageKey = image.heygenImageKey || image.compositeImageKey;
    }

    // Get public URL for the image. Prefer stored GCS/public URL from image generation
    // so BytePlus (and other external services) can fetch it; avoid passing localhost.
    let publicImageUrl: string;
    if (image.publicUrl && this.isPubliclyReachableUrl(image.publicUrl)) {
      publicImageUrl = image.publicUrl;
      console.log(`[VideoController] Using stored public URL for scene ${sceneNum}: ${publicImageUrl}`);
    } else if (image.gcsUrl && this.isPubliclyReachableUrl(image.gcsUrl)) {
      publicImageUrl = image.gcsUrl;
      console.log(`[VideoController] Using stored GCS URL for scene ${sceneNum}: ${publicImageUrl}`);
    } else if (image.localPath && image.localUrl) {
      try {
        console.log(`[VideoController] Using local file for scene ${sceneNum}: ${image.localPath}`);
        publicImageUrl = await this.publicUrlService.getPublicUrl(image.localPath, image.localUrl);
        console.log(`[VideoController] ✅ Got public URL for local file: ${publicImageUrl}`);
      } catch (error: any) {
        console.warn(`[VideoController] Failed to get public URL from local file, falling back to provider URL: ${error.message}`);
        if (!image.imageUrl) {
          throw new HttpException(
            `Failed to get public URL for image: ${error.message}`,
            HttpStatus.INTERNAL_SERVER_ERROR
          );
        }
        publicImageUrl = image.imageUrl;
      }
    } else if (image.imageUrl) {
      console.log(`[VideoController] Using provider URL for scene ${sceneNum} (no local file found)`);
      publicImageUrl = image.imageUrl;
    } else {
      throw new HttpException('Image URL not found for this scene', HttpStatus.BAD_REQUEST);
    }

    const audioFiles = (project.data.audioFiles as any[]) || [];
    const audioFile = audioFiles.find((af: any) => af.sceneNumber === parseInt(sceneNumber, 10));
    
    // Get audio file duration - ensure it exists and is valid
    const audioDuration = audioFile?.duration;
    if (!audioDuration || audioDuration <= 0) {
      throw new HttpException(
        `Audio file duration not found or invalid for scene ${sceneNumber}. Please ensure audio is generated first.`,
        HttpStatus.BAD_REQUEST
      );
    }

    // Ensure duration matches audio file duration exactly
    // Round up to nearest second to match rounded audio duration (audio is rounded up during generation)
    const videoDuration = Math.ceil(audioDuration);
    if (videoDuration <= 0) {
      throw new HttpException(
        `Invalid duration for scene ${sceneNumber}: ${audioDuration} seconds`,
        HttpStatus.BAD_REQUEST
      );
    }

    console.log(`[VideoController] Scene ${sceneNumber}: Style=${style}, Audio duration=${audioDuration}s, Video duration=${videoDuration}s, Image URL=${publicImageUrl}, ModelId=${body.modelId || 'video-model-1'}, HeyGenImageKey=${heygenImageKey || 'N/A'}`);

    const jobId = await this.queueManager.addVideoGenerationJob({
      projectId,
      userId,
      sceneNumber: sceneNum,
      imageUrl: publicImageUrl,
      prompt: image.prompt,
      duration: videoDuration,
      modelId: body.modelId || 'video-model-1',
      heygenImageKey: heygenImageKey || undefined,
      videoStyle: style,
    });

    return {
      success: true,
      data: { jobId },
      message: 'Video generation queued successfully',
    };
  }

  @Post(':projectId/convert-to-videos')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiOperation({ summary: 'Batch convert images to videos', description: 'Queue all video generation jobs for the project in one call' })
  @ApiResponse({ status: 200, description: 'Jobs queued successfully' })
  async convertToVideos(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: { forceRegenerate?: boolean } = {},
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const projectData = project.data as any;
    const script = typeof projectData.script === 'string' ? JSON.parse(projectData.script) : projectData.script;
    const scenes = script?.scenes || script?.scene_plan || [];
    const bRollImages = (projectData.bRollImages as any[]) || [];
    const bRollVideoTasks = (projectData.bRollVideoTasks as any[]) || [];
    const style = projectData.style;
    const authToken = req.headers?.authorization;

    // Trigger avatar image generation early for avatar projects so avatar-video jobs can use it
    if (projectData.avatarId) {
      this.videoService.ensureProjectAvatarImage(projectId, userId, authToken).catch((err) => {
        console.warn(`[VideoController] ensureProjectAvatarImage at convertToVideos start: ${err?.message}`);
      });
    }

    const jobs: { sceneNumber: number; jobId: string; type: 'broll' | 'avatar' }[] = [];
    const force = !!body.forceRegenerate;
    const avatarVideos = (projectData.avatarVideos as any[]) || [];

    // [PRODUCT_ONLY/AVATAR_PRODUCT reference image - commented out to use single scene image until r2v model supported]
    // Resolve product image URL for PRODUCT_ONLY/AVATAR_PRODUCT (pass as reference for video generation)
    // let productImageUrlForVideo: string | null = null;
    // if (style === 'PRODUCT_ONLY' || style === 'AVATAR_PRODUCT') {
    //   if (projectData.metadata?.productImageUrl) {
    //     productImageUrlForVideo = projectData.metadata.productImageUrl;
    //   } else {
    //     let assets: any[] = [];
    //     if (projectData.assets) {
    //       assets = typeof projectData.assets === 'string' ? JSON.parse(projectData.assets) : projectData.assets;
    //     }
    //     if (assets.length === 0 && projectData.metadata?.assets) {
    //       const metadataAssets = typeof projectData.metadata.assets === 'string'
    //         ? JSON.parse(projectData.metadata.assets)
    //         : projectData.metadata.assets;
    //       assets = Array.isArray(metadataAssets) ? metadataAssets : [];
    //     }
    //     const productImage = assets.find((asset: any) => {
    //       if (asset.type !== 'image') return false;
    //       return asset.id?.startsWith('product-') ||
    //         asset.name?.toLowerCase().includes('product') ||
    //         (assets.filter((a: any) => a.type === 'image').length === 1);
    //     });
    //     productImageUrlForVideo = productImage?.url || productImage?.publicUrl || productImage?.imageUrl || null;
    //   }
    //   if (productImageUrlForVideo) {
    //     console.log(`[VideoController] convertToVideos: using product image as reference for video generation`);
    //   }
    // }

    for (let i = 0; i < scenes.length; i++) {
      const sceneNumber = scenes[i].scene_number ?? scenes[i].sceneNumber ?? i + 1;
      const audioFile = (projectData.audioFiles as any[])?.find((af: any) => af.sceneNumber === sceneNumber);
      if (!audioFile?.duration) continue;

      // ALTERNATE avatar scenes: queue per-scene avatar video generation
      if (style === 'ALTERNATE' && this.isAlternateAvatarScene(projectData, sceneNumber)) {
        const existingAvatar = avatarVideos.find(
          (v: any) => v.sceneNumber === sceneNumber && (v.localUrl || v.localPath),
        );
        if (existingAvatar && !force) continue;

        const jobId = await this.queueManager.addAvatarVideoGenerationJob({
          projectId,
          userId,
          sceneNumber,
          authToken,
        });
        jobs.push({ sceneNumber, jobId, type: 'avatar' });
        continue;
      }

      const hasImage = bRollImages.some((img: any) => img.sceneNumber === sceneNumber);
      const videoEntry = bRollVideoTasks.find((vid: any) => vid.sceneNumber === sceneNumber && (vid.localUrl || vid.localPath || vid.videoUrl));
      const hasVideo = !!videoEntry;
      if (!hasImage || (hasVideo && !force)) continue;

      const image = bRollImages.find((img: any) => img.sceneNumber === sceneNumber);
      if (!image) continue;

      let publicImageUrl: string;
      try {
        if (image.publicUrl && this.isPubliclyReachableUrl(image.publicUrl)) {
          publicImageUrl = image.publicUrl;
        } else if (image.gcsUrl && this.isPubliclyReachableUrl(image.gcsUrl)) {
          publicImageUrl = image.gcsUrl;
        } else if (image.localPath && image.localUrl) {
          publicImageUrl = await this.publicUrlService.getPublicUrl(image.localPath, image.localUrl);
        } else if (image.imageUrl) {
          publicImageUrl = image.imageUrl;
        } else {
          continue;
        }
      } catch {
        continue;
      }

      const videoDuration = Math.ceil(audioFile.duration);
      const jobId = await this.queueManager.addVideoGenerationJob({
        projectId,
        userId,
        sceneNumber,
        imageUrl: publicImageUrl,
        prompt: image.prompt,
        duration: videoDuration,
        modelId: 'video-model-1',
        videoStyle: style,
        // ...(productImageUrlForVideo && { referenceImageUrl: productImageUrlForVideo }),
      });
      jobs.push({ sceneNumber, jobId, type: 'broll' });
    }

    return {
      success: true,
      data: { jobs },
      message: 'Video generation jobs queued',
    };
  }

  @Post(':projectId/retry-avatar/:sceneNumber')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Video project ID' })
  @ApiParam({ name: 'sceneNumber', description: 'Scene number' })
  @ApiOperation({ summary: 'Retry avatar generation only', description: 'Retry avatar for an ALTERNATE avatar scene when avatar generation failed' })
  @ApiResponse({ status: 200, description: 'Avatar retry queued' })
  async retryAvatar(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Param('sceneNumber') sceneNumber: string,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    const sceneNum = parseInt(sceneNumber, 10);
    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);

    const projectData = project.data as any;
    if (projectData.style !== 'ALTERNATE' || !this.isAlternateAvatarScene(projectData, sceneNum)) {
      throw new HttpException('Retry avatar is only for ALTERNATE avatar scenes', HttpStatus.BAD_REQUEST);
    }

    const metadata = (projectData.metadata as any) || {};
    const failedScenes = metadata.failedAvatarScenes || [];
    if (!failedScenes.includes(sceneNum)) {
      throw new HttpException('Scene was not marked as avatar-failed', HttpStatus.BAD_REQUEST);
    }

    const authToken = req.headers?.authorization;

    const jobId = await this.queueManager.addAvatarVideoGenerationJob({
      projectId,
      userId,
      sceneNumber: sceneNum,
      authToken,
    });

    return {
      success: true,
      data: { jobId, type: 'avatar' },
      message: 'Avatar retry queued',
    };
  }

  @Get('queue-status/:jobId')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOperation({ summary: 'Get queue job status', description: 'Get status of a queued job' })
  @ApiResponse({ status: 200, description: 'Job status retrieved successfully' })
  async getQueueJobStatus(
    @Request() req: any,
    @Param('jobId') jobId: string,
    @Query('queueType') queueType: 'audio-generation' | 'image-generation' | 'video-generation' | 'avatar-video-generation' | 'scene-composite' | 'stock-download' | 'brand-packaging',
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    if (!queueType) {
      throw new HttpException('queueType query parameter is required', HttpStatus.BAD_REQUEST);
    }

    const status = await this.queueManager.getJobStatus(queueType as any, jobId);
    if (!status) {
      throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    }

    return {
      success: true,
      data: status,
    };
  }

  @Post(':projectId/upload-broll')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiOperation({ summary: 'Upload B-roll file', description: 'Upload an image or video file for use as B-roll; returns a URL to pass to process-custom-broll' })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 201, description: 'File uploaded; returns url' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadBroll(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Multer.File,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }
    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success || !project.data) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }
    if (!file || !file.buffer) {
      throw new BadRequestException('File is required');
    }
    const uploadsDir = this.configService.get<string>('UPLOADS_DIR') || join(process.cwd(), 'uploads');
    const brollDir = join(uploadsDir, 'broll', userId, projectId);
    if (!fs.existsSync(brollDir)) {
      fs.mkdirSync(brollDir, { recursive: true });
    }
    const ext = path.extname(file.originalname || '') || (file.mimetype?.startsWith('video/') ? '.mp4' : '.jpg');
    const filename = `broll_${Date.now()}${ext}`;
    const filePath = join(brollDir, filename);
    fs.writeFileSync(filePath, file.buffer);
    const localUrl = `/uploads/broll/${userId}/${projectId}/${filename}`;
    let publicUrl: string | undefined;
    let gcsUrl: string | undefined;
    try {
      const mimeType = file.mimetype || (ext === '.mp4' || ext === '.mov' ? 'video/mp4' : 'image/jpeg');
    const result = await this.publicUrlService.uploadFromPath(
        filePath,
        `broll/${userId}/${projectId}`,
        filename,
        mimeType,
      );
      publicUrl = result.publicUrl;
      gcsUrl = result.gcsUrl;
    } catch (err: any) {
      console.warn(`[VideoController] upload-broll GCS upload failed: ${err?.message}`);
    }
    const canonical = publicUrl || localUrl;
    return {
      success: true,
      data: {
        url: canonical,
        publicUrl: publicUrl || undefined,
        localUrl: publicUrl ? undefined : localUrl,
        gcsUrl,
      },
      message: 'B-roll file uploaded successfully',
    };
  }

  @Post(':projectId/upload-music')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiOperation({
    summary: 'Upload background music file',
    description: 'Upload audio (mp3/wav/aac/ogg) for use as project background music; returns public URL and duration.',
  })
  @ApiResponse({ status: 201, description: 'Music uploaded' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async uploadMusic(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Multer.File,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }
    const project = await this.videoService.getProject(projectId, userId);
    if (!project.success || !project.data) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }
    if (!file || !file.buffer) {
      throw new BadRequestException('File is required');
    }

    const allowed = new Set([
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
      'audio/aac',
      'audio/x-aac',
      'audio/ogg',
      'audio/webm',
    ]);
    const mime = (file.mimetype || '').toLowerCase();
    if (!allowed.has(mime)) {
      throw new BadRequestException(
        `Unsupported audio type: ${mime || 'unknown'}. Allowed: mp3, wav, aac, ogg, webm.`,
      );
    }

    const uploadsDir = this.configService.get<string>('UPLOADS_DIR') || join(process.cwd(), 'uploads');
    const musicDir = join(uploadsDir, 'music', userId, projectId);
    if (!fs.existsSync(musicDir)) {
      fs.mkdirSync(musicDir, { recursive: true });
    }
    const ext =
      path.extname(file.originalname || '') ||
      (mime.includes('wav') ? '.wav' : mime.includes('ogg') ? '.ogg' : mime.includes('aac') ? '.aac' : '.mp3');
    const filename = `music_${Date.now()}${ext}`;
    const filePath = join(musicDir, filename);
    fs.writeFileSync(filePath, file.buffer);
    const localUrl = `/uploads/music/${userId}/${projectId}/${filename}`;

    let durationSeconds: number | undefined;
    try {
      const raw = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: 'utf8' },
      ).trim();
      const d = parseFloat(raw);
      if (!Number.isNaN(d) && d > 0) durationSeconds = d;
    } catch {
      // optional
    }

    let publicUrl: string | undefined;
    let gcsUrl: string | undefined;
    try {
      const mimeType =
        file.mimetype ||
        (ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : ext === '.aac' ? 'audio/aac' : 'audio/mpeg');
      const result = await this.publicUrlService.uploadFromPath(
        filePath,
        `music/${userId}/${projectId}`,
        filename,
        mimeType,
      );
      publicUrl = result.publicUrl;
      gcsUrl = result.gcsUrl;
    } catch (err: any) {
      console.warn(`[VideoController] upload-music GCS upload failed: ${err?.message}`);
    }

    const canonical = publicUrl || localUrl;
    return {
      success: true,
      data: {
        url: canonical,
        publicUrl: publicUrl || undefined,
        localUrl: publicUrl ? undefined : localUrl,
        gcsUrl,
        durationSeconds,
        originalName: file.originalname || filename,
      },
      message: 'Music file uploaded successfully',
    };
  }

  @Post(':projectId/process-custom-broll')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiOperation({
    summary: 'Process custom B-roll upload',
    description: 'Process uploaded or stock B-roll media for a scene: aspect ratio check, video frame extraction, resize',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sceneNumber: { type: 'number', description: 'Scene number to apply B-roll to' },
        source: { type: 'string', enum: ['upload', 'freepik'], description: 'Source of the B-roll' },
        sourceId: { type: 'string', description: 'Stock item ID (for Freepik)' },
        fileUrl: { type: 'string', description: 'URL of uploaded file in GCS/local storage' },
        mediaType: { type: 'string', enum: ['image', 'video'], description: 'Type of media' },
        targetAspectRatio: { type: 'string', enum: ['9:16', '9:8'], description: 'Target aspect ratio for B-roll' },
        scriptContext: { type: 'string', description: 'Optional script context for generating video prompt from image' },
      },
      required: ['sceneNumber', 'source', 'mediaType', 'targetAspectRatio'],
    },
  })
  @ApiResponse({ status: 200, description: 'B-roll processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  async processCustomBRoll(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: {
      sceneNumber: number;
      source: 'upload' | 'freepik';
      sourceId?: string;
      fileUrl?: string;
      mediaType: 'image' | 'video';
      targetAspectRatio: '9:16' | '9:8';
      scriptContext?: string;
    },
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

    const { sceneNumber, source, sourceId, fileUrl, mediaType, targetAspectRatio, scriptContext } = body;

    if (!sceneNumber || !source || !mediaType || !targetAspectRatio) {
      throw new HttpException('Missing required fields', HttpStatus.BAD_REQUEST);
    }

    if (source === 'freepik' && !sourceId) {
      throw new HttpException('sourceId is required for Freepik source', HttpStatus.BAD_REQUEST);
    }

    if (source === 'upload' && !fileUrl) {
      throw new HttpException('fileUrl is required for upload source', HttpStatus.BAD_REQUEST);
    }

    try {
      const project = await this.videoService.getProject(projectId, userId);
      if (!project.success || !project.data) {
        throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
      }

      const projectData = project.data as any;
      const bRollImages = Array.isArray(projectData.bRollImages) ? [...projectData.bRollImages] : [];
      const bRollVideoTasks = Array.isArray(projectData.bRollVideoTasks) ? [...projectData.bRollVideoTasks] : [];

      let processedImageUrl: string | undefined;
      let processedVideoUrl: string | undefined;

      if (source === 'upload' && fileUrl) {
        const isHttp = fileUrl.startsWith('http://') || fileUrl.startsWith('https://');
        const isLocalPath = fileUrl.startsWith('/uploads');
        const normalizedPublic = isHttp ? fileUrl : undefined;
        const normalizedLocal = isLocalPath ? fileUrl : undefined;
        const displayUrl = normalizedPublic || fileUrl;

        if (mediaType === 'image') {
          processedImageUrl = displayUrl;
          const existingIndex = bRollImages.findIndex((b: any) => b.sceneNumber === sceneNumber);
          const brollEntry = {
            sceneNumber,
            imageUrl: displayUrl,
            publicUrl: normalizedPublic,
            localUrl: normalizedLocal,
            source: 'custom_upload',
            customUpload: true,
            uploadedAt: new Date().toISOString(),
          };
          if (existingIndex >= 0) {
            bRollImages[existingIndex] = { ...bRollImages[existingIndex], ...brollEntry };
          } else {
            bRollImages.push(brollEntry);
          }
        } else {
          processedVideoUrl = displayUrl;
          const existingIndex = bRollVideoTasks.findIndex((b: any) => b.sceneNumber === sceneNumber);
          const brollEntry = {
            sceneNumber,
            videoUrl: displayUrl,
            publicUrl: normalizedPublic,
            localUrl: normalizedLocal,
            source: 'custom_upload',
            customUpload: true,
            uploadedAt: new Date().toISOString(),
          };
          if (existingIndex >= 0) {
            bRollVideoTasks[existingIndex] = { ...bRollVideoTasks[existingIndex], ...brollEntry };
          } else {
            bRollVideoTasks.push(brollEntry);
          }
        }
      } else if (source === 'freepik' && fileUrl) {
        // Download stock asset and persist to our storage (GCS when enabled) so URLs are stable for pipelines
        console.log(`[VideoController] Ingesting Freepik stock for scene ${sceneNumber} from preview URL`);
        const stockResp = await axios.get<ArrayBuffer>(fileUrl, {
          responseType: 'arraybuffer',
          timeout: 120000,
          maxContentLength: 80 * 1024 * 1024,
          validateStatus: (s) => s >= 200 && s < 400,
        });
        if (stockResp.status >= 400) {
          throw new HttpException(`Failed to download stock media: HTTP ${stockResp.status}`, HttpStatus.BAD_GATEWAY);
        }
        const buffer = Buffer.from(stockResp.data);
        const headerCt = (stockResp.headers['content-type'] || '') as string;
        const isImage = mediaType === 'image';
        const ext = isImage
          ? headerCt.includes('png')
            ? 'png'
            : 'jpg'
          : headerCt.includes('webm')
            ? 'webm'
            : 'mp4';
        const filename = `stock_${sourceId || 'asset'}_${sceneNumber}_${Date.now()}.${ext}`;
        const contentType = isImage
          ? headerCt.startsWith('image/')
            ? headerCt
            : 'image/jpeg'
          : headerCt.startsWith('video/')
            ? headerCt
            : 'video/mp4';
        const subPath = isImage ? `images/${userId}` : `videos/${userId}`;
        const uploaded = await this.publicUrlService.uploadFromBuffer(buffer, subPath, filename, contentType);
        const canonicalUrl = uploaded.publicUrl;

        if (isImage) {
          processedImageUrl = canonicalUrl;
          const existingIndex = bRollImages.findIndex((b: any) => b.sceneNumber === sceneNumber);
          const brollEntry = {
            sceneNumber,
            imageUrl: canonicalUrl,
            gcsUrl: uploaded.gcsUrl,
            publicUrl: canonicalUrl,
            localUrl: uploaded.localUrl,
            source: 'freepik',
            sourceId: sourceId || undefined,
            customUpload: false,
          };
          if (existingIndex >= 0) {
            bRollImages[existingIndex] = { ...bRollImages[existingIndex], ...brollEntry };
          } else {
            bRollImages.push(brollEntry);
          }
        } else {
          processedVideoUrl = canonicalUrl;
          const existingIndex = bRollVideoTasks.findIndex((b: any) => b.sceneNumber === sceneNumber);
          const brollEntry = {
            sceneNumber,
            videoUrl: canonicalUrl,
            gcsUrl: uploaded.gcsUrl,
            publicUrl: canonicalUrl,
            localUrl: uploaded.localUrl,
            source: 'freepik',
            sourceId: sourceId || undefined,
            customUpload: false,
          };
          if (existingIndex >= 0) {
            bRollVideoTasks[existingIndex] = { ...bRollVideoTasks[existingIndex], ...brollEntry };
          } else {
            bRollVideoTasks.push(brollEntry);
          }
        }
      }

      // Update project with B-roll data: use bRollVideoTasks for video entries (Prisma expects String[] for bRollVideos)
      await this.videoService.updateProject(projectId, userId, {
        bRollImages,
        bRollVideoTasks: bRollVideoTasks as any,
        metadata: {
          ...projectData.metadata,
          customBRollUpdatedAt: new Date().toISOString(),
        },
      });

      return {
        success: true,
        data: {
          processedImageUrl,
          processedVideoUrl,
          sceneNumber,
        },
        message: 'Custom B-roll processed successfully',
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to process custom B-roll',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

