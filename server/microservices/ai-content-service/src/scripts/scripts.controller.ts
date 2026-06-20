import { Controller, Post, Body, Get, Param, HttpException, HttpStatus, UseInterceptors, UploadedFile, Request, ParseFilePipe, MaxFileSizeValidator } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { ScriptsService, ScriptGenerationRequest, VideoScriptGenerationRequest, SceneRegenerationRequest } from './scripts.service';
import { PublicUrlService } from '../common/storage/public-url.service';

@ApiTags('scripts')
@Controller('scripts')
export class ScriptsController {
  constructor(
    private readonly scriptsService: ScriptsService,
    private readonly publicUrlService: PublicUrlService,
    private readonly configService: ConfigService,
  ) {}

  @Post('generate')
  @ApiOperation({ 
    summary: 'Generate a script using AI',
    description: 'Generate a video script using AI based on topic, duration, tone, and other parameters. Uses OpenAI GPT-4 for script generation.'
  })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', example: 'Introduction to AI and Machine Learning', description: 'Main topic for the script' },
        duration: { type: 'number', example: 60, description: 'Desired script duration in seconds' },
        tone: { type: 'string', example: 'professional', description: 'Tone: professional, casual, friendly, educational' },
        targetAudience: { type: 'string', example: 'beginners', description: 'Target audience for the script' },
        additionalContext: { type: 'string', example: 'Include examples and real-world applications', description: 'Additional context or requirements' }
      },
      required: ['topic', 'duration']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Script generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            scriptId: { type: 'string', example: 'script_abc123', description: 'Unique script ID' },
            script: { type: 'string', example: 'Welcome to our introduction to AI and Machine Learning...', description: 'Generated script text' },
            wordCount: { type: 'number', example: 250, description: 'Total word count' },
            estimatedDuration: { type: 'number', example: 60, description: 'Estimated duration in seconds' },
            createdAt: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
          }
        },
        message: { type: 'string', example: 'Script generated successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - Invalid input parameters',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Topic and duration are required' },
        error: { type: 'string', example: 'Bad Request' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
        error: { type: 'string', example: 'Unauthorized' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async generateScript(@Body() request: ScriptGenerationRequest) {
    const result = await this.scriptsService.generateScript(request);
    return {
      success: true,
      data: result,
      message: 'Script generated successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('chat')
  @ApiOperation({ 
    summary: 'Chat with AI for script assistance',
    description: 'Chat with AI to get help with script writing, modifications, or suggestions. Maintains conversation history for context.'
  })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Can you make the script more engaging?', description: 'User message to AI' },
        history: { 
          type: 'array', 
          items: { type: 'string' },
          example: ['User: Create a script about renewable energy', 'AI: Here is a script about renewable energy...'],
          description: 'Previous conversation history (optional)' 
        }
      },
      required: ['message']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'AI response generated',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            response: { type: 'string', example: 'I can help make the script more engaging. Here are some suggestions...', description: 'AI response text' },
            updatedScript: { type: 'string', example: 'Enhanced script text...', description: 'Updated script if applicable' }
          }
        },
        message: { type: 'string', example: 'AI response generated' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - Missing message',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Message is required' },
        error: { type: 'string', example: 'Bad Request' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
        error: { type: 'string', example: 'Unauthorized' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async chatWithAI(@Body() body: { message: string; history?: string[] }) {
    const result = await this.scriptsService.chatWithAI(body.message, body.history);
    return {
      success: true,
      data: { response: result },
      message: 'AI response generated',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('generate-video-script')
  @ApiOperation({ 
    summary: 'Generate a video script based on video style and user prompt',
    description: 'Generate a structured video script using OpenAI GPT-4.1 based on the selected video style (Half-and-Half, Alternating, or Cutout Overlay). Returns JSON script and formatted display version.'
  })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userPrompt: { type: 'string', example: 'Introduction to artificial intelligence and its applications', description: 'User input topic or idea for the video' },
        videoStyle: { type: 'string', enum: ['HALF_N_HALF', 'ALTERNATE', 'AVATAR_CUTOUT', 'AVATAR_ONLY', 'PRODUCT_ONLY', 'AVATAR_PRODUCT', 'B_ROLL_ONLY'], example: 'HALF_N_HALF', description: 'Video style/format' },
        duration: { type: 'string', example: '30 seconds', description: 'Desired video duration' },
        language: { type: 'string', enum: ['english', 'hindi', 'hinglish'], example: 'hinglish', description: 'Language for script dialogue (defaults to hinglish if not provided)' },
        tags: { type: 'array', items: { type: 'string' }, example: ['technology', 'professional', 'modern'], description: 'Optional tags for visual style guidance (e.g., technology, professional, modern, food, casual)' },
        projectId: { type: 'string', example: 'cmhj8oa2p00004v3uh68khd1r', description: 'Video project ID (optional)' },
        productImageUrl: { type: 'string', example: 'https://example.com/product.jpg', description: 'URL of the product image uploaded by user (optional, for PRODUCT_ONLY and AVATAR_PRODUCT styles)' },
        hasAvatar: { type: 'boolean', example: true, description: 'Whether an avatar is being used (optional, for AVATAR_PRODUCT style)' },
        avatarId: { type: 'string', example: 'avatar123', description: 'ID of the selected avatar (optional, if hasAvatar is true)' }
      },
      required: ['userPrompt', 'videoStyle']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Video script generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            script: { type: 'object', description: 'JSON script object with scenes, voiceover, b-roll descriptions, etc.' },
            formattedScript: { type: 'string', example: '📹 Video Type: Half-and-Half\n⏱️  Duration: 30 seconds\n\n🎬 Scene 1 (0-5s)...', description: 'Human-readable formatted script' },
            tokensUsed: { type: 'number', example: 1500, description: 'OpenAI tokens used' },
            processingTime: { type: 'number', example: 2345, description: 'Processing time in milliseconds' },
            model: { type: 'string', example: 'gpt-4-turbo', description: 'OpenAI model used' }
          }
        },
        message: { type: 'string', example: 'Video script generated successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - Invalid input parameters',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'userPrompt and videoStyle are required' },
        error: { type: 'string', example: 'Bad Request' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
        error: { type: 'string', example: 'Unauthorized' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async generateVideoScript(@Request() req: any, @Body() request: VideoScriptGenerationRequest) {
    try {
      // Extract userId from token - try req.user first (normal user tokens)
      let userId = (req as any).user?.userId || (req as any).user?.sub || (req as any).user?.id;
      
      // If not found, try to extract from Authorization header (service tokens or when req.user not populated)
      if (!userId) {
        try {
          const authHeader = req.headers?.authorization;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '');
            const jwtSecret = this.configService.get<string>('JWT_SECRET') || 
                             'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';
            const decoded = jwt.verify(token, jwtSecret) as any;
            userId = decoded.sub || decoded.userId || decoded.id;
          }
        } catch (error) {
          // Token extraction failed, will throw error below
        }
      }
      
      if (!userId) {
        throw new HttpException('User ID not found in token', HttpStatus.UNAUTHORIZED);
      }
      
      const result = await this.scriptsService.generateVideoScript(request, userId);
      return {
        success: true,
        data: result,
        message: 'Video script generated successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      // Log error for debugging
      console.error('[ScriptsController] Error generating video script:', error);
      
      // Determine appropriate status code
      const statusCode = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
      const errorMessage = error.message || 'Failed to generate video script. Please try again.';
      
      // Throw HttpException with proper status code
      throw new HttpException(
        {
          success: false,
          message: errorMessage,
          error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        },
        statusCode
      );
    }
  }

  @Post('regenerate-scene')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Regenerate or edit a single scene from a video script',
    description: 'Uses chat-based approach with OpenAI to regenerate or edit a specific scene while maintaining context from the existing script. Follows the same guidelines as full script generation.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sceneNumber: { type: 'number', example: 1, description: 'Scene number to regenerate/edit' },
        videoStyle: { type: 'string', enum: ['HALF_N_HALF', 'ALTERNATE', 'AVATAR_CUTOUT'], example: 'HALF_N_HALF', description: 'Video style/format' },
        existingScript: { type: 'object', description: 'Full existing script for context' },
        originalUserPrompt: { type: 'string', example: 'Introduction to AI', description: 'Original user prompt for context' },
        operation: { type: 'string', enum: ['regenerate', 'edit'], example: 'regenerate', description: 'Operation type: regenerate or edit' },
        newVoiceover: { type: 'string', example: 'New voiceover text', description: 'New voiceover text (required if operation is edit)' },
        language: { type: 'string', enum: ['english', 'hindi', 'hinglish'], example: 'hinglish', description: 'Language for script dialogue (defaults to hinglish if not provided)' }
      },
      required: ['sceneNumber', 'videoStyle', 'existingScript', 'originalUserPrompt', 'operation']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Scene regenerated/edited successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            scene: { type: 'object', description: 'Updated scene object' },
            tokensUsed: { type: 'number', example: 500 },
            processingTime: { type: 'number', example: 2000 },
            model: { type: 'string', example: 'gpt-4-turbo' }
          }
        },
        message: { type: 'string', example: 'Scene regenerated successfully' },
        timestamp: { type: 'string', example: '2024-01-01T00:00:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - Invalid input parameters'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing token'
  })
  async regenerateScene(@Body() request: SceneRegenerationRequest) {
    const result = await this.scriptsService.regenerateOrEditScene(request);
    return {
      success: true,
      data: result,
      message: request.operation === 'edit' ? 'Scene edited successfully' : 'Scene regenerated successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('upload-product-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          // Extract userId from request (from JWT or query param)
          const userId = (req as any).user?.userId || (req as any).query?.userId || 'anonymous';
          const uploadsDir = join(process.cwd(), 'uploads', 'product-images', userId);
          
          // Create directory if it doesn't exist
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          cb(null, uploadsDir);
        },
        filename: (req, file, cb) => {
          // Generate unique filename with timestamp
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          cb(null, `product-${uniqueSuffix}${ext}`);
        },
      }),
      limits: {
        fileSize: 20 * 1024 * 1024, // 20MB max
      },
      fileFilter: (req, file, cb) => {
        // Accept only image files
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          return cb(new Error('Only image files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiBearerAuth('JWT-auth')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload product image and get public URL',
    description: 'Upload a product image file, save it locally, and return a public URL (FAL storage in local env, backend URL in prod). This URL can be used for GPT-4 Vision API in script generation.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Product image file (JPEG, PNG, GIF, or WebP, max 20MB)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Product image uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            publicUrl: { type: 'string', example: 'https://fal.run/storage/...', description: 'Public URL for the uploaded image (FAL storage in local, backend URL in prod)' },
            localUrl: { type: 'string', example: '/uploads/product-images/user123/product-1234567890.jpg', description: 'Local URL path relative to backend' },
          },
        },
        message: { type: 'string', example: 'Product image uploaded successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid file or file too large',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
  })
  async uploadProductImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 20 * 1024 * 1024 }), // 20MB
        ],
      }),
    )
    file: Express.Multer.File,
    @Request() req: any,
  ) {
    try {
      if (!file) {
        throw new HttpException('File is required', HttpStatus.BAD_REQUEST);
      }

      // Extract userId from request
      const userId = req.user?.userId || req.query?.userId || 'anonymous';
      
      // Construct local URL path
      const localUrl = `/uploads/product-images/${userId}/${file.filename}`;

      const storageResult = await this.publicUrlService.uploadFromPath(
        file.path,
        `product-images/${userId}`,
        file.filename,
        file.mimetype,
      );

      return {
        success: true,
        data: {
          publicUrl: storageResult.publicUrl,
          localUrl: storageResult.localUrl || localUrl,
          localPath: storageResult.localPath,
          gcsUrl: storageResult.gcsUrl,
          gcsUploaded: storageResult.gcsUploaded,
        },
        message: 'Product image uploaded successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('[ScriptsController] Error uploading product image:', error);
      
      // Clean up uploaded file if it exists
      if (file?.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkError) {
          console.error('[ScriptsController] Failed to cleanup file:', unlinkError);
        }
      }

      const statusCode = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
      const errorMessage = error.message || 'Failed to upload product image. Please try again.';

      throw new HttpException(
        {
          success: false,
          message: errorMessage,
          error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        },
        statusCode,
      );
    }
  }

  @Post('translate-voiceovers')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Translate scene voiceovers for translated video captions' })
  async translateVoiceovers(
    @Body() body: { scenes: Array<{ sceneNumber: number; voiceover: string }>; targetLanguage: string },
  ) {
    const scenes = await this.scriptsService.translateVoiceovers({
      scenes: body.scenes || [],
      targetLanguage: body.targetLanguage,
    });
    return {
      success: true,
      data: { scenes },
      message: 'Voiceovers translated',
      timestamp: new Date().toISOString(),
    };
  }
}
