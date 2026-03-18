import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../common/logger/logger.service';
import OpenAI from 'openai';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';

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
  videoStyle: 'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT' | 'AVATAR_ONLY' | 'PRODUCT_ONLY' | 'AVATAR_PRODUCT' | 'ANIMATED_AVATAR';
  duration?: string; // e.g., "30 seconds", "1 minute"
  language?: 'english' | 'hindi' | 'hinglish';
  tags?: string[]; // Optional tags for visual style guidance
  projectId?: string;
  productImageUrl?: string; // URL of the product image uploaded by user
  hasAvatar?: boolean; // Whether an avatar is being used
  avatarId?: string; // ID of the selected avatar (if any)
  analyzedAssets?: Array<{ // Analyzed assets from project metadata (optional, will be fetched if projectId provided)
    id: string;
    category: string;
    extractedText?: string;
    productInfo?: any;
    url: string;
  }>;
  urlContentContext?: string; // Extracted content from URL assets for script context
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
  videoStyle: 'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT' | 'AVATAR_ONLY' | 'PRODUCT_ONLY' | 'AVATAR_PRODUCT' | 'ANIMATED_AVATAR';
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

/** Video styles that use an avatar and require avatar_image_prompt in the script. */
const AVATAR_VIDEO_STYLES: readonly string[] = ['HALF_N_HALF', 'ALTERNATE', 'AVATAR_CUTOUT', 'AVATAR_ONLY', 'AVATAR_PRODUCT', 'ANIMATED_AVATAR'];

@Injectable()
export class ScriptsService {
  private openai: OpenAI;
  private readonly videoProcessingServiceUrl: string;
  private readonly jwtSecret: string;
  /** Max wait in ms for asset analysis before proceeding without analysis; wait until completed/failed or this cap (ASSET_ANALYSIS_TIMEOUT_MS, default 15 min) */
  private readonly assetAnalysisTimeoutMs: number;

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
    this.videoProcessingServiceUrl = 
      this.configService.get<string>('VIDEO_PROCESSING_SERVICE_URL') || 
      this.configService.get<string>('NEXT_PUBLIC_WS_URL')?.replace('/ws', '') || 
      'http://localhost:9000';
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 
                     'SFVBJIK@67289416VYUQVDUQVCHU=BCHUDB567UJCNUEHJB.';
    const timeoutEnv = this.configService.get<string>('ASSET_ANALYSIS_TIMEOUT_MS');
    const fifteenMinutes = 15 * 60 * 1000;
    this.assetAnalysisTimeoutMs = timeoutEnv ? Math.max(10000, parseInt(timeoutEnv, 10) || fifteenMinutes) : fifteenMinutes;
  }

  /**
   * Pre-warm a URL by making a GET request to ensure it's accessible and cached
   * This helps with CDN caching and ensures the file is propagated before OpenAI tries to fetch it
   */
  private async preWarmUrl(url: string, maxAttempts = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await axios.get(url, {
          timeout: 10000, // 10 second timeout
          responseType: 'arraybuffer', // Download the full file to warm cache
          headers: {
            'User-Agent': 'UserGen-PreWarm/1.0',
          },
        });
        
        if (response.status === 200) {
          const contentLength = response.headers['content-length'] || response.data?.length || 0;
          this.logger.log(`URL pre-warmed successfully (${contentLength} bytes): ${url.substring(0, 60)}...`, 'ScriptsService');
          return true;
        }
      } catch (error: any) {
        this.logger.warn(`URL pre-warm attempt ${attempt}/${maxAttempts} failed: ${error.message}`, 'ScriptsService');
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Wait 1s, 2s, 3s
        }
      }
    }
    return false;
  }

  /**
   * Call OpenAI with retry logic specifically for vision API image fetch timeouts
   * OpenAI has an internal ~3 second timeout when fetching external images
   */
  private async callOpenAIWithRetry(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    model: string,
    useVisionAPI: boolean,
    maxRetries = 3
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const completion = await this.openai.chat.completions.create({
          model: model,
          messages: messages,
          response_format: { type: 'json_object' },
          temperature: 0.7,
          max_tokens: useVisionAPI ? 4000 : 3000,
        });
        
        if (attempt > 1) {
          this.logger.log(`OpenAI call succeeded on attempt ${attempt}`, 'ScriptsService');
        }
        
        return completion;
      } catch (error: any) {
        lastError = error;
        
        // Check if it's an image timeout error - only retry for these
        const isImageTimeoutError = 
          error.code === 'invalid_image_url' || 
          (error.message && error.message.includes('Timeout while downloading'));
        
        if (isImageTimeoutError && attempt < maxRetries) {
          const delay = Math.min(2000 * attempt, 6000); // 2s, 4s, 6s max
          this.logger.warn(
            `OpenAI image fetch timeout (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`,
            'ScriptsService'
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // For non-timeout errors or last attempt, throw
        throw error;
      }
    }
    
    throw lastError;
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
  async generateVideoScript(request: VideoScriptGenerationRequest, userId?: string): Promise<VideoScriptGenerationResponse> {
    const startTime = Date.now();
    
    try {
      const language = request.language || 'hinglish'; // Default to hinglish if not provided
      const tags = request.tags || [];
      this.logger.log(`Generating video script for style: ${request.videoStyle}, language: ${language}, tags: ${tags.join(', ') || 'none'}, prompt: ${request.userPrompt}`, 'ScriptsService');

      if (!this.openai) {
        throw new Error('OpenAI API key is not configured');
      }

      // If projectId provided, fetch analyzed assets (wait for analysis if needed)
      let analyzedAssets = request.analyzedAssets;
      if (request.projectId && !analyzedAssets) {
        analyzedAssets = await this.waitForAssetAnalysisAndExtract(request.projectId, userId, this.assetAnalysisTimeoutMs);
        // Fallback: if analysis timed out or never completed, use raw metadata.assets so images are still referenced
        if (!analyzedAssets && userId) {
          analyzedAssets = await this.getRawAssetsFallback(request.projectId, userId);
          if (analyzedAssets?.length) {
            this.logger.log(`Using ${analyzedAssets.length} raw project assets as fallback (analysis unavailable) for project ${request.projectId}`, 'ScriptsService');
          }
        }
      }

      // Request avatar_image_prompt for avatar styles even when client does not send hasAvatar
      const effectiveHasAvatar = request.hasAvatar === true || AVATAR_VIDEO_STYLES.includes(request.videoStyle);
      // Get the system prompt (uses BOTH: analysis text in asset context + images attached below for vision)
      const systemPrompt = this.getSystemPromptForStyle(
        request.videoStyle, 
        language, 
        tags,
        request.productImageUrl,
        effectiveHasAvatar,
        analyzedAssets,
        request.urlContentContext
      );
      
      // Get duration from request, or extract from user prompt, or use default
      let duration = request.duration;
      if (!duration) {
        // Try to extract duration from user prompt
        const extractedDuration = this.extractDurationFromPrompt(request.userPrompt);
        if (extractedDuration) {
          duration = extractedDuration;
          console.log(`[ScriptsService] Using duration extracted from user prompt: ${duration}`);
        } else {
          duration = '30 seconds';
          console.log(`[ScriptsService] Using default duration: ${duration}`);
        }
      } else {
        console.log(`[ScriptsService] Using duration from request: ${duration}`);
      }
      
      // Calculate expected scene count for strong enforcement
      const durationSeconds = this.parseDurationToSeconds(duration);
      const expectedScenes = this.calculateExpectedScenes(durationSeconds, request.videoStyle);
      
      // Determine if we need to use vision API (only for visual reference with analyzed assets, not for analysis)
      const hasAnalyzedAssets = analyzedAssets && analyzedAssets.length > 0;
      // Only use Vision API if we have analyzed assets with image URLs for visual reference
      // Product images are already analyzed, so we don't need Vision API for analysis
      const useVisionAPI: boolean = hasAnalyzedAssets && analyzedAssets.some(a => 
        a.url && (a.url.startsWith('http://') || a.url.startsWith('https://'))
      );
      
      // Build messages array
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
      
      // Add system message
      messages.push({ role: 'system', content: systemPrompt });

      if (useVisionAPI) {
        // Build content array with text and images (for visual reference only, not for analysis)
        const content: Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> = [];
        
        // Add text prompt with strong scene count enforcement
        let textPrompt = `Create a video script for the following topic/idea: "${request.userPrompt}". 

CRITICAL DURATION REQUIREMENTS:
- Total video duration: ${duration} (${durationSeconds} seconds)
- You MUST generate exactly ${expectedScenes.target} scenes (acceptable range: ${expectedScenes.min}-${expectedScenes.max} scenes)
- Each scene should be approximately ${Math.round(durationSeconds / expectedScenes.target)} seconds long
- The total of all scene durations MUST equal ${durationSeconds} seconds
- DO NOT generate fewer scenes than required - this is a strict requirement`;
        
        // Add context from analyzed assets (product info, brand info already in system prompt)
        if (hasAnalyzedAssets) {
          const logoAssets = analyzedAssets.filter(a => a.category === 'logo');
          const productAssets = analyzedAssets.filter(a => a.category === 'product');
          
          if (logoAssets.length > 0) {
            // Get brand name from analyzed assets if available
            const logoAsset = logoAssets[0];
            const brandName = logoAsset.extractedText || (logoAsset as any).brandName;
            
            if (brandName) {
              textPrompt += `\n\nCRITICAL BRAND INFORMATION:
- Brand name: "${brandName}"
- You MUST mention "${brandName}" naturally in the voiceover multiple times throughout the script
- Use "${brandName}" when referring to the product, service, or company
- Do NOT use generic terms like "our product" or "the company" - use "${brandName}" instead
- Emphasize "${brandName}" in key moments and call-to-action scenes
- Use the logo image(s) provided as visual reference for brand identity and style`;
            } else {
              textPrompt += `\n\nBRAND CONTEXT:
- Use the logo image(s) provided as visual reference for brand identity
- Extract brand name from the logo and incorporate it naturally into the script
- Use brand colors and style elements when describing visuals`;
            }
          }
          
          if (productAssets.length > 0) {
            textPrompt += `\n\nPRODUCT CONTEXT:
- Product information has been pre-analyzed and is included in the system prompt
- Use the product image(s) provided as visual reference to understand product appearance
- Reference specific product features and characteristics from the pre-analyzed information
- Ensure visual descriptions match the actual product appearance in the images`;
          }
        }
        
        textPrompt += `\n\nReturn the response as a valid JSON object following the specified format.`;
        
        content.push({ type: 'text', text: textPrompt });
        
        // Add analyzed asset images (logo, product, etc.) for visual reference only
        // These are NOT for analysis - analysis was already done asynchronously
        if (hasAnalyzedAssets) {
          for (const asset of analyzedAssets) {
            // Only include image assets with public URLs
            if (asset.url && (asset.url.startsWith('http://') || asset.url.startsWith('https://'))) {
              // Ensure URL is public
              let assetUrl = asset.url;
              if (!assetUrl.startsWith('http://') && !assetUrl.startsWith('https://')) {
                const backendBaseUrl = this.configService.get<string>('BACKEND_BASE_URL') || 
                                      this.configService.get<string>('NEXT_PUBLIC_WS_URL') || 
                                      'http://localhost:9001';
                if (assetUrl.startsWith('/uploads')) {
                  assetUrl = `${backendBaseUrl}${assetUrl}`;
                } else {
                  continue; // Skip if not a valid URL
                }
              }
              
              content.push({
                type: 'image_url',
                image_url: { url: assetUrl }
              });
            }
          }
        }
        
        messages.push({
          role: 'user',
          content: content as any,
        });
      } else {
        // Standard text-only prompt with strong scene count enforcement
        messages.push({
          role: 'user',
          content: `Create a video script for the following topic/idea: "${request.userPrompt}".

CRITICAL DURATION REQUIREMENTS:
- Total video duration: ${duration} (${durationSeconds} seconds)
- You MUST generate exactly ${expectedScenes.target} scenes (acceptable range: ${expectedScenes.min}-${expectedScenes.max} scenes)
- Each scene should be approximately ${Math.round(durationSeconds / expectedScenes.target)} seconds long
- The total of all scene durations MUST equal ${durationSeconds} seconds
- DO NOT generate fewer scenes than required - this is a strict requirement

Return the response as a JSON object.`
        });
      }

      // Use GPT-4o or gpt-4-turbo for vision, otherwise use configured model
      const model = useVisionAPI 
        ? 'gpt-4o' // GPT-4o has better vision capabilities
        : this.configService.get<string>('OPENAI_MODEL_GPT4', 'gpt-4-turbo');

      // Pre-warm analyzed asset image URLs before calling OpenAI (for vision API only)
      // This helps ensure the images are cached and accessible when OpenAI tries to fetch them
      // Note: Product images are NOT analyzed here - they were already analyzed asynchronously
      if (useVisionAPI && analyzedAssets) {
        const urlsToWarm: string[] = [];
        analyzedAssets.forEach(asset => {
          if (asset.url && (asset.url.startsWith('http://') || asset.url.startsWith('https://'))) {
            urlsToWarm.push(asset.url);
          }
        });
        
        if (urlsToWarm.length > 0) {
          this.logger.log(`Pre-warming ${urlsToWarm.length} analyzed asset image URL(s) for visual reference before OpenAI call...`, 'ScriptsService');
          await Promise.all(urlsToWarm.map(url => this.preWarmUrl(url)));
          // Small delay after pre-warming to ensure propagation
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Call OpenAI API with retry logic for vision timeouts
      // Note: response_format: json_object requires gpt-4-turbo, gpt-4o, or gpt-3.5-turbo
      const completion = await this.callOpenAIWithRetry(messages, model, useVisionAPI, 3);

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

      // Normalize prompts to ensure visual consistency (region-aware fallback)
      scriptData = this.normalizePrompts(scriptData, language);

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

      // Request avatar_image_prompt for avatar styles so regenerated script retains it
      const effectiveHasAvatar = AVATAR_VIDEO_STYLES.includes(request.videoStyle);
      // Get system prompt (same as script generation to maintain consistency)
      const systemPrompt = this.getSystemPromptForStyle(request.videoStyle, language, [], undefined, effectiveHasAvatar);
      
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
          ? `CRITICAL: Maintain the EXACT same visual style parameters in broll_image_prompt and broll_video_prompt from the visual_style_guide. Use format: "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description]". B-roll images must be PHOTOREALISTIC: prepend "Photorealistic, documentary photograph, real-world, " to scene-specific descriptions. Avoid "dramatic", "cinematic", "stark", "stylized" - use documentary-style wording.`
          : '';
        
        userRequest = `Update Scene ${request.sceneNumber} with the following voiceover: "${request.newVoiceover}". Keep all other fields (broll_visual_description, broll_image_prompt, broll_video_prompt, avatar_action, avatar_motion, avatar_cutout_position, etc.) consistent with the video style "${request.videoStyle}" and the scene's context. ${styleGuidance} Return ONLY the updated scene object as JSON, following the exact same structure as the existing scenes. Ensure the scene_number is ${request.sceneNumber}.`;
      } else {
        // Regenerate operation
        // Extract visual style guide from existing script to maintain consistency
        const visualStyleGuide = request.existingScript?.visual_style_guide;
        const styleGuidance = visualStyleGuide 
          ? `CRITICAL: Use the EXACT same visual style parameters from the visual_style_guide: Color palette: "${visualStyleGuide.color_palette || visualStyleGuide.colorPalette}", Lighting: "${visualStyleGuide.lighting}", Mood: "${visualStyleGuide.mood}", Camera: "${visualStyleGuide.camera_style || visualStyleGuide.cameraStyle}", Time: "${visualStyleGuide.time_of_day || visualStyleGuide.timeOfDay}", Tone: "${visualStyleGuide.visual_tone || visualStyleGuide.visualTone}". These MUST appear in broll_image_prompt and broll_video_prompt in the format: "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description]". B-roll images must be PHOTOREALISTIC: prepend "Photorealistic, documentary photograph, real-world, " to scene-specific descriptions. Avoid "dramatic", "cinematic", "stark", "stylized" - use documentary-style wording.`
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
          
          // Only process if this is a b-roll or half-n-half scene (for ALTERNATE style)
          const isBrollScene = request.existingScript.video_type !== 'Alternating' || sceneData.type === 'b-roll' || sceneData.type === 'half-n-half';
          
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
        colorPalette: 'Corporate blues, neutral grays, documentary tones',
        lighting: 'Natural, professional, well-lit',
        mood: 'Documentary, trustworthy, business-focused',
        visualTone: 'Documentary, factual, authentic',
        cameraStyle: 'Documentary style, natural perspective',
      },
      'casual': {
        colorPalette: 'Relaxed earth tones, soft pastels',
        lighting: 'Natural, relaxed, comfortable',
        mood: 'Friendly, approachable, laid-back',
        visualTone: 'Relaxed, informal, approachable',
        cameraStyle: 'Natural, relaxed, casual',
      },
      'energetic': {
        colorPalette: 'Natural colors, authentic contrasts',
        lighting: 'Natural, bright, documentary style',
        mood: 'Lively, authentic, candid',
        visualTone: 'Lively, authentic, candid',
        cameraStyle: 'Documentary style, natural perspective',
      },
      'calm': {
        colorPalette: 'Soft, natural colors, muted tones',
        lighting: 'Natural, soft, gentle',
        mood: 'Peaceful, relaxing, serene',
        visualTone: 'Natural, calm, documentary',
        cameraStyle: 'Documentary style, gentle, peaceful',
      },
      'playful': {
        colorPalette: 'Bright, fun colors, playful tones',
        lighting: 'Bright, fun, playful',
        mood: 'Fun, lighthearted, playful',
        visualTone: 'Playful, fun, lighthearted',
        cameraStyle: 'Dynamic, fun, playful',
      },
      'serious': {
        colorPalette: 'Muted, natural tones, documentary colors',
        lighting: 'Natural, documentary style',
        mood: 'Documentary, factual, authentic',
        visualTone: 'Documentary, factual, authentic',
        cameraStyle: 'Documentary style, natural perspective',
      },
      'inspiring': {
        colorPalette: 'Natural, uplifting tones',
        lighting: 'Natural, bright, documentary style',
        mood: 'Authentic, uplifting, real-world',
        visualTone: 'Authentic, uplifting, real-world',
        cameraStyle: 'Documentary style, natural perspective',
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
  private getSystemPromptForStyle(
    style: string, 
    language: 'english' | 'hindi' | 'hinglish' = 'hinglish', 
    tags: string[] = [],
    productImageUrl?: string, // Deprecated - kept for backward compatibility, but not used for analysis
    hasAvatar?: boolean,
    analyzedAssets?: Array<{ id: string; category: string; extractedText?: string; productInfo?: any; url: string }>,
    urlContentContext?: string // Content extracted from URL assets
  ): string {
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

    // Build asset context section
    let assetContext = '';
    if (analyzedAssets && analyzedAssets.length > 0) {
      const logoAsset = analyzedAssets.find(a => a.category === 'logo');
      const productAssets = analyzedAssets.filter(a => a.category === 'product');
      const backgroundAssets = analyzedAssets.filter(a => a.category === 'background' || a.category === 'environment');
      
      if (logoAsset) {
        const brandName = logoAsset.extractedText ||
                         (logoAsset as any).brandName ||
                         (logoAsset.productInfo as any)?.name ||
                         undefined;

        if (brandName) {
          assetContext += `\n\nBRAND INFORMATION:\n- Brand name: ${brandName}\n- You MUST mention "${brandName}" naturally in the voiceover when appropriate\n- Emphasize the brand name in key moments\n- Use the brand name authentically throughout the script\n- When referring to the product or service, use "${brandName}" instead of generic terms\n`;
        }
        assetContext += `- When generating broll_image_prompt and broll_video_prompt, assume the logo will be provided as a reference image (last in order). Describe placement (e.g. on product, lower-third) if needed; do not ask the image model to draw the brand name.\n`;
      }
      
      if (productAssets && productAssets.length > 0) {
        assetContext += `\n\nCRITICAL PRODUCT INFORMATION (from pre-analyzed assets):\n`;
        productAssets.forEach((asset, index) => {
          if (asset.productInfo) {
            const productName = asset.productInfo.name || asset.extractedText || 'Product';
            assetContext += `- Product ${index + 1}: ${productName}\n`;
            if (asset.productInfo.type) assetContext += `  Type: ${asset.productInfo.type}\n`;
            if (asset.productInfo.category) assetContext += `  Category: ${asset.productInfo.category}\n`;
            if (asset.productInfo.features && asset.productInfo.features.length > 0) {
              assetContext += `  Features: ${asset.productInfo.features.join(', ')}\n`;
            }
            if (asset.productInfo.colors && asset.productInfo.colors.length > 0) {
              assetContext += `  Colors: ${asset.productInfo.colors.join(', ')}\n`;
            }
            if (asset.productInfo.description) {
              assetContext += `  Description: ${asset.productInfo.description}\n`;
            }
            if (asset.productInfo.useCases && asset.productInfo.useCases.length > 0) {
              assetContext += `  Use Cases: ${asset.productInfo.useCases.join(', ')}\n`;
            }
            if (asset.productInfo.targetAudience) {
              assetContext += `  Target Audience: ${asset.productInfo.targetAudience}\n`;
            }
          } else if (asset.extractedText) {
            // Fallback to extractedText if productInfo is not available
            assetContext += `- Product ${index + 1}: ${asset.extractedText}\n`;
          }
        });
        assetContext += `\nSCRIPT GENERATION REQUIREMENTS FOR PRODUCT:\n`;
        assetContext += `- Use the ACTUAL product name(s) from the analyzed information throughout the script\n`;
        assetContext += `- Do NOT use placeholders like "[Product Name]" or "[Product]" - use the real product name(s)\n`;
        assetContext += `- Reference specific product features, colors, and characteristics from the analysis\n`;
        assetContext += `- Create scenes that showcase the product accurately based on the analyzed information\n`;
        assetContext += `- Ensure all voiceover and descriptions match the actual product details\n`;
      }
      
      if (backgroundAssets && backgroundAssets.length > 0) {
        assetContext += `\nBACKGROUND/ENVIRONMENT CONTEXT:\n- ${backgroundAssets.length} background/environment asset(s) available for reference\n- Use these to inform scene settings and visual descriptions\n`;
      }
    }

    // Add URL content context if provided
    let urlContext = '';
    if (urlContentContext && urlContentContext.trim()) {
      urlContext = `\n\nWEBSITE/URL CONTENT CONTEXT:\nThe following content was extracted from URLs provided by the user. Use this information to inform the script content, messaging, and context:\n\n${urlContentContext}\n\nIMPORTANT:\n- Reference specific information from the website content when relevant\n- Use company/product names, features, and messaging from the extracted content\n- Ensure the script aligns with the brand voice and information from the website\n- Do not fabricate information - stick to what is provided in the website content\n`;
    }

    // Avatar image prompt: when hasAvatar is true, script must output a single avatar_image_prompt string (no hardcoding; LLM decides framing, background, lighting per style)
    let avatarContext = '';
    if (hasAvatar) {
      const styleSpecificGuidance = {
        'HALF_N_HALF': 'The avatar appears only in the BOTTOM HALF of the frame. CRITICAL: Person must be FRONT-FACING, looking directly at the camera. Describe waist-up composition, neutral background, lighting matching the visual_style_guide.',
        'ALTERNATE': 'Alternating full-screen avatar scenes. CRITICAL: Person must be FRONT-FACING, looking directly at the camera. No side angles. Close-up or waist-up, neutral background, lighting consistent with visual_style_guide.',
        'AVATAR_CUTOUT': 'Avatar will be composited over b-roll. Use appropriate framing and neutral, theme-consistent background and lighting so the avatar fits the video as a single unit.',
        'AVATAR_ONLY': 'Full-screen avatar. Use appropriate framing and neutral, theme-consistent background and lighting matching the visual_style_guide.',
        'AVATAR_PRODUCT': 'Avatar with product context. Use appropriate framing and neutral, theme-consistent background and lighting.',
        'ANIMATED_AVATAR': 'CRITICAL: The avatar_image_prompt must describe ONLY the 3D animated style (e.g. "3D animated character", "stylized 3D animated look", "animated 3D presenter style"). Do NOT include position, pose, desk, microphone, or setup—those are chosen by the user separately. Keep it to 1-2 short phrases describing the animated aesthetic.',
      };
      const styleGuide = styleSpecificGuidance[style as keyof typeof styleSpecificGuidance] || 'Use appropriate framing and neutral, theme-consistent background and lighting matching the visual_style_guide.';
      avatarContext = `

AVATAR IMAGE PROMPT (REQUIRED - when avatar is used):
Your JSON output MUST include at the top level: "avatar_image_prompt": "<full prompt string>".
- CRITICAL - FRONT-FACING RESTRICTION: The avatar MUST face the camera directly. No side angles, profile views, or sideways poses. The person must look straight at the camera. This is mandatory for all avatar styles.
- This is a single string: a complete, ready-to-use prompt for the image model (no structured fields or enums).
- Generate it entirely from the video topic, style, and visual_style_guide. Do not use placeholders.
- Style-specific for this video: ${styleGuide}
- Rules: No scenic or decorative backgrounds (no mountains, traffic, etc.). Neutral, theme-consistent background. Lighting must align with visual_style_guide so avatar and b-roll feel like one video.
- Example format: "avatar_image_prompt": "Front-facing waist-up portrait, person looking directly at camera, neutral gray background, soft even lighting, professional video look" (for HALF_N_HALF) or "Front-facing close-up, person at streaming desk looking straight at camera, neutral dark gray background, soft lighting" (for ALTERNATE).
`;
    }

  const PHOTOREALISM_RULE = `
CRITICAL B-ROLL PHOTOREALISM RULE (NON-NEGOTIABLE):
- B-roll images MUST look like REAL-WORLD PHOTOGRAPHS, not AI art or illustrations
- Use factual, documentary-style descriptions: natural lighting, real textures, authentic scenes
- AVOID: "dramatic", "cinematic", "stark", "stylized", "artistic", "vibrant" (unless describing actual vibrant objects)
- AVOID: Symbolic color descriptions (e.g. "stark blues to represent contrast")
- PREFER: "natural daylight", "overcast", "golden hour", "neutral tones", "documentary photograph"
- visual_style_guide must describe how a REAL LOCATION would look, not an artistic interpretation

TOPIC-APPROPRIATE REALISM:
- For general, educational, business, or everyday topics: use "documentary photograph", "real-world", "natural", "everyday setting". Avoid hyper-stylized, neon, or overly digital aesthetics.
- For fantasy, sci-fi, space, or explicitly creative topics: stylized or artistic b-roll is acceptable.
- If the topic does NOT mention fantasy, sci-fi, space, or abstract art, generate b-roll descriptions that sound like real-world locations and objects.
`;

  const BROLL_TEXT_RULE = `
CRITICAL B-ROLL TEXT RULE:
- Avoid specific readable text, signs, or on-screen UI with words in b-roll unless the user explicitly requests it.
- Prefer abstract visuals, iconography, or data visualizations without clearly readable words.
- When describing screens, dashboards, or interfaces, use phrases like "blurred interface", "generic charts", or "unreadable placeholder text" instead of concrete sentences or product names.
- Do NOT ask the image or video model to draw specific sentences or detailed typography.
- When broll_video_prompt describes screens or text, add guidance like "use static or subtle camera motion; avoid zooms, rotations, or heavy transitions that would distort any on-screen text".
`;

  const PHYSICAL_PLAUSIBILITY_RULE = `
CRITICAL PHYSICAL PLAUSIBILITY RULE:
- All scene descriptions and b-roll prompts must be physically plausible in the real world.
- People must be in normal positions relative to objects (e.g., standing next to a desk, sitting at a table), never inside solid objects or merged with furniture.
- Do NOT describe impossible compositions such as "person inside the table", "person inside the desk", or body parts intersecting with solid objects.
- Avoid impossible camera perspectives that would break realism (e.g., multiple conflicting viewpoints in a single shot).
- When in doubt, choose grounded, realistic compositions that could be filmed with a normal camera.
`;

  const GLOBAL_BROLL_RULES = `${PHOTOREALISM_RULE}
${BROLL_TEXT_RULE}
${PHYSICAL_PLAUSIBILITY_RULE}`;

  const VIDEO_TOPIC_RULE = `
CRITICAL VIDEO TOPIC / GLOBAL CONTEXT RULE:
- You MUST include a top-level field "video_topic": one short phrase capturing the overall video theme (e.g. "work from home benefits", "product launch features").
- EVERY scene's broll_visual_description, broll_image_prompt, and broll_video_prompt must clearly tie to this topic so that no scene could be mistaken for a generic unrelated image.
- Example: if the topic is "work from home", a scene about family should show "parent at home with family, home office or work-from-home context visible", NOT a generic "family in village".
- The scene-specific part of each prompt must reference or imply the video topic so the global context is never lost.
`;

  const SPECIFICITY_RULE = `
CRITICAL CONTENT SPECIFICITY RULE:
- Address EXACTLY what the user asks. Do NOT default to generic definitions.
- If the topic mentions "new", "latest", "features", "updates", "recent", "trends" - focus on those specific aspects.
- Example: "new cloud features" → discuss recent/upcoming cloud features, NOT "what is cloud".
- Example: "AI trends 2025" → discuss 2025 AI trends, NOT a generic AI introduction.
- Keep content accurate, specific, and up-to-date in tone.
`;

  const prompts = {
      'HALF_N_HALF': `You are a professional video director and AI content composer who creates structured video scripts for "half-and-half" style videos, where the top half of the frame shows b-roll (visual footage related to the narration) and the bottom half shows an Indian-looking avatar delivering ${lang.dialogue}.

Your task is to produce a complete creative breakdown for a video based on a user's input topic or idea, fully adapted for an Indian audience.

CRITICAL VISUAL CONSISTENCY REQUIREMENTS:
- ALL scenes must share the SAME visual style, color palette, lighting, mood, and aesthetic
- You MUST create a "visual_style_guide" that defines consistent parameters for ALL scenes
- EVERY broll_image_prompt and broll_video_prompt MUST include the visual style guide at the beginning
- The visual style guide should specify: color palette, lighting style, mood/atmosphere, camera style, time of day, visual tone, and any recurring visual elements
${GLOBAL_BROLL_RULES}
${VIDEO_TOPIC_RULE}

CRITICAL IMAGE COMPOSITION RULES:
- Generate ONE SINGLE IMAGE per scene - NEVER a grid, collage, or multiple images combined
- Each broll_image_prompt MUST produce ONE focused shot, ONE perspective, ONE composition
- NEVER include: grids, collages, split-screen layouts, multiple angles in one image, tiled views, or mosaic layouts
- Each scene should have its own unique single-image composition
- Add [COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] to every broll_image_prompt

Output Requirements:

Video Duration and Scene Planning (CRITICAL):
- Each scene should be 4-6 seconds long for natural pacing
- If user does not specify a duration, DEFAULT to 30 seconds minimum with 5-7 scenes
- Calculate the number of scenes based on total duration:
  * For 30 seconds: Generate 5-7 scenes (approximately 5 seconds per scene)
  * For 1 minute (60 seconds): Generate 10-12 scenes (approximately 5 seconds per scene)
  * For 2 minutes (120 seconds): Generate 20-24 scenes (approximately 5 seconds per scene)
  * For custom durations: Calculate scenes by dividing total seconds by 5 (e.g., 45 seconds = 9 scenes, 90 seconds = 18 scenes)
- Ensure all scenes have proper time_range that covers the ENTIRE video duration without gaps
- Scene time ranges should not overlap and should sequentially cover the full duration
- Example: For 30 seconds, scenes should be numbered 1, 2, 3, 4, 5, 6 with time ranges like "0-5s", "5-10s", "10-15s", "15-20s", "20-25s", "25-30s"
- If user specifies a duration, calculate and generate the appropriate number of scenes accordingly

IMPORTANT: You must return your response as a valid JSON object.

Structure Your Output in This JSON Format:
{
  "video_type": "Half-and-Half",
  "duration": "30 seconds",
  "video_topic": "One short phrase for the overall video theme (e.g. work from home benefits, product launch features)",
  "visual_style_guide": {
    "color_palette": "Describe natural, realistic colors as in a documentary photo (e.g., 'Natural earth tones, realistic sky, authentic Indian environment')",
    "lighting": "Describe natural lighting (e.g., 'Natural daylight, soft overcast, or golden hour - documentary style')",
    "mood": "Describe authentic atmosphere (e.g., 'Documentary, factual, authentic Indian street life')",
    "camera_style": "Describe documentary framing (e.g., 'Documentary style, natural perspective, real-world framing')",
    "time_of_day": "Specify consistent time (e.g., 'Golden hour evening' or 'Bright midday' or 'Morning light')",
    "visual_tone": "Describe documentary tone (e.g., 'Documentary photograph, authentic local life, unretouched')",
    "recurring_elements": "List any visual elements that should appear consistently (e.g., 'Indian street vendors, markets, urban infrastructure')"
  },
  "avatar_image_prompt": "Only include this key when the video uses an avatar. Full prompt string for the avatar image, e.g. 'Waist-up portrait, neutral gray background, soft lighting matching the video theme, person centered for lower half of frame'.",
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-5s",
      "voiceover": "${lang.example}",
      "broll_visual_description": "Describe Indian-context visuals — e.g., Indian streets, markets, offices, homes, festivals.",
      "broll_image_prompt": "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: natural earth tones, realistic sky, authentic Indian environment] [Lighting: natural daylight, documentary style] [Mood: documentary, factual, authentic] [Camera: documentary style, natural perspective] [Time: golden hour evening] [Tone: documentary photograph, authentic local life] [Scene-specific: bustling Indian street market with vendors and stalls]",
      "broll_video_prompt": "[Color palette: natural earth tones, realistic sky, authentic Indian environment] [Lighting: natural daylight, documentary style] [Mood: documentary, factual, authentic] [Camera: smooth panning, natural perspective] [Time: golden hour evening] [Tone: documentary photograph, authentic local life] [Scene-specific: bustling Indian street market with vendors, people walking, stalls, dynamic movement]",
      "stock_search_term": "indian street market vendors stalls",
      "avatar_action": "Explain how the Indian-looking avatar speaks and reacts.",
      "avatar_motion": "Single word describing avatar's motion such as 'nod', 'smile', 'gesture'"
    },
    {
      "scene_number": 2,
      "time_range": "5-10s",
      "voiceover": "${lang.example}",
      "broll_visual_description": "Describe next Indian-context visuals",
      "broll_image_prompt": "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: natural earth tones, realistic sky, authentic Indian environment] [Lighting: natural daylight, documentary style] [Mood: documentary, factual, authentic] [Camera: documentary style, natural perspective] [Time: golden hour evening] [Tone: documentary photograph, authentic local life] [Scene-specific: different scene description]",
      "broll_video_prompt": "[Color palette: natural earth tones, realistic sky, authentic Indian environment] [Lighting: natural daylight, documentary style] [Mood: documentary, factual, authentic] [Camera: smooth panning, natural perspective] [Time: golden hour evening] [Tone: documentary photograph, authentic local life] [Scene-specific: different scene description with motion]",
      "stock_search_term": "appropriate search keywords for stock footage",
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
3. EVERY broll_image_prompt MUST start with "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images]" followed by visual style parameters
4. Full format for broll_image_prompt: "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: specific description]"
5. EVERY broll_image_prompt must produce PHOTOREALISTIC output. Prepend "Photorealistic, documentary photograph, real-world, " to the scene-specific description when writing prompts. Avoid artistic or symbolic interpretations.
6. EVERY broll_video_prompt MUST follow the same format but include motion/action words
7. The scene-specific part should vary, but ALL style parameters (color, lighting, mood, camera, time, tone) MUST remain IDENTICAL across all scenes
8. Use the EXACT same wording for style parameters in every prompt to ensure AI image/video models generate consistent visuals
9. Extract the style parameters from visual_style_guide and use them verbatim in every prompt
10. NEVER generate grids, collages, split-screen, or multiple images in one - each scene must be ONE single focused image
11. EVERY scene MUST include "stock_search_term": 3-5 keywords optimized for stock footage search based on the scene visual context (e.g., "city skyline sunset urban landscape", "chef cooking kitchen professional")
12. You MUST include top-level "video_topic" and ensure every scene's broll prompts tie to this topic so the global context is never lost

Guidelines:
- All visuals should reflect Indian context unless user explicitly asks otherwise.
- ${lang.instruction}
- Maintain continuity between avatar and b-roll.
- B-roll should support, enhance, or contrast the spoken dialogue.
- Keep pacing aligned with the requested duration (minimum 30 seconds if not specified).
- VISUAL CONSISTENCY IS CRITICAL: All scenes must look like they belong to the same video with the same visual style.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,

      'ALTERNATE': `You are a creative director and film editor AI who creates alternating-scene style video scripts, where some scenes feature a full-screen Indian-looking avatar speaking ${lang.dialogue}, and others feature full-screen Indian-style b-roll.

Your task is to script a balanced, engaging alternating-scene video with smooth narrative continuity for an Indian audience.

CRITICAL RENDERING REQUIREMENTS (MUST READ):
- ALL scenes require b-roll images to be generated
- Odd-numbered scenes (1, 3, 5, ...): Use full-screen 9:16 b-roll images (type: "b-roll")
- Even-numbered scenes (2, 4, 6, ...): Use 3:4 b-roll images for the top half (type: "half-n-half")
- Therefore, EVERY scene MUST have a broll_image_prompt, regardless of type

CRITICAL VISUAL CONSISTENCY REQUIREMENTS:
- ALL b-roll images must share the SAME visual style, color palette, lighting, mood, and aesthetic
- You MUST create a "visual_style_guide" that defines consistent parameters for ALL b-roll images
- EVERY broll_image_prompt and broll_video_prompt MUST include the visual style guide at the beginning
- The visual style guide should specify: color palette, lighting style, mood/atmosphere, camera style, time of day, visual tone, and any recurring visual elements
${GLOBAL_BROLL_RULES}
${VIDEO_TOPIC_RULE}

CRITICAL IMAGE COMPOSITION RULES:
- Generate ONE SINGLE IMAGE per scene - NEVER a grid, collage, or multiple images combined
- Each broll_image_prompt MUST produce ONE focused shot, ONE perspective, ONE composition
- NEVER include: grids, collages, split-screen layouts, multiple angles in one image, tiled views, or mosaic layouts
- Each scene should have its own unique single-image composition
- Add [COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] to every broll_image_prompt

IMPORTANT: You must return your response as a valid JSON object.

Video Duration and Scene Planning (CRITICAL):
- Each scene (avatar or b-roll) should be 5-7 seconds long for natural pacing
- If user does not specify a duration, DEFAULT to 30 seconds minimum with 5-6 scenes
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

Output Format:
{
  "video_type": "Alternating",
  "duration": "1 minute",
  "video_topic": "One short phrase for the overall video theme (e.g. work from home benefits)",
  "visual_style_guide": {
    "color_palette": "Describe natural, realistic colors as in a documentary photo (e.g., 'Natural earth tones, realistic sky')",
    "lighting": "Describe natural lighting (e.g., 'Natural daylight, documentary style')",
    "mood": "Describe authentic atmosphere (e.g., 'Documentary, factual, authentic')",
    "camera_style": "Describe documentary framing (e.g., 'Documentary style, natural perspective')",
    "time_of_day": "Specify consistent time for all b-roll scenes",
    "visual_tone": "Describe documentary tone (e.g., 'Documentary photograph, authentic')",
    "recurring_elements": "List any visual elements that should appear consistently"
  },
  "avatar_image_prompt": "Full prompt string for the avatar image, matching visual_style_guide and style (e.g. close-up, person at streaming desk, neutral background, soft lighting).",
  "scene_plan": [
    {
      "scene_number": 1,
      "type": "b-roll",
      "time_range": "0-7s",
      "voiceover": "${lang.alternate}",
      "broll_visual_description": "Describe Indian visuals that support the voiceover — markets, roads, cafes, offices, villages, festivals, etc. REQUIRED for ALL scenes.",
      "broll_image_prompt": "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description]. REQUIRED for ALL scenes (odd scenes = full 9:16, even scenes = 3:4 for top half).",
      "broll_video_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description with motion]. REQUIRED for ALL scenes.",
      "stock_search_term": "keywords for stock footage search",
      "avatar_action": null,
      "avatar_motion": null
    },
    {
      "scene_number": 2,
      "type": "half-n-half",
      "time_range": "7-14s",
      "voiceover": "${lang.alternate}",
      "broll_visual_description": "Describe Indian visuals — markets, roads, cafes, offices, villages, festivals, etc.",
      "broll_image_prompt": "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description]",
      "broll_video_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description with motion]",
      "stock_search_term": "keywords for stock footage search",
      "avatar_action": "Describe Indian avatar's expression and delivery for this half-n-half scene.",
      "avatar_motion": "Give a single word describing avatar's motion such as 'nod', 'smile', 'blink'"
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
2. The visual_style_guide MUST be consistent across ALL scenes (both avatar-type and b-roll-type)
3. EVERY scene (regardless of type) MUST have a broll_image_prompt - this is REQUIRED for rendering
4. EVERY broll_image_prompt MUST start with "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images]" followed by visual style parameters
5. Full format for broll_image_prompt: "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: specific description]"
6. EVERY broll_image_prompt must produce PHOTOREALISTIC output. Prepend "Photorealistic, documentary photograph, real-world, " to the scene-specific description when writing prompts. Avoid artistic or symbolic interpretations.
7. Use the EXACT same wording for style parameters in every scene prompt (both avatar and b-roll scenes)
8. Only the scene-specific part should vary between scenes
9. Extract the style parameters from visual_style_guide and use them verbatim in every prompt
10. NEVER generate grids, collages, split-screen, or multiple images in one - each scene must be ONE single focused image
11. For avatar-type scenes, generate broll_image_prompt based on the voiceover context and visual style guide
12. You MUST include top-level "video_topic" and ensure every scene's broll prompts tie to this topic so the global context is never lost

Guidelines:
- Use ${lang.dialogue} voiceover across all scenes.
- B-roll must visually reflect Indian environments unless user specifies otherwise.
- Maintain logical narrative continuity across scenes.
- Multiple avatar or multiple b-roll scenes in a row are fine if they improve flow.
- CRITICAL: Generate enough scenes to cover the entire video duration (5-6 scenes for 30 seconds, 10-12 for 1 minute, etc.)
- Each scene should be 5-7 seconds, and the total number of scenes must cover the full duration without gaps
- Keep pacing aligned with the requested duration (minimum 30 seconds if not specified).
- VISUAL CONSISTENCY IS CRITICAL: All b-roll scenes must look like they belong to the same video with the same visual style.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,

    'AVATAR_CUTOUT': `You are a motion graphics director and AI content composer who creates cutout-style videos, where an Indian-looking avatar (green-screen cutout) appears over full-frame Indian-context b-roll.

The avatar is smaller (placed at bottom or corner) while b-roll fills the background.

CRITICAL VISUAL CONSISTENCY REQUIREMENTS:
- ALL scenes must share the SAME visual style, color palette, lighting, mood, and aesthetic for the b-roll background
- You MUST create a "visual_style_guide" that defines consistent parameters for ALL scenes
- EVERY broll_image_prompt and broll_video_prompt MUST include the visual style guide at the beginning
- The visual style guide should specify: color palette, lighting style, mood/atmosphere, camera style, time of day, visual tone, and any recurring visual elements
${GLOBAL_BROLL_RULES}
${VIDEO_TOPIC_RULE}

CRITICAL IMAGE COMPOSITION RULES:
- Generate ONE SINGLE IMAGE per scene - NEVER a grid, collage, or multiple images combined
- Each broll_image_prompt MUST produce ONE focused shot, ONE perspective, ONE composition
- NEVER include: grids, collages, split-screen layouts, multiple angles in one image, tiled views, or mosaic layouts
- Each scene should have its own unique single-image composition
- Add [COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] to every broll_image_prompt

IMPORTANT: You must return your response as a valid JSON object.

Video Duration and Scene Planning (CRITICAL):
- Keep scenes around 4-6 seconds each for natural pacing
- If user does not specify a duration, DEFAULT to 30 seconds minimum with 5-7 scenes
- Calculate the number of scenes based on total duration:
  * For 30 seconds: Generate 5-7 scenes (approximately 5 seconds per scene)
  * For 1 minute (60 seconds): Generate 10-12 scenes (approximately 5 seconds per scene)
  * For 2 minutes (120 seconds): Generate 20-24 scenes (approximately 5 seconds per scene)
  * For custom durations: Calculate scenes by dividing total seconds by 5 (e.g., 45 seconds = 9 scenes, 90 seconds = 18 scenes)
- Ensure all scenes have proper time_range that covers the ENTIRE video duration without gaps
- Scene time ranges should not overlap and should sequentially cover the full duration
- Example: For 30 seconds, scenes should be numbered 1, 2, 3, 4, 5, 6 with time ranges like "0-5s", "5-10s", "10-15s", "15-20s", "20-25s", "25-30s"
- If user specifies duration, adjust number and lengths of scenes accordingly

Output Format:
{
  "video_type": "Cutout Overlay",
  "duration": "30 seconds",
  "video_topic": "One short phrase for the overall video theme (e.g. work from home benefits)",
  "visual_style_guide": {
    "color_palette": "Describe natural, realistic colors as in a documentary photo for b-roll backgrounds",
    "lighting": "Describe natural lighting for b-roll backgrounds (e.g., 'Natural daylight, documentary style')",
    "mood": "Describe authentic atmosphere for b-roll backgrounds (e.g., 'Documentary, factual, authentic')",
    "camera_style": "Describe documentary framing (e.g., 'Documentary style, natural perspective')",
    "time_of_day": "Specify consistent time for all b-roll backgrounds",
    "visual_tone": "Describe documentary tone for b-roll (e.g., 'Documentary photograph, authentic')",
    "recurring_elements": "List any visual elements that should appear consistently in backgrounds"
  },
  "avatar_image_prompt": "Full prompt string for the avatar image, matching visual_style_guide and style (e.g. waist-up portrait, neutral background, soft lighting for cutout overlay).",
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-5s",
      "voiceover": "${lang.cutout}",
      "broll_visual_description": "Describe Indian environment — cafes, offices, markets, metro, festivals, streets, villages.",
      "broll_image_prompt": "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description]",
      "broll_video_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: description with motion]",
      "stock_search_term": "keywords for stock footage search",
      "avatar_cutout_position": "bottom-left" | "bottom-right" | "center" | etc.,
      "avatar_action": "Describe Indian avatar gestures, expressions, tone.",
      "avatar_motion": "Single word describing avatar's motion such as 'nod', 'raise-hand', 'smile'"
    },
    {
      "scene_number": 2,
      "time_range": "5-10s",
      "voiceover": "${lang.cutout}",
      "broll_visual_description": "Describe next Indian environment",
      "broll_image_prompt": "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: different description]",
      "broll_video_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: different description with motion]",
      "stock_search_term": "keywords for stock footage search",
      "avatar_cutout_position": "bottom-left",
      "avatar_action": "Describe avatar gestures",
      "avatar_motion": "smile"
    }
  ],
  "IMPORTANT NOTE": "You must generate MULTIPLE scenes (5-7 for 30 seconds, 10-12 for 1 minute, etc.) to cover the entire video duration. The scenes array above shows only the structure - you must create enough scenes to fill the requested duration.",
  "notes": {
    "overlay_style": "Soft edges, light blending, realistic shadows; match Indian lighting.",
    "color_tone": "Natural, documentary, authentic Indian aesthetic.",
    "visual_consistency": "Reference the visual_style_guide to ensure all b-roll backgrounds maintain the same visual style"
  }
}

CRITICAL PROMPT GENERATION RULES:
1. FIRST, determine the visual_style_guide based on the user's topic/idea - this is the MOST IMPORTANT step
2. The visual_style_guide MUST be consistent across ALL scenes
3. EVERY broll_image_prompt MUST start with "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images]" followed by visual style parameters
4. Full format for broll_image_prompt: "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: specific description]"
5. EVERY broll_image_prompt must produce PHOTOREALISTIC output. Prepend "Photorealistic, documentary photograph, real-world, " to the scene-specific description when writing prompts. Avoid artistic or symbolic interpretations.
6. Use the EXACT same wording for style parameters in every prompt
7. Only the scene-specific part should vary between scenes
8. Extract the style parameters from visual_style_guide and use them verbatim in every prompt
9. NEVER generate grids, collages, split-screen, or multiple images in one - each scene must be ONE single focused image
10. You MUST include top-level "video_topic" and ensure every scene's broll prompts tie to this topic so the global context is never lost

Guidelines:
- ${lang.instruction} - this is CRITICAL.
- Avatar must always be visible and should appear Indian.
- B-roll must reflect Indian context unless user says otherwise.
- Keep scenes around 4-6 seconds each for natural pacing.
- CRITICAL: Generate enough scenes to cover the entire video duration (5-7 scenes for 30 seconds, 10-12 for 1 minute, etc.)
- Each scene should be 4-6 seconds, and the total number of scenes must cover the full duration without gaps
- Keep pacing aligned with the requested duration (minimum 30 seconds if not specified).
- Maintain consistency in avatar position and lighting.
- VISUAL CONSISTENCY IS CRITICAL: All b-roll backgrounds must look like they belong to the same video with the same visual style.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,

    'AVATAR_ONLY': `You are a professional video director creating avatar-only videos where an Indian-looking avatar delivers ${lang.dialogue} in a full-screen format.

CRITICAL REQUIREMENTS:
- Avatar must be prominently featured in every scene
- No b-roll backgrounds - focus entirely on the avatar
- Avatar should deliver engaging ${lang.dialogue}
- Visual style must be consistent

Output Requirements:

Video Duration and Scene Planning (CRITICAL):
- Each scene should be 4-6 seconds long for natural pacing
- If user does not specify a duration, DEFAULT to 30 seconds minimum with 5-7 scenes
- Calculate the number of scenes based on total duration:
  * For 30 seconds: Generate 5-7 scenes (approximately 5 seconds per scene)
  * For 1 minute (60 seconds): Generate 10-12 scenes (approximately 5 seconds per scene)
  * For 2 minutes (120 seconds): Generate 20-24 scenes (approximately 5 seconds per scene)
  * For custom durations: Calculate scenes by dividing total seconds by 5
- Ensure all scenes have proper time_range that covers the ENTIRE video duration without gaps
- Scene time ranges should not overlap and should sequentially cover the full duration

IMPORTANT: You must return your response as a valid JSON object.

Structure Your Output in This JSON Format:
{
  "video_type": "Avatar Only",
  "duration": "30 seconds",
  "visual_style_guide": {
    "color_palette": "Describe the consistent color scheme",
    "lighting": "Avatar-focused lighting",
    "mood": "Engaging presentation mood",
    "camera_style": "Avatar cinematography",
    "time_of_day": "Specify consistent time",
    "visual_tone": "Professional avatar presentation"
  },
  "avatar_image_prompt": "Full prompt string for the avatar image, matching visual_style_guide and style (e.g. full-screen avatar, neutral background, soft lighting).",
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-5s",
      "voiceover": "${lang.example}",
      "avatar_action": "Describe avatar's expression and delivery",
      "avatar_motion": "nod", "smile", "gesture", etc.
    }
  ],
  "notes": "Avatar-only video - no b-roll"
}

Guidelines:
- ${lang.instruction}
- Keep pacing aligned with the requested duration (minimum 30 seconds if not specified).
- VISUAL CONSISTENCY IS CRITICAL: All scenes must maintain consistent avatar presentation style.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,

    'ANIMATED_AVATAR': `You are a professional video director creating 3D animated avatar-only videos where an Indian-looking animated avatar delivers ${lang.dialogue} in a full-screen format.

CRITICAL REQUIREMENTS:
- Avatar must be prominently featured in every scene
- No b-roll backgrounds - focus entirely on the avatar
- Avatar should deliver engaging ${lang.dialogue}
- Visual style must be consistent
- CRITICAL - avatar_image_prompt: Output ONLY a short description of the 3D animated aesthetic (e.g. "3D animated character", "stylized 3D animated look", "animated 3D presenter"). Do NOT include position, pose, desk, microphone, or setup—the user's avatar style preset provides those. The avatar_image_prompt is combined with the preset on the backend.

Output Requirements:

Video Duration and Scene Planning (CRITICAL):
- Each scene should be 4-6 seconds long for natural pacing
- If user does not specify a duration, DEFAULT to 30 seconds minimum with 5-7 scenes
- Calculate the number of scenes based on total duration:
  * For 30 seconds: Generate 5-7 scenes (approximately 5 seconds per scene)
  * For 1 minute (60 seconds): Generate 10-12 scenes (approximately 5 seconds per scene)
  * For 2 minutes (120 seconds): Generate 20-24 scenes (approximately 5 seconds per scene)
  * For custom durations: Calculate scenes by dividing total seconds by 5
- Ensure all scenes have proper time_range that covers the ENTIRE video duration without gaps
- Scene time ranges should not overlap and should sequentially cover the full duration

IMPORTANT: You must return your response as a valid JSON object.

Structure Your Output in This JSON Format:
{
  "video_type": "Animated Avatar",
  "duration": "30 seconds",
  "visual_style_guide": {
    "color_palette": "Describe the consistent color scheme",
    "lighting": "Avatar-focused lighting",
    "mood": "Engaging presentation mood",
    "camera_style": "Avatar cinematography",
    "time_of_day": "Specify consistent time",
    "visual_tone": "Professional 3D animated avatar presentation"
  },
  "avatar_image_prompt": "Short 3D animated style only (e.g. '3D animated character' or 'stylized 3D animated look'). No position, pose, or setup.",
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-5s",
      "voiceover": "${lang.example}",
      "avatar_action": "Describe avatar's expression and delivery",
      "avatar_motion": "nod", "smile", "gesture", etc.
    }
  ],
  "notes": "Animated avatar-only video - no b-roll"
}

Guidelines:
- ${lang.instruction}
- Keep pacing aligned with the requested duration (minimum 30 seconds if not specified).
- VISUAL CONSISTENCY IS CRITICAL: All scenes must maintain consistent 3D animated avatar style.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,

    'PRODUCT_ONLY': `You are a professional product video director who creates product showcase video scripts. The video will feature ONLY the product (no avatar, no human presenter, no person).

CRITICAL REQUIREMENTS:
- NO avatar, NO human, NO person in any scene
- Focus entirely on the product
- Product information has been pre-analyzed and will be provided in the asset context section
- Use the ACTUAL product details from the pre-analyzed information in your script
- All b-roll should showcase the product from different angles, contexts, and uses
- Visual style must be consistent across all scenes
- IMPORTANT: Use the actual product name and features from the pre-analyzed information. Do NOT use generic placeholders like "[Product Name]" or "[Product]"
${GLOBAL_BROLL_RULES}
${VIDEO_TOPIC_RULE}

CRITICAL IMAGE COMPOSITION RULES:
- Generate ONE SINGLE IMAGE per scene - NEVER a grid, collage, or multiple images combined
- Each broll_image_prompt MUST produce ONE focused shot, ONE perspective, ONE composition
- NEVER include: grids, collages, split-screen layouts, multiple product angles in one image, tiled views, or mosaic layouts
- Each scene should have its own unique single-image composition showing the product from ONE angle or in ONE context
- Add [COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] to every broll_image_prompt

Output Requirements:

Video Duration and Scene Planning (CRITICAL):
- Each scene should be 4-6 seconds long for natural pacing
- If user does not specify a duration, DEFAULT to 30 seconds minimum with 5-7 scenes
- Calculate the number of scenes based on total duration:
  * For 30 seconds: Generate 5-7 scenes (approximately 5 seconds per scene)
  * For 1 minute (60 seconds): Generate 10-12 scenes (approximately 5 seconds per scene)
  * For 2 minutes (120 seconds): Generate 20-24 scenes (approximately 5 seconds per scene)
  * For custom durations: Calculate scenes by dividing total seconds by 5
- Ensure all scenes have proper time_range that covers the ENTIRE video duration without gaps
- Scene time ranges should not overlap and should sequentially cover the full duration

IMPORTANT: You must return your response as a valid JSON object.

Structure Your Output in This JSON Format:
{
  "video_type": "Product Only",
  "duration": "30 seconds",
  "video_topic": "One short phrase for the overall video theme (e.g. product launch, key features)",
  "product_focus": true,
  "visual_style_guide": {
    "color_palette": "Describe natural, realistic colors (e.g., 'Natural product photography, realistic background')",
    "lighting": "Natural product lighting (e.g., 'Natural daylight or soft studio, documentary product shot')",
    "mood": "Documentary product mood (e.g., 'Authentic, factual product showcase')",
    "camera_style": "Documentary product framing (e.g., 'Documentary style, natural perspective, real product')",
    "time_of_day": "Specify consistent time",
    "visual_tone": "Documentary product presentation, photorealistic"
  },
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-5s",
      "voiceover": "${lang.example}",
      "broll_visual_description": "Product-focused description - NO human, NO avatar, NO person",
      "broll_image_prompt": "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: product showcase description] [CRITICAL: NO human, NO avatar, NO person in image]",
      "broll_video_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: product showcase with motion] [CRITICAL: NO human, NO avatar, NO person in video]"
    }
  ],
  "notes": "Product showcase video - no avatar or human elements"
}

CRITICAL PROMPT GENERATION RULES:
1. EVERY broll_image_prompt and broll_video_prompt MUST explicitly state "NO human, NO avatar, NO person"
2. EVERY broll_image_prompt MUST start with "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images]" followed by visual style parameters
3. Full format for broll_image_prompt: "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: product showcase description] [CRITICAL: NO human, NO avatar, NO person in image]"
4. EVERY broll_image_prompt must produce PHOTOREALISTIC output. Prepend "Photorealistic, documentary photograph, real-world, " to the scene-specific description when writing prompts. Avoid artistic or symbolic interpretations.
5. Focus on product angles, features, uses, and contexts - ONE product shot per scene
6. Create engaging product-focused visuals - NEVER grids, collages, or multiple product views in one image
7. Maintain visual consistency across all scenes
8. FIRST, determine the visual_style_guide based on the user's topic/idea
9. The visual_style_guide MUST be consistent across ALL scenes
10. EVERY broll_video_prompt MUST follow the same format but include motion/action words
11. NEVER generate grids, collages, split-screen, or multiple images in one - each scene must be ONE single focused product image
12. You MUST include top-level "video_topic" and ensure every scene's broll prompts tie to this topic so the global context is never lost

Guidelines:
- All visuals should focus on the product - ONE focused shot per scene
- ${lang.instruction}
- Keep pacing aligned with the requested duration (minimum 30 seconds if not specified).
- VISUAL CONSISTENCY IS CRITICAL: All scenes must look like they belong to the same video with the same visual style.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,

    'B_ROLL_ONLY': `You are a professional video director who creates b-roll only video scripts. The video will feature full-screen 9:16 b-roll for EVERY scene - no avatar overlay or separate presenter layer. B-roll may include people when they naturally support the story or demonstrate the topic.

CRITICAL REQUIREMENTS:
- NO avatar overlay or separate presenter layer in any scene
- All scenes use full-screen 9:16 b-roll images
- B-roll should primarily focus on the topic or product, but CAN include people when they naturally support the story or demonstrate the product in use
- Visual style must be consistent across all scenes
- Product/background assets may be provided in asset context - use them when available
${GLOBAL_BROLL_RULES}
${VIDEO_TOPIC_RULE}

CRITICAL IMAGE COMPOSITION RULES:
- Generate ONE SINGLE IMAGE per scene - NEVER a grid, collage, or multiple images combined
- Each broll_image_prompt MUST produce ONE focused shot, ONE perspective, ONE composition
- NEVER include: grids, collages, split-screen layouts, multiple angles in one image, tiled views, or mosaic layouts
- Add [COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] to every broll_image_prompt

Output Requirements:
- Each scene should be 4-6 seconds long for natural pacing
- DEFAULT to 30 seconds minimum with 5-7 scenes if user does not specify duration
- For 30 seconds: 5-7 scenes; For 1 minute: 10-12 scenes; For 2 minutes: 20-24 scenes

IMPORTANT: You must return your response as a valid JSON object.

Structure Your Output in This JSON Format:
{
  "video_type": "B-roll Only",
  "duration": "30 seconds",
  "video_topic": "One short phrase for the overall video theme (e.g. work from home benefits)",
  "visual_style_guide": {
    "color_palette": "Natural, realistic colors",
    "lighting": "Natural daylight or documentary style",
    "mood": "Documentary, factual, authentic",
    "camera_style": "Documentary style, natural perspective",
    "time_of_day": "Specify consistent time",
    "visual_tone": "Documentary photograph, photorealistic"
  },
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-5s",
      "voiceover": "${lang.example}",
      "broll_visual_description": "Scene-specific b-roll description that may include people when it naturally supports the narrative. Do NOT describe a separate avatar overlay.",
      "broll_image_prompt": "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: b-roll description with physically plausible human presence when appropriate]",
      "broll_video_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: b-roll with motion, optionally including people in natural positions when appropriate]"
    }
  ],
  "notes": "B-roll only video - no avatar overlay; b-roll may include people when appropriate and physically plausible"
}

CRITICAL PROMPT GENERATION RULES:
1. EVERY broll_image_prompt MUST start with "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images]"
2. EVERY broll_image_prompt must produce PHOTOREALISTIC output. Prepend "Photorealistic, documentary photograph, real-world, " to the scene-specific description.
3. Create engaging b-roll visuals that illustrate the narration - ONE focused shot per scene
4. Maintain visual consistency across all scenes
5. FIRST, determine the visual_style_guide based on the user's topic/idea
6. You MUST include top-level "video_topic" and ensure every scene's broll prompts tie to this topic so the global context is never lost

Guidelines:
- ${lang.instruction}
- Keep pacing aligned with the requested duration (minimum 30 seconds if not specified).
- VISUAL CONSISTENCY IS CRITICAL: All scenes must look like they belong to the same video.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,

    'AVATAR_PRODUCT': `You are a professional video director creating product advertisement videos featuring a presenter (avatar or auto-generated person) showcasing a product.

The video will feature:
- A presenter (${hasAvatar ? 'user-selected avatar' : 'auto-generated person'}) interacting with the product
- Product information has been pre-analyzed and will be provided in the asset context section
- Engaging product demonstration and advertisement

CRITICAL REQUIREMENTS:
- Product must be prominently featured in every scene
- Presenter (avatar or person) should interact with the product naturally
- Create engaging product demonstration scenarios
- Visual style must be consistent
- IMPORTANT: Use the actual product name and features from the pre-analyzed information. Do NOT use generic placeholders like "[Product Name]" or "[Product]"
${GLOBAL_BROLL_RULES}
${VIDEO_TOPIC_RULE}

CRITICAL IMAGE COMPOSITION RULES:
- Generate ONE SINGLE IMAGE per scene - NEVER a grid, collage, or multiple images combined
- Each broll_image_prompt MUST produce ONE focused shot, ONE perspective, ONE composition
- NEVER include: grids, collages, split-screen layouts, multiple product angles in one image, tiled views, or mosaic layouts
- Each scene should have its own unique single-image composition
- Add [COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] to every broll_image_prompt

Output Requirements:

Video Duration and Scene Planning (CRITICAL):
- Each scene should be 4-6 seconds long for natural pacing
- If user does not specify a duration, DEFAULT to 30 seconds minimum with 5-7 scenes
- Calculate the number of scenes based on total duration:
  * For 30 seconds: Generate 5-7 scenes (approximately 5 seconds per scene)
  * For 1 minute (60 seconds): Generate 10-12 scenes (approximately 5 seconds per scene)
  * For 2 minutes (120 seconds): Generate 20-24 scenes (approximately 5 seconds per scene)
  * For custom durations: Calculate scenes by dividing total seconds by 5
- Ensure all scenes have proper time_range that covers the ENTIRE video duration without gaps
- Scene time ranges should not overlap and should sequentially cover the full duration

IMPORTANT: You must return your response as a valid JSON object.

Structure Your Output in This JSON Format:
{
  "video_type": "Avatar with Product",
  "duration": "30 seconds",
  "video_topic": "One short phrase for the overall video theme (e.g. product launch, key features)",
  "product_focus": true,
  "visual_style_guide": {
    "color_palette": "Describe natural, realistic colors (e.g., 'Natural product photography, realistic background')",
    "lighting": "Natural product + presenter lighting (e.g., 'Natural daylight or soft studio')",
    "mood": "Documentary product advertisement mood (e.g., 'Authentic, factual product demo')",
    "camera_style": "Documentary product demonstration framing (e.g., 'Documentary style, natural perspective')",
    "time_of_day": "Specify consistent time",
    "visual_tone": "Professional product advertisement"
  },
  "avatar_image_prompt": "Full prompt string for the avatar image, matching visual_style_guide and style (e.g. presenter with product, neutral background, soft lighting).",
  "scenes": [
    {
      "scene_number": 1,
      "time_range": "0-5s",
      "voiceover": "${lang.example}",
      "broll_visual_description": "Presenter (avatar or person) showcasing/using the product",
      "broll_image_prompt": "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: presenter demonstrating product]",
      "broll_video_prompt": "[Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: presenter demonstrating product with motion]",
      "avatar_action": "Presenter showcasing the product...",
      "avatar_motion": "point", "hold", "demonstrate", etc.
    }
  ],
  "notes": "Product advertisement with presenter"
}

CRITICAL PROMPT GENERATION RULES:
1. Product must be visible and prominent in every scene
2. Presenter must interact with product naturally
3. Create engaging product demonstration scenarios
4. Maintain visual consistency across all scenes
5. FIRST, determine the visual_style_guide based on the user's topic/idea
6. The visual_style_guide MUST be consistent across ALL scenes
7. EVERY broll_image_prompt MUST start with "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images]" followed by visual style parameters
8. Full format for broll_image_prompt: "[COMPOSITION: Single focused shot, NO grid, NO collage, NO multiple images] [Color palette: X] [Lighting: Y] [Mood: Z] [Camera: W] [Time: T] [Tone: U] [Scene-specific: presenter demonstrating product]"
9. EVERY broll_image_prompt must produce PHOTOREALISTIC output. Prepend "Photorealistic, documentary photograph, real-world, " to the scene-specific description when writing prompts. Avoid artistic or symbolic interpretations.
10. EVERY broll_video_prompt MUST follow the same format but include motion/action words
11. NEVER generate grids, collages, split-screen, or multiple images in one - each scene must be ONE single focused image
12. You MUST include top-level "video_topic" and ensure every scene's broll prompts tie to this topic so the global context is never lost

Guidelines:
- All visuals should feature product + presenter interaction - ONE focused shot per scene
- ${lang.instruction}
- Keep pacing aligned with the requested duration (minimum 30 seconds if not specified).
- VISUAL CONSISTENCY IS CRITICAL: All scenes must look like they belong to the same video with the same visual style.${tags.length > 0 ? this.buildTagEnhancementSection(tags, this.processTagsForVisualStyle(tags)) : ''}`,
  };

  const basePrompt = prompts[style as keyof typeof prompts] || prompts['HALF_N_HALF'];
  const regionContext = this.getRegionContext(language);

  // Append specificity rule, base prompt, asset context, URL context, optional avatar context, and region context
  return SPECIFICITY_RULE + basePrompt + assetContext + urlContext + avatarContext + regionContext;
}

  /**
   * Get region/locale context for script generation.
   * Indian default for ALL languages (english, hindi, hinglish).
   */
  private getRegionContext(_language: 'english' | 'hindi' | 'hinglish'): string {
    return `

REGION CONTEXT (CRITICAL - Indian Default):
- All content must use Indian context. B-roll and avatar descriptions must use Indian settings.
- Show Indian people, Indian locations (markets, offices, streets, villages, cafes, metro, festivals), Indian aesthetic.
- Every visual_style_guide, broll_image_prompt, broll_video_prompt, and avatar_image_prompt must explicitly mention Indian context (e.g. "Indian street", "Indian auto driver", "Indian office", "Indian family") unless the user specifies another region.
- People, accessories, objects, scenes, and locations must be explicitly Indian (e.g. "Indian auto driver driving on Indian road", "Indian market with Indian vendors").
- For product-focused videos: use Indian context (e.g. "Indian product showcase", "Indian retail setting") where relevant.`;
  }

  /**
   * Wait for asset analysis completion and extract analyzed assets from project metadata
   */
  private async waitForAssetAnalysisAndExtract(
    projectId: string,
    userId?: string,
    timeoutMs?: number
  ): Promise<Array<{ id: string; category: string; extractedText?: string; productInfo?: any; url: string }> | undefined> {
    const effectiveTimeout = timeoutMs ?? this.assetAnalysisTimeoutMs;
    const startTime = Date.now();
    const checkInterval = 1000; // Check every second
    const logIntervalMs = 5000; // Log status every 5 seconds to avoid spam
    let lastLogTime = 0;

    this.logger.log(`Waiting for asset analysis for project ${projectId} (max wait: ${Math.round(effectiveTimeout / 1000)}s, will proceed when completed/failed or at cap)`, 'ScriptsService');

    while (Date.now() - startTime < effectiveTimeout) {
      try {
        const project = await this.getProject(projectId, userId);
        if (!project) {
          this.logger.warn(`Project ${projectId} not found`, 'ScriptsService');
          return undefined;
        }

        const metadata = project.metadata as any;
        const analysisStatus = metadata?.assetAnalysis;
        const status = analysisStatus?.status ?? 'pending';

        if (Date.now() - lastLogTime >= logIntervalMs) {
          this.logger.log(`Asset analysis status for project ${projectId}: ${status} (elapsed: ${Math.round((Date.now() - startTime) / 1000)}s)`, 'ScriptsService');
          lastLogTime = Date.now();
        }

        if (analysisStatus?.status === 'completed') {
          const analyzedAssets = metadata?.analyzedAssets;
          if (analyzedAssets && Array.isArray(analyzedAssets) && analyzedAssets.length > 0) {
            this.logger.log(`Found ${analyzedAssets.length} analyzed assets for project ${projectId}`, 'ScriptsService');
            return analyzedAssets.map((asset: any) => ({
              id: asset.originalAsset?.id || asset.id,
              category: asset.category,
              extractedText: asset.extractedText,
              productInfo: asset.productInfo,
              url: asset.originalAsset?.url || asset.url,
            }));
          }
          return undefined;
        }

        if (analysisStatus?.status === 'failed') {
          this.logger.warn(`Asset analysis failed for project ${projectId}`, 'ScriptsService');
          return undefined;
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch (error: any) {
        this.logger.warn(`Error checking asset analysis status: ${error.message}`, 'ScriptsService');
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
    }

    this.logger.warn(`Asset analysis max wait reached for project ${projectId} after ${effectiveTimeout}ms, proceeding without analysis`, 'ScriptsService');
    return undefined;
  }

  /**
   * When asset analysis is unavailable (timeout/failed), fetch raw metadata.assets from project
   * so script generation can still attach images for vision and reference.
   */
  private async getRawAssetsFallback(
    projectId: string,
    userId: string
  ): Promise<Array<{ id: string; category: string; url: string }> | undefined> {
    try {
      const project = await this.getProject(projectId, userId);
      if (!project?.metadata) return undefined;

      const metadata = project.metadata as any;
      let assets = metadata?.assets;
      if (typeof assets === 'string') {
        try {
          assets = JSON.parse(assets);
        } catch {
          return undefined;
        }
      }
      if (!Array.isArray(assets) || assets.length === 0) return undefined;

      return assets
        .filter((a: any) => a?.url || (a as any).publicUrl || (a as any).imageUrl)
        .map((a: any) => ({
          id: a.id || `raw-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          category: (a.category || (a as any).userLabel || 'reference').toLowerCase(),
          url: a.url || (a as any).publicUrl || (a as any).imageUrl,
        }));
    } catch {
      return undefined;
    }
  }

  /**
   * Get project from video-processing-service
   */
  private async getProject(projectId: string, userId?: string): Promise<any> {
    try {
      let token: string;
      
      if (userId) {
        // Use actual userId if provided
        token = jwt.sign(
          { sub: userId, userId, id: userId, type: 'service' },
          this.jwtSecret,
          { expiresIn: '1h' }
        );
      } else {
        // Fallback to service token (may not work for projects that require userId filtering)
        token = jwt.sign(
          { sub: 'service', type: 'service' },
          this.jwtSecret,
          { expiresIn: '1h' }
        );
      }
      
      const response = await axios.get(
        `${this.videoProcessingServiceUrl}/api/video-projects/${projectId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          timeout: 5000,
        }
      );
      
      return response.data?.data;
    } catch (error: any) {
      this.logger.warn(`Failed to fetch project ${projectId}: ${error.message}`, 'ScriptsService');
      return null;
    }
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
    // Add photorealism anchor first - ensures image model prioritizes realism
    parts.push('[Style: Photorealistic, documentary photograph, real-world, natural textures]');
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
   * Normalize prompts to ensure they all have consistent style parameters.
   * Indian context fallback for all languages.
   */
  private normalizePrompts(scriptData: any, _language: 'english' | 'hindi' | 'hinglish' = 'hinglish'): any {
    if (!scriptData) return scriptData;

    const sceneFallback = 'Indian context scene';
    const sceneFallbackMotion = 'Indian context scene with motion';

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
    const videoTopic = scriptData.video_topic || scriptData.theme_context || '';

    // Normalize each scene's prompts
    scenes.forEach((scene: any) => {
      // For ALTERNATE style, ALL scenes (both avatar and b-roll type) need b-roll images
      const videoType = (scriptData.video_type || '').toLowerCase();

      if (videoType === 'alternating' && !scene.broll_image_prompt && scene.broll_visual_description) {
        const sceneSpecific = scene.broll_visual_description || sceneFallback;
        scene.broll_image_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific}]`;
      }

      if (scene.broll_image_prompt) {
        if (!this.hasStyleParameters(scene.broll_image_prompt)) {
          const sceneSpecific = this.extractSceneSpecific(scene.broll_image_prompt) || scene.broll_visual_description || sceneFallback;
          scene.broll_image_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific}]`;
        } else {
          const sceneSpecific = this.extractSceneSpecific(scene.broll_image_prompt) || scene.broll_visual_description || sceneFallback;
          scene.broll_image_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific}]`;
        }
        if (videoTopic && videoTopic.trim() && !scene.broll_image_prompt.includes('[Video topic:')) {
          scene.broll_image_prompt = `[Video topic: ${videoTopic.trim()}. ] ${scene.broll_image_prompt}`;
        }
      }

      if (scene.broll_video_prompt) {
        if (!this.hasStyleParameters(scene.broll_video_prompt)) {
          const sceneSpecific = this.extractSceneSpecific(scene.broll_video_prompt) || scene.broll_visual_description || sceneFallbackMotion;
          scene.broll_video_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific} with dynamic movement and cinematic motion]`;
        } else {
          const sceneSpecific = this.extractSceneSpecific(scene.broll_video_prompt) || scene.broll_visual_description || sceneFallbackMotion;
          scene.broll_video_prompt = `${stylePrefix} [Scene-specific: ${sceneSpecific} with dynamic movement and cinematic motion]`;
        }
        if (videoTopic && videoTopic.trim() && !scene.broll_video_prompt.includes('[Video topic:')) {
          scene.broll_video_prompt = `[Video topic: ${videoTopic.trim()}. ] ${scene.broll_video_prompt}`;
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
   * Extract duration from user prompt text as a fallback
   * Looks for patterns like "1 minute video", "30 second", "2 min", etc.
   */
  private extractDurationFromPrompt(userPrompt: string): string | null {
    if (!userPrompt) return null;
    
    const normalized = userPrompt.toLowerCase();
    
    // Patterns to match duration mentions in user text
    const patterns = [
      // "one minute", "two minutes", etc.
      /\b(one|two|three|four|five)\s*(minute|min)s?\b/i,
      // "1 minute", "2 minutes", "30 seconds", etc.
      /\b(\d+)\s*(minute|min|second|sec)s?\b/i,
      // "1-minute", "30-second" (hyphenated)
      /\b(\d+)-(minute|min|second|sec)s?\b/i,
    ];
    
    // Word to number mapping
    const wordToNum: Record<string, number> = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
    };
    
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        let value = match[1];
        const unit = match[2].toLowerCase();
        
        // Convert word to number if needed
        if (wordToNum[value]) {
          value = String(wordToNum[value]);
        }
        
        const num = parseInt(value, 10);
        if (!isNaN(num)) {
          if (unit.startsWith('min')) {
            console.log(`[ScriptsService] Extracted duration from prompt: ${num} minute(s)`);
            return `${num} minute${num > 1 ? 's' : ''}`;
          } else {
            console.log(`[ScriptsService] Extracted duration from prompt: ${num} second(s)`);
            return `${num} second${num > 1 ? 's' : ''}`;
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Calculate expected number of scenes based on duration and video style
   */
  private calculateExpectedScenes(durationSeconds: number, videoStyle: string): { min: number; max: number; target: number } {
    // Different styles have different pacing
    const secondsPerScene = videoStyle === 'ALTERNATE' ? 6 : 5;
    
    const target = Math.round(durationSeconds / secondsPerScene);
    const min = Math.max(3, Math.floor(durationSeconds / (secondsPerScene + 1)));
    const max = Math.ceil(durationSeconds / (secondsPerScene - 1));
    
    console.log(`[ScriptsService] Expected scenes for ${durationSeconds}s ${videoStyle}: target=${target}, range=${min}-${max}`);
    
    return { min, max, target };
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
        // For ALTERNATE style, check both "b-roll" (odd) and "half-n-half" (even) scenes
        return (s.type === 'b-roll' || s.type === 'half-n-half') && (s.broll_image_prompt || s.broll_video_prompt);
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
      // For ALTERNATE style, process both "b-roll" (odd scenes) and "half-n-half" (even scenes)
      // Skip only if type is explicitly "avatar" (old format)
      if (videoType === 'alternating' && scene.type === 'avatar') {
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
