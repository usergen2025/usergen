import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { ScriptsService, ScriptGenerationRequest, VideoScriptGenerationRequest, SceneRegenerationRequest } from './scripts.service';

@ApiTags('scripts')
@Controller('scripts')
export class ScriptsController {
  constructor(private readonly scriptsService: ScriptsService) {}

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
        videoStyle: { type: 'string', enum: ['HALF_N_HALF', 'ALTERNATE', 'AVATAR_CUTOUT'], example: 'HALF_N_HALF', description: 'Video style/format' },
        duration: { type: 'string', example: '30 seconds', description: 'Desired video duration' },
        projectId: { type: 'string', example: 'cmhj8oa2p00004v3uh68khd1r', description: 'Video project ID (optional)' }
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
  async generateVideoScript(@Body() request: VideoScriptGenerationRequest) {
    const result = await this.scriptsService.generateVideoScript(request);
    return {
      success: true,
      data: result,
      message: 'Video script generated successfully',
      timestamp: new Date().toISOString(),
    };
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
        newVoiceover: { type: 'string', example: 'New voiceover text', description: 'New voiceover text (required if operation is edit)' }
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
}
