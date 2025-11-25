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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';
import { VideoService } from './video.service';
import { RenderingService } from '../rendering/rendering.service';
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
  ) {}

  /**
   * Extract userId from JWT token
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
      const userId = decoded.sub || decoded.userId || decoded.id || null;
      
      if (!userId) {
        console.warn('[VideoController] Token decoded but no userId found in payload');
      }
      
      return userId;
    } catch (error: any) {
      if (error.name === 'JsonWebTokenError') {
        console.warn('[VideoController] Invalid JWT token:', error.message);
      } else if (error.name === 'TokenExpiredError') {
        console.warn('[VideoController] JWT token has expired');
      } else {
        console.error('[VideoController] Error verifying token:', error.message);
      }
      return null;
    }
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
  async getProjects(@Request() req: any) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
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
  @ApiOperation({ summary: 'Generate audio files', description: 'Queue audio generation for all scenes' })
  @ApiResponse({ status: 200, description: 'Audio generation queued successfully' })
  async generateAudio(@Request() req: any, @Param('projectId') projectId: string) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException('Authentication failed. Please login again.', HttpStatus.UNAUTHORIZED);
    }

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

    // Check if image already exists for this scene
    const bRollImages = ((project.data as any).bRollImages as any[]) || [];
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

    const script = typeof project.data.script === 'string' 
      ? JSON.parse(project.data.script) 
      : project.data.script;
    const scenes = script.scenes || script.scene_plan || [];
    const scene = scenes.find((s: any) => (s.scene_number || s.sceneNumber) === sceneNum);
    // Try multiple prompt fields: broll_image_prompt, broll_prompt, broll_visual_description
    const prompt = body.prompt || scene?.broll_image_prompt || scene?.broll_prompt || scene?.broll_visual_description;

    if (!prompt) {
      throw new HttpException('Image prompt not found for this scene', HttpStatus.BAD_REQUEST);
    }

    // Get model ID from body or use default
    const modelId = body.modelId || 'model-1'; // Default to Model 1 (FAL imagen4)

    const jobId = await this.queueManager.addImageGenerationJob({
      projectId,
      userId,
      sceneNumber: sceneNum,
      prompt,
      modelId, // Pass model selection
      aspectRatio: body.aspectRatio, // Optional override
      resolution: body.resolution, // Optional override
    });

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

    // Get public URL for the image - prefer local file over provider URL (which may expire)
    let publicImageUrl: string;
    if (image.localPath && image.localUrl) {
      try {
        // Use local file and get public URL (uploads to FAL in local, uses backend URL in dev/prod)
        console.log(`[VideoController] Using local file for scene ${sceneNum}: ${image.localPath}`);
        publicImageUrl = await this.publicUrlService.getPublicUrl(image.localPath, image.localUrl);
        console.log(`[VideoController] ✅ Got public URL for local file: ${publicImageUrl}`);
      } catch (error: any) {
        console.warn(`[VideoController] Failed to get public URL from local file, falling back to provider URL: ${error.message}`);
        // Fallback to provider URL if local file upload fails
        if (!image.imageUrl) {
          throw new HttpException(
            `Failed to get public URL for image: ${error.message}`,
            HttpStatus.INTERNAL_SERVER_ERROR
          );
        }
        publicImageUrl = image.imageUrl;
      }
    } else if (image.imageUrl) {
      // Fallback to provider URL if local file doesn't exist (backward compatibility)
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

    // Ensure duration matches audio file duration exactly (not exceeding it)
    // Round down to nearest second to ensure video doesn't exceed audio duration
    const videoDuration = Math.floor(audioDuration);
    if (videoDuration <= 0) {
      throw new HttpException(
        `Invalid duration for scene ${sceneNumber}: ${audioDuration} seconds`,
        HttpStatus.BAD_REQUEST
      );
    }

    console.log(`[VideoController] Scene ${sceneNumber}: Audio duration=${audioDuration}s, Video duration=${videoDuration}s, Image URL=${publicImageUrl}, ModelId=${body.modelId || 'video-model-1'}`);

    const jobId = await this.queueManager.addVideoGenerationJob({
      projectId,
      userId,
      sceneNumber: parseInt(sceneNumber, 10),
      imageUrl: publicImageUrl, // Use public URL from local file or provider
      prompt: image.prompt,
      duration: videoDuration, // Use exact duration matching audio file
      modelId: body.modelId || 'video-model-1', // Use selected model or default
    });

    return {
      success: true,
      data: { jobId },
      message: 'Video generation queued successfully',
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
    @Query('queueType') queueType: 'audio-generation' | 'image-generation' | 'video-generation',
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
}

