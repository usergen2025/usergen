import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface UsergenTiledWatermarkOptions {
  inputPath: string;
  outputPath: string;
  /** When set, watermark only appears during this time range (seconds). */
  timeRange?: { startSec: number; endSec: number };
  wmText?: string;
  fontSize?: number;
  alpha?: number;
  spacingX?: number;
  spacingY?: number;
  diagonalShift?: number;
  crf?: number;
}

/**
 * Tiled diagonal "UserGen" text watermark (same pattern as campaign draft submissions).
 */
export async function applyUsergenTiledWatermark(
  options: UsergenTiledWatermarkOptions,
): Promise<void> {
  const {
    inputPath,
    outputPath,
    timeRange,
    wmText = 'UserGen',
    fontSize = 72,
    alpha = 0.5,
    spacingX = 350,
    spacingY = 220,
    diagonalShift = 150,
    crf = 23,
  } = options;

  const enableClause =
    timeRange != null
      ? `:enable='between(t,${timeRange.startSec},${timeRange.endSec})'`
      : '';

  const drawTextFilters: string[] = [];
  for (let row = -5; row <= 18; row++) {
    for (let col = -5; col <= 12; col++) {
      const x = col * spacingX + row * diagonalShift;
      const y = row * spacingY;
      drawTextFilters.push(
        `drawtext=text='${wmText}':fontsize=${fontSize}:fontcolor=white@${alpha}:x=${x}:y=${y}${enableClause}`,
      );
    }
  }
  const vf = drawTextFilters.join(',');

  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    String(crf),
    '-movflags',
    '+faststart',
    '-c:a',
    'copy',
    outputPath,
  ]);
}

export interface PreviewAudioScene {
  sceneNumber?: number;
  duration?: number;
}

const DEFAULT_LAST_PORTION_SEC = 5;

/**
 * Last-scene / last-portion window for preview watermark (before outro).
 */
export function computeLastSceneTimeRange(
  totalDurationSec: number,
  audioFiles?: PreviewAudioScene[] | null,
): { startSec: number; endSec: number } {
  const total = Math.max(0, totalDurationSec);
  if (total <= 0) {
    return { startSec: 0, endSec: 0 };
  }

  let lastPortionSec = DEFAULT_LAST_PORTION_SEC;
  if (audioFiles && Array.isArray(audioFiles) && audioFiles.length > 0) {
    const sorted = [...audioFiles].sort(
      (a, b) => (a.sceneNumber ?? 0) - (b.sceneNumber ?? 0),
    );
    const last = sorted[sorted.length - 1];
    const d = Number(last?.duration);
    if (Number.isFinite(d) && d > 0) {
      lastPortionSec = d;
    }
  }

  lastPortionSec = Math.min(lastPortionSec, total);
  const endSec = total;
  const startSec = Math.max(0, endSec - lastPortionSec);
  return { startSec, endSec };
}
