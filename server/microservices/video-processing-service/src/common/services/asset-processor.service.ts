import { Injectable } from '@nestjs/common';

export interface AnalyzedAsset {
  id: string;
  category: 'logo' | 'product' | 'background' | 'branding' | 'reference' | 'environment';
  extractedText?: string;
  productInfo?: {
    name?: string;
    type?: string;
    features?: string[];
    colors?: string[];
    useCases?: string[];
    targetAudience?: string;
  };
  url: string;
  originalAsset?: {
    id: string;
    url: string;
    type: string;
    userLabel?: string;
  };
}

@Injectable()
export class AssetProcessorService {
  /**
   * Get assets relevant for a specific scene based on video style
   */
  getAssetsForScene(
    assets: AnalyzedAsset[],
    sceneNumber: number,
    style: string
  ): AnalyzedAsset[] {
    if (!assets || assets.length === 0) {
      return [];
    }

    switch (style) {
      case 'HALF_N_HALF':
        return this.getAssetsForHalfNHalf(assets, sceneNumber);
      case 'AVATAR_CUTOUT':
        return this.getAssetsForCutout(assets, sceneNumber);
      case 'AVATAR_ONLY':
        return this.getAssetsForAvatarOnly(assets, sceneNumber);
      case 'ALTERNATE':
        return this.getAssetsForAlternate(assets, sceneNumber);
      case 'PRODUCT_ONLY':
      case 'AVATAR_PRODUCT':
        return this.getAssetsForProduct(assets, sceneNumber);
      default:
        return assets;
    }
  }

  /**
   * Prepare reference images for b-roll generation (order not guaranteed)
   */
  prepareReferenceImages(
    assets: AnalyzedAsset[],
    sceneNumber: number
  ): string[] {
    if (!assets || assets.length === 0) {
      return [];
    }

    // Filter to only image assets with valid URLs
    return assets
      .filter(asset => {
        const url = asset.url || asset.originalAsset?.url;
        return url && (url.startsWith('http://') || url.startsWith('https://'));
      })
      .map(asset => asset.url || asset.originalAsset?.url)
      .filter((url): url is string => !!url);
  }

  /**
   * Build reference image URLs in fixed order for Seedream/multi-reference APIs:
   * product(s) first, then logo last. Prompt should refer to "image 1", "image 2", ..., "last image" (logo).
   */
  buildReferenceImagesInOrder(assets: AnalyzedAsset[]): string[] {
    if (!assets || assets.length === 0) {
      return [];
    }

    const toUrl = (asset: AnalyzedAsset): string | null => {
      const url = asset.url || asset.originalAsset?.url;
      return url && (url.startsWith('http://') || url.startsWith('https://')) ? url : null;
    };

    const productUrls = this.getProductAssets(assets)
      .map(toUrl)
      .filter((u): u is string => !!u);
    const logoAssets = assets.filter(a => a.category === 'logo');
    const logoUrls = logoAssets.map(toUrl).filter((u): u is string => !!u);

    return [...productUrls, ...logoUrls];
  }

  /**
   * Enhance prompt with asset context
   */
  enhancePromptWithAssets(
    prompt: string,
    assets: AnalyzedAsset[]
  ): string {
    if (!assets || assets.length === 0) {
      return prompt;
    }

    const enhancements: string[] = [];

    const logoAsset = this.getLogoAsset(assets);
    const productAssets = this.getProductAssets(assets);

    if (logoAsset?.extractedText) {
      enhancements.push(`Brand: ${logoAsset.extractedText}`);
    }

    if (productAssets.length > 0) {
      productAssets.forEach(asset => {
        if (asset.productInfo?.name) {
          enhancements.push(`Product: ${asset.productInfo.name}`);
        }
        if (asset.productInfo?.features && asset.productInfo.features.length > 0) {
          enhancements.push(`Features: ${asset.productInfo.features.join(', ')}`);
        }
      });
      enhancements.push('Same product as in the reference image(s); only change angle, lighting, or background; do not alter product design, shape, or colors.');
    }

    if (logoAsset) {
      enhancements.push('Use the logo from the last reference image; place it naturally in the scene; do not generate or redraw brand text – use the exact logo from the reference. Spell the brand name exactly as in the reference logo; do not add or change letters.');
    }

    const backgroundAssets = this.getBackgroundAssets(assets);
    if (backgroundAssets.length > 0) {
      enhancements.push(`Background style: Reference provided background assets`);
    }

    if (enhancements.length > 0) {
      return `${prompt}\n\nContext: ${enhancements.join(' | ')}`;
    }

    return prompt;
  }

  /**
   * Get logo asset
   */
  getLogoAsset(assets: AnalyzedAsset[]): AnalyzedAsset | null {
    return assets.find(a => a.category === 'logo') || null;
  }

  /**
   * Get product assets
   */
  getProductAssets(assets: AnalyzedAsset[]): AnalyzedAsset[] {
    return assets.filter(a => a.category === 'product');
  }

  /**
   * Get background assets
   */
  getBackgroundAssets(assets: AnalyzedAsset[]): AnalyzedAsset[] {
    return assets.filter(a => 
      a.category === 'background' || 
      a.category === 'environment'
    );
  }

  /**
   * HALF_N_HALF: Use product assets as reference, logo for branding scenes
   */
  private getAssetsForHalfNHalf(assets: AnalyzedAsset[], sceneNumber: number): AnalyzedAsset[] {
    const relevantAssets: AnalyzedAsset[] = [];
    
    // Always include product assets
    relevantAssets.push(...this.getProductAssets(assets));
    
    // Include logo for branding/key scenes (every 3rd scene or first/last)
    if (sceneNumber === 1 || sceneNumber % 3 === 0) {
      const logo = this.getLogoAsset(assets);
      if (logo) relevantAssets.push(logo);
    }
    
    // Include background assets for context
    relevantAssets.push(...this.getBackgroundAssets(assets).slice(0, 1));
    
    return relevantAssets;
  }

  /**
   * AVATAR_CUTOUT: Use background assets as b-roll backgrounds, logo for overlay
   */
  private getAssetsForCutout(assets: AnalyzedAsset[], sceneNumber: number): AnalyzedAsset[] {
    const relevantAssets: AnalyzedAsset[] = [];
    
    // Background assets are primary for cutout style
    relevantAssets.push(...this.getBackgroundAssets(assets));
    
    // Include logo for overlay
    const logo = this.getLogoAsset(assets);
    if (logo) relevantAssets.push(logo);
    
    // Include product assets when relevant
    if (sceneNumber % 2 === 0) {
      relevantAssets.push(...this.getProductAssets(assets));
    }
    
    return relevantAssets;
  }

  /**
   * AVATAR_ONLY: Use background assets for avatar background, logo for watermark
   */
  private getAssetsForAvatarOnly(assets: AnalyzedAsset[], sceneNumber: number): AnalyzedAsset[] {
    const relevantAssets: AnalyzedAsset[] = [];
    
    // Background assets for avatar background
    relevantAssets.push(...this.getBackgroundAssets(assets));
    
    // Logo for watermark (every scene)
    const logo = this.getLogoAsset(assets);
    if (logo) relevantAssets.push(logo);
    
    return relevantAssets;
  }

  /**
   * ALTERNATE: Rotate assets between odd/even scenes
   */
  private getAssetsForAlternate(assets: AnalyzedAsset[], sceneNumber: number): AnalyzedAsset[] {
    const relevantAssets: AnalyzedAsset[] = [];
    
    if (sceneNumber % 2 === 1) {
      // Odd scenes: product + logo
      relevantAssets.push(...this.getProductAssets(assets));
      const logo = this.getLogoAsset(assets);
      if (logo) relevantAssets.push(logo);
    } else {
      // Even scenes: background
      relevantAssets.push(...this.getBackgroundAssets(assets));
    }
    
    return relevantAssets;
  }

  /**
   * PRODUCT_ONLY / AVATAR_PRODUCT: Use product assets, enhance with logo context
   */
  private getAssetsForProduct(assets: AnalyzedAsset[], sceneNumber: number): AnalyzedAsset[] {
    const relevantAssets: AnalyzedAsset[] = [];
    
    // Product assets are primary
    relevantAssets.push(...this.getProductAssets(assets));
    
    // Logo for branding context
    const logo = this.getLogoAsset(assets);
    if (logo) relevantAssets.push(logo);
    
    return relevantAssets;
  }
}



