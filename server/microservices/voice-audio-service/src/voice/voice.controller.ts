import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Request,
  HttpException,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Multer } from 'multer';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
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
    description: 'Create a voice clone from audio sample. Upload an audio file to clone the voice for use in video generation.',
  })
  @ApiBearerAuth('JWT-auth')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'John Doe Voice', description: 'Name for the cloned voice' },
        audioFile: { type: 'string', format: 'binary', description: 'Audio file (MP3, WAV, M4A, WEBM) to clone voice from' },
        description: { type: 'string', example: 'Professional male voice for video narration', description: 'Optional description' },
        labels: { type: 'string', example: '{"style":"professional"}', description: 'Serialized labels JSON (optional)' },
        removeBackgroundNoise: { type: 'boolean', example: false, description: 'Remove background noise from sample (optional)' },
      },
      required: ['name', 'audioFile'],
    },
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
            requiresVerification: { type: 'boolean', example: false },
          },
        },
        message: { type: 'string', example: 'Voice cloned successfully' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid audio file or missing parameters',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Invalid audio file format. Supported formats: MP3, WAV, M4A, WEBM' },
        error: { type: 'string', example: 'Bad Request' },
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' },
      },
    },
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
        timestamp: { type: 'string', example: '2024-11-02T03:55:00.000Z' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('audioFile', {
      storage: memoryStorage(),
      limits: {
        fileSize: 15 * 1024 * 1024, // 15MB limit
      },
    }),
  )
  async cloneVoice(
    @Request() req: any,
    @UploadedFile() audioFile: Multer.File,
    @Body()
    body: {
      name?: string;
      description?: string;
      labels?: string;
      removeBackgroundNoise?: string | boolean;
    },
  ) {
    const userId = this.extractUserIdFromToken(req);
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

    if (!body?.name || !body.name.trim()) {
      throw new HttpException(
        {
          success: false,
          message: 'Voice name is required',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!audioFile) {
      throw new HttpException(
        {
          success: false,
          message: 'Audio file is required',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const allowedMimeTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/webm',
      'audio/ogg',
      'audio/m4a',
      'audio/x-m4a',
    ];

    if (!allowedMimeTypes.includes(audioFile.mimetype)) {
      throw new HttpException(
        {
          success: false,
          message: 'Invalid audio file format. Supported formats: MP3, WAV, M4A, WEBM, OGG',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    let storedSample;
    try {
      console.log(`[VoiceController] Starting voice clone for user ${userId}, name: ${body.name}`);
      console.log(`[VoiceController] Received audio file: ${audioFile.originalname}, size: ${audioFile.size} bytes, mimetype: ${audioFile.mimetype}`);

      storedSample = await this.voiceService.storeCloneAudioSample(
        userId,
        audioFile,
        body.name,
      );

      // Validate stored sample before sending to ElevenLabs
      if (!storedSample || !storedSample.buffer || storedSample.buffer.length === 0) {
        throw new Error('Stored audio sample is invalid or empty');
      }

      console.log(`[VoiceController] Audio sample stored successfully: ${storedSample.filename}, size: ${storedSample.buffer.length} bytes`);
      console.log(`[VoiceController] Calling ElevenLabs API to clone voice...`);

      const result = await this.voiceService.cloneVoice(
        body.name.trim(),
        [
          {
            buffer: storedSample.buffer,
            filename: storedSample.filename,
            mimetype: storedSample.mimetype,
          },
        ],
        userId,
        {
          description: body.description,
          labels: body.labels,
          remove_background_noise:
            typeof body.removeBackgroundNoise === 'string'
              ? body.removeBackgroundNoise === 'true'
              : !!body.removeBackgroundNoise,
        },
      );

      // Log full result for debugging
      console.log(`[VoiceController] Voice cloning result:`, JSON.stringify(result, null, 2));

      // Validate result before proceeding
      if (!result || !result.voice_id) {
        throw new Error(`Voice cloning failed: Invalid response from ElevenLabs. voice_id is missing. Response: ${JSON.stringify(result)}`);
      }

      console.log(`[VoiceController] Voice cloned successfully: ${result.voice_id}, requires_verification: ${result.requires_verification}`);

      return {
        success: true,
        data: {
          voiceId: result.voice_id,
          requiresVerification: result.requires_verification ?? false,
          sampleUrl: storedSample.localUrl,
        },
        message: 'Voice cloned successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error(`[VoiceController] Voice cloning error:`, {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });

      // Determine appropriate HTTP status code based on error type
      let httpStatus = HttpStatus.BAD_GATEWAY;
      if (error.message?.includes('Invalid API key') || error.message?.includes('Unauthorized')) {
        httpStatus = HttpStatus.UNAUTHORIZED;
      } else if (error.message?.includes('validation failed') || error.message?.includes('Invalid')) {
        httpStatus = HttpStatus.BAD_REQUEST;
      } else if (error.message?.includes('rate limit')) {
        httpStatus = HttpStatus.TOO_MANY_REQUESTS;
      }

      throw new HttpException(
        {
          success: false,
          message: error.message || 'Failed to clone voice',
          error: 'Voice cloning failed',
          timestamp: new Date().toISOString(),
        },
        httpStatus,
      );
    }
  }

  @Get('voices')
  @ApiOperation({ 
    summary: 'List ElevenLabs voices', 
    description: 'Get list of all available voices from ElevenLabs library. Can filter by search term, category, or language.' 
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
    @Query('language') language?: 'english' | 'hindi' | 'hinglish',
  ) {
    const voices = await this.voiceService.getVoices({
      search,
      category,
      pageSize: pageSize || 100,
      language,
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
      language?: 'english' | 'hindi' | 'hinglish';
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
        language: body.language,
      }
    );

    return {
      success: true,
      data: audioFiles,
      message: 'Audio files generated successfully',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('process-last-scene-audio')
  @ApiOperation({
    summary: 'Process last scene manual audio',
    description: 'Download manual audio from URL, apply padding and fade-out (same as AI path), re-upload and return URLs.',
  })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audioUrl: { type: 'string', description: 'Public URL of the audio file' },
        userId: { type: 'string', description: 'User ID' },
        projectId: { type: 'string', description: 'Project ID' },
        sceneNumber: { type: 'number', description: 'Scene number' },
      },
      required: ['audioUrl', 'userId', 'projectId', 'sceneNumber'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Audio processed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            publicUrl: { type: 'string' },
            gcsUrl: { type: 'string' },
            duration: { type: 'number' },
          },
        },
      },
    },
  })
  async processLastSceneAudio(
    @Body() body: { audioUrl: string; userId: string; projectId: string; sceneNumber: number },
    @Request() req: any,
  ) {
    const userId = body.userId || this.extractUserIdFromToken(req);
    if (!userId) {
      throw new HttpException(
        { success: false, message: 'User ID is required', error: 'Authentication failed' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!body.audioUrl || !body.projectId || body.sceneNumber == null) {
      throw new HttpException(
        { success: false, message: 'audioUrl, projectId and sceneNumber are required', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.voiceService.processLastSceneAudio(
      body.audioUrl,
      userId,
      body.projectId,
      body.sceneNumber,
    );

    return {
      success: true,
      data: result,
      message: 'Last scene audio processed successfully',
      timestamp: new Date().toISOString(),
    };
  }
}

