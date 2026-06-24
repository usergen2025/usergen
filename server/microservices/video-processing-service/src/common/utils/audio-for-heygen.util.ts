import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Resolve a project audio filePath (relative or absolute) to an on-disk path.
 */
export function resolveAudioPathOnDisk(
  relativeOrAbsolutePath: string,
  options?: { uploadsDir?: string; cwd?: string },
): string | null {
  if (!relativeOrAbsolutePath) return null;

  const cwd = options?.cwd ?? process.cwd();
  const serverRoot = path.join(cwd, '..', '..');
  const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');
  const uploadsDir = options?.uploadsDir ?? path.join(cwd, 'uploads');

  if (path.isAbsolute(relativeOrAbsolutePath) && fs.existsSync(relativeOrAbsolutePath)) {
    return relativeOrAbsolutePath;
  }

  const rel = relativeOrAbsolutePath.startsWith('/')
    ? relativeOrAbsolutePath.slice(1)
    : relativeOrAbsolutePath;

  const candidates = [
    path.join(voiceServiceDir, rel),
    path.join(serverRoot, rel),
    path.join(cwd, rel),
    path.join(uploadsDir, rel.replace(/^uploads[/\\]/, '')),
  ];

  for (const full of candidates) {
    if (fs.existsSync(full)) return full;
  }

  return null;
}

/** HeyGen upload expects MP3 (audio/mpeg). Browser recordings are often WebM. */
export function needsMp3ConversionForHeyGen(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext !== '.mp3' && ext !== '.mpeg';
}

export function convertAudioFileToMp3(inputPath: string, outputPath: string): string {
  execFileSync(
    'ffmpeg',
    ['-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-b:a', '192k', '-y', outputPath],
    { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 },
  );
  if (!fs.existsSync(outputPath)) {
    throw new Error(`MP3 conversion failed: output not created (${outputPath})`);
  }
  return outputPath;
}

/**
 * Returns an MP3 path suitable for HeyGen upload. Converts WebM/other formats to a temp MP3 when needed.
 */
export function prepareMp3ForHeyGen(inputPath: string): {
  mp3Path: string;
  cleanup: (() => void) | null;
} {
  if (!needsMp3ConversionForHeyGen(inputPath)) {
    return { mp3Path: inputPath, cleanup: null };
  }

  const tempPath = path.join(
    os.tmpdir(),
    `heygen-${path.basename(inputPath, path.extname(inputPath))}-${Date.now()}.mp3`,
  );
  convertAudioFileToMp3(inputPath, tempPath);
  console.log(`[AudioForHeyGen] Converted ${path.extname(inputPath) || 'audio'} → MP3 for HeyGen: ${inputPath}`);

  return {
    mp3Path: tempPath,
    cleanup: () => {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    },
  };
}
