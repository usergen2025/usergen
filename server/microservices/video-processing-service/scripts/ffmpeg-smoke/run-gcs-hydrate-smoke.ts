/**
 * Verify missing localPath + remote URL hydrates to disk (GCS-first / local-first).
 */
import * as path from 'path';
import * as fs from 'fs';
import { ensureLocalMedia } from '@shared/storage';

async function main() {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const remote =
    process.env.SMOKE_GCS_URL ||
    'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

  console.log('[gcs-hydrate] fetching', remote);
  const resolved = await ensureLocalMedia(
    {
      localPath: '/tmp/definitely-missing-broll-usergen.mp4',
      gcsUrl: remote,
      localUrl: '/uploads/videos/smoke/missing.mp4',
    },
    { uploadsDir, priority: 'gcs' as any },
  );

  if (!resolved?.localPath || !fs.existsSync(resolved.localPath)) {
    throw new Error('Failed to hydrate remote video to local disk');
  }
  const size = fs.statSync(resolved.localPath).size;
  console.log(
    JSON.stringify(
      { ok: true, localPath: resolved.localPath, size, isTemp: resolved.isTemp },
      null,
      2,
    ),
  );

  // Now prove compositor can use the hydrated file (scale)
  const { VideoCompositorProvider } = await import(
    '../../src/rendering/providers/video-compositor.provider'
  );
  const compositor = new VideoCompositorProvider({
    get: (_k: string, d?: any) => d,
  } as any);
  const out = path.join(uploadsDir, '.gcs-cache', `smoke_scaled_${Date.now()}.mp4`);
  await compositor.scaleVideoToDimensions(resolved.localPath, out, 360, 640);
  console.log(
    JSON.stringify(
      { scaledOk: fs.existsSync(out), scaledSize: fs.existsSync(out) ? fs.statSync(out).size : 0 },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
