import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import { PublicUrlService } from '../common/storage/public-url.service';
import {
  LogoBrandMetadata,
  logoBrandHasPackagingAssets,
} from '@shared/brand/logo-brand.types';
import { parseMetadataAssets } from '@shared/brand';
import { resolveCanonicalBrandName } from '@shared/brand/logo-brand-voiceover.util';
import { storageResultToRef } from '@shared/storage';

export interface ResolveLogoBrandInput {
  metadata: Record<string, unknown>;
  projectId: string;
  userId: string;
  workDir: string;
}

export interface ResolveLogoBrandResult {
  logoBrand: LogoBrandMetadata | null;
  source: 'metadata' | 'fallback' | 'none';
  reason?: string;
}

interface LogoSource {
  assetId: string;
  url: string;
  brandName?: string;
  suitableForTopRightBug?: boolean;
  logoProcessingHints?: {
    markBoundingBox?: { x: number; y: number; width: number; height: number };
    dominantColors?: string[];
    backgroundType?: string;
    cornerOverlaySuitable?: boolean;
    endCardBackgroundHint?: string;
  };
}

@Injectable()
export class BrandLogoResolverService {
  private readonly uploadsDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly publicUrlService: PublicUrlService,
  ) {
    this.uploadsDir =
      this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  /**
   * Emergency fallback only — primary path is Phase B brand-packaging queue.
   */
  async resolve(input: ResolveLogoBrandInput): Promise<ResolveLogoBrandResult> {
    const { metadata } = input;
    const existing = metadata.logoBrand as LogoBrandMetadata | undefined;
    const brandPackaging = metadata.brandPackaging as { status?: string } | undefined;

    if (brandPackaging?.status === 'ready' && existing && logoBrandHasPackagingAssets(existing)) {
      return {
        logoBrand: this.normalizeLogoBrand(existing),
        source: 'metadata',
      };
    }

    if (this.isUsableLogoBrand(existing)) {
      return {
        logoBrand: this.normalizeLogoBrand(existing!),
        source: 'metadata',
      };
    }

    if (
      brandPackaging?.status === 'pending' ||
      brandPackaging?.status === 'processing'
    ) {
      if (this.isUsableLogoBrand(existing)) {
        return {
          logoBrand: this.normalizeLogoBrand(existing!),
          source: 'metadata',
        };
      }
      return {
        logoBrand: existing || null,
        source: 'none',
        reason: `Brand packaging not ready (status=${brandPackaging?.status})`,
      };
    }

    const source = this.findLogoSource(metadata);
    if (!source) {
      return {
        logoBrand: null,
        source: 'none',
        reason: 'No logo asset in metadata.assets or metadata.analyzedAssets',
      };
    }

    try {
      const built = await this.buildLogoBrandFromSource(input, source);
      if (built) {
        console.log(
          `[BrandLogoResolver] Built logoBrand at render-time for project ${input.projectId} from ${source.assetId}`,
        );
        return { logoBrand: built, source: 'fallback' };
      }
      return {
        logoBrand: null,
        source: 'none',
        reason: 'Logo preprocessing failed at render-time',
      };
    } catch (err: any) {
      console.warn(
        `[BrandLogoResolver] Render-time logo build failed for project ${input.projectId}: ${err?.message}`,
      );
      return {
        logoBrand: null,
        source: 'none',
        reason: err?.message || 'Render-time logo build failed',
      };
    }
  }

  private isUsableLogoBrand(logoBrand?: LogoBrandMetadata): boolean {
    if (!logoBrand?.overlayPolicy) return false;
    return logoBrandHasPackagingAssets(logoBrand);
  }

  private normalizeLogoBrand(logoBrand: LogoBrandMetadata): LogoBrandMetadata {
    return {
      ...logoBrand,
      dominantColors: this.normalizeColors(logoBrand.dominantColors),
    };
  }

  private findLogoSource(metadata: Record<string, unknown>): LogoSource | null {
    const analyzed = metadata.analyzedAssets;
    if (Array.isArray(analyzed)) {
      const logoAnalyzed = analyzed.find(
        (a: any) =>
          a?.category === 'logo' ||
          a?.originalAsset?.userLabel?.toLowerCase() === 'logo',
      );
      if (logoAnalyzed) {
        const url =
          logoAnalyzed.originalAsset?.url ||
          logoAnalyzed.originalAsset?.originalUrl ||
          logoAnalyzed.url;
        if (url) {
          const brandName =
            logoAnalyzed.brandName?.trim() ||
            resolveCanonicalBrandName(
              {
                rawLogoText: logoAnalyzed.rawLogoText || logoAnalyzed.extractedText,
                brandName: logoAnalyzed.brandName,
                brandNameVariants: logoAnalyzed.brandNameVariants,
              },
              'english',
            ) ||
            logoAnalyzed.extractedText;
          return {
            assetId: logoAnalyzed.originalAsset?.id || logoAnalyzed.id || 'logo',
            url,
            brandName,
            suitableForTopRightBug: logoAnalyzed.suitableForTopRightBug,
            logoProcessingHints: logoAnalyzed.logoProcessingHints,
          };
        }
      }
    }

    const parsed = parseMetadataAssets(metadata.assets);
    const raw = parsed.find(
      (a) =>
        a.category === 'logo' ||
        a.userLabel === 'logo' ||
        a.id.startsWith('logo-'),
    );
    if (raw?.url) {
      return {
        assetId: raw.id || 'logo',
        url: raw.url,
        brandName: raw.label,
      };
    }

    return null;
  }

  private async buildLogoBrandFromSource(
    input: ResolveLogoBrandInput,
    source: LogoSource,
  ): Promise<LogoBrandMetadata | null> {
    const fetchUrl = this.resolvePublicUrl(source.url);
    if (!fetchUrl) return null;

    let imageBuf = await this.downloadImage(fetchUrl);
    if (!imageBuf?.length) return null;

    if (this.isSvg(source.url, imageBuf)) {
      imageBuf = await sharp(imageBuf, { density: 300 }).png().toBuffer();
    }

    const hints = source.logoProcessingHints;
    imageBuf = await this.applyCrop(imageBuf, hints?.markBoundingBox);

    let processedBuf = imageBuf;
    const hasAlpha = await this.bufferHasUsefulAlpha(processedBuf);
    if (!hasAlpha) {
      const removed = await this.runRembg(processedBuf);
      if (removed) processedBuf = removed;
    } else {
      processedBuf = await sharp(processedBuf).trim().png().toBuffer();
    }

    const cornerBuf = await sharp(processedBuf)
      .resize({ width: 512, fit: 'inside' })
      .png()
      .toBuffer();
    const endCardBuf = await sharp(processedBuf)
      .resize({ width: 486, fit: 'inside' })
      .png()
      .toBuffer();

    const cornerMeta = await sharp(cornerBuf).metadata();
    const minDim = Math.min(cornerMeta.width || 0, cornerMeta.height || 0);
    const cornerOverlaySuitable =
      hints?.cornerOverlaySuitable !== false &&
      source.suitableForTopRightBug !== false &&
      minDim >= 32;

    const ts = Date.now();
    const workDir = path.join(input.workDir, 'brand_logos');
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    const cornerPath = path.join(workDir, `corner_${ts}.png`);
    const endCardPath = path.join(workDir, `endcard_logo_${ts}.png`);
    fs.writeFileSync(cornerPath, cornerBuf);
    fs.writeFileSync(endCardPath, endCardBuf);

    let cornerRef = storageResultToRef(
      { localPath: cornerPath, localUrl: `/uploads/logos/${input.projectId}/${path.basename(cornerPath)}`, publicUrl: cornerPath, gcsUploaded: false },
      'video-processing',
    );
    let endCardRef = storageResultToRef(
      { localPath: endCardPath, localUrl: `/uploads/logos/${input.projectId}/${path.basename(endCardPath)}`, publicUrl: endCardPath, gcsUploaded: false },
      'video-processing',
    );

    try {
      const cornerUpload = await this.publicUrlService.uploadFromPath(
        cornerPath,
        `logos/${input.projectId}`,
        path.basename(cornerPath),
        'image/png',
      );
      const endCardUpload = await this.publicUrlService.uploadFromPath(
        endCardPath,
        `logos/${input.projectId}`,
        path.basename(endCardPath),
        'image/png',
      );
      cornerRef = storageResultToRef(cornerUpload, 'video-processing');
      endCardRef = storageResultToRef(endCardUpload, 'video-processing');
    } catch (e: any) {
      console.warn(
        `[BrandLogoResolver] GCS upload failed, using local paths: ${e?.message}`,
      );
    }

    const bgType = hints?.backgroundType || 'unknown';
    const endCardHint = hints?.endCardBackgroundHint;
    let endCardMode: 'solid' | 'gradient' | 'byteplus' = 'gradient';
    if (endCardHint === 'byteplus' || bgType === 'busy') {
      endCardMode = 'byteplus';
    } else if (endCardHint === 'neutral' || bgType === 'transparent') {
      endCardMode = 'solid';
    }

    const dominantColors = this.normalizeColors(
      hints?.dominantColors?.length ? hints.dominantColors : ['#1a1a1a', '#ffffff'],
    );

    return {
      sourceAssetId: source.assetId,
      brandName: source.brandName,
      dominantColors,
      backgroundType:
        bgType === 'transparent' || bgType === 'solid' || bgType === 'busy'
          ? bgType
          : 'unknown',
      cornerOverlay: cornerRef,
      endCardLogo: endCardRef,
      cornerOverlayPngUrl: cornerRef.publicUrl,
      endCardLogoPngUrl: endCardRef.publicUrl,
      cornerOverlaySuitable,
      cornerNeedsBytePlusVariant: !cornerOverlaySuitable,
      overlayPolicy: {
        showCornerBug: true,
        showEndCard: true,
        endCardMode,
      },
      processedAt: new Date().toISOString(),
    };
  }

  normalizeColors(colors?: string[]): string[] {
    const normalized = (colors || []).map((c) => this.normalizeHexColor(c)).filter(Boolean) as string[];
    if (normalized.length === 0) return ['#1a1a1a', '#ffffff'];
    if (normalized.length === 1) return [normalized[0], normalized[0]];
    return normalized.slice(0, 4);
  }

  private normalizeHexColor(color: string | undefined): string | null {
    if (!color || typeof color !== 'string') return null;
    const trimmed = color.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    const named: Record<string, string> = {
      white: '#ffffff',
      black: '#000000',
      red: '#ff0000',
      blue: '#0000ff',
      green: '#008000',
      orange: '#ffa500',
      yellow: '#ffff00',
      gray: '#808080',
      grey: '#808080',
    };
    const lower = trimmed.toLowerCase();
    return named[lower] || '#1a1a1a';
  }

  private resolvePublicUrl(assetUrl: string): string | null {
    if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
      return assetUrl;
    }
    if (fs.existsSync(assetUrl)) {
      return assetUrl;
    }
    const aiContentUrl =
      this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9001';
    const backendBaseUrl =
      this.configService.get<string>('BACKEND_BASE_URL') || aiContentUrl;
    if (assetUrl.startsWith('/uploads')) {
      return `${backendBaseUrl}${assetUrl}`;
    }
    return null;
  }

  private async downloadImage(url: string): Promise<Buffer | null> {
    try {
      if (fs.existsSync(url)) {
        return fs.readFileSync(url);
      }
      const localPath = url.startsWith('/uploads/')
        ? path.join(this.uploadsDir, url.replace(/^\/uploads\/?/, ''))
        : null;
      if (localPath && fs.existsSync(localPath)) {
        return fs.readFileSync(localPath);
      }
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: 30 * 1024 * 1024,
      });
      return Buffer.from(res.data);
    } catch (e: any) {
      console.warn(`[BrandLogoResolver] Download failed for ${url}: ${e?.message}`);
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
    if (!fs.existsSync(scriptPath)) return null;
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
    } catch {
      /* rembg optional */
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
