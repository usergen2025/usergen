import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  Query,
  HttpCode,
  HttpStatus,
  Request,
  HttpException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody, ApiParam } from '@nestjs/swagger';
import { AvatarsService } from './avatars.service';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';

@ApiTags('avatars')
@Controller('avatars')
export class AvatarsController {
  constructor(
    private readonly avatarsService: AvatarsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Extract userId from JWT token
   */
  private extractUserIdFromToken(req: any): string | null {
    try {
      const authHeader = req.headers?.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
      }

      const token = authHeader.replace('Bearer ', '');
      const jwtSecret = this.configService!.get<string>('JWT_SECRET') || 
                       'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';
      
      const decoded = jwt.verify(token, jwtSecret) as any;
      // JWT token uses 'sub' field for user ID
      return decoded.sub || decoded.userId || decoded.id || null;
    } catch (error) {
      // Token is invalid or expired
      return null;
    }
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Upload image to HeyGen', description: 'Upload image file to HeyGen and get image_key. Also saves file locally.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Image file (JPEG or PNG)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Image uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            imageKey: { type: 'string', example: 'img_key_123' },
            assetId: { type: 'string', example: 'asset_456' },
            localUrl: { type: 'string', example: '/uploads/avatars/123/image.jpg' },
          },
        },
        message: { type: 'string', example: 'Image uploaded successfully' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          // Extract userId from token (synchronously)
          const authHeader = req.headers?.authorization;
          let userId = 'anonymous';
          
          if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
              const token = authHeader.replace('Bearer ', '');
              const jwtSecret = process.env.JWT_SECRET || 
                               'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';
              const decoded = jwt.verify(token, jwtSecret) as any;
              userId = decoded.sub || decoded.userId || decoded.id || 'anonymous';
            } catch (error) {
              // If token is invalid, use anonymous
              userId = 'anonymous';
            }
          }
          
          const uploadDir = join(process.cwd(), 'uploads', 'avatars', userId);
          // Ensure directory exists
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          cb(null, `${uniqueSuffix}${ext}`);
        },
      }),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  )
  async uploadImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
          // FileTypeValidator removed - we validate mimetype manually below
        ],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Request() req: any,
  ) {
    const userId = this.extractUserIdFromToken(req) || 'anonymous';
    
    // Validate mimetype manually - FileTypeValidator regex can be problematic
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!file || !file.mimetype || !allowedMimeTypes.includes(file.mimetype)) {
      throw new HttpException(
        {
          success: false,
          error: `Invalid file type. Expected image/jpeg, image/jpg, or image/png, got ${file?.mimetype || 'unknown'}`,
          code: 'INVALID_FILE_TYPE',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    
    const contentType = (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') ? 'image/jpeg' : 'image/png';
    
    // Read file buffer from disk
    const fileBuffer = fs.readFileSync(file.path);
    
    const result = await this.avatarsService.uploadImageToHeyGen({
      imageBuffer: fileBuffer,
      contentType,
      filename: file.originalname,
      localFilePath: file.path,
      userId,
    });

    return {
      success: true,
      data: {
        ...result,
        localUrl: `/uploads/avatars/${userId}/${file.filename}`,
      },
      message: 'Image uploaded successfully. You can now proceed to create avatar.',
    };
  }

  @Post('create-from-upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create avatar from uploaded image',
    description: 'Creates avatar from HeyGen image_key. Starts background process to generate avatar. Requires JWT token in Authorization header or userId in request body.',
  })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({
    status: 201,
    description: 'Avatar creation started',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            avatarId: { type: 'string', example: 'avatar_123' },
            jobId: { type: 'string', example: 'job_456' },
          },
        },
        message: { type: 'string', example: 'Avatar generation started' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'User ID is required',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'User ID is required. Please provide userId in request body or authenticate with JWT token.' },
        code: { type: 'string', example: 'MISSING_USER_ID' },
      },
    },
  })
  async createAvatarFromUpload(
    @Body() dto: { imageKey: string; assetId?: string; name?: string; description?: string; userId?: string; originalImageUrl?: string },
    @Request() req: any,
  ) {
    // Extract userId from JWT token if not provided in body
    let userId = dto.userId;
    
    if (!userId) {
      userId = this.extractUserIdFromToken(req);
    }

    // Validate userId is present
    if (!userId) {
      throw new HttpException(
        {
          success: false,
          error: 'User ID is required. Please provide userId in request body or authenticate with JWT token.',
          code: 'MISSING_USER_ID',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.avatarsService.createAvatarFromUpload({
      ...dto,
      userId,
      originalImageUrl: dto.originalImageUrl,
    });

    return {
      success: true,
      data: result,
      message: 'Avatar generation started. This will take a few minutes.',
    };
  }

  @Get()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get user avatars', description: 'List all avatars for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Avatars retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserAvatars(
    @Request() req: any,
    @Query('source') source?: string,
    @Query('category') category?: string,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException(
        {
          success: false,
          error: 'Authentication failed. Please login again.',
          code: 'UNAUTHORIZED',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const avatars = await this.avatarsService.getUserAvatars(userId, { source, category });
    return {
      success: true,
      data: avatars,
    };
  }

  @Get('library')
  @ApiOperation({ summary: 'Get library avatars', description: 'Get public avatar library' })
  @ApiResponse({ status: 200, description: 'Library avatars retrieved successfully' })
  async getLibraryAvatars(
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    const avatars = await this.avatarsService.getLibraryAvatars({ category, search });
    return {
      success: true,
      data: avatars,
    };
  }

  @Post('generate-for-project')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Generate avatar image for project',
    description: 'Generates a single avatar image from the avatar original + script avatar_image_prompt. Used when user moves to b-roll images step. Returns HeyGen image_key for Avatar IV.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        avatarId: { type: 'string' },
        userId: { type: 'string' },
        script: { type: 'object', properties: { avatar_image_prompt: { type: 'string' }, visual_style_guide: { type: 'object' } } },
        style: { type: 'string', enum: ['HALF_N_HALF', 'ALTERNATE', 'AVATAR_CUTOUT', 'AVATAR_ONLY', 'AVATAR_PRODUCT', 'ANIMATED_AVATAR'] },
        avatarVisualStylePreset: { type: 'string', description: 'original, random, or preset id' },
      },
      required: ['projectId', 'avatarId', 'script'],
    },
  })
  @ApiResponse({ status: 200, description: 'Avatar image generated', schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { imageKey: { type: 'string' } } } } } })
  @ApiResponse({ status: 400, description: 'Missing avatar_image_prompt or invalid request' })
  async generateForProject(
    @Body() body: { projectId: string; avatarId: string; userId?: string; script: any; style?: string; avatarVisualStylePreset?: string },
    @Request() req: any,
  ) {
    const userId = body.userId ?? this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException(
        { success: false, error: 'User ID required', code: 'MISSING_USER_ID' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.avatarsService.generateAvatarImageForProject({
      projectId: body.projectId,
      avatarId: body.avatarId,
      userId,
      script: body.script,
      style: body.style,
      avatarVisualStylePreset: body.avatarVisualStylePreset,
    });
    return { success: true, data: result };
  }

  @Post('generate-preview')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Generate avatar preview image',
    description:
      'Generates an avatar preview for display (BytePlus + storage). Does not upload to HeyGen; call finalize-preview when the user proceeds.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        avatarId: { type: 'string' },
        userId: { type: 'string' },
        script: { type: 'object', properties: { avatar_image_prompt: { type: 'string' }, visual_style_guide: { type: 'object' } } },
        style: { type: 'string', enum: ['HALF_N_HALF', 'ALTERNATE', 'AVATAR_CUTOUT', 'AVATAR_ONLY', 'AVATAR_PRODUCT', 'ANIMATED_AVATAR'] },
        avatarVisualStylePreset: { type: 'string', description: 'original, random, or preset id' },
        productImageUrl: { type: 'string', description: 'Optional product image URL for AVATAR_PRODUCT composite preview' },
        previewSceneIndex: { type: 'number', description: 'Which script scene to align preview hints with (default 0)' },
      },
      required: ['projectId', 'avatarId', 'script'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Avatar preview generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            publicUrl: { type: 'string' },
            imageKey: { type: 'string', description: 'Optional; set only if legacy' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Missing avatar_image_prompt or invalid request' })
  async generatePreview(
    @Body()
    body: {
      projectId: string;
      avatarId: string;
      userId?: string;
      script: any;
      style?: string;
      avatarVisualStylePreset?: string;
      productImageUrl?: string;
      previewSceneIndex?: number;
    },
    @Request() req: any,
  ) {
    const userId = body.userId ?? this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException(
        { success: false, error: 'User ID required', code: 'MISSING_USER_ID' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.avatarsService.generateAvatarPreview({
      projectId: body.projectId,
      avatarId: body.avatarId,
      userId,
      script: body.script,
      style: body.style,
      avatarVisualStylePreset: body.avatarVisualStylePreset,
      productImageUrl: body.productImageUrl,
      previewSceneIndex: body.previewSceneIndex,
    });
    return { success: true, data: result };
  }

  @Post('finalize-preview')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Finalize avatar preview (HeyGen upload)',
    description:
      'Uploads the preview image to HeyGen once when the user confirms the avatar. Updates avatar.imageKey.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        avatarId: { type: 'string' },
        previewImageUrl: { type: 'string', description: 'Public URL of the preview image (same as metadata.avatarPreviewUrl)' },
      },
      required: ['avatarId', 'previewImageUrl'],
    },
  })
  async finalizePreview(
    @Body() body: { avatarId: string; previewImageUrl: string },
    @Request() req: any,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException(
        { success: false, error: 'Authentication failed. Please login again.', code: 'UNAUTHORIZED' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const result = await this.avatarsService.finalizeAvatarPreview({
      userId,
      avatarId: body.avatarId,
      previewImageUrl: body.previewImageUrl,
    });
    return { success: true, data: result };
  }

  @Post('generate-from-text')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Generate avatar from text description',
    description: 'Generates an avatar image from a text prompt using AI text-to-image generation.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text description of the avatar to generate' },
        projectId: { type: 'string', description: 'Optional project ID to associate with' },
        style: { type: 'string', description: 'Optional visual style preset' },
      },
      required: ['prompt'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Avatar generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        avatarId: { type: 'string' },
        thumbnailUrl: { type: 'string' },
        avatarUrl: { type: 'string' },
        originalImageUrl: { type: 'string' },
        error: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Missing prompt or invalid request' })
  async generateFromText(
    @Body()
    body: {
      prompt: string;
      projectId?: string;
      style?: string;
      avatarVisualStylePreset?: string | null;
      script?: { avatar_image_prompt?: string; visual_style_guide?: any };
    },
    @Request() req: any,
  ) {
    const userId = this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException(
        { success: false, error: 'User ID required', code: 'MISSING_USER_ID' },
        HttpStatus.BAD_REQUEST,
      );
    }
    
    if (!body.prompt || !body.prompt.trim()) {
      throw new HttpException(
        { success: false, error: 'Prompt is required', code: 'MISSING_PROMPT' },
        HttpStatus.BAD_REQUEST,
      );
    }
    
    return await this.avatarsService.generateAvatarFromText({
      prompt: body.prompt.trim(),
      userId,
      projectId: body.projectId,
      style: body.style,
      avatarVisualStylePreset: body.avatarVisualStylePreset,
      script: body.script,
    });
  }

  @Get(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get avatar details', description: 'Get specific avatar by ID' })
  @ApiResponse({ status: 200, description: 'Avatar retrieved successfully' })
  async getAvatarById(@Param('id') id: string, @Query('userId') userId?: string, @Request() req?: any) {
    // Try to extract userId from JWT token first, fallback to query parameter
    let user = userId;
    if (!user) {
      user = this.extractUserIdFromToken(req);
    }
    
    // If still no userId, return error
    if (!user) {
      throw new HttpException(
        {
          success: false,
          error: 'User ID is required. Please provide userId query parameter or authenticate with a valid token.',
          code: 'USER_ID_REQUIRED',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    
    const avatar = await this.avatarsService.getAvatarById(id, user);
    return {
      success: true,
      data: avatar,
    };
  }

  @Get('jobs/:jobId/status')
  @ApiOperation({ summary: 'Get generation job status', description: 'Check status of avatar generation job' })
  @ApiResponse({ status: 200, description: 'Job status retrieved successfully' })
  async getJobStatus(@Param('jobId') jobId: string, @Query('userId') userId?: string) {
    const user = userId || 'user123'; // TODO: Get from JWT token
    const job = await this.avatarsService.getJobStatus(jobId, user);
    return {
      success: true,
      data: job,
      };
    }

    @Post(':id/create-transparent')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Create transparent background version of avatar' })
    @ApiParam({ name: 'id', description: 'Avatar ID' })
    @ApiResponse({
      status: 200,
      description: 'Transparent version created successfully',
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              imageKey: { type: 'string' },
              assetId: { type: 'string' },
            },
          },
          message: { type: 'string' },
        },
      },
    })
    async createTransparentVersion(@Param('id') id: string, @Request() req: any) {
      const userId = this.extractUserIdFromToken(req);
      
      if (!userId) {
        throw new HttpException(
          {
            success: false,
            error: 'Unauthorized',
            code: 'UNAUTHORIZED',
          },
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Verify avatar belongs to user
      const avatar = await this.avatarsService.getAvatarById(id, userId);
      if (!avatar) {
        throw new HttpException(
          {
            success: false,
            error: 'Avatar not found',
            code: 'AVATAR_NOT_FOUND',
          },
          HttpStatus.NOT_FOUND,
        );
      }
      
      const result = await this.avatarsService.createTransparentAvatarVersion(id);
      
      return {
        success: true,
        data: result,
        message: 'Transparent version created successfully',
      };
    }

    @Post(':id/process-images')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Process images for an avatar (on-demand for old avatars)' })
    @ApiParam({ name: 'id', description: 'Avatar ID' })
    @ApiResponse({
      status: 202,
      description: 'Image processing job queued',
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              jobId: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    })
    async processImages(
      @Param('id') avatarId: string,
      @Query('userId') userId: string,
      @Request() req: any,
    ): Promise<any> {
      const tokenUserId = this.extractUserIdFromToken(req);
      if (tokenUserId && tokenUserId !== userId) {
        throw new HttpException(
          {
            success: false,
            error: 'Unauthorized',
            code: 'UNAUTHORIZED',
          },
          HttpStatus.UNAUTHORIZED,
        );
      }

      if (!userId) {
        throw new HttpException(
          {
            success: false,
            error: 'User ID is required',
            code: 'MISSING_USER_ID',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.avatarsService.processAvatarImagesOnDemand(avatarId, userId);

      return {
        success: true,
        data: result,
        message: result.message,
      };
    }
  }

