import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { BytePlusImageProvider } from '../providers/byteplus-image.provider';
import { HeyGenProvider } from '../providers/heygen.provider';

@Injectable()
export class ImageProcessorService {
  constructor(
    private readonly bytePlusProvider: BytePlusImageProvider,
    private readonly heygenProvider: HeyGenProvider,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get image dimensions
   */
  private async getImageDimensions(imageBuffer: Buffer): Promise<{ width: number; height: number }> {
    const metadata = await sharp(imageBuffer).metadata();
    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
    };
  }

  /**
   * Process uploaded avatar image into multiple variants for Premium avatars
   * @param imageBuffer Original image buffer
   * @param originalImageKey Original HeyGen image key
   * @param userId User ID for directory structure
   * @param avatarId Avatar ID for directory structure
   * @returns Processed image keys and local file paths
   */
  async processAvatarImage(
    imageBuffer: Buffer,
    originalImageKey: string,
    userId: string,
    avatarId: string
  ): Promise<{
    imageKeyFull: string;              // 9:16 (1080x1920)
    imageKeyHalfNHalf: string;         // 9:8 (1080x960)
    imageKeyHalfNHalfWithWhite: string; // 9:8 + white top (1080x1920)
    localPaths: {
      full: string;
      halfNHalf: string;
      halfNHalfWithWhite: string;
      fullLarge: string;              // BytePlus-generated large version
      halfNHalfLarge: string;          // BytePlus-generated large version
    };
  }> {
    // Create avatar-specific directory
    const avatarDir = path.join(process.cwd(), 'uploads', 'avatars', userId, avatarId);
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

    // Check original image dimensions
    const originalDimensions = await this.getImageDimensions(imageBuffer);
    const isAlready1080x1920 = originalDimensions.width === 1080 && originalDimensions.height === 1920;
    const isAlready1080x960 = originalDimensions.width === 1080 && originalDimensions.height === 960;

    console.log(`[ImageProcessor] Original image dimensions: ${originalDimensions.width}x${originalDimensions.height}`);

    // If already correct size, copy instead of processing
    if (isAlready1080x1920) {
      console.log('[ImageProcessor] Image is already 1080x1920, copying for full variant...');
      const fullPath = path.join(avatarDir, 'full_9x16_1080x1920.jpg');
      fs.writeFileSync(fullPath, imageBuffer);
      
      // Upload to HeyGen
      const imageKeyFull = await this.uploadToHeyGen(imageBuffer, 'image/jpeg');
      
      // For half-n-half, we still need to process (crop to 1080x960)
      // But we can use the existing 1080x1920 as base
      // Crop bottom half: top = 1920 - 960 = 960
      const halfImageBuffer = await sharp(imageBuffer)
        .extract({ left: 0, top: 960, width: 1080, height: 960 }) // Crop bottom half
        .jpeg({ quality: 95 })
        .toBuffer();
      
      const halfPath = path.join(avatarDir, 'half_n_half_9x8_1080x960.jpg');
      fs.writeFileSync(halfPath, halfImageBuffer);
      
      const imageKeyHalfNHalf = await this.uploadToHeyGen(halfImageBuffer, 'image/jpeg');
      
      // Create white top variant
      const halfWithWhiteBuffer = await this.addWhiteTopToImage(
        halfImageBuffer,
        1080,
        960,
        1920
      );
      
      const halfWithWhitePath = path.join(avatarDir, 'half_n_half_with_white_9x16_1080x1920.jpg');
      fs.writeFileSync(halfWithWhitePath, halfWithWhiteBuffer);
      
      const imageKeyHalfNHalfWithWhite = await this.uploadToHeyGen(halfWithWhiteBuffer, 'image/jpeg');
      
      console.log('[ImageProcessor] Skipped BytePlus processing - image already correct size');
      
      return {
        imageKeyFull,
        imageKeyHalfNHalf,
        imageKeyHalfNHalfWithWhite,
        localPaths: {
          full: `/uploads/avatars/${userId}/${avatarId}/full_9x16_1080x1920.jpg`,
          halfNHalf: `/uploads/avatars/${userId}/${avatarId}/half_n_half_9x8_1080x960.jpg`,
          halfNHalfWithWhite: `/uploads/avatars/${userId}/${avatarId}/half_n_half_with_white_9x16_1080x1920.jpg`,
          fullLarge: `/uploads/avatars/${userId}/${avatarId}/full_9x16_1080x1920.jpg`, // Use same file
          halfNHalfLarge: `/uploads/avatars/${userId}/${avatarId}/half_n_half_9x8_1080x960.jpg`, // Use same file
        },
      };
    }

    if (isAlready1080x960) {
      console.log('[ImageProcessor] Image is already 1080x960, copying for half-n-half variant...');
      const halfPath = path.join(avatarDir, 'half_n_half_9x8_1080x960.jpg');
      fs.writeFileSync(halfPath, imageBuffer);
      
      const imageKeyHalfNHalf = await this.uploadToHeyGen(imageBuffer, 'image/jpeg');
      
      // Create white top variant
      const halfWithWhiteBuffer = await this.addWhiteTopToImage(
        imageBuffer,
        1080,
        960,
        1920
      );
      
      const halfWithWhitePath = path.join(avatarDir, 'half_n_half_with_white_9x16_1080x1920.jpg');
      fs.writeFileSync(halfWithWhitePath, halfWithWhiteBuffer);
      
      const imageKeyHalfNHalfWithWhite = await this.uploadToHeyGen(halfWithWhiteBuffer, 'image/jpeg');
      
      // For full variant, we need to process (upscale or use BytePlus)
      // Continue with BytePlus processing for full variant
      const imageBase64 = imageBuffer.toString('base64');
      const base64DataUri = `data:image/jpeg;base64,${imageBase64}`;
      const fullPrompt = "High quality portrait image, professional photography, clear face, good lighting, 9:16 aspect ratio";
      
      const fullResult = await this.bytePlusProvider.generateImageVariant(
        base64DataUri,
        fullPrompt,
        '1440x2560'
      );
      
      const fullImageBufferLarge = await this.downloadImage(fullResult.imageUrl);
      const fullLargePath = path.join(avatarDir, 'full_9x16_1440x2560_byteplus.jpg');
      fs.writeFileSync(fullLargePath, fullImageBufferLarge);
      
      const fullImageBuffer = await sharp(fullImageBufferLarge)
        .resize(1080, 1920, {
          fit: 'fill',
          position: 'center',
        })
        .jpeg({ quality: 95 })
        .toBuffer();
      
      const fullPath = path.join(avatarDir, 'full_9x16_1080x1920.jpg');
      fs.writeFileSync(fullPath, fullImageBuffer);
      
      const imageKeyFull = await this.uploadToHeyGen(fullImageBuffer, 'image/jpeg');
      
      console.log('[ImageProcessor] Skipped BytePlus processing for half-n-half - image already correct size');
      
      return {
        imageKeyFull,
        imageKeyHalfNHalf,
        imageKeyHalfNHalfWithWhite,
        localPaths: {
          full: `/uploads/avatars/${userId}/${avatarId}/full_9x16_1080x1920.jpg`,
          halfNHalf: `/uploads/avatars/${userId}/${avatarId}/half_n_half_9x8_1080x960.jpg`,
          halfNHalfWithWhite: `/uploads/avatars/${userId}/${avatarId}/half_n_half_with_white_9x16_1080x1920.jpg`,
          fullLarge: `/uploads/avatars/${userId}/${avatarId}/full_9x16_1440x2560_byteplus.jpg`,
          halfNHalfLarge: `/uploads/avatars/${userId}/${avatarId}/half_n_half_9x8_1080x960.jpg`, // Use same file
        },
      };
    }

    // Convert image buffer to Base64 for BytePlus processing
    const imageBase64 = imageBuffer.toString('base64');
    const base64DataUri = `data:image/jpeg;base64,${imageBase64}`;

    // Prompts for different variants
    const fullPrompt = "High quality portrait image, professional photography, clear face, good lighting, 9:16 aspect ratio";
    const halfPrompt = "High quality portrait image, professional photography, clear face, good lighting, 9:8 aspect ratio, cropped to show upper body and face";

    // Generate variants at BytePlus-compliant dimensions (must be at least 3,686,400 pixels)
    console.log('[ImageProcessor] Generating image variants via BytePlus Seedream 4.5 at compliant dimensions...');
    
    const [fullResult, halfResult] = await Promise.all([
      // Generate 9:16 image at BytePlus-compliant size (1440x2560 = 3,686,400 pixels)
      this.bytePlusProvider.generateImageVariant(
        base64DataUri,
        fullPrompt,
        '1440x2560'  // BytePlus-compliant: meets minimum 3,686,400 pixels requirement
      ),
      // Generate 9:8 image at BytePlus-compliant size (2304x2048 = 4,718,592 pixels)
      this.bytePlusProvider.generateImageVariant(
        base64DataUri,
        halfPrompt,
        '2304x2048'  // BytePlus-compliant: meets minimum 3,686,400 pixels requirement
      ),
    ]);

    // Download generated images (large versions from BytePlus)
    console.log('[ImageProcessor] Downloading BytePlus-generated images...');
    const [fullImageBufferLarge, halfImageBufferLarge] = await Promise.all([
      this.downloadImage(fullResult.imageUrl),
      this.downloadImage(halfResult.imageUrl),
    ]);

    // Save BytePlus-generated large versions locally
    const largePaths = {
      fullLarge: path.join(avatarDir, 'full_9x16_1440x2560_byteplus.jpg'),
      halfNHalfLarge: path.join(avatarDir, 'half_n_half_9x8_2304x2048_byteplus.jpg'),
    };

    console.log('[ImageProcessor] Saving BytePlus-generated large images...');
    await Promise.all([
      fs.promises.writeFile(largePaths.fullLarge, fullImageBufferLarge),
      fs.promises.writeFile(largePaths.halfNHalfLarge, halfImageBufferLarge),
    ]);

    // Resize to target dimensions using sharp
    console.log('[ImageProcessor] Resizing images to target dimensions (1080x1920 and 1080x960)...');
    
    const [fullImageBuffer, halfImageBuffer] = await Promise.all([
      // Resize 1440x2560 → 1080x1920 (maintains 9:16 aspect ratio)
      sharp(fullImageBufferLarge)
        .resize(1080, 1920, {
          fit: 'fill',
          position: 'center',
        })
        .jpeg({ quality: 95 })
        .toBuffer(),
      
      // Resize 2304x2048 → 1080x960 (maintains 9:8 aspect ratio)
      sharp(halfImageBufferLarge)
        .resize(1080, 960, {
          fit: 'fill',
          position: 'center',
        })
        .jpeg({ quality: 95 })
        .toBuffer(),
    ]);

    // Create 9:8 + white top variant (1080x1920)
    const halfWithWhiteBuffer = await this.addWhiteTopToImage(
      halfImageBuffer,
      1080,  // width
      960,   // original height
      1920   // target height (9:16)
    );

    // Save all resized images locally
    const localPaths = {
      full: path.join(avatarDir, 'full_9x16_1080x1920.jpg'),
      halfNHalf: path.join(avatarDir, 'half_n_half_9x8_1080x960.jpg'),
      halfNHalfWithWhite: path.join(avatarDir, 'half_n_half_with_white_9x16_1080x1920.jpg'),
      fullLarge: largePaths.fullLarge,
      halfNHalfLarge: largePaths.halfNHalfLarge,
    };

    console.log('[ImageProcessor] Saving resized images locally...');
    await Promise.all([
      fs.promises.writeFile(localPaths.full, fullImageBuffer),
      fs.promises.writeFile(localPaths.halfNHalf, halfImageBuffer),
      fs.promises.writeFile(localPaths.halfNHalfWithWhite, halfWithWhiteBuffer),
    ]);

    console.log(`[ImageProcessor] All images saved to: ${avatarDir}`);
    console.log(`[ImageProcessor] - Original: original.jpg (already saved)`);
    console.log(`[ImageProcessor] - BytePlus large: full_9x16_1440x2560_byteplus.jpg, half_n_half_9x8_2304x2048_byteplus.jpg`);
    console.log(`[ImageProcessor] - Resized: full_9x16_1080x1920.jpg, half_n_half_9x8_1080x960.jpg, half_n_half_with_white_9x16_1080x1920.jpg`);

    // Upload resized variants to HeyGen (use resized versions for video generation)
    console.log('[ImageProcessor] Uploading resized images to HeyGen...');
    
    const [imageKeyFull, imageKeyHalfNHalf, imageKeyHalfNHalfWithWhite] = await Promise.all([
      this.uploadToHeyGen(fullImageBuffer, 'image/jpeg'),
      this.uploadToHeyGen(halfImageBuffer, 'image/jpeg'),
      this.uploadToHeyGen(halfWithWhiteBuffer, 'image/jpeg'),
    ]);

    console.log('[ImageProcessor] Image processing completed successfully');
    
    return {
      imageKeyFull,
      imageKeyHalfNHalf,
      imageKeyHalfNHalfWithWhite,
      localPaths: {
        full: `/uploads/avatars/${userId}/${avatarId}/full_9x16_1080x1920.jpg`,
        halfNHalf: `/uploads/avatars/${userId}/${avatarId}/half_n_half_9x8_1080x960.jpg`,
        halfNHalfWithWhite: `/uploads/avatars/${userId}/${avatarId}/half_n_half_with_white_9x16_1080x1920.jpg`,
        fullLarge: `/uploads/avatars/${userId}/${avatarId}/full_9x16_1440x2560_byteplus.jpg`,
        halfNHalfLarge: `/uploads/avatars/${userId}/${avatarId}/half_n_half_9x8_2304x2048_byteplus.jpg`,
      },
    };
  }

  /**
   * Add white background to top half of image
   */
  private async addWhiteTopToImage(
    imageBuffer: Buffer,
    width: number,
    imageHeight: number,
    totalHeight: number
  ): Promise<Buffer> {
    const whiteHeight = totalHeight - imageHeight; // 960px white top

    // Create white top image
    const whiteTop = await sharp({
      create: {
        width,
        height: whiteHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();

    // Composite: white top + original image
    return sharp({
      create: {
        width,
        height: totalHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        { input: whiteTop, top: 0, left: 0 },
        { input: imageBuffer, top: whiteHeight, left: 0 },
      ])
      .jpeg()
      .toBuffer();
  }

  /**
   * Download image from URL
   */
  private async downloadImage(imageUrl: string): Promise<Buffer> {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    return Buffer.from(response.data);
  }

  /**
   * Upload image to HeyGen
   */
  private async uploadToHeyGen(
    imageBuffer: Buffer,
    contentType: 'image/jpeg' | 'image/png'
  ): Promise<string> {
    const uploadResponse = await this.heygenProvider.uploadImage(
      imageBuffer,
      contentType
    );
    
    if (!uploadResponse.image_key) {
      throw new Error('Failed to get image_key from HeyGen upload');
    }
    
    return uploadResponse.image_key;
  }
}

