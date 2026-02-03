import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import sharp from 'sharp';
import { PublicUrlService } from '../storage/public-url.service';

/**
 * Service to create composite images combining avatar and product
 * for avatar-product video style
 */
@Injectable()
export class CompositeImageService {
  private readonly uploadsDir: string;
  private readonly heygenApiKey: string;
  private readonly heygenUploadBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly publicUrlService: PublicUrlService,
  ) {
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
    this.heygenApiKey = this.configService.get<string>('HEYGEN_API_KEY') || '';
    this.heygenUploadBaseUrl = 'https://upload.heygen.com/v1';
  }

  /**
   * Download image from URL and return as buffer
   */
  private async downloadImage(imageUrl: string): Promise<Buffer> {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      return Buffer.from(response.data);
    } catch (error: any) {
      throw new Error(`Failed to download image from ${imageUrl}: ${error.message}`);
    }
  }

  /**
   * Upload composite image to HeyGen and get image_key
   */
  private async uploadToHeyGen(imageBuffer: Buffer, contentType: 'image/jpeg' | 'image/png'): Promise<string> {
    if (!this.heygenApiKey) {
      throw new Error('HeyGen API key not configured');
    }

    try {
      const response = await axios.post(
        `${this.heygenUploadBaseUrl}/asset`,
        imageBuffer,
        {
          headers: {
            'X-Api-Key': this.heygenApiKey,
            'Content-Type': contentType,
          },
          timeout: 60000,
        }
      );

      const data = response.data.code !== undefined ? response.data.data : (response.data as any);
      
      if (!data?.image_key) {
        throw new Error('Failed to get image_key from HeyGen upload response');
      }

      return data.image_key;
    } catch (error: any) {
      throw new Error(`Failed to upload composite image to HeyGen: ${error.message}`);
    }
  }

  /**
   * Create composite image combining avatar and product
   * @param avatarImagePath - Local path to original avatar image
   * @param productImageUrl - Public URL of product image
   * @param sceneNumber - Scene number for filename
   * @param projectId - Project ID for directory structure
   * @param userId - User ID for directory structure
   * @param scenePrompt - Scene prompt to determine layout
   * @returns Composite image data with HeyGen image_key
   */
  async createProductAvatarComposite(
    avatarImagePath: string,
    productImageUrl: string,
    sceneNumber: number,
    projectId: string,
    userId: string,
    scenePrompt?: string
  ): Promise<{
    compositeImageUrl: string;
    compositeImageKey: string; // HeyGen image_key
    localPath: string;
    localUrl: string;
  }> {
    console.log(`[CompositeImageService] Creating composite for scene ${sceneNumber}`);
    console.log(`[CompositeImageService] Avatar path: ${avatarImagePath}`);
    console.log(`[CompositeImageService] Product URL: ${productImageUrl}`);

    // Create directory for composites
    const compositeDir = path.join(this.uploadsDir, 'composites', userId, projectId);
    if (!fs.existsSync(compositeDir)) {
      fs.mkdirSync(compositeDir, { recursive: true });
    }

    // Load avatar image
    if (!fs.existsSync(avatarImagePath)) {
      throw new Error(`Avatar image not found at path: ${avatarImagePath}`);
    }
    const avatarBuffer = fs.readFileSync(avatarImagePath);

    // Download product image
    const productBuffer = await this.downloadImage(productImageUrl);

    // Determine layout based on scene prompt (default: side-by-side)
    // For now, use side-by-side layout (avatar left, product right)
    const layout = this.determineLayout(scenePrompt);

    // Create composite image
    const compositeBuffer = await this.createComposite(
      avatarBuffer,
      productBuffer,
      layout
    );

    // Save composite locally
    const timestamp = Date.now();
    const filename = `scene_${sceneNumber}_${projectId}_${timestamp}.jpg`;
    const localPath = path.join(compositeDir, filename);
    fs.writeFileSync(localPath, compositeBuffer);

    const localUrl = `/uploads/composites/${userId}/${projectId}/${filename}`;

    // Upload to HeyGen to get image_key
    console.log(`[CompositeImageService] Uploading composite to HeyGen...`);
    const compositeImageKey = await this.uploadToHeyGen(compositeBuffer, 'image/jpeg');
    console.log(`[CompositeImageService] ✅ Composite uploaded. Image key: ${compositeImageKey}`);

    // Get public URL (for reference/display)
    // In local env, this will upload to FAL; in dev/prod, use backend URL
    const compositeImageUrl = await this.publicUrlService.getPublicUrl(localPath, localUrl);

    return {
      compositeImageUrl,
      compositeImageKey,
      localPath,
      localUrl,
    };
  }

  /**
   * Determine layout based on scene prompt
   */
  private determineLayout(scenePrompt?: string): 'side-by-side' | 'overlay' | 'product-focused' {
    if (!scenePrompt) {
      return 'side-by-side';
    }

    const prompt = scenePrompt.toLowerCase();

    // Check for overlay keywords
    if (prompt.includes('overlay') || prompt.includes('foreground') || prompt.includes('background')) {
      return 'overlay';
    }

    // Check for product-focused keywords
    if (prompt.includes('product') && (prompt.includes('prominent') || prompt.includes('feature'))) {
      return 'product-focused';
    }

    // Default: side-by-side
    return 'side-by-side';
  }

  /**
   * Create composite image using sharp
   */
  private async createComposite(
    avatarBuffer: Buffer,
    productBuffer: Buffer,
    layout: 'side-by-side' | 'overlay' | 'product-focused'
  ): Promise<Buffer> {
    const targetWidth = 1080;
    const targetHeight = 1920; // 9:16 aspect ratio

    // Resize images to fit layout
    let avatarResized: Buffer;
    let productResized: Buffer;

    if (layout === 'side-by-side') {
      // Avatar on left (540x1920), Product on right (540x1920)
      avatarResized = await sharp(avatarBuffer)
        .resize(540, 1920, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 95 })
        .toBuffer();

      productResized = await sharp(productBuffer)
        .resize(540, 1920, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 95 })
        .toBuffer();

      // Composite side-by-side
      return sharp({
        create: {
          width: targetWidth,
          height: targetHeight,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite([
          { input: avatarResized, top: 0, left: 0 },
          { input: productResized, top: 0, left: 540 },
        ])
        .jpeg({ quality: 95 })
        .toBuffer();
    } else if (layout === 'overlay') {
      // Product as background, avatar as foreground (smaller, positioned)
      productResized = await sharp(productBuffer)
        .resize(targetWidth, targetHeight, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 95 })
        .toBuffer();

      avatarResized = await sharp(avatarBuffer)
        .resize(400, 600, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 95 })
        .toBuffer();

      // Composite with avatar over product
      return sharp(productResized)
        .composite([
          { input: avatarResized, top: 100, left: 50 }, // Position avatar
        ])
        .jpeg({ quality: 95 })
        .toBuffer();
    } else {
      // Product-focused: Product larger, avatar smaller
      productResized = await sharp(productBuffer)
        .resize(targetWidth, 1400, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 95 })
        .toBuffer();

      avatarResized = await sharp(avatarBuffer)
        .resize(300, 450, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 95 })
        .toBuffer();

      // Composite with product prominent
      return sharp({
        create: {
          width: targetWidth,
          height: targetHeight,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite([
          { input: productResized, top: 0, left: 0 },
          { input: avatarResized, top: 1450, left: 50 }, // Avatar at bottom
        ])
        .jpeg({ quality: 95 })
        .toBuffer();
    }
  }
}

