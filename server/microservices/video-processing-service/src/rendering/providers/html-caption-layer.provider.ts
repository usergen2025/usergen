import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

type CaptionSegment = { text: string; startTime: number; endTime: number };

export type CaptionLayerStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline';
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  position: { x: number; y: number };
  widthScale?: number;
  positionScale?: number;
};

export type CaptionLayerRenderResult = {
  frameDir: string;
  fps: number;
  frameCount: number;
};

const SAFETY_MARGIN = 4;
const HANDLE_INSET = 4;

/** Match client/lib/workspace/captionBounds.ts layoutCaptionBox */
export function computeCaptionBoxPixels(params: {
  containerWidth: number;
  containerHeight: number;
  positionX: number;
  positionY: number;
  widthScale: number;
  fontSize?: number;
  borderWidth?: number;
  layoutText?: string;
  /** @deprecated ignored — height derived from fontSize + layoutText */
  positionScale?: number;
}): { left: number; top: number; width: number; minHeight: number } {
  const { containerWidth, containerHeight, positionX, positionY } = params;
  const widthScale = Math.max(0.3, Math.min(0.9, params.widthScale ?? 0.8));
  const captionWidth = containerWidth * widthScale;
  const fontSize = params.fontSize ?? 16;
  const borderWidth = params.borderWidth ?? 0;
  const layoutText = params.layoutText ?? 'Sample';

  const padding = 16;
  const lineHeight = fontSize * 1.35;
  const charsPerLine = Math.max(8, Math.floor((captionWidth - padding) / (fontSize * 0.55)));
  const lines = Math.max(1, Math.ceil(layoutText.length / charsPerLine));
  const boxHeight = padding + lineHeight * lines + borderWidth * 2 + 4;

  const inset = HANDLE_INSET + SAFETY_MARGIN;
  const maxLeft = Math.max(0, containerWidth - captionWidth - inset);
  const maxTop = Math.max(0, containerHeight - boxHeight - inset);

  const clampedX = Math.max(0, Math.min(1, positionX));
  const clampedY = Math.max(0, Math.min(1, positionY));

  const left = Math.max(0, Math.min(maxLeft, maxLeft * clampedX));
  const top = Math.max(0, Math.min(maxTop, maxTop * clampedY));

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(captionWidth),
    minHeight: Math.round(boxHeight),
  };
}

@Injectable()
export class HtmlCaptionLayerProvider {
  constructor(private readonly configService: ConfigService) {}

  private checkFFmpeg(): void {
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
    } catch {
      throw new Error('FFmpeg is not installed or not available in PATH.');
    }
  }

  private getFontsDirectory(): string | undefined {
    const envDir = this.configService.get<string>('CAPTION_FONTS_DIR')?.trim();
    if (envDir && fs.existsSync(envDir)) return path.resolve(envDir);
    const bundled = path.join(process.cwd(), 'assets', 'fonts');
    if (fs.existsSync(bundled)) return bundled;
    return undefined;
  }

  private buildFontFaceCss(fontsDir: string | undefined): string {
    if (!fontsDir) return '';
    const boldPath = path.join(fontsDir, 'Inter-Bold.ttf');
    const regularPath = path.join(fontsDir, 'Inter-Regular.ttf');
    const variablePath = path.join(fontsDir, 'Inter.ttf');
    const toFileUrl = (p: string) =>
      fs.existsSync(p) ? `url('file://${p.replace(/\\/g, '/')}')` : null;

    const boldUrl = toFileUrl(boldPath) || toFileUrl(variablePath);
    const regularUrl = toFileUrl(regularPath) || toFileUrl(variablePath);
    if (!boldUrl && !regularUrl) return '';

    let css = '';
    if (regularUrl) {
      css += `@font-face { font-family: 'Inter'; src: ${regularUrl} format('truetype'); font-weight: 400; font-style: normal; }\n`;
    }
    if (boldUrl) {
      css += `@font-face { font-family: 'Inter'; src: ${boldUrl} format('truetype'); font-weight: 700; font-style: normal; }\n`;
    }
    return css;
  }

  private captionAtTime(captions: CaptionSegment[], timeSec: number): string {
    for (const c of captions) {
      if (timeSec >= c.startTime && timeSec < c.endTime) return c.text;
    }
    return '';
  }

  private async loadChromium(): Promise<any> {
    const dynamicImport = new Function('modulePath', 'return import(modulePath);') as (
      modulePath: string,
    ) => Promise<any>;
    const pw = await dynamicImport('playwright');
    if (!pw?.chromium) {
      throw new Error('Playwright chromium runtime is unavailable');
    }
    return pw.chromium;
  }

  /**
   * Renders full-frame transparent PNGs (caption styled in-page). Caller overlays via FFmpeg PNG sequence.
   */
  async renderCaptionLayer(params: {
    captions: CaptionSegment[];
    style: CaptionLayerStyle;
    width: number;
    height: number;
    durationSec: number;
    fps?: number;
    outputDir?: string;
  }): Promise<CaptionLayerRenderResult> {
    this.checkFFmpeg();
    const { captions, style, width, height, durationSec } = params;
    const fps = Math.max(8, Math.min(24, Math.round(params.fps ?? 12)));

    if (!captions.length || durationSec <= 0) {
      throw new Error('No caption timeline to render');
    }

    const baseDir =
      params.outputDir ||
      path.join(process.cwd(), 'uploads', 'caption_frames');
    fs.mkdirSync(baseDir, { recursive: true });
    const frameDir = path.join(
      baseDir,
      `caption_frames_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(frameDir, { recursive: true });

    const fontsDir = this.getFontsDirectory();
    const fontFaceCss = this.buildFontFaceCss(fontsDir);

    const longestSegmentText = captions.reduce(
      (longest, seg) => (seg.text.length > longest.length ? seg.text : longest),
      'Sample',
    );

    const box = computeCaptionBoxPixels({
      containerWidth: width,
      containerHeight: height,
      positionX: style.position.x,
      positionY: style.position.y,
      widthScale: style.widthScale ?? 0.8,
      fontSize: style.fontSize,
      borderWidth: style.borderWidth,
      layoutText: longestSegmentText,
    });

    const chromium = await this.loadChromium();
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--font-render-hinting=none'],
    });

    try {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });

      await page.setContent(
        `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    ${fontFaceCss}
    html, body {
      margin: 0;
      padding: 0;
      width: ${width}px;
      height: ${height}px;
      background: transparent;
      overflow: hidden;
    }
    #caption {
      position: absolute;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 1px;
      padding: 8px;
      text-align: center;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.2;
      border-radius: 8px;
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
      transform: none;
      opacity: 0;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
  <div id="caption"></div>
</body>
</html>`,
      );

      const totalFrames = Math.max(1, Math.ceil(durationSec * fps));

      for (let i = 0; i < totalFrames; i++) {
        const t = i / fps;
        const text = this.captionAtTime(captions, t);

        await page.evaluate(
          ({ textValue, s, boxPx }) => {
            const el = document.getElementById('caption') as HTMLDivElement | null;
            if (!el) return;
            el.textContent = textValue || '';
            el.style.opacity = textValue ? '1' : '0';
            el.style.left = `${boxPx.left}px`;
            el.style.top = `${boxPx.top}px`;
            el.style.width = `${boxPx.width}px`;
            el.style.minHeight = `${boxPx.minHeight}px`;
            el.style.fontFamily = "'Inter', Arial, sans-serif";
            el.style.fontSize = `${Math.max(12, s.fontSize)}px`;
            el.style.fontWeight = s.fontWeight;
            el.style.fontStyle = s.fontStyle;
            el.style.textDecoration = s.textDecoration || 'none';
            el.style.color = s.textColor || '#FFFFFF';
            el.style.background = s.backgroundColor || 'transparent';
            el.style.border =
              s.borderWidth > 0 && s.borderColor && s.borderColor !== 'transparent'
                ? `${s.borderWidth}px solid ${s.borderColor}`
                : 'none';
            const bg = (s.backgroundColor || '').trim().toLowerCase();
            const transparent = !bg || bg === 'transparent';
            el.style.textShadow = transparent
              ? '0 1px 2px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.6)'
              : 'none';
          },
          {
            textValue: text,
            s: style,
            boxPx: box,
          },
        );

        const framePath = path.join(frameDir, `frame_${String(i).padStart(6, '0')}.png`);
        await page.screenshot({
          path: framePath,
          type: 'png',
          omitBackground: true,
        });
      }

      return { frameDir, fps, frameCount: totalFrames };
    } finally {
      await browser.close();
    }
  }

  /** Legacy VP9 WebM path — only when CAPTION_USE_VP9_INTERMEDIATE=true */
  async renderCaptionLayerAsWebm(params: {
    captions: CaptionSegment[];
    style: CaptionLayerStyle;
    width: number;
    height: number;
    durationSec: number;
    outputPath: string;
    fps?: number;
  }): Promise<string> {
    const { outputPath } = params;
    const result = await this.renderCaptionLayer(params);
    const ffmpegCmd = `
      ffmpeg -framerate ${result.fps} -i "${path.join(result.frameDir, 'frame_%06d.png')}" \
      -c:v libvpx-vp9 -pix_fmt yuva420p -lossless 1 -auto-alt-ref 0 \
      -y "${outputPath}"
    `
      .replace(/\s+/g, ' ')
      .trim();
    execSync(ffmpegCmd, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
    try {
      fs.rmSync(result.frameDir, { recursive: true, force: true });
    } catch {
      // no-op
    }
    return outputPath;
  }
}
