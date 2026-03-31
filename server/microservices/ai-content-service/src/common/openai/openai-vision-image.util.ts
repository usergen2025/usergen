import axios from 'axios';
import sharp from 'sharp';

/** Keep payloads small so OpenAI vision accepts them and avoids slow remote fetches. */
const MAX_LONG_EDGE_PX = 1536;
const TARGET_MAX_OUTPUT_BYTES = 1_100_000;

/**
 * Download an HTTP(S) image and return a JPEG data URL suitable for OpenAI vision.
 * Avoids OpenAI servers fetching large/slow GCS URLs (they use a short download timeout).
 */
export async function httpImageToOpenAIDataUrl(imageHttpUrl: string): Promise<string | null> {
  try {
    const res = await axios.get<ArrayBuffer>(imageHttpUrl, {
      responseType: 'arraybuffer',
      timeout: 25000,
      maxContentLength: 30 * 1024 * 1024,
      headers: { 'User-Agent': 'UserGen-VisionPrep/1.0' },
    });
    if (res.status !== 200 || !res.data) {
      return null;
    }
    let input = Buffer.from(res.data);

    let quality = 82;
    for (let pass = 0; pass < 5; pass++) {
      const jpeg = await sharp(input)
        .rotate()
        .resize({
          width: MAX_LONG_EDGE_PX,
          height: MAX_LONG_EDGE_PX,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (jpeg.length <= TARGET_MAX_OUTPUT_BYTES) {
        return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
      }
      quality = Math.max(55, quality - 10);
    }

    const small = await sharp(input)
      .rotate()
      .resize({
        width: 1024,
        height: 1024,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 68, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${small.toString('base64')}`;
  } catch {
    return null;
  }
}
