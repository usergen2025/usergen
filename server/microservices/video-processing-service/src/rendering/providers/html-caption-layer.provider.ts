import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

type CaptionSegment = { text: string; startTime: number; endTime: number };

type CaptionLayerStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  position: { x: number; y: number };
  widthScale?: number;
};

@Injectable()
export class HtmlCaptionLayerProvider {
  private checkFFmpeg(): void {
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
    } catch {
      throw new Error('FFmpeg is not installed or not available in PATH.');
    }
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

  async renderCaptionLayer(params: {
    captions: CaptionSegment[];
    style: CaptionLayerStyle;
    width: number;
    height: number;
    durationSec: number;
    outputPath: string;
    fps?: number;
  }): Promise<string> {
    this.checkFFmpeg();
    const { captions, style, width, height, durationSec, outputPath } = params;
    const fps = Math.max(8, Math.min(24, Math.round(params.fps ?? 12)));

    if (!captions.length || durationSec <= 0) {
      throw new Error('No caption timeline to render');
    }

    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });
    const frameDir = path.join(
      outputDir,
      `caption_frames_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(frameDir, { recursive: true });

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
      left: 50%;
      top: 85%;
      transform: translate(-50%, -50%);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 1px;
      padding: 10px 14px;
      text-align: center;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.2;
      border-radius: 10px;
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
      opacity: 0;
    }
  </style>
</head>
<body>
  <div id="caption"></div>
</body>
</html>`,
      );

      const totalFrames = Math.max(1, Math.ceil(durationSec * fps));
      const widthScale = Math.max(0.3, Math.min(0.9, style.widthScale ?? 0.8));
      const captionWidthPx = Math.round(width * widthScale);
      const x = Math.max(0, Math.min(1, style.position.x));
      const y = Math.max(0, Math.min(1, style.position.y));

      for (let i = 0; i < totalFrames; i++) {
        const t = i / fps;
        const text = this.captionAtTime(captions, t);

        await page.evaluate(
          ({ textValue, s, widthPx, xPos, yPos }) => {
            const el = document.getElementById('caption') as HTMLDivElement | null;
            if (!el) return;
            el.textContent = textValue || '';
            el.style.opacity = textValue ? '1' : '0';
            el.style.left = `${xPos * 100}%`;
            el.style.top = `${yPos * 100}%`;
            el.style.width = `${widthPx}px`;
            el.style.fontFamily = s.fontFamily || 'Inter, Arial, sans-serif';
            el.style.fontSize = `${Math.max(12, s.fontSize)}px`;
            el.style.fontWeight = s.fontWeight;
            el.style.fontStyle = s.fontStyle;
            el.style.color = s.textColor || '#FFFFFF';
            el.style.background = s.backgroundColor || 'transparent';
            el.style.border =
              s.borderWidth > 0 && s.borderColor && s.borderColor !== 'transparent'
                ? `${s.borderWidth}px solid ${s.borderColor}`
                : 'none';
          },
          {
            textValue: text,
            s: style,
            widthPx: captionWidthPx,
            xPos: x,
            yPos: y,
          },
        );

        const framePath = path.join(frameDir, `frame_${String(i).padStart(6, '0')}.png`);
        await page.screenshot({
          path: framePath,
          type: 'png',
          omitBackground: true,
        });
      }

      const ffmpegCmd = `
        ffmpeg -framerate ${fps} -i "${path.join(frameDir, 'frame_%06d.png')}" \
        -c:v libvpx-vp9 -pix_fmt yuva420p -lossless 1 -auto-alt-ref 0 \
        -y "${outputPath}"
      `
        .replace(/\s+/g, ' ')
        .trim();
      execSync(ffmpegCmd, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });

      return outputPath;
    } finally {
      await browser.close();
      try {
        fs.rmSync(frameDir, { recursive: true, force: true });
      } catch {
        // no-op
      }
    }
  }
}

