/**
 * P0 FFmpeg smoke: exercise every VideoCompositorProvider path that shells out
 * to FFmpeg with quoted absolute paths (the regression from naive .split(' ')).
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/ffmpeg-smoke/run-compositor-smoke.ts
 */
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { VideoCompositorProvider } from '../../src/rendering/providers/video-compositor.provider';

const OUT = path.join(osTmp(), 'usergen-ffmpeg-smoke');
const results: { name: string; ok: boolean; detail?: string; ms: number }[] = [];

function osTmp() {
  return process.env.TMPDIR || process.env.TMP || '/tmp';
}

function makeConfig(): ConfigService {
  return {
    get: (_key: string, defaultValue?: any) => defaultValue,
  } as ConfigService;
}

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function genFixtures() {
  ensureDir(OUT);
  const videoA = path.join(OUT, 'clip_a.mp4');
  const videoB = path.join(OUT, 'clip_b.mp4');
  const videoLandscape = path.join(OUT, 'clip_landscape.mp4');
  const audioA = path.join(OUT, 'voice_a.mp3');
  const audioB = path.join(OUT, 'voice_b.mp3');
  const bgm = path.join(OUT, 'bgm.mp3');
  const avatar = path.join(OUT, 'avatar.mp4');
  const captionPng = path.join(OUT, 'caption.png');

  // Short solid-color clips with silent audio (quoted paths intentionally have no spaces,
  // matching production filenames; argv parser is still exercised via compositor templates).
  execSync(
    `ffmpeg -y -f lavfi -i color=c=red:s=1080x1920:d=2 -f lavfi -i anullsrc=r=48000:cl=stereo -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${videoA}"`,
    { stdio: 'pipe' },
  );
  execSync(
    `ffmpeg -y -f lavfi -i color=c=blue:s=1080x1920:d=2 -f lavfi -i anullsrc=r=48000:cl=stereo -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${videoB}"`,
    { stdio: 'pipe' },
  );
  execSync(
    `ffmpeg -y -f lavfi -i color=c=green:s=1920x1080:d=2 -c:v libx264 -pix_fmt yuv420p "${videoLandscape}"`,
    { stdio: 'pipe' },
  );
  execSync(
    `ffmpeg -y -f lavfi -i sine=frequency=440:duration=2 -c:a libmp3lame "${audioA}"`,
    { stdio: 'pipe' },
  );
  execSync(
    `ffmpeg -y -f lavfi -i sine=frequency=660:duration=2 -c:a libmp3lame "${audioB}"`,
    { stdio: 'pipe' },
  );
  execSync(
    `ffmpeg -y -f lavfi -i sine=frequency=220:duration=3 -c:a libmp3lame "${bgm}"`,
    { stdio: 'pipe' },
  );
  execSync(
    `ffmpeg -y -f lavfi -i color=c=white:s=540x960:d=2 -f lavfi -i anullsrc=r=48000:cl=stereo -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${avatar}"`,
    { stdio: 'pipe' },
  );
  // Tiny 1x1 PNG as caption layer stand-in
  execSync(
    `ffmpeg -y -f lavfi -i color=c=black@0.0:s=1080x1920:d=0.04 -frames:v 1 "${captionPng}"`,
    { stdio: 'pipe' },
  );

  return { videoA, videoB, videoLandscape, audioA, audioB, bgm, avatar, captionPng };
}

async function run(
  name: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`✅ ${name} (${Date.now() - t0}ms)`);
  } catch (e: any) {
    const detail = (e?.message || String(e)).slice(0, 500);
    results.push({ name, ok: false, detail, ms: Date.now() - t0 });
    console.error(`❌ ${name}: ${detail}`);
  }
}

async function main() {
  console.log(`[ffmpeg-smoke] OUT=${OUT}`);
  const f = genFixtures();
  const compositor = new VideoCompositorProvider(makeConfig());

  // Map ops → which video styles typically hit them
  await run('scaleVideoToDimensions (all styles)', async () => {
    const out = path.join(OUT, 'scaled.mp4');
    await compositor.scaleVideoToDimensions(f.videoLandscape, out, 1080, 1920);
    if (!fs.existsSync(out) || fs.statSync(out).size < 1000) throw new Error('scaled output empty');
  });

  await run('addAudioToVideo (PRODUCT/BROLL/ALTERNATE/CUTOUT/AVATAR_PRODUCT)', async () => {
    const out = path.join(OUT, 'with_audio.mp4');
    await compositor.addAudioToVideo(f.videoA, f.audioA, out);
    if (!fs.existsSync(out) || fs.statSync(out).size < 1000) throw new Error('mux output empty');
  });

  await run('refitVideoToTargetDuration trim (PRODUCT/BROLL)', async () => {
    const out = path.join(OUT, 'refit_trim.mp4');
    const r = await compositor.refitVideoToTargetDuration(f.videoA, out, 1.0, 0.05);
    if (!fs.existsSync(r)) throw new Error('refit missing');
  });

  await run('refitVideoToTargetDuration loop (PRODUCT/BROLL)', async () => {
    const out = path.join(OUT, 'refit_loop.mp4');
    const r = await compositor.refitVideoToTargetDuration(f.videoA, out, 4.0, 0.05);
    if (!fs.existsSync(r)) throw new Error('loop missing');
  });

  await run('trimVideo', async () => {
    const out = path.join(OUT, 'trimmed.mp4');
    await compositor.trimVideo(f.videoA, out, 0, 1);
  });

  await run('loopVideoToDuration', async () => {
    const out = path.join(OUT, 'looped.mp4');
    await compositor.loopVideoToDuration(f.videoA, out, 3.5);
  });

  await run('concatenateVideos (PRODUCT/BROLL/ALTERNATE/CUTOUT)', async () => {
    const out = path.join(OUT, 'concat.mp4');
    await compositor.concatenateVideos([f.videoA, f.videoB], out);
  });

  await run('concatenateAudios (voice stitch)', async () => {
    const out = path.join(OUT, 'concat_audio.mp3');
    await compositor.concatenateAudios([f.audioA, f.audioB], out);
  });

  await run('compositeHalfAndHalf (HALF_N_HALF)', async () => {
    const out = path.join(OUT, 'half_n_half.mp4');
    await compositor.compositeHalfAndHalf(f.videoA, f.videoB, out);
  });

  await run('overlayAvatarOnBroll (AVATAR_CUTOUT)', async () => {
    const out = path.join(OUT, 'cutout_overlay.mp4');
    // Disable AI bg removal path; useAIBackgroundRemoval=false
    await compositor.overlayAvatarOnBroll(
      f.videoA,
      f.avatar,
      out,
      { x: 0.7, y: 0.75, scale: 0.35, aspectRatio: 9 / 16 },
      false,
    );
  });

  await run('extractVideoSegment (CUTOUT per-scene)', async () => {
    const out = path.join(OUT, 'segment.mp4');
    await compositor.extractVideoSegment(f.videoA, out, 0, 1, false);
  });

  await run('cropVideo', async () => {
    const out = path.join(OUT, 'cropped.mp4');
    await compositor.cropVideo(f.videoA, out, 0, 0, 540, 960);
  });

  await run('mixVoiceWithBackgroundMusic (export BGM)', async () => {
    const withVoice = path.join(OUT, 'with_audio.mp4');
    if (!fs.existsSync(withVoice)) {
      await compositor.addAudioToVideo(f.videoA, f.audioA, withVoice);
    }
    const out = path.join(OUT, 'voice_bgm.mp4');
    await compositor.mixVoiceWithBackgroundMusic(withVoice, f.bgm, out, { mixVolume: 0.25 });
  });

  await run('applyAudioFadeOut', async () => {
    const out = path.join(OUT, 'fade.mp3');
    await compositor.applyAudioFadeOut(f.audioA, out, 0.5);
  });

  await run('overlayCaptionLayerOnVideo (captions)', async () => {
    const out = path.join(OUT, 'captioned.mp4');
    await compositor.overlayCaptionLayerOnVideo(f.videoA, f.captionPng, out);
  });

  await run('getVideoDuration / getVideoResolution / validateVideoOutput', async () => {
    const d = await compositor.getVideoDuration(f.videoA);
    const r = await compositor.getVideoResolution(f.videoA);
    if (!(d > 0) || !r?.width) throw new Error(`probe failed d=${d} r=${JSON.stringify(r)}`);
    const v = await compositor.validateVideoOutput(f.videoA, { minSizeBytes: 500 });
    if (!v.ok) throw new Error(`validate failed: ${v.reason}`);
  });

  await run('missing-input fails clearly (assert before spawn)', async () => {
    const missing = path.join(OUT, 'does_not_exist.mp4');
    const out = path.join(OUT, 'should_not_create.mp4');
    let threw = false;
    try {
      await compositor.addAudioToVideo(missing, f.audioA, out);
    } catch (e: any) {
      threw = true;
      if (!String(e.message).includes('missing on disk')) {
        throw new Error(`Expected clear missing-input error, got: ${e.message}`);
      }
    }
    if (!threw) throw new Error('Expected throw for missing input');
  });

  // Quoted-path with spaces (argv parser must keep path intact)
  await run('quoted path with spaces in filename', async () => {
    const spaced = path.join(OUT, 'clip with spaces.mp4');
    fs.copyFileSync(f.videoA, spaced);
    const out = path.join(OUT, 'spaced_out.mp4');
    await compositor.scaleVideoToDimensions(spaced, out, 720, 1280);
    if (!fs.existsSync(out)) throw new Error('spaced path scale failed');
  });

  const failed = results.filter((r) => !r.ok);
  const report = {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n========== SMOKE SUMMARY ==========');
  console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed }, null, 2));
  if (failed.length) {
    console.error('Failures:', failed.map((f) => f.name));
    process.exit(1);
  }
  console.log('All compositor FFmpeg ops passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
