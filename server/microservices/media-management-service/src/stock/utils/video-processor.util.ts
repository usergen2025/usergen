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
  extended: boolean;
  compressed: boolean;
  scaled: boolean;
}

export interface TargetDimensions {
  width: number;
  height: number;
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
 * Get video resolution (width x height) using ffprobe
 */
export async function getVideoResolution(videoPath: string): Promise<{ width: number; height: number } | null> {
  checkFFmpeg();

  try {
    const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}"`;
    const output = execSync(command, { encoding: 'utf-8' }).trim();
    const [width, height] = output.split('x').map(Number);
    if (width && height && !isNaN(width) && !isNaN(height)) {
      return { width, height };
    }
    return null;
  } catch (error: any) {
    console.error(`[VideoProcessor] Failed to get video resolution: ${error.message}`);
    return null;
  }
}

/**
 * Scale video to target dimensions (scale and crop to fit exactly)
 * Uses the same approach as video-compositor: scale to cover, then crop to exact dimensions
 */
export async function scaleVideoToDimensions(
  inputPath: string,
  targetWidth: number,
  targetHeight: number,
  outputDir?: string
): Promise<{ outputPath: string; scaled: boolean; originalResolution: { width: number; height: number } | null }> {
  checkFFmpeg();

  const originalResolution = await getVideoResolution(inputPath);
  
  if (!originalResolution) {
    console.log(`[VideoProcessor] Could not get resolution, skipping scale`);
    return { outputPath: inputPath, scaled: false, originalResolution: null };
  }

  // Check if scaling is needed
  if (originalResolution.width === targetWidth && originalResolution.height === targetHeight) {
    console.log(`[VideoProcessor] Video already at target dimensions ${targetWidth}x${targetHeight}, no scaling needed`);
    return { outputPath: inputPath, scaled: false, originalResolution };
  }

  const dir = outputDir || path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const basename = path.basename(inputPath, ext);
  const outputPath = path.join(dir, `${basename}_scaled${ext}`);

  console.log(`[VideoProcessor] Scaling video from ${originalResolution.width}x${originalResolution.height} to ${targetWidth}x${targetHeight}`);

  try {
    // Scale to cover target dimensions (maintaining aspect ratio), then crop to exact size
    // This ensures the video fills the entire target frame without letterboxing
    const ffmpegCommand = `ffmpeg -i "${inputPath}" -vf "scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}" -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 192k -y "${outputPath}"`;
    
    execSync(ffmpegCommand, { stdio: 'pipe' });
    
    // Verify output exists
    if (fs.existsSync(outputPath)) {
      const newResolution = await getVideoResolution(outputPath);
      console.log(`[VideoProcessor] Scaled video created: ${outputPath} (${newResolution?.width}x${newResolution?.height})`);
      return { outputPath, scaled: true, originalResolution };
    } else {
      throw new Error('Scaled video file not created');
    }
  } catch (error: any) {
    console.error(`[VideoProcessor] Scale failed: ${error.message}`);
    return { outputPath: inputPath, scaled: false, originalResolution };
  }
}

/**
 * Extend video to target duration by looping
 * Used when stock video is shorter than the required audio duration
 */
export async function extendVideoToLength(
  inputPath: string,
  targetDuration: number,
  outputDir?: string
): Promise<{ outputPath: string; extended: boolean; originalDuration: number }> {
  checkFFmpeg();

  const originalDuration = await getVideoDuration(inputPath);
  
  if (originalDuration <= 0) {
    console.log(`[VideoProcessor] Could not get duration, skipping extend`);
    return { outputPath: inputPath, extended: false, originalDuration: 0 };
  }

  if (originalDuration >= targetDuration) {
    console.log(`[VideoProcessor] Video duration (${originalDuration.toFixed(2)}s) >= target (${targetDuration}s), no extension needed`);
    return { outputPath: inputPath, extended: false, originalDuration };
  }

  const dir = outputDir || path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const basename = path.basename(inputPath, ext);
  const outputPath = path.join(dir, `${basename}_extended${ext}`);

  console.log(`[VideoProcessor] Extending video from ${originalDuration.toFixed(2)}s to ${targetDuration}s by looping`);

  try {
    // Calculate how many loops needed to exceed target duration
    const loopsNeeded = Math.ceil(targetDuration / originalDuration);
    
    // Use stream_loop to loop the video, then trim to exact target duration
    // stream_loop=-1 would loop infinitely, we use exact number for efficiency
    const ffmpegCommand = `ffmpeg -stream_loop ${loopsNeeded - 1} -i "${inputPath}" -t ${targetDuration} -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 192k -y "${outputPath}"`;
    
    execSync(ffmpegCommand, { stdio: 'pipe' });
    
    // Verify output exists
    if (fs.existsSync(outputPath)) {
      const newDuration = await getVideoDuration(outputPath);
      console.log(`[VideoProcessor] Extended video created: ${outputPath} (${newDuration.toFixed(2)}s)`);
      return { outputPath, extended: true, originalDuration };
    } else {
      throw new Error('Extended video file not created');
    }
  } catch (error: any) {
    console.error(`[VideoProcessor] Extension failed: ${error.message}`);
    // Fallback: if looping fails, try holding the last frame
    try {
      console.log(`[VideoProcessor] Attempting fallback: holding last frame`);
      const fallbackPath = path.join(dir, `${basename}_padded${ext}`);
      // This creates a video that holds the last frame for the remaining duration
      const extraTime = targetDuration - originalDuration;
      const ffmpegFallback = `ffmpeg -i "${inputPath}" -vf "tpad=stop_mode=clone:stop_duration=${extraTime}" -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 192k -y "${fallbackPath}"`;
      
      execSync(ffmpegFallback, { stdio: 'pipe' });
      
      if (fs.existsSync(fallbackPath)) {
        const newDuration = await getVideoDuration(fallbackPath);
        console.log(`[VideoProcessor] Padded video created: ${fallbackPath} (${newDuration.toFixed(2)}s)`);
        return { outputPath: fallbackPath, extended: true, originalDuration };
      }
    } catch (fallbackError: any) {
      console.error(`[VideoProcessor] Fallback padding also failed: ${fallbackError.message}`);
    }
    return { outputPath: inputPath, extended: false, originalDuration };
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
 * Process video: trim to target duration, scale to target dimensions, and compress if needed
 * Returns the path to the processed video
 */
export async function processStockVideo(
  inputPath: string,
  targetDuration: number,
  maxSizeMB: number = MAX_FILE_SIZE_MB,
  targetDimensions?: TargetDimensions
): Promise<VideoProcessingResult> {
  console.log(`[VideoProcessor] Processing stock video: ${inputPath}`);
  console.log(`[VideoProcessor] Target duration: ${targetDuration}s, Max size: ${maxSizeMB} MB, Target dimensions: ${targetDimensions ? `${targetDimensions.width}x${targetDimensions.height}` : 'none'}`);

  // Step 1: Get original stats
  const originalDuration = await getVideoDuration(inputPath);
  const originalSize = getFileSizeMB(inputPath);
  
  console.log(`[VideoProcessor] Original stats: ${originalDuration.toFixed(2)}s, ${originalSize.toFixed(2)} MB`);

  let currentPath = inputPath;
  let wasTrimmed = false;
  let wasExtended = false;
  let wasCompressed = false;
  let wasScaled = false;

  // Step 2: Adjust duration to match target
  if (originalDuration > targetDuration) {
    // Video is too long - trim it
    const trimResult = await trimVideoToLength(currentPath, targetDuration);
    if (trimResult.trimmed) {
      currentPath = trimResult.outputPath;
      wasTrimmed = true;
    }
  } else if (originalDuration < targetDuration && (targetDuration - originalDuration) > 0.5) {
    // Video is too short (by more than 0.5s) - extend it by looping
    // This ensures stock videos match audio duration exactly
    const extendResult = await extendVideoToLength(currentPath, targetDuration);
    if (extendResult.extended) {
      currentPath = extendResult.outputPath;
      wasExtended = true;
    }
  }

  // Step 3: Scale to target dimensions if specified
  if (targetDimensions && targetDimensions.width > 0 && targetDimensions.height > 0) {
    const previousPath = currentPath;
    const scaleResult = await scaleVideoToDimensions(currentPath, targetDimensions.width, targetDimensions.height);
    if (scaleResult.scaled) {
      // Clean up previous intermediate file if different
      if (previousPath !== inputPath && previousPath !== scaleResult.outputPath) {
        try {
          fs.unlinkSync(previousPath);
        } catch (e) {
          console.warn(`[VideoProcessor] Could not clean up intermediate file: ${previousPath}`);
        }
      }
      currentPath = scaleResult.outputPath;
      wasScaled = true;
    }
  }

  // Step 4: Compress if necessary
  const currentSize = getFileSizeMB(currentPath);
  if (currentSize > maxSizeMB) {
    const previousPath = currentPath;
    const compressResult = await compressVideoIfNeeded(currentPath, maxSizeMB);
    if (compressResult.compressed) {
      // Clean up previous intermediate file if different
      if (previousPath !== inputPath && previousPath !== compressResult.outputPath) {
        try {
          fs.unlinkSync(previousPath);
        } catch (e) {
          console.warn(`[VideoProcessor] Could not clean up intermediate file: ${previousPath}`);
        }
      }
      currentPath = compressResult.outputPath;
      wasCompressed = true;
    }
  }

  const finalDuration = await getVideoDuration(currentPath);
  const finalSize = getFileSizeMB(currentPath);

  console.log(`[VideoProcessor] Processing complete: ${finalDuration.toFixed(2)}s, ${finalSize.toFixed(2)} MB`);
  console.log(`[VideoProcessor] Trimmed: ${wasTrimmed}, Extended: ${wasExtended}, Scaled: ${wasScaled}, Compressed: ${wasCompressed}`);

  return {
    outputPath: currentPath,
    originalDuration,
    finalDuration,
    originalSize,
    finalSize,
    trimmed: wasTrimmed,
    extended: wasExtended,
    compressed: wasCompressed,
    scaled: wasScaled,
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
