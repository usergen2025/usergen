import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import {
  applyUsergenTiledWatermark,
  computeLastSceneTimeRange,
  type PreviewAudioScene,
} from '@shared/ffmpeg/usergen-tiled-watermark';
import { PublicUrlService } from '../common/storage/public-url.service';
import { VideoCompositorProvider } from '../rendering/providers/video-compositor.provider';
import { PREVIEW_DEFAULT_MAX_WIDTH, PREVIEW_FORMAT_VERSION } from './preview.constants';

export interface BuildWatermarkedPreviewInput {
  projectId: string;
  userId: string;
  /** Final clean video URL or local /uploads path */
  sourceVideoUrl: string;
  audioFiles?: PreviewAudioScene[] | null;
}

export interface BuildWatermarkedPreviewResult {
  previewPublicUrl: string;
  previewLocalPath: string;
  thumbnailPublicUrl: string;
  previewSourceHash: string;
  previewFormatVersion: number;
}

@Injectable()
export class PreviewVideoService {
  private readonly uploadsDir: string;
  private readonly maxWidth: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly publicUrlService: PublicUrlService,
    private readonly videoCompositor: VideoCompositorProvider,
  ) {
    this.uploadsDir =
      this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
    this.maxWidth = Number(
      this.configService.get<string>('PREVIEW_MAX_WIDTH') || PREVIEW_DEFAULT_MAX_WIDTH,
    );
  }

  static computeSourceHash(sourceVideoUrl: string): string {
    return createHash('sha256').update(sourceVideoUrl || '').digest('hex');
  }

  shouldSkipRegeneration(
    metadata: Record<string, unknown> | null | undefined,
    sourceVideoUrl: string,
    forceRegenerate?: boolean,
  ): boolean {
    if (forceRegenerate) return false;
    if (!metadata?.previewVideoUrl) return false;
    const version = Number(metadata.previewFormatVersion ?? 0);
    if (version < PREVIEW_FORMAT_VERSION) return false;
    const hash = metadata.previewSourceHash as string | undefined;
    return hash === PreviewVideoService.computeSourceHash(sourceVideoUrl);
  }

  async buildWatermarkedPreview(
    input: BuildWatermarkedPreviewInput,
  ): Promise<BuildWatermarkedPreviewResult> {
    const { projectId, userId, sourceVideoUrl, audioFiles } = input;
    const sourceHash = PreviewVideoService.computeSourceHash(sourceVideoUrl);

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `preview-${projectId}-`));
    try {
      const sourcePath = await this.resolveSourceToLocalPath(sourceVideoUrl, workDir);
      const res = await this.videoCompositor.getVideoResolution(sourcePath);
      const width = res?.width && res.width > 0 ? res.width : 1080;
      const height = res?.height && res.height > 0 ? res.height : 1920;
      const totalDuration = this.probeDuration(sourcePath);

      const mainWatermarkedPath = path.join(workDir, 'main_watermarked.mp4');
      const outroPath = path.join(workDir, 'outro.mp4');
      const concatPath = path.join(workDir, 'with_outro.mp4');
      const previewPath = path.join(workDir, `${projectId}_preview.mp4`);
      const thumbPath = path.join(workDir, `${projectId}_thumb.jpg`);

      const timeRange = computeLastSceneTimeRange(totalDuration, audioFiles);
      if (timeRange.endSec > timeRange.startSec) {
        await applyUsergenTiledWatermark({
          inputPath: sourcePath,
          outputPath: mainWatermarkedPath,
          timeRange,
          crf: 23,
        });
      } else {
        fs.copyFileSync(sourcePath, mainWatermarkedPath);
      }

      this.buildOutroClip(outroPath, width, height);
      this.concatWithOutro(mainWatermarkedPath, outroPath, concatPath, width, height);
      this.compressSegment(concatPath, previewPath);

      execSync(
        `ffmpeg -y -ss 0.5 -i "${previewPath}" -frames:v 1 -q:v 5 "${thumbPath}"`,
        { stdio: 'pipe' },
      );

      const previewDir = path.join(this.uploadsDir, 'videos', userId, 'previews');
      if (!fs.existsSync(previewDir)) {
        fs.mkdirSync(previewDir, { recursive: true });
      }
      const previewFilename = `${projectId}_preview.mp4`;
      const persistentPreviewPath = path.join(previewDir, previewFilename);
      fs.copyFileSync(previewPath, persistentPreviewPath);

      const thumbFilename = `${projectId}_thumb.jpg`;
      const previewUpload = await this.publicUrlService.uploadFromPath(
        persistentPreviewPath,
        `videos/${userId}/previews`,
        previewFilename,
        'video/mp4',
      );
      const thumbUpload = await this.publicUrlService.uploadFromPath(
        thumbPath,
        `videos/${userId}/previews`,
        thumbFilename,
        'image/jpeg',
      );

      return {
        previewPublicUrl: previewUpload.publicUrl,
        previewLocalPath: persistentPreviewPath,
        thumbnailPublicUrl: thumbUpload.publicUrl,
        previewSourceHash: sourceHash,
        previewFormatVersion: PREVIEW_FORMAT_VERSION,
      };
    } finally {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private async resolveSourceToLocalPath(
    sourceVideoUrl: string,
    workDir: string,
  ): Promise<string> {
    if (sourceVideoUrl.startsWith('/uploads/')) {
      const relative = sourceVideoUrl.replace(/^\/uploads\//, '');
      const local = path.join(this.uploadsDir, relative);
      if (!fs.existsSync(local)) {
        throw new Error(`Source video not found at ${local}`);
      }
      return local;
    }
    if (sourceVideoUrl.startsWith('http://') || sourceVideoUrl.startsWith('https://')) {
      const dest = path.join(workDir, 'source.mp4');
      const response = await axios.get<ArrayBuffer>(sourceVideoUrl, {
        responseType: 'arraybuffer',
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      fs.writeFileSync(dest, Buffer.from(response.data));
      return dest;
    }
    if (fs.existsSync(sourceVideoUrl)) {
      return sourceVideoUrl;
    }
    throw new Error(`Unsupported or missing source video: ${sourceVideoUrl}`);
  }

  private compressSegment(inputPath: string, outputPath: string): void {
    const hasAudio = this.probeHasAudio(inputPath);
    const audioPart = hasAudio ? '-c:a aac -b:a 128k' : '-an';

    const cmd = [
      'ffmpeg -y',
      `-i "${inputPath}"`,
      `-vf "scale='min(${this.maxWidth},iw)':-2:force_original_aspect_ratio=decrease"`,
      '-c:v libx264 -preset veryfast -crf 28',
      audioPart,
      '-movflags +faststart',
      `"${outputPath}"`,
    ].join(' ');

    execSync(cmd, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
  }

  private buildOutroClip(outputPath: string, width: number, height: number): void {
    const fontfile = this.resolveDrawtextFont();
    const fontPart = fontfile
      ? `:fontfile='${fontfile.replace(/'/g, "'\\''")}'`
      : '';
    const drawtext = `drawtext=text='UserGen'${fontPart}:fontsize=${Math.round(
      Math.min(width, height) * 0.12,
    )}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`;

    const cmd = `
      ffmpeg -y
      -f lavfi -i color=c=black:s=${width}x${height}:d=1:r=30
      -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100
      -t 1
      -vf "${drawtext}"
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

  private concatWithOutro(
    mainPath: string,
    outroPath: string,
    outputPath: string,
    width: number,
    height: number,
  ): void {
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
      execSync(cmd, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
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
      execSync(cmd, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
    }
  }

  private probeDuration(filePath: string): number {
    try {
      const out = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: 'utf-8' },
      ).trim();
      const n = parseFloat(out);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
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

  private resolveDrawtextFont(): string | null {
    const candidates = [
      '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
      '/System/Library/Fonts/Supplemental/Arial.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
}
