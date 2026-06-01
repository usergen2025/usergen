import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import { BytePlusProvider } from '../rendering/providers/byteplus.provider';
import {
  LogoBrandMetadata,
  getCornerOverlayRef,
  getEndCardLogoRef,
  getEndCardPlateRef,
} from '@shared/brand/logo-brand.types';
import { resolveStorageRefToLocalPath } from '@shared/storage';

export type { LogoBrandMetadata };

@Injectable()
export class BrandVideoPostProcessorService {
  private readonly uploadsDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly bytePlusProvider: BytePlusProvider,
  ) {
    this.uploadsDir =
      this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  isBrandOverlayEnabled(): boolean {
    return this.configService.get<string>('BRAND_LOGO_OVERLAY_ENABLED') !== 'false';
  }

  isEndCardEnabled(): boolean {
    return this.configService.get<string>('BRAND_END_CARD_ENABLED') !== 'false';
  }

  getCornerWidthRatio(): number {
    const v = Number(this.configService.get<string>('BRAND_CORNER_LOGO_WIDTH_RATIO') || 0.11);
    return Number.isFinite(v) && v > 0 ? v : 0.11;
  }

  getEndCardDurationSec(): number {
    const v = Number(this.configService.get<string>('BRAND_END_CARD_DURATION_SEC') || 1);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  /**
   * Fast stitch: corner overlay + pre-built end-card plate (local paths only).
   */
  async applyBrandPackaging(
    inputPath: string,
    outputPath: string,
    logoBrand: LogoBrandMetadata,
    workDir: string,
  ): Promise<{ outputPath: string; durationAddedSec: number; cornerApplied: boolean; endCardApplied: boolean }> {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Brand packaging input missing: ${inputPath}`);
    }

    const normalizedBrand: LogoBrandMetadata = {
      ...logoBrand,
      dominantColors: this.normalizeColors(logoBrand.dominantColors),
    };

    const resolveOpts = this.getResolveOptions();
    let currentPath = inputPath;
    const ts = Date.now();
    let cornerApplied = false;
    let endCardApplied = false;

    const cornerRef = getCornerOverlayRef(normalizedBrand);
    if (this.isBrandOverlayEnabled() && normalizedBrand.overlayPolicy.showCornerBug && cornerRef) {
      try {
        const resolved = await resolveStorageRefToLocalPath(cornerRef, resolveOpts);
        if (resolved?.localPath) {
          const overlaid = path.join(workDir, `brand_corner_${ts}.mp4`);
          await this.applyCornerLogoOverlayFromPath(currentPath, overlaid, resolved.localPath);
          currentPath = overlaid;
          cornerApplied = true;
        }
      } catch (e: any) {
        console.warn(`[BrandVideoPostProcessor] Corner logo overlay failed: ${e?.message}`);
      }
    }

    let durationAddedSec = 0;
    const plateRef = getEndCardPlateRef(normalizedBrand);
    const endCardLogoRef = getEndCardLogoRef(normalizedBrand);
    if (
      this.isEndCardEnabled() &&
      normalizedBrand.overlayPolicy.showEndCard &&
      (plateRef || endCardLogoRef)
    ) {
      try {
        const res = await this.videoCompositorGetSize(currentPath);
        const width = res.width;
        const height = res.height;

        let platePath: string | null = null;
        if (plateRef) {
          const resolved = await resolveStorageRefToLocalPath(plateRef, resolveOpts);
          platePath = resolved?.localPath || null;
        }

        if (!platePath && endCardLogoRef) {
          const logoResolved = await resolveStorageRefToLocalPath(endCardLogoRef, resolveOpts);
          if (logoResolved?.localPath) {
            platePath = await this.buildSolidOrGradientEndCardPng(
              width,
              height,
              logoResolved.localPath,
              normalizedBrand.dominantColors,
              normalizedBrand.brandName,
            );
          }
        }

        if (!platePath) {
          throw new Error('End card plate unavailable');
        }

        const outroPath = path.join(workDir, `brand_outro_${ts}.mp4`);
        await this.buildBrandOutroMp4(outroPath, width, height, platePath);

        const withOutro = path.join(workDir, `brand_with_outro_${ts}.mp4`);
        await this.appendOutro(currentPath, outroPath, withOutro, width, height);
        currentPath = withOutro;
        durationAddedSec = this.getEndCardDurationSec();
        endCardApplied = true;
      } catch (e: any) {
        console.warn(`[BrandVideoPostProcessor] Brand end card failed: ${e?.message}`);
      }
    }

    if (currentPath !== outputPath) {
      fs.copyFileSync(currentPath, outputPath);
    } else {
      fs.copyFileSync(inputPath, outputPath);
    }

    return { outputPath, durationAddedSec, cornerApplied, endCardApplied };
  }

  getResolveOptions() {
    const aiContentUrl =
      this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9001';
    return {
      uploadsDir: this.uploadsDir,
      aiContentServiceUrl: aiContentUrl,
      backendBaseUrl: this.configService.get<string>('BACKEND_BASE_URL') || aiContentUrl,
      aiContentUploadsDir:
        this.configService.get<string>('AI_CONTENT_UPLOADS_DIR') ||
        path.join(process.cwd(), '../ai-content-service/uploads'),
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
    return named[trimmed.toLowerCase()] || '#1a1a1a';
  }

  async applyCornerLogoOverlayFromPath(
    inputPath: string,
    outputPath: string,
    logoLocalPath: string,
  ): Promise<void> {
    const res = await this.videoCompositorGetSize(inputPath);
    const margin = Math.max(8, Math.round(res.width * 0.025));
    const maxW = Math.max(48, Math.round(res.width * this.getCornerWidthRatio()));
    const mainHasAudio = this.probeHasAudio(inputPath);

    const audioMap = mainHasAudio ? '-map 0:a -c:a copy' : '-an';
    const cmd = `
      ffmpeg -y -i "${inputPath}" -i "${logoLocalPath}"
      -filter_complex "[1:v]scale=${maxW}:-1[logo];[0:v][logo]overlay=W-w-${margin}:${margin}:format=auto[v]"
      -map "[v]" ${audioMap}
      -c:v libx264 -preset veryfast -crf 23
      -movflags +faststart
      "${outputPath}"
    `
      .replace(/\s+/g, ' ')
      .trim();

    execSync(cmd, { stdio: 'pipe', maxBuffer: 80 * 1024 * 1024 });
  }

  /** @deprecated Use applyCornerLogoOverlayFromPath with a resolved local path */
  async applyCornerLogoOverlay(
    inputPath: string,
    outputPath: string,
    cornerPngUrl: string,
  ): Promise<void> {
    const logoLocal = await this.downloadToTemp(cornerPngUrl, 'corner_logo.png');
    await this.applyCornerLogoOverlayFromPath(inputPath, outputPath, logoLocal);
  }

  async buildSolidOrGradientEndCardPng(
    width: number,
    height: number,
    logoPngPath: string,
    dominantColors: string[],
    brandName?: string,
  ): Promise<string> {
    const colors = this.normalizeColors(dominantColors);
    const c1 = colors[0] || '#1a1a1a';
    const c2 = colors[1] || c1;
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:${c1}"/>
            <stop offset="100%" style="stop-color:${c2}"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>`;

    const bgBuf = await sharp(Buffer.from(svg)).png().toBuffer();
    const logoMaxH = Math.round(height * 0.35);
    const logoBuf = await sharp(logoPngPath)
      .resize({ height: logoMaxH, fit: 'inside' })
      .png()
      .toBuffer();
    const logoMeta = await sharp(logoBuf).metadata();
    const lw = logoMeta.width || 100;
    const lh = logoMeta.height || 100;
    const left = Math.round((width - lw) / 2);
    const top = Math.round((height - lh) / 2) - (brandName ? 20 : 0);

    const composites: sharp.OverlayOptions[] = [{ input: logoBuf, left, top }];
    const outPath = path.join(path.dirname(logoPngPath), `endcard_plate_${Date.now()}.png`);
    await sharp(bgBuf).composite(composites).png().toFile(outPath);
    return outPath;
  }

  async generateBytePlusCornerMark(
    logoPngUrl: string,
    dominantColors: string[],
    brandName?: string,
  ): Promise<string | null> {
    if (this.configService.get<string>('BRAND_END_CARD_BYTEPLUS_ENABLED') === 'false') {
      return null;
    }
    const colors = dominantColors.slice(0, 3).join(', ') || 'neutral';
    const prompt = `Compact square logo mark for a video corner bug overlay. Preserve exact logo identity, colors, and typography from the reference image. Transparent or simple solid background. Readable at small size (~10% frame width). No text beyond the logo. ${brandName ? `Brand: ${brandName}.` : ''} Colors: ${colors}.`;

    try {
      const result = await this.bytePlusProvider.generateImage({
        prompt,
        modelId: 'seedream-4-5-251128',
        aspectRatio: '1:1',
        referenceImages: [logoPngUrl],
        outputFormat: 'png',
      });
      return result.imageUrl || null;
    } catch (e: any) {
      console.warn(`[BrandVideoPostProcessor] BytePlus corner mark failed: ${e?.message}`);
      return null;
    }
  }

  async generateBytePlusEndCardPlate(
    logoPngUrl: string,
    dominantColors: string[],
    brandName?: string,
  ): Promise<string | null> {
    if (this.configService.get<string>('BRAND_END_CARD_BYTEPLUS_ENABLED') === 'false') {
      return null;
    }
    const colors = dominantColors.slice(0, 3).join(', ') || 'neutral dark';
    const prompt = `Vertical 9:16 professional brand end card for video outro. Center the exact logo from the reference image unchanged. Soft gradient background using brand colors: ${colors}. Minimal, clean, no extra text, no people. ${brandName ? `Brand: ${brandName}.` : ''}`;

    try {
      const result = await this.bytePlusProvider.generateImage({
        prompt,
        modelId: 'seedream-4-5-251128',
        aspectRatio: '9:16',
        referenceImages: [logoPngUrl],
        outputFormat: 'png',
      });
      return result.imageUrl || null;
    } catch (e: any) {
      console.warn(`[BrandVideoPostProcessor] BytePlus end card failed: ${e?.message}`);
      return null;
    }
  }

  async buildBrandOutroMp4(
    outputPath: string,
    width: number,
    height: number,
    platePngPath: string,
  ): Promise<void> {
    const dur = this.getEndCardDurationSec();
    const cmd = `
      ffmpeg -y
      -loop 1 -t ${dur} -i "${platePngPath}"
      -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100
      -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1"
      -c:v libx264 -preset veryfast -crf 23
      -c:a aac -b:a 128k
      -shortest
      -movflags +faststart
      "${outputPath}"
    `
      .replace(/\s+/g, ' ')
      .trim();
    execSync(cmd, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
  }

  async appendOutro(
    mainPath: string,
    outroPath: string,
    outputPath: string,
    width: number,
    height: number,
  ): Promise<void> {
    const mainHasAudio = this.probeHasAudio(mainPath);
    if (mainHasAudio) {
      const cmd = `
        ffmpeg -y
        -i "${mainPath}"
        -i "${outroPath}"
        -filter_complex "[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v0];[1:v]scale=${width}:${height},setsar=1[v1];[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[outv][outa]"
        -map "[outv]" -map "[outa]"
        -c:v libx264 -preset veryfast -crf 28
        -c:a aac -b:a 128k
        -movflags +faststart
        "${outputPath}"
      `
        .replace(/\s+/g, ' ')
        .trim();
      execSync(cmd, { stdio: 'pipe', maxBuffer: 80 * 1024 * 1024 });
    } else {
      const cmd = `
        ffmpeg -y
        -i "${mainPath}"
        -i "${outroPath}"
        -filter_complex "[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v0];[1:v]scale=${width}:${height},setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[outv]"
        -map "[outv]"
        -c:v libx264 -preset veryfast -crf 28
        -movflags +faststart
        "${outputPath}"
      `
        .replace(/\s+/g, ' ')
        .trim();
      execSync(cmd, { stdio: 'pipe', maxBuffer: 80 * 1024 * 1024 });
    }
  }

  private async downloadToTemp(url: string, filename: string): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-pack-'));
    const dest = path.join(dir, filename);

    if (!url.startsWith('http') && fs.existsSync(url)) {
      fs.copyFileSync(url, dest);
      return dest;
    }
    if (url.startsWith('/') && fs.existsSync(url)) {
      fs.copyFileSync(url, dest);
      return dest;
    }
    const localPath = url.startsWith('/uploads/')
      ? path.join(this.uploadsDir, url.replace(/^\/uploads\/?/, ''))
      : null;
    if (localPath && fs.existsSync(localPath)) {
      fs.copyFileSync(localPath, dest);
      return dest;
    }

    const fetchUrls: string[] = [url];
    if (url.startsWith('/uploads/')) {
      const aiContentUrl =
        this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9001';
      const backendBaseUrl =
        this.configService.get<string>('BACKEND_BASE_URL') || aiContentUrl;
      fetchUrls.push(`${backendBaseUrl}${url}`);
      fetchUrls.push(`${aiContentUrl}${url}`);
    }

    let lastError: Error | null = null;
    for (const fetchUrl of fetchUrls) {
      try {
        const res = await axios.get(fetchUrl, {
          responseType: 'arraybuffer',
          timeout: 120000,
          maxContentLength: 30 * 1024 * 1024,
        });
        fs.writeFileSync(dest, Buffer.from(res.data));
        return dest;
      } catch (e: any) {
        lastError = e;
      }
    }
    throw new Error(`Failed to download brand asset from ${url}: ${lastError?.message || 'unknown error'}`);
  }

  private videoCompositorGetSize(
    filePath: string,
  ): Promise<{ width: number; height: number }> {
    try {
      const out = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`,
        { encoding: 'utf-8' },
      ).trim();
      const [w, h] = out.split(',').map((n) => parseInt(n, 10));
      return Promise.resolve({
        width: w > 0 ? w : 1080,
        height: h > 0 ? h : 1920,
      });
    } catch {
      return Promise.resolve({ width: 1080, height: 1920 });
    }
  }

  private probeHasAudio(filePath: string): boolean {
    try {
      const out = execSync(
        `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${filePath}"`,
        { encoding: 'utf-8' },
      ).trim();
      return out.includes('audio');
    } catch {
      return false;
    }
  }
}
