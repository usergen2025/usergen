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
  language?: 'english' | 'hindi' | 'hinglish';
  tags?: string[]; // Optional tags for visual style guidance
  projectId?: string;
}

export interface VideoScriptGenerationResponse {
  script: any; // JSON script object
  formattedScript: string; // Human-readable formatted version
  tokensUsed: number;
  processingTime: number;
  model: string;
}

export interface SceneRegenerationRequest {
  sceneNumber: number;
  videoStyle: 'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT';
  existingScript: any; // Full script for context
  originalUserPrompt: string; // Original prompt for context
  operation: 'regenerate' | 'edit';
  newVoiceover?: string; // If editing, the new voiceover text
  language?: 'english' | 'hindi' | 'hinglish';
}

export interface SceneRegenerationResponse {
  scene: any; // Updated scene object
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
      const language = request.language || 'hinglish'; // Default to hinglish if not provided
      const tags = request.tags || [];
      this.logger.log(`Generating video script for style: ${request.videoStyle}, language: ${language}, tags: ${tags.join(', ') || 'none'}, prompt: ${request.userPrompt}`, 'ScriptsService');

      if (!this.openai) {
        throw new Error('OpenAI API key is not configured');
      }

      // Get the system prompt based on video style, language, and tags
      const systemPrompt = this.getSystemPromptForStyle(request.videoStyle, language, tags);
      
      // Build user prompt with duration
      const duration = request.duration || '30 seconds';
      const userPrompt = `Create a video script for the following topic/idea: "${request.userPrompt}". Duration: ${duration}. Return the response as a JSON object.`;

      // Call OpenAI API
      // Note: response_format: json_object requires gpt-4-turbo, gpt-4o, or gpt-3.5-turbo
      const completion = await this.openai.chat.completions.create({
        model: this.configService.get<string>('OPENAI_MODEL_GPT4', 'gpt-4-turbo'),
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
      let scriptData = JSON.parse(responseContent);

      // Validate scene count matches duration
      const sceneCountValidation = this.validateSceneCountForDuration(scriptData, duration);
      if (!sceneCountValidation.valid) {
        this.logger.warn(`Scene count validation: ${sceneCountValidation.issues.join(', ')}`, 'ScriptsService');
        // Log warning but don't fail - AI should fix this, but we log for monitoring
      }

      // Normalize prompts to ensure visual consistency
      scriptData = this.normalizePrompts(scriptData);

      // Validate prompt consistency
      const validation = this.validatePromptConsistency(scriptData);
      if (!validation.valid) {
        this.logger.warn(`Prompt consistency issues detected: ${validation.issues.join(', ')}`, 'ScriptsService');
        // Log but don't fail - normalization should have fixed most issues
      }

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
   * Regenerate or edit a single scene using chat-based approach
   * Uses conversation history to maintain context and follow same guidelines
   */
  async regenerateOrEditScene(request: SceneRegenerationRequest): Promise<SceneRegenerationResponse> {
    const startTime = Date.now();
    
    try {
      const language = request.language || 'hinglish'; // Default to hinglish if not provided
      this.logger.log(`Regenerating/editing scene ${request.sceneNumber} for style: ${request.videoStyle}, language: ${language}`, 'ScriptsService');

      if (!this.openai) {
        throw new Error('OpenAI API key is not configured');
      }

      // Get system prompt (same as script generation to maintain consistency)
      const systemPrompt = this.getSystemPromptForStyle(request.videoStyle, language);
      
      // Build conversation history for context
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
        { 
          role: 'user', 
          content: `Create a video script for the following topic/idea: "${request.originalUserPrompt}". Return the response as a valid JSON object.`
        },
        {
          role: 'assistant',
          content: JSON.stringify(request.existingScript) // Existing script as context
        }
      ];
      
      // Build the user's request based on operation type
      let userRequest: string;
      if (request.operation === 'edit' && request.newVoiceover) {
        // Extract visual style guide from existing script to maintain consistency
        const visualStyleGuide = request.existingScript?.visual_style_guide;
        const styleGuidance = visualStyleGuide 
          ? `CRITICAL: Maintain the EXACT same visual style parameters in broll_image_prompt and broll_video_prompt from the visual_style_guide. Use format: "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description]".`
          : '';
        
        userRequest = `Update Scene ${request.sceneNumber} with the following voiceover: "${request.newVoiceover}". Keep all other fields (broll_visual_description, broll_image_prompt, broll_video_prompt, avatar_action, avatar_motion, avatar_cutout_position, etc.) consistent with the video style "${request.videoStyle}" and the scene's context. ${styleGuidance} Return ONLY the updated scene object as JSON, following the exact same structure as the existing scenes. Ensure the scene_number is ${request.sceneNumber}.`;
      } else {
        // Regenerate operation
        // Extract visual style guide from existing script to maintain consistency
        const visualStyleGuide = request.existingScript?.visual_style_guide;
        const styleGuidance = visualStyleGuide 
          ? `CRITICAL: Use the EXACT same visual style parameters from the visual_style_guide: Color palette: "${visualStyleGuide.color_palette || visualStyleGuide.colorPalette}", Lighting: "${visualStyleGuide.lighting}", Mood: "${visualStyleGuide.mood}", Camera: "${visualStyleGuide.camera_style || visualStyleGuide.cameraStyle}", Time: "${visualStyleGuide.time_of_day || visualStyleGuide.timeOfDay}", Tone: "${visualStyleGuide.visual_tone || visualStyleGuide.visualTone}". These MUST appear in broll_image_prompt and broll_video_prompt in the format: "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description]".`
          : '';
        
        userRequest = `Regenerate Scene ${request.sceneNumber} with new creative content. Keep it consistent with the overall video theme: "${request.originalUserPrompt}" and the video style "${request.videoStyle}". ${styleGuidance} Return ONLY the updated scene object as JSON, following the exact same structure as the existing scenes. Include all required fields: scene_number (must be ${request.sceneNumber}), time_range, voiceover, broll_visual_description, broll_image_prompt, broll_video_prompt, avatar_action, and avatar_motion (if applicable). For ALTERNATE style, include the 'type' field. For AVATAR_CUTOUT style, include 'avatar_cutout_position'.`;
      }
      
      messages.push({ role: 'user', content: userRequest });
      
      // Call OpenAI with conversation history
      const completion = await this.openai.chat.completions.create({
        model: this.configService.get<string>('OPENAI_MODEL_GPT4', 'gpt-4-turbo'),
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error('Empty response from OpenAI');
      }

      // Parse the scene response
      const responseData = JSON.parse(responseContent);
      
      // Extract scene from response (could be direct scene object or wrapped)
      let sceneData: any;
      if (responseData.scene) {
        sceneData = responseData.scene;
      } else if (responseData.scene_number || responseData.sceneNumber) {
        sceneData = responseData; // Response is the scene itself
      } else {
        // Try to find scene in scenes array
        const scenes = responseData.scenes || responseData.scene_plan || [];
        sceneData = scenes.find((s: any) => 
          (s.scene_number || s.sceneNumber) === request.sceneNumber
        ) || scenes[0] || responseData;
      }
      
      // Ensure scene_number is set correctly
      if (!sceneData.scene_number && !sceneData.sceneNumber) {
        sceneData.scene_number = request.sceneNumber;
      } else if (sceneData.sceneNumber && !sceneData.scene_number) {
        sceneData.scene_number = sceneData.sceneNumber;
      }

      // Normalize prompts to ensure consistency with existing script's visual style
      if (request.existingScript && request.existingScript.visual_style_guide) {
        const styleParams = this.extractStyleParameters(request.existingScript.visual_style_guide);
        if (styleParams && styleParams.colorPalette) {
          const stylePrefix = this.buildStylePrefix(styleParams);
          
          // Only process if this is a b-roll scene (for ALTERNATE style)
          const isBrollScene = request.existingScript.video_type !== 'Alternating' || sceneData.type === 'b-roll';
          
          if (isBrollScene) {
            // Normalize image prompt
            if (sceneData.broll_image_prompt) {
              if (!this.hasStyleParameters(sceneData.broll_image_prompt)) {
                const sceneSpecific = this.extractSceneSpecific(sceneData.broll_image_prompt) || sceneData.broll_visual_description || 'Indian context scene';
                sceneData.broll_image_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific}]`;
              } else {
                // Ensure style parameters match the guide
                const sceneSpecific = this.extractSceneSpecific(sceneData.broll_image_prompt) || sceneData.broll_visual_description || 'Indian context scene';
                sceneData.broll_image_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific}]`;
              }
            }

            // Normalize video prompt
            if (sceneData.broll_video_prompt) {
              if (!this.hasStyleParameters(sceneData.broll_video_prompt)) {
                const sceneSpecific = this.extractSceneSpecific(sceneData.broll_video_prompt) || sceneData.broll_visual_description || 'Indian context scene with motion';
                sceneData.broll_video_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific} with dynamic movement and cinematic motion]`;
              } else {
                // Ensure style parameters match the guide
                const sceneSpecific = this.extractSceneSpecific(sceneData.broll_video_prompt) || sceneData.broll_visual_description || 'Indian context scene with motion';
                sceneData.broll_video_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific} with dynamic movement and cinematic motion]`;
              }
            }
          }
        }
      }

      const processingTime = Date.now() - startTime;
      const tokensUsed = completion.usage?.total_tokens || 0;

      this.logger.log(`Scene ${request.sceneNumber} regenerated/edited successfully in ${processingTime}ms`, 'ScriptsService');

      return {
        scene: sceneData,
        tokensUsed,
        processingTime,
        model: completion.model || 'gpt-4-turbo',
      };
    } catch (error: any) {
      this.logger.error(`Scene regeneration/editing failed: ${error.message}`, error.stack, 'ScriptsService');
      throw error;
    }
  }

  /**
   * Process tags to generate visual style guidance
   */
  private processTagsForVisualStyle(tags: string[]): {
    colorPalette?: string;
    lighting?: string;
    mood?: string;
    visualTone?: string;
    cameraStyle?: string;
    timeOfDay?: string;
    recurringElements?: string;
  } {
    if (!tags || tags.length === 0) {
      return {};
    }

    // Tag mapping dictionary
    const tagMappings: Record<string, {
      colorPalette?: string;
      lighting?: string;
      mood?: string;
      visualTone?: string;
      cameraStyle?: string;
      timeOfDay?: string;
      recurringElements?: string;
    }> = {
      // Industry tags
      'technology': {
        colorPalette: 'Modern blues, sleek grays, electric accents',
        lighting: 'Clean, bright, tech-focused lighting',
        mood: 'Innovative, forward-thinking, cutting-edge',
        visualTone: 'Sleek, modern, high-tech aesthetic',
        cameraStyle: 'Smooth, professional, tech-focused',
        recurringElements: 'Modern tech environments, sleek interfaces, digital elements'
      },
      'healthcare': {
        colorPalette: 'Clean whites, calming blues, medical greens',
        lighting: 'Soft, clean, clinical lighting',
        mood: 'Trustworthy, caring, professional',
        visualTone: 'Clean, medical, trustworthy aesthetic',
        cameraStyle: 'Steady, professional, clinical',
        recurringElements: 'Medical facilities, healthcare professionals, clean environments'
      },
      'food': {
        colorPalette: 'Warm oranges, rich reds, appetizing yellows',
        lighting: 'Warm, inviting, appetizing lighting',
        mood: 'Comforting, delicious, vibrant',
        visualTone: 'Appetizing, warm, inviting atmosphere',
        cameraStyle: 'Close-up, food-focused, appetizing angles',
        recurringElements: 'Delicious food presentations, warm kitchen environments'
      },
      'education': {
        colorPalette: 'Bright, engaging colors, academic blues',
        lighting: 'Bright, clear, educational lighting',
        mood: 'Inspiring, educational, engaging',
        visualTone: 'Academic, clear, informative',
        cameraStyle: 'Clear, educational, informative',
        recurringElements: 'Classrooms, students, learning environments'
      },
      'finance': {
        colorPalette: 'Professional blues, trustworthy grays, gold accents',
        lighting: 'Professional, polished, trustworthy lighting',
        mood: 'Trustworthy, professional, secure',
        visualTone: 'Corporate, professional, trustworthy',
        cameraStyle: 'Professional, steady, corporate',
        recurringElements: 'Financial institutions, professional settings, charts and graphs'
      },
      'retail': {
        colorPalette: 'Vibrant colors, appealing tones',
        lighting: 'Bright, appealing, commercial lighting',
        mood: 'Appealing, commercial, engaging',
        visualTone: 'Commercial, appealing, vibrant',
        cameraStyle: 'Product-focused, commercial, appealing',
        recurringElements: 'Retail spaces, products, shopping environments'
      },
      'fashion': {
        colorPalette: 'Trendy colors, fashion-forward palette',
        lighting: 'Stylish, fashion-forward lighting',
        mood: 'Trendy, stylish, fashionable',
        visualTone: 'Fashion-forward, trendy, stylish',
        cameraStyle: 'Stylish, fashion-focused, editorial',
        recurringElements: 'Fashion items, stylish settings, trend-focused visuals'
      },
      'travel': {
        colorPalette: 'Vibrant destination colors, scenic tones',
        lighting: 'Natural, scenic, destination lighting',
        mood: 'Adventurous, inspiring, exciting',
        visualTone: 'Scenic, adventurous, destination-focused',
        cameraStyle: 'Wide, scenic, travel-focused',
        recurringElements: 'Destinations, travel scenes, scenic locations'
      },
      // Mood tags
      'professional': {
        colorPalette: 'Corporate blues, neutral grays, sophisticated tones',
        lighting: 'Polished, professional, well-lit',
        mood: 'Serious, trustworthy, business-focused',
        visualTone: 'Corporate, polished, executive style',
        cameraStyle: 'Professional, steady, corporate',
      },
      'casual': {
        colorPalette: 'Relaxed earth tones, soft pastels',
        lighting: 'Natural, relaxed, comfortable',
        mood: 'Friendly, approachable, laid-back',
        visualTone: 'Relaxed, informal, approachable',
        cameraStyle: 'Natural, relaxed, casual',
      },
      'energetic': {
        colorPalette: 'Vibrant colors, bold contrasts',
        lighting: 'Dynamic, bright, high-energy',
        mood: 'Exciting, fast-paced, enthusiastic',
        visualTone: 'Dynamic, vibrant, high-energy',
        cameraStyle: 'Dynamic, fast-paced, energetic',
      },
      'calm': {
        colorPalette: 'Soft, soothing colors, muted tones',
        lighting: 'Soft, gentle, calming',
        mood: 'Peaceful, relaxing, serene',
        visualTone: 'Calm, peaceful, serene',
        cameraStyle: 'Slow, gentle, peaceful',
      },
      'playful': {
        colorPalette: 'Bright, fun colors, playful tones',
        lighting: 'Bright, fun, playful',
        mood: 'Fun, lighthearted, playful',
        visualTone: 'Playful, fun, lighthearted',
        cameraStyle: 'Dynamic, fun, playful',
      },
      'serious': {
        colorPalette: 'Muted, serious tones, professional colors',
        lighting: 'Serious, focused, professional',
        mood: 'Serious, focused, professional',
        visualTone: 'Serious, professional, focused',
        cameraStyle: 'Steady, serious, focused',
      },
      'inspiring': {
        colorPalette: 'Uplifting colors, inspiring tones',
        lighting: 'Bright, uplifting, inspiring',
        mood: 'Inspiring, uplifting, motivational',
        visualTone: 'Inspiring, uplifting, motivational',
        cameraStyle: 'Elevated, inspiring, motivational',
      },
      // Style tags
      'modern': {
        colorPalette: 'Contemporary colors, minimalist palette',
        lighting: 'Clean, modern, minimalist',
        mood: 'Contemporary, sleek, cutting-edge',
        visualTone: 'Modern, minimalist, contemporary',
        cameraStyle: 'Sleek, modern, contemporary',
      },
      'classic': {
        colorPalette: 'Timeless colors, traditional tones',
        lighting: 'Warm, traditional, timeless',
        mood: 'Elegant, timeless, refined',
        visualTone: 'Classic, elegant, traditional',
        cameraStyle: 'Traditional, elegant, timeless',
      },
      'minimalist': {
        colorPalette: 'Simple, clean colors, minimal palette',
        lighting: 'Clean, simple, minimal',
        mood: 'Clean, simple, focused',
        visualTone: 'Minimalist, clean, simple',
        cameraStyle: 'Simple, clean, minimal',
      },
      'vibrant': {
        colorPalette: 'Bold, vibrant colors, high contrast',
        lighting: 'Bright, vibrant, high-energy',
        mood: 'Vibrant, energetic, bold',
        visualTone: 'Vibrant, bold, energetic',
        cameraStyle: 'Dynamic, vibrant, bold',
      },
      'elegant': {
        colorPalette: 'Sophisticated colors, refined tones',
        lighting: 'Sophisticated, refined, elegant',
        mood: 'Elegant, sophisticated, refined',
        visualTone: 'Elegant, sophisticated, refined',
        cameraStyle: 'Refined, elegant, sophisticated',
      },
      'bold': {
        colorPalette: 'Strong colors, high contrast',
        lighting: 'Strong, bold, impactful',
        mood: 'Bold, strong, impactful',
        visualTone: 'Bold, strong, impactful',
        cameraStyle: 'Strong, bold, impactful',
      },
    };

    // Categorize tags
    const industryTags = tags.filter(t => 
      ['technology', 'healthcare', 'education', 'finance', 'retail', 'food', 'fashion', 'travel', 'real-estate', 'automotive', 'entertainment', 'sports'].includes(t.toLowerCase())
    );
    const moodTags = tags.filter(t => 
      ['professional', 'casual', 'energetic', 'calm', 'playful', 'serious', 'inspiring', 'educational', 'entertaining', 'friendly', 'trustworthy'].includes(t.toLowerCase())
    );
    const styleTags = tags.filter(t => 
      ['modern', 'classic', 'minimalist', 'vibrant', 'elegant', 'bold', 'subtle', 'trendy', 'traditional'].includes(t.toLowerCase())
    );

    // Combine guidance with priority: Industry > Mood > Style
    const guidance: any = {};
    
    // Start with industry tag (highest priority)
    if (industryTags.length > 0) {
      const industryGuidance = tagMappings[industryTags[0].toLowerCase()];
      if (industryGuidance) {
        Object.assign(guidance, industryGuidance);
      }
    }
    
    // Overlay mood tags
    if (moodTags.length > 0) {
      const moodGuidance = tagMappings[moodTags[0].toLowerCase()];
      if (moodGuidance) {
        // Merge mood, but keep industry color palette and visual tone if set
        if (moodGuidance.mood) guidance.mood = moodGuidance.mood;
        if (moodGuidance.lighting && !guidance.lighting) guidance.lighting = moodGuidance.lighting;
        if (moodGuidance.cameraStyle && !guidance.cameraStyle) guidance.cameraStyle = moodGuidance.cameraStyle;
      }
    }
    
    // Overlay style tags
    if (styleTags.length > 0) {
      const styleGuidance = tagMappings[styleTags[0].toLowerCase()];
      if (styleGuidance) {
        // Merge style, but prioritize industry/mood for mood and visual tone
        if (styleGuidance.visualTone && !guidance.visualTone) guidance.visualTone = styleGuidance.visualTone;
        if (styleGuidance.colorPalette && !guidance.colorPalette) guidance.colorPalette = styleGuidance.colorPalette;
        if (styleGuidance.lighting && !guidance.lighting) guidance.lighting = styleGuidance.lighting;
        if (styleGuidance.cameraStyle && !guidance.cameraStyle) guidance.cameraStyle = styleGuidance.cameraStyle;
      }
    }

    return guidance;
  }

  /**
   * Build tag enhancement section for system prompt
   */
  private buildTagEnhancementSection(tags: string[], guidance: any): string {
    if (!tags || tags.length === 0 || Object.keys(guidance).length === 0) {
      return '';
    }

    const guidanceParts: string[] = [];
    if (guidance.colorPalette) guidanceParts.push(`- Color Palette: ${guidance.colorPalette}`);
    if (guidance.lighting) guidanceParts.push(`- Lighting: ${guidance.lighting}`);
    if (guidance.mood) guidanceParts.push(`- Mood: ${guidance.mood}`);
    if (guidance.visualTone) guidanceParts.push(`- Visual Tone: ${guidance.visualTone}`);
    if (guidance.cameraStyle) guidanceParts.push(`- Camera Style: ${guidance.cameraStyle}`);
    if (guidance.timeOfDay) guidanceParts.push(`- Time of Day: ${guidance.timeOfDay}`);
    if (guidance.recurringElements) guidanceParts.push(`- Recurring Elements: ${guidance.recurringElements}`);

    return `
ADDITIONAL CONTEXT FROM USER TAGS:
The user has provided the following tags to guide the visual style: ${tags.join(', ')}

These tags indicate specific preferences for the video's visual aesthetic:
${guidanceParts.join('\n')}

CRITICAL: When creating the visual_style_guide, you MUST incorporate these tag-based preferences. The visual_style_guide should reflect:
1. The industry/theme indicated by the tags (if any industry tags are present)
2. The mood and atmosphere indicated by mood tags
3. The visual style indicated by style tags

If multiple tags are provided, prioritize industry tags for color palette and visual tone, mood tags for atmosphere, and style tags for overall aesthetic.

The visual_style_guide you create should be a synthesis of these tag preferences while still being appropriate for the content topic.`;
  }

  /**
   * Get system prompt based on video style, language, and tags
   */
  private getSystemPromptForStyle(style: string, language: 'english' | 'hindi' | 'hinglish' = 'hinglish', tags: string[] = []): string {
    // Language-specific descriptions
    const languageDescriptions = {
      'english': {
        dialogue: 'English dialogue',
        instruction: 'Voiceover must always be natural, emotional, and conversational English.',
        example: 'Conversational English dialogue here...',
        alternate: 'English dialogue or narration here...',
        cutout: 'Natural conversational English line…',
      },
      'hindi': {
        dialogue: 'Hindi dialogue',
        instruction: 'Voiceover must always be natural, emotional, and conversational Hindi.',
        example: 'Conversational Hindi dialogue here...',
        alternate: 'Hindi dialogue or narration here...',
        cutout: 'Natural conversational Hindi line…',
      },
      'hinglish': {
        dialogue: 'Hinglish dialogue (mix of Hindi and English)',
        instruction: 'Voiceover must always be natural, emotional, and conversational Hinglish (mix of Hindi and English).',
        example: 'Conversational Hinglish dialogue here...',
        alternate: 'Hinglish dialogue or narration here...',
        cutout: 'Natural conversational Hinglish line…',
      },
    };

    const lang = languageDescriptions[language] || languageDescriptions['hinglish'];

  const prompts = {
      'HALF_N_HALF': `You are a professional video director and AI content composer who creates structured video scripts for "half-and-half" style videos, where the top half of the frame shows b-roll (visual footage related to the narration) and the bottom half shows an Indian-looking avatar delivering ${lang.dialogue}.

Your task is to produce a complete creative breakdown for a video based on a user's input topic or idea, fully adapted for an Indian audience.

CRITICAL VISUAL CONSISTENCY REQUIREMENTS:
- ALL scenes must share the SAME visual style, color palette, lighting, mood, and aesthetic
- You MUST create a "visual_style_guide" that defines consistent parameters for ALL scenes
- EVERY broll_image_prompt and broll_video_prompt MUST include the visual style guide at the beginning
- The visual style guide should specify: color palette, lighting style, mood/atmosphere, camera style, time of day, visual tone, and any recurring visual elements

Output Requirements:

Video Duration and Scene Planning (CRITICAL):
- Each scene should be 4-6 seconds long for natural pacing
- Calculate the number of scenes based on total duration:
  * For 30 seconds: Generate 5-7 scenes (approximately 5 seconds per scene)
  * For 1 minute (60 seconds): Generate 10-12 scenes (approximately 5 seconds per scene)
  * For 2 minutes (120 seconds): Generate 20-24 scenes (approximately 5 seconds per scene)
  * For custom durations: Calculate scenes by dividing total seconds by 5 (e.g., 45 seconds = 9 scenes, 90 seconds = 18 scenes)
- Ensure all scenes have proper time_range that covers the ENTIRE video duration without gaps
- Scene time ranges should not overlap and should sequentially cover the full duration
- Example: For 30 seconds, scenes should be numbered 1, 2, 3, 4, 5, 6 with time ranges like "0-5s", "5-10s", "10-15s", "15-20s", "20-25s", "25-30s"
- If user specifies a duration, calculate and generate the appropriate number of scenes accordingly
- If not specified, default to 30 seconds with 5-7 scenes

IMPORTANT: You must return your response as a valid JSON object.

Structure Your Output in This JSON Format:
{
  "video_type": "Half-and-Half",
  "duration": "30 seconds",
  "visual_style_guide": {
    "color_palette": "Describe the consistent color scheme (e.g., 'Warm oranges and yellows with vibrant Indian colors, golden hour tones')",
    "lighting": "Describe consistent lighting (e.g., 'Soft natural daylight, warm golden hour lighting')",
    "mood": "Describe the consistent mood/atmosphere (e.g., 'Energetic, vibrant, optimistic, Indian street life energy')",
    "camera_style": "Describe consistent camera approach (e.g., 'Cinematic, slightly elevated angles, smooth movements')",
    "time_of_day": "Specify consistent time (e.g., 'Golden hour evening' or 'Bright midday' or 'Morning light')",
    "visual_tone": "Describe overall visual tone (e.g., 'Modern Indian urban, vibrant street scenes, authentic local life')",
    "recurring_elements": "List any visual elements that should appear consistently (e.g., 'Indian street vendors, colorful markets, modern urban infrastructure')"
  },
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-5s",
      "voiceover": "${lang.example}",
      "broll_visual_description": "Describe Indian-context visuals — e.g., Indian streets, markets, offices, homes, festivals.",
      "broll_image_prompt": "[Color palette: warm oranges and yellows with vibrant Indian colors] [Lighting: soft natural daylight, warm golden hour] [Mood: energetic, vibrant, optimistic] [Camera: cinematic, slightly elevated angles] [Time: golden hour evening] [Tone: modern Indian urban, vibrant street scenes] [Scene-specific: bustling Indian street market with vendors and colorful stalls]",
      "broll_video_prompt": "[Color palette: warm oranges and yellows with vibrant Indian colors] [Lighting: soft natural daylight, warm golden hour] [Mood: energetic, vibrant, optimistic] [Camera: smooth panning, cinematic, slightly elevated] [Time: golden hour evening] [Tone: modern Indian urban, vibrant street scenes] [Scene-specific: bustling Indian street market with vendors, people walking, colorful stalls, dynamic movement]",
      "avatar_action": "Explain how the Indian-looking avatar speaks and reacts.",
      "avatar_motion": "Single word describing avatar's motion such as 'nod', 'smile', 'gesture'"
    },
    {
      "scene_number": 2,
      "time_range": "5-10s",
      "voiceover": "${lang.example}",
      "broll_visual_description": "Describe next Indian-context visuals",
      "broll_image_prompt": "[Color palette: warm oranges and yellows with vibrant Indian colors] [Lighting: soft natural daylight, warm golden hour] [Mood: energetic, vibrant, optimistic] [Camera: cinematic, slightly elevated angles] [Time: golden hour evening] [Tone: modern Indian urban, vibrant street scenes] [Scene-specific: different scene description]",
      "broll_video_prompt": "[Color palette: warm oranges and yellows with vibrant Indian colors] [Lighting: soft natural daylight, warm golden hour] [Mood: energetic, vibrant, optimistic] [Camera: smooth panning, cinematic, slightly elevated] [Time: golden hour evening] [Tone: modern Indian urban, vibrant street scenes] [Scene-specific: different scene description with motion]",
      "avatar_action": "Explain avatar's reaction",
      "avatar_motion": "smile"
    }
  ],
  "IMPORTANT NOTE": "You must generate MULTIPLE scenes (5-7 for 30 seconds, 10-12 for 1 minute, etc.) to cover the entire video duration. The scenes array above shows only the structure - you must create enough scenes to fill the requested duration.",
  "notes": "Transitions, color tone, and any visual guidance fitting the Indian mood. This should reference the visual_style_guide for consistency."
}

CRITICAL PROMPT GENERATION RULES:
1. FIRST, determine the visual_style_guide based on the user's topic/idea - this is the MOST IMPORTANT step
2. The visual_style_guide MUST be consistent across ALL scenes
3. EVERY broll_image_prompt MUST start with the visual style parameters in this exact format:
   "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: specific description]"
4. EVERY broll_video_prompt MUST follow the same format but include motion/action words
5. The scene-specific part should vary, but ALL style parameters (color, lighting, mood, camera, time, tone) MUST remain IDENTICAL across all scenes
6. Use the EXACT same wording for style parameters in every prompt to ensure AI image/video models generate consistent visuals
7. Extract the style parameters from visual_style_guide and use them verbatim in every prompt

Guidelines:
- All visuals should reflect Indian context unless user explicitly asks otherwise.
- ${lang.instruction}
- Maintain continuity between avatar and b-roll.
- B-roll should support, enhance, or contrast the spoken dialogue.
- Keep pacing aligned with the requested duration.
- VISUAL CONSISTENCY IS CRITICAL: All scenes must look like they belong to the same video with the same visual style.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,

      'ALTERNATE': `You are a creative director and film editor AI who creates alternating-scene style video scripts, where some scenes feature a full-screen Indian-looking avatar speaking ${lang.dialogue}, and others feature full-screen Indian-style b-roll.

Your task is to script a balanced, engaging alternating-scene video with smooth narrative continuity for an Indian audience.

CRITICAL VISUAL CONSISTENCY REQUIREMENTS:
- ALL b-roll scenes must share the SAME visual style, color palette, lighting, mood, and aesthetic
- You MUST create a "visual_style_guide" that defines consistent parameters for ALL b-roll scenes
- EVERY broll_image_prompt and broll_video_prompt for b-roll scenes MUST include the visual style guide at the beginning
- The visual style guide should specify: color palette, lighting style, mood/atmosphere, camera style, time of day, visual tone, and any recurring visual elements

IMPORTANT: You must return your response as a valid JSON object.

Video Duration and Scene Planning (CRITICAL):
- Each scene (avatar or b-roll) should be 5-7 seconds long for natural pacing
- Calculate the total number of scenes based on duration:
  * For 30 seconds: Generate 5-6 scenes total (alternating between avatar and b-roll)
  * For 1 minute (60 seconds): Generate 10-12 scenes total
  * For 2 minutes (120 seconds): Generate 20-24 scenes total
  * For custom durations: Calculate scenes by dividing total seconds by 6 (e.g., 45 seconds = 7-8 scenes, 90 seconds = 15 scenes)
- Alternate between avatar and b-roll scenes, but allow flexibility for narrative flow (multiple consecutive scenes of same type are acceptable)
- Ensure all scenes have proper time_range that covers the ENTIRE video duration without gaps
- Scene time ranges should not overlap and should sequentially cover the full duration
- Example: For 30 seconds with 5 scenes, time ranges could be "0-6s", "6-12s", "12-18s", "18-24s", "24-30s"
- If user specifies a duration, calculate and generate the appropriate number of scenes accordingly
- If not specified, default to 30 seconds with 5-6 scenes

Output Format:
{
  "video_type": "Alternating",
  "duration": "1 minute",
  "visual_style_guide": {
    "color_palette": "Describe the consistent color scheme for all b-roll scenes",
    "lighting": "Describe consistent lighting for all b-roll scenes",
    "mood": "Describe the consistent mood/atmosphere for all b-roll scenes",
    "camera_style": "Describe consistent camera approach for all b-roll scenes",
    "time_of_day": "Specify consistent time for all b-roll scenes",
    "visual_tone": "Describe overall visual tone for all b-roll scenes",
    "recurring_elements": "List any visual elements that should appear consistently"
  },
  "scene_plan": [
    {
      "scene_number": 1,
      "type": "avatar" | "b-roll",
      "time_range": "0-7s",
      "voiceover": "${lang.alternate}",
      "broll_visual_description": "If this is a b-roll scene, describe Indian visuals — markets, roads, cafes, offices, villages, festivals, etc.",
      "broll_image_prompt": "If type is b-roll: [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description]",
      "broll_video_prompt": "If type is b-roll: [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description with motion]",
      "avatar_action": "If avatar scene, describe Indian avatar's expression and delivery.",
      "avatar_motion": "If avatar scene, give a single word describing avatar's motion such as 'nod', 'smile', 'blink'"
    },
    {
      "scene_number": 2,
      "type": "b-roll",
      "time_range": "7-14s",
      "voiceover": "${lang.alternate}",
      "broll_visual_description": "Describe Indian visuals — markets, roads, cafes, offices, villages, festivals, etc.",
      "broll_image_prompt": "If type is b-roll: [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description]",
      "broll_video_prompt": "If type is b-roll: [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description with motion]",
      "avatar_action": null,
      "avatar_motion": null
    }
  ],
  "notes": {
    "transition_style": "Describe how transitions occur between avatar and Indian b-roll.",
    "music_or_mood": "Background music vibe — Indian cinematic, soft, emotional, festive, etc.",
    "visual_consistency": "Reference the visual_style_guide to ensure all b-roll scenes maintain the same visual style"
  }
}

CRITICAL PROMPT GENERATION RULES:
1. FIRST, determine the visual_style_guide based on the user's topic/idea - this is the MOST IMPORTANT step
2. The visual_style_guide MUST be consistent across ALL b-roll scenes
3. EVERY broll_image_prompt and broll_video_prompt for b-roll scenes MUST start with the visual style parameters in this exact format:
   "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: specific description]"
4. Use the EXACT same wording for style parameters in every b-roll scene prompt
5. Only the scene-specific part should vary between scenes
6. Extract the style parameters from visual_style_guide and use them verbatim in every prompt

Guidelines:
- Use ${lang.dialogue} voiceover across all scenes.
- B-roll must visually reflect Indian environments unless user specifies otherwise.
- Maintain logical narrative continuity across scenes.
- Multiple avatar or multiple b-roll scenes in a row are fine if they improve flow.
- CRITICAL: Generate enough scenes to cover the entire video duration (5-6 scenes for 30 seconds, 10-12 for 1 minute, etc.)
- Each scene should be 5-7 seconds, and the total number of scenes must cover the full duration without gaps
- VISUAL CONSISTENCY IS CRITICAL: All b-roll scenes must look like they belong to the same video with the same visual style.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,

    'AVATAR_CUTOUT': `You are a motion graphics director and AI content composer who creates cutout-style videos, where an Indian-looking avatar (green-screen cutout) appears over full-frame Indian-context b-roll.

The avatar is smaller (placed at bottom or corner) while b-roll fills the background.

CRITICAL VISUAL CONSISTENCY REQUIREMENTS:
- ALL scenes must share the SAME visual style, color palette, lighting, mood, and aesthetic for the b-roll background
- You MUST create a "visual_style_guide" that defines consistent parameters for ALL scenes
- EVERY broll_image_prompt and broll_video_prompt MUST include the visual style guide at the beginning
- The visual style guide should specify: color palette, lighting style, mood/atmosphere, camera style, time of day, visual tone, and any recurring visual elements

IMPORTANT: You must return your response as a valid JSON object.

Video Duration and Scene Planning (CRITICAL):
- Keep scenes around 4-6 seconds each for natural pacing
- Calculate the number of scenes based on total duration:
  * For 30 seconds: Generate 5-7 scenes (approximately 5 seconds per scene)
  * For 1 minute (60 seconds): Generate 10-12 scenes (approximately 5 seconds per scene)
  * For 2 minutes (120 seconds): Generate 20-24 scenes (approximately 5 seconds per scene)
  * For custom durations: Calculate scenes by dividing total seconds by 5 (e.g., 45 seconds = 9 scenes, 90 seconds = 18 scenes)
- Ensure all scenes have proper time_range that covers the ENTIRE video duration without gaps
- Scene time ranges should not overlap and should sequentially cover the full duration
- Example: For 30 seconds, scenes should be numbered 1, 2, 3, 4, 5, 6 with time ranges like "0-5s", "5-10s", "10-15s", "15-20s", "20-25s", "25-30s"
- If user specifies duration, adjust number and lengths of scenes accordingly; otherwise default to 30 seconds with 5-7 scenes

Output Format:
{
  "video_type": "Cutout Overlay",
  "duration": "30 seconds",
  "visual_style_guide": {
    "color_palette": "Describe the consistent color scheme for all b-roll backgrounds",
    "lighting": "Describe consistent lighting for all b-roll backgrounds",
    "mood": "Describe the consistent mood/atmosphere for all b-roll backgrounds",
    "camera_style": "Describe consistent camera approach for all b-roll backgrounds",
    "time_of_day": "Specify consistent time for all b-roll backgrounds",
    "visual_tone": "Describe overall visual tone for all b-roll backgrounds",
    "recurring_elements": "List any visual elements that should appear consistently in backgrounds"
  },
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-5s",
      "voiceover": "${lang.cutout}",
      "broll_visual_description": "Describe Indian environment — cafes, offices, markets, metro, festivals, streets, villages.",
      "broll_image_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description]",
      "broll_video_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description with motion]",
      "avatar_cutout_position": "bottom-left" | "bottom-right" | "center" | etc.,
      "avatar_action": "Describe Indian avatar gestures, expressions, tone.",
      "avatar_motion": "Single word describing avatar's motion such as 'nod', 'raise-hand', 'smile'"
    },
    {
      "scene_number": 2,
      "time_range": "5-10s",
      "voiceover": "${lang.cutout}",
      "broll_visual_description": "Describe next Indian environment",
      "broll_image_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: different description]",
      "broll_video_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: different description with motion]",
      "avatar_cutout_position": "bottom-left",
      "avatar_action": "Describe avatar gestures",
      "avatar_motion": "smile"
    }
  ],
  "IMPORTANT NOTE": "You must generate MULTIPLE scenes (5-7 for 30 seconds, 10-12 for 1 minute, etc.) to cover the entire video duration. The scenes array above shows only the structure - you must create enough scenes to fill the requested duration.",
  "notes": {
    "overlay_style": "Soft edges, light blending, realistic shadows; match Indian lighting.",
    "color_tone": "Warm, cinematic, vibrant Indian aesthetic.",
    "visual_consistency": "Reference the visual_style_guide to ensure all b-roll backgrounds maintain the same visual style"
  }
}

CRITICAL PROMPT GENERATION RULES:
1. FIRST, determine the visual_style_guide based on the user's topic/idea - this is the MOST IMPORTANT step
2. The visual_style_guide MUST be consistent across ALL scenes
3. EVERY broll_image_prompt and broll_video_prompt MUST start with the visual style parameters in this exact format:
   "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: specific description]"
4. Use the EXACT same wording for style parameters in every prompt
5. Only the scene-specific part should vary between scenes
6. Extract the style parameters from visual_style_guide and use them verbatim in every prompt

Guidelines:
- ${lang.instruction} - this is CRITICAL.
- Avatar must always be visible and should appear Indian.
- B-roll must reflect Indian context unless user says otherwise.
- Keep scenes around 4-6 seconds each for natural pacing.
- CRITICAL: Generate enough scenes to cover the entire video duration (5-7 scenes for 30 seconds, 10-12 for 1 minute, etc.)
- Each scene should be 4-6 seconds, and the total number of scenes must cover the full duration without gaps
- Maintain consistency in avatar position and lighting.
- VISUAL CONSISTENCY IS CRITICAL: All b-roll backgrounds must look like they belong to the same video with the same visual style.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,
  };

  return prompts[style as keyof typeof prompts] || prompts['HALF_N_HALF'];
}


  /**
   * Extract visual style parameters from visual_style_guide
   */
  private extractStyleParameters(visualStyleGuide: any): {
    colorPalette: string;
    lighting: string;
    mood: string;
    cameraStyle: string;
    timeOfDay: string;
    visualTone: string;
  } | null {
    if (!visualStyleGuide || typeof visualStyleGuide !== 'object') {
      return null;
    }

    return {
      colorPalette: visualStyleGuide.color_palette || visualStyleGuide.colorPalette || '',
      lighting: visualStyleGuide.lighting || '',
      mood: visualStyleGuide.mood || '',
      cameraStyle: visualStyleGuide.camera_style || visualStyleGuide.cameraStyle || '',
      timeOfDay: visualStyleGuide.time_of_day || visualStyleGuide.timeOfDay || '',
      visualTone: visualStyleGuide.visual_tone || visualStyleGuide.visualTone || '',
    };
  }

  /**
   * Build consistent style prefix for prompts
   */
  private buildStylePrefix(styleParams: {
    colorPalette: string;
    lighting: string;
    mood: string;
    cameraStyle: string;
    timeOfDay: string;
    visualTone: string;
  }): string {
    const parts: string[] = [];
    
    if (styleParams.colorPalette) {
      parts.push(`[Color palette: ${styleParams.colorPalette}]`);
    }
    if (styleParams.lighting) {
      parts.push(`[Lighting: ${styleParams.lighting}]`);
    }
    if (styleParams.mood) {
      parts.push(`[Mood: ${styleParams.mood}]`);
    }
    if (styleParams.cameraStyle) {
      parts.push(`[Camera: ${styleParams.cameraStyle}]`);
    }
    if (styleParams.timeOfDay) {
      parts.push(`[Time: ${styleParams.timeOfDay}]`);
    }
    if (styleParams.visualTone) {
      parts.push(`[Tone: ${styleParams.visualTone}]`);
    }

    return parts.join(' ');
  }

  /**
   * Check if a prompt already has style parameters
   */
  private hasStyleParameters(prompt: string): boolean {
    if (!prompt) return false;
    const stylePattern = /\[(Color palette|Lighting|Mood|Camera|Time|Tone):/i;
    return stylePattern.test(prompt);
  }

  /**
   * Extract scene-specific content from a prompt (remove style parameters)
   */
  private extractSceneSpecific(prompt: string): string {
    if (!prompt) return '';
    
    // Remove style parameters in brackets
    let cleaned = prompt.replace(/\[(Color palette|Lighting|Mood|Camera|Time|Tone):[^\]]+\]/gi, '').trim();
    
    // Remove [Scene-specific:] prefix if present
    cleaned = cleaned.replace(/^\[Scene-specific:\s*/i, '').trim();
    
    return cleaned;
  }

  /**
   * Normalize prompts to ensure they all have consistent style parameters
   */
  private normalizePrompts(scriptData: any): any {
    if (!scriptData) return scriptData;

    // Extract visual style guide
    const visualStyleGuide = scriptData.visual_style_guide;
    const styleParams = this.extractStyleParameters(visualStyleGuide);

    if (!styleParams || !styleParams.colorPalette) {
      // If no style guide, return as-is (AI should have created it, but handle gracefully)
      this.logger.warn('No visual_style_guide found in script, skipping normalization', 'ScriptsService');
      return scriptData;
    }

    const stylePrefix = this.buildStylePrefix(styleParams);
    const scenes = scriptData.scenes || scriptData.scene_plan || [];

    // Normalize each scene's prompts
    scenes.forEach((scene: any) => {
      // Only process b-roll scenes for ALTERNATE style
      const videoType = (scriptData.video_type || '').toLowerCase();
      if (videoType === 'alternating' && scene.type !== 'b-roll') {
        return;
      }

      // Normalize image prompt
      if (scene.broll_image_prompt) {
        if (!this.hasStyleParameters(scene.broll_image_prompt)) {
          const sceneSpecific = this.extractSceneSpecific(scene.broll_image_prompt) || scene.broll_visual_description || 'Indian context scene';
          scene.broll_image_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific}]`;
        } else {
          // Ensure style parameters match the guide
          const sceneSpecific = this.extractSceneSpecific(scene.broll_image_prompt) || scene.broll_visual_description || 'Indian context scene';
          scene.broll_image_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific}]`;
        }
      }

      // Normalize video prompt
      if (scene.broll_video_prompt) {
        if (!this.hasStyleParameters(scene.broll_video_prompt)) {
          const sceneSpecific = this.extractSceneSpecific(scene.broll_video_prompt) || scene.broll_visual_description || 'Indian context scene with motion';
          scene.broll_video_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific} with dynamic movement and cinematic motion]`;
        } else {
          // Ensure style parameters match the guide
          const sceneSpecific = this.extractSceneSpecific(scene.broll_video_prompt) || scene.broll_visual_description || 'Indian context scene with motion';
          scene.broll_video_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific} with dynamic movement and cinematic motion]`;
        }
      }
    });

    return scriptData;
  }

  /**
   * Parse duration string to seconds
   */
  private parseDurationToSeconds(duration: string): number {
    if (!duration) return 30; // Default
    
    const normalized = duration.toLowerCase().trim();
    
    // Match patterns like "30 seconds", "1 minute", "2 minutes", etc.
    const secondMatch = normalized.match(/(\d+)\s*(?:second|sec)/);
    if (secondMatch) {
      return parseInt(secondMatch[1], 10);
    }
    
    const minuteMatch = normalized.match(/(\d+)\s*(?:minute|min)/);
    if (minuteMatch) {
      return parseInt(minuteMatch[1], 10) * 60;
    }
    
    // Default fallback
    return 30;
  }

  /**
   * Validate that scene count matches the requested duration
   */
  private validateSceneCountForDuration(scriptData: any, requestedDuration: string): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const scenes = scriptData.scenes || scriptData.scene_plan || [];
    
    if (scenes.length === 0) {
      issues.push('No scenes found in script');
      return { valid: false, issues };
    }

    // Parse requested duration to seconds
    const requestedSeconds = this.parseDurationToSeconds(requestedDuration);
    
    // Calculate expected scene count (5 seconds per scene for HALF_N_HALF/AVATAR_CUTOUT, 6 seconds for ALTERNATE)
    const videoType = (scriptData.video_type || '').toLowerCase();
    const secondsPerScene = videoType === 'alternating' ? 6 : 5;
    const expectedMinScenes = Math.floor(requestedSeconds / (secondsPerScene + 1)); // Slightly lower threshold
    const expectedMaxScenes = Math.ceil(requestedSeconds / (secondsPerScene - 1)); // Slightly higher threshold
    
    // For 30 seconds: expect 5-7 scenes (30/5 = 6, so range 4-8 is acceptable)
    // For 60 seconds: expect 10-12 scenes (60/5 = 12, so range 10-15 is acceptable)
    if (scenes.length < expectedMinScenes || scenes.length > expectedMaxScenes) {
      issues.push(
        `Scene count mismatch: Expected ${expectedMinScenes}-${expectedMaxScenes} scenes for ${requestedDuration} (${requestedSeconds}s), but got ${scenes.length} scenes. ` +
        `Please ensure you generate enough scenes to cover the entire video duration.`
      );
    }

    // Validate that time ranges cover the full duration
    const videoTypeFromScript = (scriptData.video_type || '').toLowerCase();
    const lastScene = scenes[scenes.length - 1];
    const lastTimeRange = lastScene?.time_range || '';
    
    if (lastTimeRange) {
      // Extract end time from last scene (e.g., "25-30s" -> 30)
      const endTimeMatch = lastTimeRange.match(/-(\d+)s?$/);
      if (endTimeMatch) {
        const lastEndTime = parseInt(endTimeMatch[1], 10);
        // Allow 1-2 seconds tolerance
        if (lastEndTime < requestedSeconds - 2) {
          issues.push(
            `Time range coverage: Last scene ends at ${lastEndTime}s, but video duration is ${requestedSeconds}s. ` +
            `Scenes should cover the entire ${requestedDuration} duration.`
          );
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Validate prompt consistency across all scenes
   */
  private validatePromptConsistency(scriptData: any): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const scenes = scriptData.scenes || scriptData.scene_plan || [];
    
    if (scenes.length === 0) {
      issues.push('No scenes found in script');
      return { valid: false, issues };
    }

    // Extract style parameters from first scene
    const videoType = (scriptData.video_type || '').toLowerCase();
    const firstScene = scenes.find((s: any) => {
      if (videoType === 'alternating') {
        return s.type === 'b-roll' && (s.broll_image_prompt || s.broll_video_prompt);
      }
      return s.broll_image_prompt || s.broll_video_prompt;
    });

    if (!firstScene) {
      issues.push('No b-roll scenes found to validate');
      return { valid: true, issues }; // Not an error, just no b-roll scenes
    }

    const firstImagePrompt = firstScene.broll_image_prompt || '';
    const firstStyleParams = this.extractStyleFromPrompt(firstImagePrompt);

    // Check all b-roll scenes
    scenes.forEach((scene: any, index: number) => {
      // Skip non-b-roll scenes for ALTERNATE style
      if (videoType === 'alternating' && scene.type !== 'b-roll') {
        return;
      }

      const sceneNum = scene.scene_number || scene.sceneNumber || (index + 1);

      if (scene.broll_image_prompt) {
        const sceneStyleParams = this.extractStyleFromPrompt(scene.broll_image_prompt);
        if (!this.compareStyleParams(firstStyleParams, sceneStyleParams)) {
          issues.push(`Scene ${sceneNum} image prompt has inconsistent style parameters`);
        }
      }

      if (scene.broll_video_prompt) {
        const sceneStyleParams = this.extractStyleFromPrompt(scene.broll_video_prompt);
        if (!this.compareStyleParams(firstStyleParams, sceneStyleParams)) {
          issues.push(`Scene ${sceneNum} video prompt has inconsistent style parameters`);
        }
      }
    });

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Extract style parameters from a prompt string
   */
  private extractStyleFromPrompt(prompt: string): Record<string, string> {
    const params: Record<string, string> = {};
    
    if (!prompt) return params;

    const patterns = {
      colorPalette: /\[Color palette:\s*([^\]]+)\]/i,
      lighting: /\[Lighting:\s*([^\]]+)\]/i,
      mood: /\[Mood:\s*([^\]]+)\]/i,
      cameraStyle: /\[Camera:\s*([^\]]+)\]/i,
      timeOfDay: /\[Time:\s*([^\]]+)\]/i,
      visualTone: /\[Tone:\s*([^\]]+)\]/i,
    };

    Object.entries(patterns).forEach(([key, pattern]) => {
      const match = prompt.match(pattern);
      if (match) {
        params[key] = match[1].trim();
      }
    });

    return params;
  }

  /**
   * Compare two style parameter objects
   */
  private compareStyleParams(params1: Record<string, string>, params2: Record<string, string>): boolean {
    const keys = ['colorPalette', 'lighting', 'mood', 'cameraStyle', 'timeOfDay', 'visualTone'];
    
    for (const key of keys) {
      const val1 = (params1[key] || '').toLowerCase().trim();
      const val2 = (params2[key] || '').toLowerCase().trim();
      
      if (val1 && val2 && val1 !== val2) {
        return false;
      }
    }

    return true;
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
      
      if (scene.avatar_motion) {
        formatted += `   🎭 Motion: ${scene.avatar_motion}\n`;
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
