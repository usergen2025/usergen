import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../common/logger/logger.service';
import OpenAI from 'openai';

export interface ScriptGenerationRequest {
  prompt: string;
  length?: 'short' | 'medium' | 'long';
  tone?: 'professional' | 'casual' | 'friendly' | 'persuasive';
  language?: string;
  includeCallToAction?: boolean;
}

export interface ScriptGenerationResponse {
  script: string;
  tokensUsed: number;
  processingTime: number;
  model: string;
}

export interface VideoScriptGenerationRequest {
  userPrompt: string;
  videoStyle: 'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT';
  duration?: string; // e.g., "30 seconds", "1 minute"
  projectId?: string;
}

export interface VideoScriptGenerationResponse {
  script: any; // JSON script object
  formattedScript: string; // Human-readable formatted version
  tokensUsed: number;
  processingTime: number;
  model: string;
}

@Injectable()
export class ScriptsService {
  private openai: OpenAI;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({
        apiKey: apiKey,
      });
    }
  }

  async generateScript(request: ScriptGenerationRequest): Promise<ScriptGenerationResponse> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`Generating script for prompt: ${request.prompt}`, 'ScriptsService');

      // TODO: Implement OpenAI integration
      // This is a placeholder for future OpenAI API integration
      const mockResponse = await this.mockOpenAICall(request);
      
      const processingTime = Date.now() - startTime;
      
      this.logger.log(`Script generated successfully in ${processingTime}ms`, 'ScriptsService');
      
      return {
        script: mockResponse.script,
        tokensUsed: mockResponse.tokensUsed,
        processingTime,
        model: 'gpt-4',
      };
    } catch (error) {
      this.logger.error(`Script generation failed: ${error.message}`, error.stack, 'ScriptsService');
      throw error;
    }
  }

  async chatWithAI(message: string, conversationHistory?: string[]): Promise<string> {
    try {
      this.logger.log(`AI chat request: ${message}`, 'ScriptsService');

      // TODO: Implement OpenAI Chat API integration
      // This is a placeholder for future OpenAI Chat API integration
      const mockResponse = await this.mockOpenAIChat(message, conversationHistory);
      
      this.logger.log(`AI chat response generated`, 'ScriptsService');
      
      return mockResponse;
    } catch (error) {
      this.logger.error(`AI chat failed: ${error.message}`, error.stack, 'ScriptsService');
      throw error;
    }
  }

  /**
   * Generate video script based on video style and user prompt
   */
  async generateVideoScript(request: VideoScriptGenerationRequest): Promise<VideoScriptGenerationResponse> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`Generating video script for style: ${request.videoStyle}, prompt: ${request.userPrompt}`, 'ScriptsService');

      if (!this.openai) {
        throw new Error('OpenAI API key is not configured');
      }

      // Get the system prompt based on video style
      const systemPrompt = this.getSystemPromptForStyle(request.videoStyle);
      
      // Build user prompt with duration
      const duration = request.duration || '30 seconds';
      const userPrompt = `Create a video script for the following topic/idea: "${request.userPrompt}". Duration: ${duration}. Return the response as a JSON object.`;

      // Call OpenAI API
      const completion = await this.openai.chat.completions.create({
        model: this.configService.get<string>('OPENAI_MODEL_GPT4', 'gpt-4.1'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error('Empty response from OpenAI');
      }

      // Parse JSON response
      const scriptData = JSON.parse(responseContent);

      // Format script for display
      const formattedScript = this.formatScriptForDisplay(scriptData);

      const processingTime = Date.now() - startTime;
      const tokensUsed = completion.usage?.total_tokens || 0;

      this.logger.log(`Video script generated successfully in ${processingTime}ms`, 'ScriptsService');

      return {
        script: scriptData,
        formattedScript,
        tokensUsed,
        processingTime,
        model: completion.model || 'gpt-4',
      };
    } catch (error: any) {
      this.logger.error(`Video script generation failed: ${error.message}`, error.stack, 'ScriptsService');
      throw error;
    }
  }

  /**
   * Get system prompt based on video style
   */
  private getSystemPromptForStyle(style: string): string {
    const prompts = {
      'HALF_N_HALF': `You are a professional video director and AI content composer who creates structured video scripts for "half-and-half" style videos, where the top half of the frame shows a b-roll (visual footage related to the narration) and the bottom half shows an avatar delivering the dialogue.

Your task is to produce a complete creative breakdown for a video based on a user's input topic or idea.

Output Requirements:

Video Duration:
- If user specifies a duration (e.g., "1 minute" or "30 seconds"), divide the script accordingly.
- If not specified, default to 30 seconds.

IMPORTANT: You must return your response as a valid JSON object.

Structure Your Output in This JSON Format:
{
  "video_type": "Half-and-Half",
  "duration": "30 seconds",
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-5s",
      "voiceover": "Voiceover line here...",
      "broll_visual_description": "Describe the scene — what should be seen in the upper half.",
      "broll_image_prompt": "Short prompt to generate a single b-roll image.",
      "broll_video_prompt": "Short prompt to generate a short video clip for the same concept.",
      "avatar_action": "Describe how the avatar speaks or reacts."
    }
  ],
  "notes": "Any special visual transitions or aesthetic guidance."
}

Guidelines:
- Maintain visual and thematic continuity between avatar speech and b-roll.
- B-roll should visually reinforce or contrast the dialogue.
- Voiceover should sound natural, emotional, and conversational.
- Keep total duration aligned with requested length.`,

      'ALTERNATE': `You are a creative director and film editor AI who creates structured video scripts for alternating-scene style videos, where some scenes feature the avatar speaking full-screen, and others feature full-screen b-roll footage.

Your task is to plan and script videos with clear scene alternation logic (not strictly 1:1), balancing narrative flow and visual engagement.

IMPORTANT: You must return your response as a valid JSON object.

Output Format:
{
  "video_type": "Alternating",
  "duration": "1 minute",
  "scene_plan": [
    {
      "scene_number": 1,
      "type": "avatar" | "b-roll",
      "time_range": "0-7s",
      "voiceover": "Voiceover dialogue here (if avatar) or narration text (if b-roll)",
      "broll_visual_description": "Only if type is b-roll — describe what's seen.",
      "broll_image_prompt": "Prompt for generating the b-roll image.",
      "broll_video_prompt": "Prompt for generating the b-roll clip.",
      "avatar_action": "If type=avatar, describe expression and delivery."
    }
  ],
  "notes": {
    "transition_style": "Describe how transitions should occur between avatar and b-roll.",
    "music_or_mood": "Describe background music or emotion to maintain."
  }
}

Guidelines:
- Alternate freely: you can have multiple avatar or b-roll scenes consecutively if it enhances flow.
- Clearly specify which scenes are avatar and which are b-roll.
- Ensure the voiceover/narrative continues logically across all scenes.
- When duration is unspecified, default to 30 seconds.
- Keep timing and pacing realistic for human speech and visual cuts.`,

      'AVATAR_CUTOUT': `You are a motion graphics director and AI video composer creating cutout-style scripts, where the avatar (without background, i.e., green-screen cutout) appears over dynamic b-roll footage.

The avatar typically occupies a small portion of the screen (bottom or corner), while the b-roll occupies the full frame behind it.

IMPORTANT: You must return your response as a valid JSON object.

Output Format:
{
  "video_type": "Cutout Overlay",
  "duration": "30 seconds",
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-6s",
      "voiceover": "Avatar dialogue line",
      "broll_visual_description": "Describe what the background video should show.",
      "broll_image_prompt": "Prompt for generating the b-roll image.",
      "broll_video_prompt": "Prompt for generating the b-roll video.",
      "avatar_cutout_position": "bottom-left" | "bottom-right" | "center" | etc.,
      "avatar_action": "Describe facial expression and gestures for realism."
    }
  ],
  "notes": {
    "overlay_style": "Describe lighting, compositing, and edge blending style for realism.",
    "color_tone": "Describe tone (warm, cinematic, documentary, etc.)."
  }
}

Guidelines:
- Avatar should always be visible but not dominate the screen.
- B-roll should match or contrast the avatar's message.
- Keep each scene 4–6 seconds on average for smooth pacing.
- Maintain consistency in avatar positioning and lighting.
- If user gives duration, adjust number and length of scenes accordingly; else default to 30 seconds.`,
    };

    return prompts[style as keyof typeof prompts] || prompts['HALF_N_HALF'];
  }

  /**
   * Format script JSON for display
   */
  private formatScriptForDisplay(scriptData: any): string {
    let formatted = '';
    
    if (scriptData.video_type) {
      formatted += `📹 Video Type: ${scriptData.video_type}\n`;
    }
    
    if (scriptData.duration) {
      formatted += `⏱️  Duration: ${scriptData.duration}\n\n`;
    }

    const scenes = scriptData.scenes || scriptData.scene_plan || [];
    
    scenes.forEach((scene: any, index: number) => {
      formatted += `🎬 Scene ${scene.scene_number || index + 1} (${scene.time_range || 'N/A'})\n`;
      
      if (scene.type) {
        formatted += `   Type: ${scene.type}\n`;
      }
      
      if (scene.voiceover) {
        formatted += `   💬 Voiceover: "${scene.voiceover}"\n`;
      }
      
      if (scene.broll_visual_description) {
        formatted += `   🎥 B-Roll: ${scene.broll_visual_description}\n`;
      }
      
      if (scene.avatar_action) {
        formatted += `   👤 Avatar: ${scene.avatar_action}\n`;
      }
      
      if (scene.avatar_cutout_position) {
        formatted += `   📍 Position: ${scene.avatar_cutout_position}\n`;
      }
      
      formatted += '\n';
    });

    if (scriptData.notes) {
      if (typeof scriptData.notes === 'string') {
        formatted += `📝 Notes: ${scriptData.notes}\n`;
      } else {
        formatted += `📝 Notes:\n`;
        Object.entries(scriptData.notes).forEach(([key, value]: [string, any]) => {
          formatted += `   ${key}: ${value}\n`;
        });
      }
    }

    return formatted;
  }

  private async mockOpenAICall(request: ScriptGenerationRequest): Promise<any> {
    // Mock response for development
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          script: `This is a mock script generated for the prompt: "${request.prompt}". In a real implementation, this would be generated by OpenAI's GPT-4 model with proper context, tone, and length based on the request parameters.`,
          tokensUsed: 150,
        });
      }, 1000);
    });
  }

  private async mockOpenAIChat(message: string, history?: string[]): Promise<string> {
    // Mock response for development
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(`This is a mock AI response to: "${message}". In a real implementation, this would be generated by OpenAI's Chat API with proper conversation context.`);
      }, 500);
    });
  }
}
