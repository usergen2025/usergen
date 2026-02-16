import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../common/logger/logger.service';
import OpenAI from 'openai';
import axios from 'axios';

export type RecommendedUsage = 'reference_only' | 'direct_broll' | 'background';

export interface AnalyzedAsset {
  id: string;
  originalAsset: {
    id: string;
    /** Public URL used for Vision/APIs; stored so downstream (script, b-roll refs) can use it without re-resolving */
    url: string;
    /** Original input URL (e.g. /uploads/...) for display/audit */
    originalUrl?: string;
    type: 'image' | 'url';
    userLabel?: string;
  };
  category: 'logo' | 'product' | 'background' | 'branding' | 'reference' | 'environment';
  extractedText?: string; // For logos
  productInfo?: {
    name?: string;
    type?: string;
    features?: string[];
    colors?: string[];
    useCases?: string[];
    targetAudience?: string;
  };
  confidence: number;
  /** For logos: true if clean/solid background, suitable to pass as reference image for overlay in generation */
  suitableForReferenceOverlay?: boolean;
  /** For product/background: false if background is busy or stylized and image cannot be used as-is as B-roll */
  canUseAsDirectBroll?: boolean;
  /** Recommended usage: reference_only (use in image-to-image), direct_broll (use as clip), background */
  recommendedUsage?: RecommendedUsage;
  /** For background/environment: suitable to use as background layer */
  suitableAsBackground?: boolean;
  analysisMetadata: {
    model: string;
    analyzedAt: string;
    processingTime: number;
  };
}

@Injectable()
export class AssetAnalysisService {
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

  /**
   * Analyze a single asset using OpenAI Vision API
   */
  async analyzeAsset(assetUrl: string, userLabel?: string): Promise<AnalyzedAsset> {
    const startTime = Date.now();

    if (!this.openai) {
      throw new Error('OpenAI API key is not configured');
    }

    // Ensure URL is publicly accessible
    let publicUrl = assetUrl;
    if (!publicUrl.startsWith('http://') && !publicUrl.startsWith('https://')) {
      const backendBaseUrl = this.configService.get<string>('BACKEND_BASE_URL') || 
                            this.configService.get<string>('NEXT_PUBLIC_WS_URL') || 
                            'http://localhost:9001';
      if (publicUrl.startsWith('/uploads')) {
        publicUrl = `${backendBaseUrl}${publicUrl}`;
      } else {
        throw new Error(`Asset URL must be publicly accessible HTTP(S) URL. Received: ${publicUrl.substring(0, 100)}`);
      }
    }

    // Pre-warm URL to ensure it's accessible
    await this.preWarmUrl(publicUrl);

    // Build analysis prompt based on user label or general categorization
    const analysisPrompt = this.buildAnalysisPrompt(userLabel);

    try {
      const analysis = await this.callOpenAIVisionAPI(publicUrl, analysisPrompt);
      
      const processingTime = Date.now() - startTime;

      // Extract category
      const category = this.extractCategoryFromAnalysis(analysis, userLabel);

      // Extract text if it's a logo
      const extractedText = category === 'logo' ? this.extractTextFromLogo(analysis) : undefined;

      // Extract product info if it's a product
      const productInfo = category === 'product' ? this.extractProductInfo(analysis) : undefined;

      // Extract confidence
      const confidence = this.extractConfidence(analysis);

      // Usability fields for B-roll and reference image flow
      const suitableForReferenceOverlay = category === 'logo' ? this.extractSuitableForReferenceOverlay(analysis) : undefined;
      const canUseAsDirectBroll = (category === 'product' || category === 'background' || category === 'environment') ? this.extractCanUseAsDirectBroll(analysis) : undefined;
      const recommendedUsage = (category === 'product' || category === 'background' || category === 'environment') ? this.extractRecommendedUsage(analysis, category) : undefined;
      const suitableAsBackground = (category === 'background' || category === 'environment') ? this.extractSuitableAsBackground(analysis) : undefined;

      return {
        id: `analyzed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        originalAsset: {
          id: '',
          url: publicUrl,
          originalUrl: assetUrl,
          type: 'image',
          userLabel,
        },
        category,
        extractedText,
        productInfo,
        confidence,
        suitableForReferenceOverlay,
        canUseAsDirectBroll,
        recommendedUsage,
        suitableAsBackground,
        analysisMetadata: {
          model: 'gpt-4o',
          analyzedAt: new Date().toISOString(),
          processingTime,
        },
      };
    } catch (error: any) {
      this.logger.error(`Asset analysis failed for ${publicUrl}: ${error.message}`, error.stack, 'AssetAnalysisService');
      throw error;
    }
  }

  /**
   * Analyze multiple assets in parallel
   */
  async analyzeMultipleAssets(assets: Array<{ id: string; url: string; type: 'image' | 'url'; userLabel?: string }>): Promise<AnalyzedAsset[]> {
    const results = await Promise.allSettled(
      assets.map(asset => 
        this.analyzeAsset(asset.url, asset.userLabel)
          .then(result => ({
            ...result,
            originalAsset: {
              ...result.originalAsset,
              id: asset.id,
            },
          }))
      )
    );

    const analyzedAssets: AnalyzedAsset[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        analyzedAssets.push(result.value);
      } else {
        this.logger.warn(`Failed to analyze asset ${assets[index].id}: ${result.reason}`, 'AssetAnalysisService');
        // Create a fallback analyzed asset with user label; resolve public URL so downstream can use it
        const inputUrl = assets[index].url;
        let fallbackPublicUrl = inputUrl;
        if (!inputUrl.startsWith('http://') && !inputUrl.startsWith('https://')) {
          const backendBaseUrl = this.configService.get<string>('BACKEND_BASE_URL') ||
            this.configService.get<string>('NEXT_PUBLIC_WS_URL')?.replace('/ws', '') ||
            'http://localhost:9001';
          fallbackPublicUrl = inputUrl.startsWith('/') ? `${backendBaseUrl}${inputUrl}` : `${backendBaseUrl}/${inputUrl}`;
        }
        analyzedAssets.push({
          id: `analyzed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          originalAsset: {
            id: assets[index].id,
            url: fallbackPublicUrl,
            originalUrl: inputUrl,
            type: assets[index].type,
            userLabel: assets[index].userLabel,
          },
          category: this.inferCategoryFromUserLabel(assets[index].userLabel) || 'reference',
          confidence: 0.5,
          analysisMetadata: {
            model: 'fallback',
            analyzedAt: new Date().toISOString(),
            processingTime: 0,
          },
        });
      }
    });

    return analyzedAssets;
  }

  /**
   * Build analysis prompt based on user label or general categorization
   */
  private buildAnalysisPrompt(userLabel?: string): string {
    if (userLabel?.toLowerCase() === 'logo') {
      return `Analyze this image and determine:
1. Is this a logo? (yes/no with confidence score 0-1)
2. What text is visible in the logo? (extract ALL text exactly as it appears, including brand names, company names, taglines)
3. What is the primary brand name? (extract the main brand/company name)
4. What colors are used in the logo?
5. What is the design style? (modern, classic, minimalist, etc.)
6. Is the logo on a clean or solid/transparent background suitable for use as a reference overlay in image generation (e.g. logo on white/black/transparent)? Set suitableForReferenceOverlay true only if the logo can be cleanly used as a reference image.

Return your analysis as a JSON object with the following structure:
{
  "isLogo": true/false,
  "confidence": 0.0-1.0,
  "extractedText": "all text visible in the logo",
  "brandName": "primary brand name",
  "colors": ["color1", "color2"],
  "designStyle": "style description",
  "suitableForReferenceOverlay": true/false
}`;
    } else if (userLabel?.toLowerCase() === 'product' || userLabel?.toLowerCase().includes('product')) {
      return `Analyze this product image and extract:
1. Product name (if visible or can be inferred)
2. Product type/category (e.g., notebook, smartphone, clothing, electronics, furniture, etc.)
3. Key features visible in the image (materials, design elements, size, shape, etc.)
4. Colors and design elements
5. Use cases and contexts where this product would be used
6. Target audience based on product appearance
7. Can this image be used directly as B-roll footage as-is (e.g. full frame with no change)? Consider: is the background busy, stylized, or distracting? If background is busy or the scene is too specific, set canUseAsDirectBroll false and recommendedUsage "reference_only". If the image is clean and generic enough to use as a clip, set canUseAsDirectBroll true and recommendedUsage "direct_broll".

Return your analysis as a JSON object with the following structure:
{
  "productName": "name of the product",
  "productType": "category/type",
  "features": ["feature1", "feature2"],
  "colors": ["color1", "color2"],
  "useCases": ["use case 1", "use case 2"],
  "targetAudience": "target audience description",
  "canUseAsDirectBroll": true/false,
  "recommendedUsage": "reference_only" or "direct_broll"
}`;
    } else {
      // General categorization
      return `Categorize this image as one of the following:
- logo: Brand logo with text or brand identifier
- product: Product showcase, product photography
- background: Environment/background scene, landscape, setting
- branding: Brand elements, marketing materials
- reference: Reference image for generation, style reference
- environment: Setting/environment, location, scene

Analyze the image and determine:
1. The most appropriate category
2. Confidence score (0.0-1.0)
3. If it's a logo, extract all visible text and set suitableForReferenceOverlay (true if clean/solid background)
4. If it's a product, extract product name, type, key features, and set canUseAsDirectBroll (false if background busy/stylized) and recommendedUsage ("reference_only" or "direct_broll")
5. If it's a background/environment, describe the setting and set suitableAsBackground (true if usable as background layer)

Return your analysis as a JSON object with the following structure:
{
  "category": "one of: logo, product, background, branding, reference, environment",
  "confidence": 0.0-1.0,
  "extractedText": "text if logo, null otherwise",
  "productInfo": { "name": "...", "type": "...", "features": [] } or null,
  "description": "brief description of the image",
  "suitableForReferenceOverlay": true/false (for logo),
  "canUseAsDirectBroll": true/false (for product/background),
  "recommendedUsage": "reference_only" or "direct_broll" or "background",
  "suitableAsBackground": true/false (for background/environment)
}`;
    }
  }

  /**
   * Call OpenAI Vision API to analyze image
   */
  private async callOpenAIVisionAPI(imageUrl: string, prompt: string, retryCount: number = 0): Promise<any> {
    const MAX_RETRIES = 2; // Maximum 2 retries (3 total attempts)
    
    if (!this.openai) {
      throw new Error('OpenAI API key is not configured');
    }

    // Validate URL before attempting
    if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
      throw new Error(`Invalid image URL: ${imageUrl}. URL must be a valid HTTP(S) URL.`);
    }

    // Check for placeholder/invalid URLs
    if (imageUrl.includes('example.com') || imageUrl.includes('placeholder') || imageUrl === 'x.png') {
      throw new Error(`Invalid placeholder URL detected: ${imageUrl}. Please provide a valid image URL.`);
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
            },
          },
        ],
      },
    ];

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.3, // Lower temperature for more consistent analysis
        max_tokens: 2000,
      });

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error('Empty response from OpenAI Vision API');
      }

      return JSON.parse(responseContent);
    } catch (error: any) {
      // Handle image timeout/invalid URL errors with retry limit
      if ((error.code === 'invalid_image_url' || (error.message && error.message.includes('Timeout'))) && retryCount < MAX_RETRIES) {
        this.logger.warn(`Image fetch timeout for ${imageUrl}, retrying (attempt ${retryCount + 1}/${MAX_RETRIES})...`, 'AssetAnalysisService');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.callOpenAIVisionAPI(imageUrl, prompt, retryCount + 1);
      }
      
      // If max retries reached or other error, throw with descriptive message
      if (retryCount >= MAX_RETRIES) {
        this.logger.error(`Image fetch failed after ${MAX_RETRIES + 1} attempts for ${imageUrl}`, 'AssetAnalysisService');
        throw new Error(`Failed to fetch image after ${MAX_RETRIES + 1} attempts: ${imageUrl}. The URL may be invalid or inaccessible.`);
      }
      
      throw error;
    }
  }

  /**
   * Extract category from analysis result
   */
  private extractCategoryFromAnalysis(analysis: any, userLabel?: string): AnalyzedAsset['category'] {
    // If user provided a label, use it as primary indicator
    if (userLabel) {
      const normalizedLabel = userLabel.toLowerCase();
      if (normalizedLabel === 'logo' || normalizedLabel.includes('logo')) {
        return 'logo';
      }
      if (normalizedLabel === 'product' || normalizedLabel.includes('product')) {
        return 'product';
      }
      if (normalizedLabel === 'background' || normalizedLabel.includes('background')) {
        return 'background';
      }
    }

    // Use AI analysis result
    const category = analysis.category?.toLowerCase();
    if (category && ['logo', 'product', 'background', 'branding', 'reference', 'environment'].includes(category)) {
      return category as AnalyzedAsset['category'];
    }

    // Fallback based on analysis
    if (analysis.isLogo === true) {
      return 'logo';
    }
    if (analysis.productInfo || analysis.productName) {
      return 'product';
    }

    return 'reference'; // Default fallback
  }

  /**
   * Extract text from logo analysis
   */
  private extractTextFromLogo(analysis: any): string | undefined {
    // Try multiple possible fields
    return analysis.extractedText || 
           analysis.brandName || 
           analysis.text || 
           analysis.logoText ||
           undefined;
  }

  /**
   * Extract product information from analysis
   */
  private extractProductInfo(analysis: any): AnalyzedAsset['productInfo'] | undefined {
    if (!analysis.productInfo && !analysis.productName) {
      return undefined;
    }

    return {
      name: analysis.productInfo?.name || analysis.productName || undefined,
      type: analysis.productInfo?.type || analysis.productType || undefined,
      features: analysis.productInfo?.features || analysis.features || undefined,
      colors: analysis.productInfo?.colors || analysis.colors || undefined,
      useCases: analysis.productInfo?.useCases || analysis.useCases || undefined,
      targetAudience: analysis.productInfo?.targetAudience || analysis.targetAudience || undefined,
    };
  }

  /**
   * Extract confidence score from analysis
   */
  private extractConfidence(analysis: any): number {
    if (typeof analysis.confidence === 'number') {
      return Math.max(0, Math.min(1, analysis.confidence));
    }
    // Default confidence based on whether we have good data
    if (analysis.isLogo === true || analysis.productInfo || analysis.category) {
      return 0.8;
    }
    return 0.5;
  }

  private extractSuitableForReferenceOverlay(analysis: any): boolean {
    if (typeof analysis.suitableForReferenceOverlay === 'boolean') {
      return analysis.suitableForReferenceOverlay;
    }
    return true;
  }

  private extractCanUseAsDirectBroll(analysis: any): boolean {
    if (typeof analysis.canUseAsDirectBroll === 'boolean') {
      return analysis.canUseAsDirectBroll;
    }
    return false;
  }

  private extractRecommendedUsage(analysis: any, category: string): RecommendedUsage | undefined {
    const v = analysis.recommendedUsage;
    if (v === 'reference_only' || v === 'direct_broll' || v === 'background') {
      return v as RecommendedUsage;
    }
    if (category === 'background' || category === 'environment') {
      return 'background';
    }
    return 'reference_only';
  }

  private extractSuitableAsBackground(analysis: any): boolean {
    if (typeof analysis.suitableAsBackground === 'boolean') {
      return analysis.suitableAsBackground;
    }
    return true;
  }

  /**
   * Infer category from user label when analysis fails
   */
  private inferCategoryFromUserLabel(userLabel?: string): AnalyzedAsset['category'] | undefined {
    if (!userLabel) return undefined;
    
    const normalized = userLabel.toLowerCase();
    if (normalized.includes('logo')) return 'logo';
    if (normalized.includes('product')) return 'product';
    if (normalized.includes('background')) return 'background';
    if (normalized.includes('brand')) return 'branding';
    if (normalized.includes('environment') || normalized.includes('setting')) return 'environment';
    
    return undefined;
  }

  /**
   * Pre-warm URL to ensure it's accessible
   */
  private async preWarmUrl(url: string, maxAttempts = 2): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await axios.get(url, {
          timeout: 5000,
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'UserGen-AssetAnalysis/1.0',
          },
        });
        return true;
      } catch (error: any) {
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    return false;
  }
}



