import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../common/logger/logger.service';
import OpenAI from 'openai';
import axios from 'axios';
import { createConfiguredOpenAI } from '../common/openai/openai-client.util';
import { httpImageToOpenAIDataUrl } from '../common/openai/openai-vision-image.util';
import { extractAssistantText, formatCompletionDiagnostics } from '../common/openai/openai-completion.util';

export type RecommendedUsage = 'reference_only' | 'direct_broll' | 'background';
export type UrlContentType = 'image' | 'html' | 'unknown';

export interface UrlTypeDetectionResult {
  contentType: UrlContentType;
  mimeType?: string;
  isImage: boolean;
  isHtml: boolean;
}

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
  /** For logos: true if mark is compact/readable at small size for optional top-right corner overlay (not a wide banner) */
  suitableForTopRightBug?: boolean;
  /** For product/background: false if background is busy or stylized and image cannot be used as-is as B-roll */
  canUseAsDirectBroll?: boolean;
  /** Recommended usage: reference_only (use in image-to-image), direct_broll (use as clip), background */
  recommendedUsage?: RecommendedUsage;
  /** For background/environment: suitable to use as background layer */
  suitableAsBackground?: boolean;
  /** Neutral factual visual inventory for script/B-roll; from vision JSON; no real-person identification */
  visualScriptContext?: string;
  analysisMetadata: {
    model: string;
    analyzedAt: string;
    processingTime: number;
  };
}

@Injectable()
export class AssetAnalysisService {
  private static readonly MAX_VISUAL_SCRIPT_CONTEXT_CHARS = 2000;

  private openai: OpenAI;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const openAiBaseUrl = this.configService.get<string>('OPENAI_BASE_URL');
    if (apiKey) {
      this.openai = createConfiguredOpenAI(apiKey, openAiBaseUrl);
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
      const suitableForTopRightBug = category === 'logo' ? this.extractSuitableForTopRightBug(analysis) : undefined;
      const canUseAsDirectBroll = (category === 'product' || category === 'background' || category === 'environment') ? this.extractCanUseAsDirectBroll(analysis) : undefined;
      const recommendedUsage = (category === 'product' || category === 'background' || category === 'environment') ? this.extractRecommendedUsage(analysis, category) : undefined;
      const suitableAsBackground = (category === 'background' || category === 'environment') ? this.extractSuitableAsBackground(analysis) : undefined;
      const visualScriptContext = this.extractVisualScriptContext(analysis);

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
        suitableForTopRightBug,
        canUseAsDirectBroll,
        recommendedUsage,
        suitableAsBackground,
        visualScriptContext,
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
          visualScriptContext: '',
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
7. suitableForTopRightBug: true only if the logo is a compact mark (not a full-width banner), would stay readable when scaled to ~10% of frame width, and is suitable for a small fixed corner placement. False for busy full-bleed wordmarks or illegible-at-small-size designs.
8. visualScriptContext: REQUIRED. Write 2–6 sentences: neutral, factual description of the full frame (composition, background, colors, how the logo appears, lighting). Suitable for marketing copy and video scripts. Treat as a staged commercial/catalog asset. Do NOT identify or name real individuals.

Return your analysis as a JSON object with the following structure:
{
  "isLogo": true/false,
  "confidence": 0.0-1.0,
  "extractedText": "all text visible in the logo",
  "brandName": "primary brand name",
  "colors": ["color1", "color2"],
  "designStyle": "style description",
  "suitableForReferenceOverlay": true/false,
  "suitableForTopRightBug": true/false,
  "visualScriptContext": "multi-sentence neutral visual description as specified above"
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
8. visualScriptContext: REQUIRED. Write 2–6 sentences: neutral, factual visual inventory—setting, lighting, composition, product/apparel/object types, colors, materials, notable accessories, mood—for marketing copy and B-roll briefs. Staged commercial/catalog style. Do NOT identify or name real individuals.

Return your analysis as a JSON object with the following structure:
{
  "productName": "name of the product",
  "productType": "category/type",
  "features": ["feature1", "feature2"],
  "colors": ["color1", "color2"],
  "useCases": ["use case 1", "use case 2"],
  "targetAudience": "target audience description",
  "canUseAsDirectBroll": true/false,
  "recommendedUsage": "reference_only" or "direct_broll",
  "visualScriptContext": "multi-sentence neutral visual description as specified above"
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
3. If it's a logo, extract all visible text, set suitableForReferenceOverlay (true if clean/solid background), and suitableForTopRightBug (true only if compact mark readable at small corner size, false for wide banners)
4. If it's a product, extract product name, type, key features, and set canUseAsDirectBroll (false if background busy/stylized) and recommendedUsage ("reference_only" or "direct_broll")
5. If it's a background/environment, describe the setting and set suitableAsBackground (true if usable as background layer)
6. visualScriptContext: REQUIRED. Write 2–6 sentences: neutral, factual visual inventory—setting, lighting, composition, apparel/objects, colors, materials, mood—for marketing copy and B-roll briefs. Staged commercial/catalog style. Do NOT identify or name real individuals.

Return your analysis as a JSON object with the following structure:
{
  "category": "one of: logo, product, background, branding, reference, environment",
  "confidence": 0.0-1.0,
  "extractedText": "text if logo, null otherwise",
  "productInfo": { "name": "...", "type": "...", "features": [] } or null,
  "description": "brief one-line summary of the image",
  "visualScriptContext": "multi-sentence neutral visual description as specified above",
  "suitableForReferenceOverlay": true/false (for logo),
  "suitableForTopRightBug": true/false (for logo, optional compact corner suitability),
  "canUseAsDirectBroll": true/false (for product/background),
  "recommendedUsage": "reference_only" or "direct_broll" or "background",
  "suitableAsBackground": true/false (for background/environment)
}`;
    }
  }

  /**
   * Call OpenAI Vision API to analyze image (prefers resized JPEG data URL so OpenAI does not time out on large GCS URLs).
   */
  private async callOpenAIVisionAPI(imageUrl: string, prompt: string, retryCount: number = 0): Promise<any> {
    const MAX_RETRIES = 2;

    if (!this.openai) {
      throw new Error('OpenAI API key is not configured');
    }

    if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
      throw new Error(`Invalid image URL: ${imageUrl}. URL must be a valid HTTP(S) URL.`);
    }

    if (imageUrl.includes('example.com') || imageUrl.includes('placeholder') || imageUrl === 'x.png') {
      throw new Error(`Invalid placeholder URL detected: ${imageUrl}. Please provide a valid image URL.`);
    }

    const dataUrl = await httpImageToOpenAIDataUrl(imageUrl);
    const visionUrl = dataUrl ?? imageUrl;
    const detail: 'low' | 'auto' = dataUrl ? 'auto' : 'low';

    if (dataUrl) {
      this.logger.log(
        `Asset analysis vision: inline JPEG (~${Math.round(dataUrl.length / 1024)} KB base64)`,
        'AssetAnalysisService',
      );
    } else {
      this.logger.warn(
        `Asset analysis vision: could not inline; remote URL detail=low (${imageUrl.substring(0, 80)}...)`,
        'AssetAnalysisService',
      );
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: visionUrl,
              detail,
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
        temperature: 0.3,
        max_tokens: 2000,
      });

      const extracted = extractAssistantText(completion.choices[0]?.message);
      if (extracted.ok === true) {
        try {
          return JSON.parse(extracted.text);
        } catch (parseErr: any) {
          this.logger.warn(
            `${formatCompletionDiagnostics(completion, 'Vision JSON parse failed')}: ${parseErr?.message}`,
            'AssetAnalysisService',
          );
          throw new Error(
            `OpenAI vision returned non-JSON: ${parseErr?.message}. Snippet: ${extracted.text.slice(0, 300)}`,
          );
        }
      } else if (extracted.reason === 'refusal') {
        throw new Error(
          `OpenAI declined image analysis: ${extracted.refusal?.slice(0, 200) || 'refusal'}`,
        );
      } else {
        this.logger.warn(
          formatCompletionDiagnostics(completion, 'Empty vision assistant content'),
          'AssetAnalysisService',
        );
        throw new Error('Empty response from OpenAI Vision API');
      }
    } catch (error: any) {
      const isImageTimeoutError =
        error.code === 'invalid_image_url' ||
        (error.message && String(error.message).includes('Timeout while downloading'));

      if (isImageTimeoutError && retryCount < MAX_RETRIES) {
        this.logger.warn(
          `Image / vision request failed for ${imageUrl}, retrying (attempt ${retryCount + 1}/${MAX_RETRIES})...`,
          'AssetAnalysisService',
        );
        await new Promise((r) => setTimeout(r, 2000 * (retryCount + 1)));
        return this.callOpenAIVisionAPI(imageUrl, prompt, retryCount + 1);
      }

      if (retryCount >= MAX_RETRIES && isImageTimeoutError) {
        this.logger.error(`Image fetch failed after ${MAX_RETRIES + 1} attempts for ${imageUrl}`, 'AssetAnalysisService');
        throw new Error(
          `Failed to fetch image after ${MAX_RETRIES + 1} attempts: ${imageUrl}. The URL may be invalid or inaccessible.`,
        );
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
   * Long-form neutral visual text for script generation; prefers visualScriptContext, else legacy description.
   */
  private extractVisualScriptContext(analysis: any): string | undefined {
    const fromField =
      typeof analysis?.visualScriptContext === 'string' ? analysis.visualScriptContext.trim() : '';
    const fromDesc =
      typeof analysis?.description === 'string' ? analysis.description.trim() : '';
    const raw = fromField || fromDesc;
    if (!raw) {
      return undefined;
    }
    const max = AssetAnalysisService.MAX_VISUAL_SCRIPT_CONTEXT_CHARS;
    return raw.length > max ? raw.slice(0, max) : raw;
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

  private extractSuitableForTopRightBug(analysis: any): boolean | undefined {
    if (typeof analysis.suitableForTopRightBug === 'boolean') {
      return analysis.suitableForTopRightBug;
    }
    return undefined;
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
   * Detect if a URL points to an image or HTML page by checking Content-Type header
   */
  async detectUrlType(url: string): Promise<UrlTypeDetectionResult> {
    try {
      // Make a HEAD request to get the Content-Type without downloading the full content
      const response = await axios.head(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'UserGen-AssetAnalysis/1.0',
        },
        validateStatus: () => true, // Accept any status to check content-type
      });

      const contentType = response.headers['content-type'] || '';
      const mimeType = contentType.split(';')[0].trim().toLowerCase();

      // Check if it's an image
      const imageMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];
      const isImage = imageMimeTypes.some(type => mimeType.startsWith(type.split('/')[0]) && mimeType.includes(type.split('/')[1]));

      // Check if it's HTML
      const htmlMimeTypes = ['text/html', 'application/xhtml+xml'];
      const isHtml = htmlMimeTypes.some(type => mimeType.includes(type));

      let urlContentType: UrlContentType = 'unknown';
      if (isImage) {
        urlContentType = 'image';
      } else if (isHtml) {
        urlContentType = 'html';
      }

      this.logger.log(`URL type detection for ${url}: ${urlContentType} (mime: ${mimeType})`, 'AssetAnalysisService');

      return {
        contentType: urlContentType,
        mimeType,
        isImage,
        isHtml,
      };
    } catch (error: any) {
      this.logger.warn(`Failed to detect URL type for ${url}: ${error.message}`, 'AssetAnalysisService');
      
      // Fallback: check URL extension
      const urlLower = url.toLowerCase();
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
      const isImageByExtension = imageExtensions.some(ext => urlLower.includes(ext));
      
      if (isImageByExtension) {
        return {
          contentType: 'image',
          isImage: true,
          isHtml: false,
        };
      }

      return {
        contentType: 'unknown',
        isImage: false,
        isHtml: false,
      };
    }
  }

  /**
   * Analyze assets with URL type detection
   * Routes URLs to appropriate handler: images go to Vision API, HTML pages to content extraction
   */
  async analyzeAssetsWithUrlDetection(assets: Array<{ id: string; url: string; type: 'image' | 'url'; userLabel?: string }>): Promise<{
    analyzedAssets: AnalyzedAsset[];
    urlContents: Array<{ id: string; url: string; extractedContent?: string; error?: string }>;
  }> {
    const analyzedAssets: AnalyzedAsset[] = [];
    const urlContents: Array<{ id: string; url: string; extractedContent?: string; error?: string }> = [];

    // Separate images and URLs that need type detection
    const imageAssets = assets.filter(a => a.type === 'image');
    const urlAssets = assets.filter(a => a.type === 'url');

    // Process image assets directly
    if (imageAssets.length > 0) {
      const imageResults = await this.analyzeMultipleAssets(imageAssets);
      analyzedAssets.push(...imageResults);
    }

    // Detect types and route URLs appropriately
    for (const asset of urlAssets) {
      try {
        const typeResult = await this.detectUrlType(asset.url);

        if (typeResult.isImage) {
          // Treat as image, analyze with Vision API
          const result = await this.analyzeAsset(asset.url, asset.userLabel);
          result.originalAsset.id = asset.id;
          analyzedAssets.push(result);
        } else if (typeResult.isHtml) {
          // Mark for URL content extraction (handled by URL processing service)
          urlContents.push({
            id: asset.id,
            url: asset.url,
          });
        } else {
          // Unknown type - attempt image analysis with fallback
          try {
            const result = await this.analyzeAsset(asset.url, asset.userLabel);
            result.originalAsset.id = asset.id;
            analyzedAssets.push(result);
          } catch {
            urlContents.push({
              id: asset.id,
              url: asset.url,
              error: 'Unable to analyze - unknown content type',
            });
          }
        }
      } catch (error: any) {
        this.logger.error(`Failed to process URL asset ${asset.id}: ${error.message}`, error.stack, 'AssetAnalysisService');
        urlContents.push({
          id: asset.id,
          url: asset.url,
          error: error.message,
        });
      }
    }

    return { analyzedAssets, urlContents };
  }
}



