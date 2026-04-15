import { Controller, Post, Body, Request, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { AssetAnalysisQueueService, AssetAnalysisJobData } from './queue/asset-analysis-queue.service';
import { AssetAnalysisService } from './asset-analysis.service';

@ApiTags('assets')
@Controller('assets')
export class AssetAnalysisController {
  constructor(
    private readonly assetAnalysisQueueService: AssetAnalysisQueueService,
    private readonly assetAnalysisService: AssetAnalysisService,
    private readonly configService: ConfigService,
  ) {}

  @Post('analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Queue asset analysis job (Optional - for admin/manual use)',
    description: 'Queue a background job to analyze assets. The main flow automatically triggers analysis when projects are created/updated with assets.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', example: 'cmhj8oa2p00004v3uh68khd1r' },
        assets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              url: { type: 'string' },
              type: { type: 'string', enum: ['image', 'url'] },
              userLabel: { type: 'string', description: 'User-provided label (logo, product, etc.)' },
            },
          },
        },
      },
      required: ['projectId', 'assets'],
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Analysis job queued successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
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
  async analyzeAssets(@Request() req: any, @Body() body: { projectId: string; assets: AssetAnalysisJobData['assets'] }) {
    // Try to get userId from req.user first (normal user tokens)
    let userId = (req as any).user?.userId || (req as any).user?.sub || (req as any).user?.id;
    
    // If not found, try to extract from Authorization header (service tokens)
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

    if (!body.projectId || !body.assets || !Array.isArray(body.assets) || body.assets.length === 0) {
      throw new HttpException('projectId and assets array are required', HttpStatus.BAD_REQUEST);
    }

    try {
      const jobId = await this.assetAnalysisQueueService.addAnalysisJob({
        projectId: body.projectId,
        userId,
        assets: body.assets,
      });

      return {
        success: true,
        data: {
          jobId,
          message: 'Asset analysis job queued successfully. Analysis will happen in the background.',
        },
      };
    } catch (error: any) {
      throw new HttpException(
        `Failed to queue asset analysis: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('analyze-broll-image')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Analyze uploaded B-roll image and generate video prompt',
    description: 'Analyzes an uploaded image and generates a video generation prompt based on the image content and scene voiceover context.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        imageUrl: { type: 'string', example: 'https://storage.googleapis.com/bucket/image.jpg' },
        sceneVoiceover: { type: 'string', example: 'This scene shows our innovative product in action' },
      },
      required: ['imageUrl', 'sceneVoiceover'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Video prompt generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            videoPrompt: { type: 'string' },
          },
        },
      },
    },
  })
  async analyzeBrollImage(@Request() req: any, @Body() body: { imageUrl: string; sceneVoiceover: string }) {
    // Validate user authentication
    let userId = (req as any).user?.userId || (req as any).user?.sub || (req as any).user?.id;
    
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
        // Token extraction failed
      }
    }
    
    if (!userId) {
      throw new HttpException('User ID not found in token', HttpStatus.UNAUTHORIZED);
    }

    if (!body.imageUrl) {
      throw new HttpException('imageUrl is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const videoPrompt = await this.assetAnalysisService.analyzeBrollImageForVideoPrompt(
        body.imageUrl,
        body.sceneVoiceover || ''
      );

      return {
        success: true,
        data: {
          videoPrompt,
        },
      };
    } catch (error: any) {
      throw new HttpException(
        `Failed to analyze B-roll image: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

