import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface VideoProcessingResult {
  outputPath: string;
  originalDuration: number;
  finalDuration: number;
  originalSize: number;
  finalSize: number;
  trimmed: boolean;
  compressed: boolean;
}

const MAX_FILE_SIZE_MB = 100;

/**
 * Check if FFmpeg is available
 */
function checkFFmpeg(): void {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch (error) {
    throw new Error('FFmpeg is not installed or not available in PATH. Please install FFmpeg.');
  }
}

/**
 * Get video duration in seconds using ffprobe
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  checkFFmpeg();

  try {
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const output = execSync(command, { encoding: 'utf-8' });
    const duration = parseFloat(output.trim());
    return isNaN(duration) ? 0 : duration;
  } catch (error: any) {
    console.error(`[VideoProcessor] Failed to get video duration: ${error.message}`);
    return 0;
  }
}

/**
 * Get file size in MB
 */
export function getFileSizeMB(filePath: string): number {
  try {
    const stats = fs.statSync(filePath);
    return stats.size / (1024 * 1024);
  } catch (error) {
    return 0;
  }
}

/**
 * Trim video to target duration (keeps the first N seconds)
 */
export async function trimVideoToLength(
  inputPath: string,
  targetDuration: number,
  outputDir?: string
): Promise<{ outputPath: string; trimmed: boolean; originalDuration: number }> {
  checkFFmpeg();

  const originalDuration = await getVideoDuration(inputPath);
  
  if (originalDuration <= 0) {
    console.log(`[VideoProcessor] Could not get duration, skipping trim`);
    return { outputPath: inputPath, trimmed: false, originalDuration: 0 };
  }

  if (originalDuration <= targetDuration) {
    console.log(`[VideoProcessor] Video duration (${originalDuration.toFixed(2)}s) <= target (${targetDuration}s), no trim needed`);
    return { outputPath: inputPath, trimmed: false, originalDuration };
  }

  const dir = outputDir || path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const basename = path.basename(inputPath, ext);
  const outputPath = path.join(dir, `${basename}_trimmed${ext}`);

  console.log(`[VideoProcessor] Trimming video from ${originalDuration.toFixed(2)}s to ${targetDuration}s`);

  try {
    const ffmpegCommand = `ffmpeg -i "${inputPath}" -t ${targetDuration} -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 192k -y "${outputPath}"`;
    
    execSync(ffmpegCommand, { stdio: 'pipe' });
    
    // Verify output exists
    if (fs.existsSync(outputPath)) {
      const newDuration = await getVideoDuration(outputPath);
      console.log(`[VideoProcessor] Trimmed video created: ${outputPath} (${newDuration.toFixed(2)}s)`);
      return { outputPath, trimmed: true, originalDuration };
    } else {
      throw new Error('Trimmed video file not created');
    }
  } catch (error: any) {
    console.error(`[VideoProcessor] Trim failed: ${error.message}`);
    return { outputPath: inputPath, trimmed: false, originalDuration };
  }
}

/**
 * Compress video to reduce file size below the specified limit
 * Uses CRF adjustment and optional resolution reduction
 */
export async function compressVideoIfNeeded(
  inputPath: string,
  maxSizeMB: number = MAX_FILE_SIZE_MB,
  outputDir?: string
): Promise<{ outputPath: string; compressed: boolean; originalSize: number; finalSize: number }> {
  checkFFmpeg();

  const originalSize = getFileSizeMB(inputPath);
  
  if (originalSize <= 0) {
    console.log(`[VideoProcessor] Could not get file size, skipping compression`);
    return { outputPath: inputPath, compressed: false, originalSize: 0, finalSize: 0 };
  }

  if (originalSize <= maxSizeMB) {
    console.log(`[VideoProcessor] File size (${originalSize.toFixed(2)} MB) <= limit (${maxSizeMB} MB), no compression needed`);
    return { outputPath: inputPath, compressed: false, originalSize, finalSize: originalSize };
  }

  const dir = outputDir || path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const basename = path.basename(inputPath, ext);
  const outputPath = path.join(dir, `${basename}_compressed${ext}`);

  console.log(`[VideoProcessor] Compressing video from ${originalSize.toFixed(2)} MB to under ${maxSizeMB} MB`);

  try {
    // Calculate target bitrate based on desired file size and duration
    const duration = await getVideoDuration(inputPath);
    if (duration <= 0) {
      throw new Error('Could not determine video duration for compression calculation');
    }

    // Target file size in bits, with 10% buffer for safety
    const targetFileSizeBits = (maxSizeMB * 0.9) * 8 * 1024 * 1024;
    // Subtract audio bitrate estimate (192kbps)
    const audioBitrate = 192000;
    const videoBitrate = Math.floor((targetFileSizeBits / duration) - audioBitrate);
    
    // Minimum video bitrate of 500kbps
    const finalVideoBitrate = Math.max(500000, videoBitrate);
    const videoBitrateKbps = Math.floor(finalVideoBitrate / 1000);

    console.log(`[VideoProcessor] Target video bitrate: ${videoBitrateKbps}k for ${duration.toFixed(2)}s video`);

    // First pass: Try with calculated bitrate
    const ffmpegCommand = `ffmpeg -i "${inputPath}" -c:v libx264 -preset medium -b:v ${videoBitrateKbps}k -maxrate ${videoBitrateKbps * 1.5}k -bufsize ${videoBitrateKbps * 2}k -c:a aac -b:a 128k -y "${outputPath}"`;
    
    execSync(ffmpegCommand, { stdio: 'pipe' });
    
    // Verify output exists and check size
    if (fs.existsSync(outputPath)) {
      const finalSize = getFileSizeMB(outputPath);
      
      // If still too large, try more aggressive compression with resolution reduction
      if (finalSize > maxSizeMB) {
        console.log(`[VideoProcessor] First compression attempt resulted in ${finalSize.toFixed(2)} MB, trying more aggressive compression...`);
        
        const aggressivePath = path.join(dir, `${basename}_compressed_aggressive${ext}`);
        const aggressiveCommand = `ffmpeg -i "${inputPath}" -vf "scale=iw*0.75:ih*0.75" -c:v libx264 -preset medium -crf 28 -c:a aac -b:a 96k -y "${aggressivePath}"`;
        
        execSync(aggressiveCommand, { stdio: 'pipe' });
        
        if (fs.existsSync(aggressivePath)) {
          const aggressiveSize = getFileSizeMB(aggressivePath);
          // Clean up first attempt
          fs.unlinkSync(outputPath);
          
          console.log(`[VideoProcessor] Aggressive compression: ${originalSize.toFixed(2)} MB -> ${aggressiveSize.toFixed(2)} MB`);
          return { outputPath: aggressivePath, compressed: true, originalSize, finalSize: aggressiveSize };
        }
      }
      
      console.log(`[VideoProcessor] Compressed: ${originalSize.toFixed(2)} MB -> ${finalSize.toFixed(2)} MB`);
      return { outputPath, compressed: true, originalSize, finalSize };
    } else {
      throw new Error('Compressed video file not created');
    }
  } catch (error: any) {
    console.error(`[VideoProcessor] Compression failed: ${error.message}`);
    return { outputPath: inputPath, compressed: false, originalSize, finalSize: originalSize };
  }
}

/**
 * Process video: trim to target duration and compress if needed
 * Returns the path to the processed video
 */
export async function processStockVideo(
  inputPath: string,
  targetDuration: number,
  maxSizeMB: number = MAX_FILE_SIZE_MB
): Promise<VideoProcessingResult> {
  console.log(`[VideoProcessor] Processing stock video: ${inputPath}`);
  console.log(`[VideoProcessor] Target duration: ${targetDuration}s, Max size: ${maxSizeMB} MB`);

  // Step 1: Get original stats
  const originalDuration = await getVideoDuration(inputPath);
  const originalSize = getFileSizeMB(inputPath);
  
  console.log(`[VideoProcessor] Original stats: ${originalDuration.toFixed(2)}s, ${originalSize.toFixed(2)} MB`);

  let currentPath = inputPath;
  let wasTrimmed = false;
  let wasCompressed = false;

  // Step 2: Trim if necessary
  if (originalDuration > targetDuration) {
    const trimResult = await trimVideoToLength(currentPath, targetDuration);
    if (trimResult.trimmed) {
      currentPath = trimResult.outputPath;
      wasTrimmed = true;
    }
  }

  // Step 3: Compress if necessary
  const currentSize = getFileSizeMB(currentPath);
  if (currentSize > maxSizeMB) {
    const compressResult = await compressVideoIfNeeded(currentPath, maxSizeMB);
    if (compressResult.compressed) {
      // If we trimmed, clean up the trimmed intermediate file
      if (wasTrimmed && currentPath !== inputPath && currentPath !== compressResult.outputPath) {
        try {
          fs.unlinkSync(currentPath);
        } catch (e) {
          console.warn(`[VideoProcessor] Could not clean up intermediate file: ${currentPath}`);
        }
      }
      currentPath = compressResult.outputPath;
      wasCompressed = true;
    }
  }

  const finalDuration = await getVideoDuration(currentPath);
  const finalSize = getFileSizeMB(currentPath);

  console.log(`[VideoProcessor] Processing complete: ${finalDuration.toFixed(2)}s, ${finalSize.toFixed(2)} MB`);
  console.log(`[VideoProcessor] Trimmed: ${wasTrimmed}, Compressed: ${wasCompressed}`);

  return {
    outputPath: currentPath,
    originalDuration,
    finalDuration,
    originalSize,
    finalSize,
    trimmed: wasTrimmed,
    compressed: wasCompressed,
  };
}

/**
 * Clean up temporary processed files
 */
export function cleanupProcessedFiles(originalPath: string, processedPath: string): void {
  if (processedPath !== originalPath && fs.existsSync(processedPath)) {
    try {
      fs.unlinkSync(processedPath);
      console.log(`[VideoProcessor] Cleaned up: ${processedPath}`);
    } catch (error: any) {
      console.warn(`[VideoProcessor] Could not clean up: ${processedPath} - ${error.message}`);
    }
  }
}
