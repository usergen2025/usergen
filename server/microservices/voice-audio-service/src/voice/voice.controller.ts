import { Controller, Get, Post, Body, Query, Param, Request, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { VoiceService } from './voice.service';

@ApiTags('voice')
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    private readonly configService: ConfigService,
  ) {}

  private extractUserIdFromToken(req: any): string | null {
    try {
      const authHeader = req.headers?.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
      }

      const token = authHeader.replace('Bearer ', '');
      const jwtSecret = this.configService.get<string>('JWT_SECRET') || 
                       'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';
      const decoded = jwt.verify(token, jwtSecret) as any;
      return decoded.sub || decoded.userId || decoded.id || null;
    } catch (error) {
      return null;
    }
  }
  @Post('clone')
  @ApiOperation({ 
    summary: 'Clone voice', 
    description: 'Create a voice clone from audio sample. Upload an audio file to clone the voice for use in video generation.' 
  })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'John Doe Voice', description: 'Name for the cloned voice' },
        audioFile: { type: 'string', format: 'binary', description: 'Audio file (MP3, WAV, M4A) to clone voice from' },
        description: { type: 'string', example: 'Professional male voice for video narration', description: 'Optional description' }
      },
      required: ['name', 'audioFile']
    }
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Voice cloned successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            voiceId: { type: 'string', example: 'voice_abc123', description: 'Unique voice ID' },
            name: { type: 'string', example: 'John Doe Voice' },
            status: { type: 'string', example: 'processing', description: 'Voice cloning status' },
            createdAt: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
          }
        },
        message: { type: 'string', example: 'Voice cloning started successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - Invalid audio file or missing parameters',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Invalid audio file format. Supported formats: MP3, WAV, M4A' },
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
        message: { type: 'string', example: 'Unauthorized - Invalid token' },
        error: { type: 'string', example: 'Unauthorized' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async cloneVoice(@Body() dto: any) {
    // TODO: Implement voice cloning logic
    return { success: true, message: 'Voice cloning endpoint - implementation pending' };
  }

  @Get('voices')
  @ApiOperation({ 
    summary: 'List ElevenLabs voices', 
    description: 'Get list of all available voices from ElevenLabs library. Can filter by search term or category.' 
  })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ 
    status: 200, 
    description: 'Voices retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              voice_id: { type: 'string', example: '21m00Tcm4TlvDq8ikWAM' },
              name: { type: 'string', example: 'Rachel' },
              category: { type: 'string', example: 'professional' },
              description: { type: 'string', example: 'A warm, expressive voice' },
              preview_url: { type: 'string', example: 'https://storage.googleapis.com/...' },
              labels: { type: 'object', example: { accent: 'American', gender: 'female' } }
            }
          }
        },
        message: { type: 'string', example: 'Voices retrieved successfully' },
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
  async getVoices(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('pageSize') pageSize?: number,
  ) {
    const voices = await this.voiceService.getVoices({
      search,
      category,
      pageSize: pageSize || 100,
    });

    return {
      success: true,
      data: voices,
      message: 'Voices retrieved successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('voices/:voiceId')
  @ApiOperation({ 
    summary: 'Get voice details', 
    description: 'Get detailed information about a specific voice from ElevenLabs' 
  })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ 
    status: 200, 
    description: 'Voice details retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            voice_id: { type: 'string', example: '21m00Tcm4TlvDq8ikWAM' },
            name: { type: 'string', example: 'Rachel' },
            category: { type: 'string', example: 'professional' },
            description: { type: 'string', example: 'A warm, expressive voice' },
            preview_url: { type: 'string', example: 'https://storage.googleapis.com/...' }
          }
        },
        message: { type: 'string', example: 'Voice details retrieved successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async getVoice(@Param('voiceId') voiceId: string) {
    const voice = await this.voiceService.getVoice(voiceId);
    
    return {
      success: true,
      data: voice,
      message: 'Voice details retrieved successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('generate-script-audio')
  @ApiOperation({ 
    summary: 'Generate audio files for script scenes', 
    description: 'Generate audio files for all voiceover lines in a video script using the selected ElevenLabs voice' 
  })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        voiceId: { type: 'string', example: '21m00Tcm4TlvDq8ikWAM', description: 'ElevenLabs voice ID' },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sceneNumber: { type: 'number', example: 1 },
              voiceover: { type: 'string', example: 'Welcome to our video' },
              timeRange: { type: 'string', example: '0-5s' }
            }
          }
        },
        userId: { type: 'string', example: 'user_123', description: 'User ID (optional, extracted from JWT if not provided)' },
        projectId: { type: 'string', example: 'project_123', description: 'Project ID' },
        model_id: { type: 'string', example: 'eleven_multilingual_v2', description: 'ElevenLabs model ID' },
        output_format: { type: 'string', example: 'mp3_44100_128', description: 'Output audio format' }
      },
      required: ['voiceId', 'scenes', 'projectId']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Audio files generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sceneNumber: { type: 'number', example: 1 },
              filePath: { type: 'string', example: '/uploads/audio/user_123/scene_1_project_123.mp3' },
              localUrl: { type: 'string', example: '/uploads/audio/user_123/scene_1_project_123.mp3' },
              voiceover: { type: 'string', example: 'Welcome to our video' }
            }
          }
        },
        message: { type: 'string', example: 'Audio files generated successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' }
      }
    }
  })
  async generateScriptAudio(
    @Body() body: {
      voiceId: string;
      scenes: Array<{ sceneNumber: number; voiceover: string; timeRange?: string }>;
      userId?: string;
      projectId: string;
      model_id?: string;
      output_format?: string;
    },
    @Request() req: any,
  ) {
    // Extract userId from JWT token if not provided
    let userId = body.userId || this.extractUserIdFromToken(req);
    
    if (!userId) {
      throw new HttpException(
        {
          success: false,
          message: 'User ID is required. Please login again.',
          error: 'Authentication failed',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const audioFiles = await this.voiceService.generateScriptAudio(
      body.voiceId,
      body.scenes,
      userId,
      body.projectId,
      {
        model_id: body.model_id,
        output_format: body.output_format,
      }
    );

    return {
      success: true,
      data: audioFiles,
      message: 'Audio files generated successfully',
      timestamp: new Date().toISOString(),
    };
  }
}

