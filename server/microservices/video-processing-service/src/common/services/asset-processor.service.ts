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
    /** Public URL (preferred for refs when present); when stored by ai-content, url is already public */
    publicUrl?: string;
    originalUrl?: string;
    type: string;
    userLabel?: string;
  };
  /** Neutral visual inventory from ai-content vision analysis; enriches image-gen prompts */
  visualScriptContext?: string;
  /** Logo: clean background / reference suitability (from ai-content analysis) */
  suitableForReferenceOverlay?: boolean;
  /** Logo: compact mark suitable for small top-right overlay */
  suitableForTopRightBug?: boolean;
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
      case 'ANIMATED_AVATAR':
        return this.getAssetsForAvatarOnly(assets, sceneNumber);
      case 'ALTERNATE':
        return this.getAssetsForAlternate(assets, sceneNumber);
      case 'PRODUCT_ONLY':
      case 'AVATAR_PRODUCT':
        return this.getAssetsForProduct(assets, sceneNumber);
      case 'B_ROLL_ONLY':
        // B-roll only can use background/env assets if provided; return all for context
        return assets;
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

    // Prefer public URL (stored by ai-content) so refs work without re-resolving
    const toUrl = (asset: AnalyzedAsset): string | null => {
      const u = asset.originalAsset?.publicUrl ?? asset.url ?? asset.originalAsset?.url;
      return u && (u.startsWith('http://') || u.startsWith('https://')) ? u : null;
    };
    return assets
      .map(toUrl)
      .filter((url): url is string => !!url);
  }

  /**
   * Build reference image URLs from all analyzed assets (no category filter).
   * Order: product(s) first, then logo, then all others. Capped at 6 for API limits.
   * Prompt should refer by role (e.g. "use the logo from the logo reference image") so the model finds the right image.
   */
  buildReferenceImagesInOrder(assets: AnalyzedAsset[], maxRefs: number = 6): string[] {
    if (!assets || assets.length === 0) {
      return [];
    }

    const toUrl = (asset: AnalyzedAsset): string | null => {
      if (asset.originalAsset?.type === 'url') return null;
      const u = asset.originalAsset?.publicUrl ?? asset.url ?? asset.originalAsset?.url;
      return u && (u.startsWith('http://') || u.startsWith('https://')) ? u : null;
    };

    const isReferenceImageAsset = (asset: AnalyzedAsset): boolean => {
      if (asset.originalAsset?.type === 'url') return false;
      if (asset.category === 'reference' && asset.originalAsset?.type === 'url') return false;
      return true;
    };

    const productAssets = this.getProductAssets(assets);
    // DISABLED: Scene-basis logo integration — logo excluded from reference images
    // const logoAssets = assets.filter(a => a.category === 'logo');
    const restAssets = assets.filter(
      a => a.category !== 'product' && a.category !== 'logo' && isReferenceImageAsset(a),
    );

    const productUrls = productAssets.map(toUrl).filter((u): u is string => !!u);
    // DISABLED: const logoUrls = logoAssets.map(toUrl).filter((u): u is string => !!u);
    const restUrls = restAssets.map(toUrl).filter((u): u is string => !!u);

    const all = [...productUrls, ...restUrls];
    return all.slice(0, maxRefs);
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
        if (asset.productInfo?.type) {
          enhancements.push(`Product type (LOCK — same form in every scene): ${asset.productInfo.type}`);
        }
        if (asset.productInfo?.features && asset.productInfo.features.length > 0) {
          enhancements.push(`Features: ${asset.productInfo.features.join(', ')}`);
        }
        if (asset.productInfo?.colors && asset.productInfo.colors.length > 0) {
          enhancements.push(`Product Colors (MUST MATCH EXACTLY): ${asset.productInfo.colors.join(', ')}`);
        }
      });
      // Strong product consistency instructions
      enhancements.push('CRITICAL PRODUCT CONSISTENCY REQUIREMENT: The product shown in this image MUST be IDENTICAL to the product in the reference image(s). DO NOT change, modify, redesign, or reimagine the product in ANY way.');
      enhancements.push('Product characteristics that MUST remain EXACTLY the same: shape, form factor, size proportions, colors, materials, textures, labels, logos, branding, packaging, and all visual details.');
      enhancements.push('You may ONLY change: camera angle, lighting conditions, background/environment, staging context, and surrounding props. The product itself must look like the exact same physical item photographed from a different angle or in a different setting.');
      enhancements.push('DO NOT: generate a "similar" product, create a "styled" version, add or remove product features, change the color scheme, alter the packaging design, or modify any product branding.');
    }

    // DISABLED: Scene-basis logo integration
    // if (logoAsset) {
    //   enhancements.push('Use the logo from the logo reference image; place it naturally in the scene; do not generate or redraw brand text – use the exact logo from the reference. Spell the brand name exactly as in the reference logo; do not add or change letters.');
    // }

    const backgroundAssets = this.getBackgroundAssets(assets);
    if (backgroundAssets.length > 0) {
      enhancements.push(`Background style: Reference provided background assets`);
    }

    for (const asset of assets) {
      const v = asset.visualScriptContext?.trim();
      if (v) {
        enhancements.push(`Visual reference intent (${asset.category}): ${v}`);
      }
    }

    const hasVisualContext = assets.some((a) => (a.visualScriptContext || '').trim().length > 0);
    if (hasVisualContext && productAssets.length === 0) {
      enhancements.push(
        'Primary reference: keep the hero object or outfit identical to the reference image(s); change only setting, lighting, and camera unless the prompt explicitly requires otherwise.',
      );
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
    
    // DISABLED: Scene-basis logo integration
    // if (sceneNumber === 1 || sceneNumber % 3 === 0) {
    //   const logo = this.getLogoAsset(assets);
    //   if (logo) relevantAssets.push(logo);
    // }
    
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
    
    // DISABLED: Scene-basis logo integration
    // const logo = this.getLogoAsset(assets);
    // if (logo) relevantAssets.push(logo);
    
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
    
    // DISABLED: Scene-basis logo integration
    // const logo = this.getLogoAsset(assets);
    // if (logo) relevantAssets.push(logo);
    
    return relevantAssets;
  }

  /**
   * ALTERNATE: Odd scenes = full b-roll, even scenes = full avatar (or explicit scene.type)
   */
  private getAssetsForAlternate(assets: AnalyzedAsset[], sceneNumber: number): AnalyzedAsset[] {
    const relevantAssets: AnalyzedAsset[] = [];

    if (sceneNumber % 2 === 1) {
      relevantAssets.push(...this.getBackgroundAssets(assets));
      relevantAssets.push(...this.getProductAssets(assets));
    } else {
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
    
    // DISABLED: Scene-basis logo integration
    // const logo = this.getLogoAsset(assets);
    // if (logo) relevantAssets.push(logo);
    
    return relevantAssets;
  }
}



