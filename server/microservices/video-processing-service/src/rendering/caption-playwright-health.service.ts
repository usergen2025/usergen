import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CaptionPlaywrightHealthService implements OnModuleInit {
  private chromiumOk = false;

  constructor(private readonly configService: ConfigService) {}

  isChromiumHealthy(): boolean {
    return this.chromiumOk;
  }

  async onModuleInit(): Promise<void> {
    const mode = (this.configService.get<string>('CAPTION_RENDERER_MODE') || 'html_css').trim();
    if (mode === 'ass') {
      console.log('[CaptionPlaywright] Skipping health check (CAPTION_RENDERER_MODE=ass)');
      return;
    }

    try {
      const dynamicImport = new Function('modulePath', 'return import(modulePath);') as (
        modulePath: string,
      ) => Promise<any>;
      const pw = await dynamicImport('playwright');
      if (!pw?.chromium) {
        throw new Error('Playwright chromium module not found');
      }
      const browser = await pw.chromium.launch({
        headless: true,
        args: ['--disable-gpu'],
      });
      await browser.close();
      this.chromiumOk = true;
      console.log('[CaptionPlaywright] Chromium launch OK — HTML caption path available');
    } catch (err: any) {
      this.chromiumOk = false;
      console.error(
        `[CaptionPlaywright] Chromium launch FAILED — HTML captions will fail. ` +
          `Run: npx playwright install chromium` +
          ` (Linux VM: sudo npx playwright install-deps chromium). ` +
          `Error: ${err?.message || err}`,
      );
    }
  }
}
