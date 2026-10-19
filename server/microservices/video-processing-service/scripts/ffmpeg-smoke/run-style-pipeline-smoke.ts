/**
 * Per-style FFmpeg pipeline smoke (fixture media).
 * Exercises the same compositor ops each rendering style uses, with quoted paths
 * and a missing-local → HTTP hydrate step (GCS-first behavior).
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { VideoCompositorProvider } from '../../src/rendering/providers/video-compositor.provider';
import { ensureLocalMedia } from '@shared/storage';

const OUT = path.join(process.env.TMPDIR || '/tmp', 'usergen-style-pipeline');
const results: { style: string; step: string; ok: boolean; detail?: string }[] = [];

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

function mkClip(name: string, color: string, w = 1080, h = 1920, d = 1.5) {
  const p = path.join(OUT, name);
  execSync(
    `ffmpeg -y -f lavfi -i color=c=${color}:s=${w}x${h}:d=${d} -f lavfi -i anullsrc=r=48000:cl=stereo -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${p}"`,
    { stdio: 'pipe' },
  );
  return p;
}

function mkAudio(name: string, freq: number, d = 1.5) {
  const p = path.join(OUT, name);
  execSync(`ffmpeg -y -f lavfi -i sine=frequency=${freq}:duration=${d} -c:a libmp3lame "${p}"`, {
    stdio: 'pipe',
  });
  return p;
}

async function step(style: string, name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ style, step: name, ok: true });
    console.log(`✅ [${style}] ${name}`);
  } catch (e: any) {
    results.push({ style, step: name, ok: false, detail: String(e?.message || e).slice(0, 400) });
    console.error(`❌ [${style}] ${name}: ${e?.message || e}`);
  }
}

async function main() {
  ensureDir(OUT);
  const compositor = new VideoCompositorProvider({
    get: (_k: string, d?: any) => d,
  } as ConfigService);

  const clipA = mkClip('a.mp4', 'red');
  const clipB = mkClip('b.mp4', 'blue');
  const avatar = mkClip('avatar.mp4', 'white', 540, 960);
  const top = mkClip('top.mp4', 'orange');
  const bottom = mkClip('bottom.mp4', 'teal');
  const voice = mkAudio('voice.mp3', 440);
  const bgm = mkAudio('bgm.mp3', 220, 3);

  // HTTP hydrate stand-in for GCS (missing localPath)
  const httpRoot = path.join(OUT, 'http');
  ensureDir(httpRoot);
  fs.copyFileSync(clipA, path.join(httpRoot, 'remote_broll.mp4'));
  const http = execSync('python3 -c "import socket; s=socket.socket(); s.bind((\'127.0.0.1\',0)); print(s.getsockname()[1]); s.close()"')
    .toString()
    .trim();
  const httpProc = require('child_process').spawn(
    'python3',
    ['-m', 'http.server', http, '--bind', '127.0.0.1'],
    { cwd: httpRoot, stdio: 'ignore' },
  );
  await new Promise((r) => setTimeout(r, 400));
  const remoteUrl = `http://127.0.0.1:${http}/remote_broll.mp4`;

  const uploadsDir = path.join(process.cwd(), 'uploads');
  ensureDir(uploadsDir);

  let hydratedPath = '';
  await step('ALL', 'hydrate missing local from remote (GCS-like)', async () => {
    const resolved = await ensureLocalMedia(
      { localPath: '/tmp/missing-style-broll.mp4', gcsUrl: remoteUrl },
      { uploadsDir, priority: 'gcs' as any },
    );
    if (!resolved?.localPath || !fs.existsSync(resolved.localPath)) {
      throw new Error('hydrate failed');
    }
    hydratedPath = resolved.localPath;
  });

  // PRODUCT_ONLY / B_ROLL_ONLY
  await step('PRODUCT_ONLY', 'scale → refit → addAudio → concat', async () => {
    const scaled = path.join(OUT, 'po_scaled.mp4');
    const refit = path.join(OUT, 'po_refit.mp4');
    const muxed = path.join(OUT, 'po_mux.mp4');
    const final = path.join(OUT, 'po_final.mp4');
    await compositor.scaleVideoToDimensions(hydratedPath || clipA, scaled, 1080, 1920);
    await compositor.refitVideoToTargetDuration(scaled, refit, 1.2);
    await compositor.addAudioToVideo(refit, voice, muxed);
    await compositor.concatenateVideos([muxed, muxed], final);
  });

  await step('B_ROLL_ONLY', 'refit → addAudio → concat (same as product)', async () => {
    const refit = path.join(OUT, 'br_refit.mp4');
    const muxed = path.join(OUT, 'br_mux.mp4');
    await compositor.refitVideoToTargetDuration(clipB, refit, 1.2);
    await compositor.addAudioToVideo(refit, voice, muxed);
  });

  // AVATAR_ONLY / ANIMATED_AVATAR
  await step('AVATAR_ONLY', 'scale avatar + addAudio', async () => {
    const scaled = path.join(OUT, 'ao_scaled.mp4');
    const muxed = path.join(OUT, 'ao_mux.mp4');
    await compositor.scaleVideoToDimensions(avatar, scaled, 1080, 1920);
    await compositor.addAudioToVideo(scaled, voice, muxed);
  });

  await step('ANIMATED_AVATAR', 'same pipeline as AVATAR_ONLY', async () => {
    const muxed = path.join(OUT, 'an_mux.mp4');
    await compositor.addAudioToVideo(avatar, voice, muxed);
  });

  // HALF_N_HALF
  await step('HALF_N_HALF', 'compositeHalfAndHalf + addAudio', async () => {
    const composed = path.join(OUT, 'hh.mp4');
    const muxed = path.join(OUT, 'hh_mux.mp4');
    await compositor.compositeHalfAndHalf(top, bottom, composed);
    await compositor.addAudioToVideo(composed, voice, muxed);
  });

  // ALTERNATE
  await step('ALTERNATE', 'scale scenes + concat + addAudio', async () => {
    const s1 = path.join(OUT, 'alt_s1.mp4');
    const s2 = path.join(OUT, 'alt_s2.mp4');
    const cat = path.join(OUT, 'alt_cat.mp4');
    const muxed = path.join(OUT, 'alt_mux.mp4');
    await compositor.scaleVideoToDimensions(clipA, s1, 1080, 1920);
    await compositor.scaleVideoToDimensions(avatar, s2, 1080, 1920);
    await compositor.concatenateVideos([s1, s2], cat);
    await compositor.addAudioToVideo(cat, voice, muxed);
  });

  // AVATAR_CUTOUT
  await step('AVATAR_CUTOUT', 'extract segment + overlay + addAudio', async () => {
    const seg = path.join(OUT, 'cut_seg.mp4');
    const overlay = path.join(OUT, 'cut_ov.mp4');
    const muxed = path.join(OUT, 'cut_mux.mp4');
    await compositor.extractVideoSegment(avatar, seg, 0, 1, false);
    await compositor.overlayAvatarOnBroll(
      clipA,
      seg,
      overlay,
      { x: 0.7, y: 0.75, scale: 0.3, aspectRatio: 9 / 16 },
      false,
    );
    await compositor.addAudioToVideo(overlay, voice, muxed);
  });

  // AVATAR_PRODUCT
  await step('AVATAR_PRODUCT', 'refit broll + addAudio + concat', async () => {
    const refit = path.join(OUT, 'ap_refit.mp4');
    const muxed = path.join(OUT, 'ap_mux.mp4');
    const final = path.join(OUT, 'ap_final.mp4');
    await compositor.refitVideoToTargetDuration(clipA, refit, 1.2);
    await compositor.addAudioToVideo(refit, voice, muxed);
    await compositor.concatenateVideos([muxed], final);
  });

  // Export extras (all styles)
  await step('EXPORT', 'BGM mix + captions overlay', async () => {
    const withVoice = path.join(OUT, 'po_mux.mp4');
    const withBgm = path.join(OUT, 'export_bgm.mp4');
    const caption = path.join(OUT, 'caption.png');
    execSync(
      `ffmpeg -y -f lavfi -i color=c=black@0.0:s=1080x1920:d=0.04 -frames:v 1 "${caption}"`,
      { stdio: 'pipe' },
    );
    await compositor.mixVoiceWithBackgroundMusic(withVoice, bgm, withBgm, { mixVolume: 0.2 });
    const captioned = path.join(OUT, 'export_cap.mp4');
    await compositor.overlayCaptionLayerOnVideo(withBgm, caption, captioned);
  });

  try {
    httpProc.kill();
  } catch {
    /* ignore */
  }

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'style-report.json'), JSON.stringify({ results, failed: failed.length }, null, 2));
  console.log('\n========== STYLE PIPELINE SUMMARY ==========');
  console.log(`passed=${results.length - failed.length} failed=${failed.length} total=${results.length}`);
  if (failed.length) {
    console.error(failed);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
