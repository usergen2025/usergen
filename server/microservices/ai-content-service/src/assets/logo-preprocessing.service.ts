import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import { LoggerService } from '../common/logger/logger.service';
import { PublicUrlService } from '../common/storage/public-url.service';
import { AnalyzedAsset } from './asset-analysis.service';
import { LogoBrandMetadata } from '@shared/brand/logo-brand.types';
import { resolveCanonicalBrandName } from '@shared/brand/logo-brand-voiceover.util';
import { storageResultToRef, normalizeStorageRef } from '@shared/storage';

export type { LogoBrandMetadata };

@Injectable()
export class LogoPreprocessingService {
  private readonly uploadsDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly publicUrlService: PublicUrlService,
  ) {
    this.uploadsDir =
      this.configService.get<string>('UPLOADS_DIR') ||
      path.join(process.cwd(), 'uploads');
  }

  async processLogo(
    projectId: string,
    userId: string,
    logoAsset: AnalyzedAsset,
  ): Promise<LogoBrandMetadata | null> {
    try {
      const rawUrl = logoAsset.originalAsset?.url || logoAsset.originalAsset?.originalUrl;
      if (!rawUrl) return null;

      const fetchUrl = await this.resolvePublicUrl(rawUrl);
      if (!fetchUrl) return null;

      let imageBuf = await this.downloadImage(fetchUrl);
      if (!imageBuf?.length) return null;

      if (this.isSvg(rawUrl, imageBuf)) {
        imageBuf = await sharp(imageBuf, { density: 300 }).png().toBuffer();
      }

      const hints = logoAsset.logoProcessingHints;
      imageBuf = await this.applyCrop(imageBuf, hints?.markBoundingBox);

      let processedBuf = imageBuf;
      const hasAlpha = await this.bufferHasUsefulAlpha(processedBuf);
      if (!hasAlpha) {
        const removed = await this.runRembg(processedBuf);
        if (removed) processedBuf = removed;
      } else {
        processedBuf = await sharp(processedBuf).trim().png().toBuffer();
      }

      const cornerMaxW = 512;
      const endCardMaxW = 486;
      const cornerBuf = await sharp(processedBuf)
        .resize({ width: cornerMaxW, fit: 'inside' })
        .png()
        .toBuffer();
      const endCardBuf = await sharp(processedBuf)
        .resize({ width: endCardMaxW, fit: 'inside' })
        .png()
        .toBuffer();

      const cornerMeta = await sharp(cornerBuf).metadata();
      const minDim = Math.min(cornerMeta.width || 0, cornerMeta.height || 0);
      const cornerOverlaySuitable =
        hints?.cornerOverlaySuitable !== false &&
        logoAsset.suitableForTopRightBug !== false &&
        minDim >= 32;

      const ts = Date.now();
      const workDir = path.join(this.uploadsDir, 'logos', projectId);
      if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

      const cornerPath = path.join(workDir, `corner_${ts}.png`);
      const endCardPath = path.join(workDir, `endcard_logo_${ts}.png`);
      fs.writeFileSync(cornerPath, cornerBuf);
      fs.writeFileSync(endCardPath, endCardBuf);

      const cornerUpload = await this.publicUrlService.uploadFromPath(
        cornerPath,
        `logos/${projectId}`,
        path.basename(cornerPath),
        'image/png',
      );
      const endCardUpload = await this.publicUrlService.uploadFromPath(
        endCardPath,
        `logos/${projectId}`,
        path.basename(endCardPath),
        'image/png',
      );

      const cornerOverlay = storageResultToRef(cornerUpload, 'ai-content');
      const endCardLogo = storageResultToRef(endCardUpload, 'ai-content');

      const rawAsset = logoAsset.originalAsset as {
        id: string;
        url: string;
        originalUrl?: string;
        localUrl?: string;
        localPath?: string;
        type: 'image' | 'url';
        userLabel?: string;
      };
      const rawSourceUrl = rawAsset?.url || rawAsset?.originalUrl;
      const sourceLogo = rawSourceUrl
        ? normalizeStorageRef(rawSourceUrl, 'ai-content')
        : undefined;
      if (sourceLogo && rawAsset?.localUrl) {
        sourceLogo.localUrl = rawAsset.localUrl;
      }
      if (sourceLogo && rawAsset?.localPath) {
        sourceLogo.localPath = rawAsset.localPath;
      }

      const bgType = hints?.backgroundType || 'unknown';
      const endCardHint = hints?.endCardBackgroundHint;
      let endCardMode: 'solid' | 'gradient' | 'byteplus' = 'gradient';
      if (endCardHint === 'byteplus' || bgType === 'busy') {
        endCardMode = 'byteplus';
      } else if (endCardHint === 'neutral' || bgType === 'transparent') {
        endCardMode = 'solid';
      }

      const dominantColors =
        hints?.dominantColors?.length ? hints.dominantColors : ['#1a1a1a', '#ffffff'];

      const resolvedBrandName =
        logoAsset.brandName?.trim() ||
        resolveCanonicalBrandName(
          {
            rawLogoText: logoAsset.rawLogoText || logoAsset.extractedText,
            brandName: logoAsset.brandName,
            brandNameVariants: logoAsset.brandNameVariants,
            tagline: logoAsset.tagline,
          },
          'english',
        ) ||
        (logoAsset.productInfo as { name?: string } | undefined)?.name;

      return {
        sourceAssetId: logoAsset.originalAsset.id,
        brandName: resolvedBrandName,
        brandNameVariants: logoAsset.brandNameVariants,
        rawLogoText: logoAsset.rawLogoText || logoAsset.extractedText,
        dominantColors,
        backgroundType: bgType,
        cropBox: hints?.markBoundingBox
          ? {
              x: hints.markBoundingBox.x,
              y: hints.markBoundingBox.y,
              w: hints.markBoundingBox.width,
              h: hints.markBoundingBox.height,
            }
          : undefined,
        sourceLogo,
        cornerOverlay,
        endCardLogo,
        cornerOverlayPngUrl: cornerUpload.publicUrl,
        endCardLogoPngUrl: endCardUpload.publicUrl,
        cornerOverlaySuitable,
        cornerNeedsBytePlusVariant: !cornerOverlaySuitable,
        overlayPolicy: {
          showCornerBug: true,
          showEndCard: true,
          endCardMode,
        },
        processedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.warn(
        `[LogoPreprocessing] Failed for project ${projectId}: ${err?.message}`,
        'LogoPreprocessingService',
      );
      return null;
    }
  }

  private async resolvePublicUrl(assetUrl: string): Promise<string | null> {
    if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
      return assetUrl;
    }
    const backendBaseUrl =
      this.configService.get<string>('BACKEND_BASE_URL') ||
      this.configService.get<string>('NEXT_PUBLIC_WS_URL')?.replace('/ws', '') ||
      'http://localhost:9001';
    if (assetUrl.startsWith('/uploads')) {
      return `${backendBaseUrl}${assetUrl}`;
    }
    return null;
  }

  private async downloadImage(url: string): Promise<Buffer | null> {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 20 * 1024 * 1024,
      });
      return Buffer.from(res.data);
    } catch {
      return null;
    }
  }

  private isSvg(url: string, buf: Buffer): boolean {
    if (url.toLowerCase().includes('.svg')) return true;
    const head = buf.slice(0, 256).toString('utf8').trim().toLowerCase();
    return head.includes('<svg');
  }

  private async applyCrop(
    buf: Buffer,
    box?: { x: number; y: number; width: number; height: number },
  ): Promise<Buffer> {
    const meta = await sharp(buf).metadata();
    const W = meta.width || 0;
    const H = meta.height || 0;
    if (box && W > 0 && H > 0) {
      const left = Math.max(0, Math.round(box.x * W));
      const top = Math.max(0, Math.round(box.y * H));
      const width = Math.min(W - left, Math.round(box.width * W));
      const height = Math.min(H - top, Math.round(box.height * H));
      if (width > 8 && height > 8) {
        return sharp(buf).extract({ left, top, width, height }).png().toBuffer();
      }
    }
    try {
      return sharp(buf).trim({ threshold: 10 }).png().toBuffer();
    } catch {
      return buf;
    }
  }

  private async bufferHasUsefulAlpha(buf: Buffer): Promise<boolean> {
    try {
      const meta = await sharp(buf).metadata();
      return meta.hasAlpha === true;
    } catch {
      return false;
    }
  }

  private async runRembg(buf: Buffer): Promise<Buffer | null> {
    const scriptPath = path.join(process.cwd(), 'scripts', 'remove_image_background.py');
    if (!fs.existsSync(scriptPath)) {
      this.logger.warn('[LogoPreprocessing] rembg script not found', 'LogoPreprocessingService');
      return null;
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-rembg-'));
    const inPath = path.join(tmpDir, 'in.png');
    const outPath = path.join(tmpDir, 'out.png');
    try {
      fs.writeFileSync(inPath, buf);
      execSync(`python3 "${scriptPath}" "${inPath}" "${outPath}" u2net`, {
        stdio: 'pipe',
        maxBuffer: 25 * 1024 * 1024,
        timeout: 120000,
      });
      if (fs.existsSync(outPath)) {
        return fs.readFileSync(outPath);
      }
    } catch (e: any) {
      this.logger.warn(`[LogoPreprocessing] rembg failed: ${e?.message}`, 'LogoPreprocessingService');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}
