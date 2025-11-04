import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class VideoCompositorProvider {
  /**
   * Check if FFmpeg is available
   */
  private checkFFmpeg(): void {
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
    } catch (error) {
      throw new Error('FFmpeg is not installed or not available in PATH. Please install FFmpeg.');
    }
  }

  /**
   * Composite two videos vertically for half-and-half style
   * Top video (B-roll): 1080x1440 (3:4) scaled to fit top half without padding
   * Bottom video (Avatar): 1080x1440 (3:4) scaled to fit bottom half without padding
   * Final output: 1080x1920 (9:16) without black padding
   * @param topVideoPath Path to top video (B-roll)
   * @param bottomVideoPath Path to bottom video (Avatar)
   * @param outputPath Path for output video
   * @param finalWidth Final video width (e.g., 1080 for 9:16)
   * @param finalHeight Final video height (e.g., 1920 for 9:16)
   */
  async compositeHalfAndHalf(
    topVideoPath: string,
    bottomVideoPath: string,
    outputPath: string,
    finalWidth: number = 1080,
    finalHeight: number = 1920
  ): Promise<string> {
    this.checkFFmpeg();

    const topHeight = Math.floor(finalHeight / 2); // 960 for 1920 height
    const bottomHeight = finalHeight - topHeight; // 960 for 1920 height

    console.log(`[VideoCompositor] Compositing HALF_N_HALF: Top=${finalWidth}x${topHeight}, Bottom=${finalWidth}x${bottomHeight}, Final=${finalWidth}x${finalHeight}`);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // FFmpeg command to composite videos vertically WITHOUT padding
    // Use scale with crop instead of pad to avoid black bars
    // Both videos are 1080x1440 (3:4), we need to scale them to fit 1080x960 each
    // Scale to fill the height, then crop to exact dimensions (no black bars)
    const ffmpegCommand = `
      ffmpeg -i "${topVideoPath}" -i "${bottomVideoPath}" \
      -filter_complex "[0:v]scale=${finalWidth}:${topHeight}:force_original_aspect_ratio=increase,crop=${finalWidth}:${topHeight}[v0]; \
      [1:v]scale=${finalWidth}:${bottomHeight}:force_original_aspect_ratio=increase,crop=${finalWidth}:${bottomHeight}[v1]; \
      [v0][v1]vstack=inputs=2[v]" \
      -map "[v]" -c:v libx264 -preset medium -crf 23 \
      -map 1:a -c:a aac -b:a 192k \
      -shortest -y "${outputPath}"
    `.replace(/\s+/g, ' ').trim();

    try {
      console.log(`[VideoCompositor] Executing FFmpeg command for HALF_N_HALF compositing (no padding)...`);
      execSync(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Video composited successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg error:`, error.message);
      throw new Error(`Failed to composite videos: ${error.message}`);
    }
  }

  /**
   * Concatenate multiple videos into one
   * @param videoPaths Array of video file paths in order
   * @param outputPath Path for output video
   */
  async concatenateVideos(videoPaths: string[], outputPath: string): Promise<string> {
    this.checkFFmpeg();

    if (videoPaths.length === 0) {
      throw new Error('No videos to concatenate');
    }

    if (videoPaths.length === 1) {
      // If only one video, just copy it
      fs.copyFileSync(videoPaths[0], outputPath);
      return outputPath;
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Convert all paths to absolute paths before writing to concat list
    // FFmpeg concat interprets paths relative to the concat list file's directory
    // So we need absolute paths to avoid duplication issues
    const absolutePaths = videoPaths.map(vp => {
      // If path is already absolute, use it as-is
      if (path.isAbsolute(vp)) {
        if (!fs.existsSync(vp)) {
          throw new Error(`Video file not found: ${vp}`);
        }
        return vp;
      }
      // If path is relative, resolve it from current working directory
      const absolutePath = path.resolve(vp);
      if (!fs.existsSync(absolutePath)) {
        // Try resolving from output directory as fallback
        const fallbackPath = path.resolve(outputDir, vp);
        if (fs.existsSync(fallbackPath)) {
          return fallbackPath;
        }
        throw new Error(`Video file not found: ${vp} (tried: ${absolutePath}, ${fallbackPath})`);
      }
      return absolutePath;
    });

    // Create a temporary file list for FFmpeg concat
    const listPath = path.join(outputDir, `concat_list_${Date.now()}.txt`);
    // Use absolute paths in the concat list to avoid path duplication issues
    const listContent = absolutePaths.map(vp => `file '${vp.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    console.log(`[VideoCompositor] Concatenating ${absolutePaths.length} videos...`);

    try {
      const ffmpegCommand = `
        ffmpeg -f concat -safe 0 -i "${listPath}" \
        -c:v libx264 -preset medium -crf 23 \
        -c:a aac -b:a 192k \
        -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();

      execSync(ffmpegCommand, { stdio: 'inherit' });
      
      // Clean up temporary list file
      fs.unlinkSync(listPath);
      
      console.log(`[VideoCompositor] Videos concatenated successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      // Clean up temporary list file
      if (fs.existsSync(listPath)) {
        fs.unlinkSync(listPath);
      }
      console.error(`[VideoCompositor] FFmpeg concatenation error:`, error.message);
      throw new Error(`Failed to concatenate videos: ${error.message}`);
    }
  }

  /**
   * Get video duration in seconds
   */
  async getVideoDuration(videoPath: string): Promise<number> {
    this.checkFFmpeg();

    try {
      const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
      const output = execSync(command, { encoding: 'utf-8' });
      const duration = parseFloat(output.trim());
      return isNaN(duration) ? 0 : duration;
    } catch (error: any) {
      console.error(`[VideoCompositor] Failed to get video duration:`, error.message);
      return 0;
    }
  }

  /**
   * Get video resolution (width x height)
   */
  async getVideoResolution(videoPath: string): Promise<{ width: number; height: number } | null> {
    this.checkFFmpeg();

    try {
      const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}"`;
      const output = execSync(command, { encoding: 'utf-8' }).trim();
      const [width, height] = output.split('x').map(Number);
      return { width, height };
    } catch (error: any) {
      console.error(`[VideoCompositor] Failed to get video resolution:`, error.message);
      return null;
    }
  }

  /**
   * Overlay avatar video on b-roll video (for CUTOUT style)
   * Avatar video is positioned at bottom center with green screen removal
   * @param brollVideoPath Path to b-roll video (background)
   * @param avatarVideoPath Path to avatar video (foreground with green background)
   * @param outputPath Path for output video
   * @param avatarMaxHeight Maximum height of avatar video as percentage of b-roll height (default: 40%)
   */
  async overlayAvatarOnBroll(
    brollVideoPath: string,
    avatarVideoPath: string,
    outputPath: string,
    avatarMaxHeight: number = 40
  ): Promise<string> {
    this.checkFFmpeg();

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get b-roll video resolution
    const brollRes = await this.getVideoResolution(brollVideoPath);
    if (!brollRes) {
      throw new Error('Failed to get b-roll video resolution');
    }

    const brollWidth = brollRes.width;
    const brollHeight = brollRes.height;
    const avatarMaxHeightPx = Math.floor((brollHeight * avatarMaxHeight) / 100);
    const avatarX = Math.floor((brollWidth - avatarMaxHeightPx) / 2); // Center horizontally
    const avatarY = brollHeight - avatarMaxHeightPx; // Bottom

    console.log(`[VideoCompositor] Overlaying avatar (max ${avatarMaxHeight}% height) on b-roll ${brollWidth}x${brollHeight}`);
    console.log(`[VideoCompositor] Avatar position: x=${avatarX}, y=${avatarY}, max_height=${avatarMaxHeightPx}`);

    // FFmpeg command to overlay avatar on b-roll with green screen removal
    // Chroma key: remove green background (0x00FF00 or similar shades)
    const ffmpegCommand = `
      ffmpeg -i "${brollVideoPath}" -i "${avatarVideoPath}" \
      -filter_complex "[1:v]scale=-1:${avatarMaxHeightPx}:force_original_aspect_ratio=decrease[avatar_scaled]; \
      [avatar_scaled]chromakey=color=0x00FF00:similarity=0.3:blend=0.1[avatar_no_bg]; \
      [0:v][avatar_no_bg]overlay=${avatarX}:${avatarY}:shortest=1[v]" \
      -map "[v]" -c:v libx264 -preset medium -crf 23 \
      -map 0:a -c:a aac -b:a 192k \
      -shortest -y "${outputPath}"
    `.replace(/\s+/g, ' ').trim();

    try {
      console.log(`[VideoCompositor] Executing FFmpeg overlay command...`);
      execSync(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Video overlaid successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg overlay error:`, error.message);
      throw new Error(`Failed to overlay avatar on b-roll: ${error.message}`);
    }
  }

  /**
   * Concatenate audio files into one
   * @param audioPaths Array of audio file paths in order (absolute paths)
   * @param outputPath Path for output audio file
   */
  async concatenateAudios(audioPaths: string[], outputPath: string): Promise<string> {
    this.checkFFmpeg();

    if (audioPaths.length === 0) {
      throw new Error('No audio files to concatenate');
    }

    if (audioPaths.length === 1) {
      fs.copyFileSync(audioPaths[0], outputPath);
      return outputPath;
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Convert relative paths to absolute paths
    // Audio paths from voice service are stored as absolute paths from process.cwd()
    // e.g., /uploads/audio/userId/scene_X.mp3 or uploads/audio/userId/scene_X.mp3
    const absoluteAudioPaths = audioPaths.map(ap => {
      if (path.isAbsolute(ap)) {
        return ap;
      }
      // If path starts with /, it's relative to process.cwd()
      if (ap.startsWith('/')) {
        return path.join(process.cwd(), ap.slice(1));
      }
      // Otherwise, it's relative to process.cwd()
      return path.join(process.cwd(), ap);
    }).filter(ap => {
      const exists = fs.existsSync(ap);
      if (!exists) {
        console.warn(`[VideoCompositor] Audio file not found: ${ap}`);
      }
      return exists;
    });

    if (absoluteAudioPaths.length === 0) {
      throw new Error('No valid audio files found to concatenate');
    }

    console.log(`[VideoCompositor] Concatenating ${absoluteAudioPaths.length} audio files...`);

    try {
      // Use filter_complex to concatenate audio files (more reliable than concat demuxer for MP3)
      // Build input arguments
      const inputArgs = absoluteAudioPaths.map(ap => `-i "${ap}"`).join(' ');
      
      // Build filter_complex for concatenation
      const filterInputs = absoluteAudioPaths.map((_, i) => `[${i}:0]`).join('');
      const filterComplex = `${filterInputs}concat=n=${absoluteAudioPaths.length}:v=0:a=1[out]`;

      // Determine output codec based on file extension
      const outputExt = path.extname(outputPath).toLowerCase();
      let audioCodec = 'aac';
      let audioBitrate = '192k';
      
      if (outputExt === '.mp3') {
        audioCodec = 'libmp3lame';
        audioBitrate = '192k';
      } else if (outputExt === '.m4a' || outputExt === '.aac') {
        audioCodec = 'aac';
        audioBitrate = '192k';
      }

      const ffmpegCommand = `
        ffmpeg ${inputArgs} \
        -filter_complex "${filterComplex}" \
        -map "[out]" \
        -c:a ${audioCodec} -b:a ${audioBitrate} \
        -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();

      console.log(`[VideoCompositor] Executing FFmpeg command for audio concatenation...`);
      execSync(ffmpegCommand, { stdio: 'inherit' });
      
      console.log(`[VideoCompositor] Audio files concatenated successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg audio concatenation error:`, error.message);
      throw new Error(`Failed to concatenate audio files: ${error.message}`);
    }
  }

  /**
   * Add audio track to video
   * @param videoPath Path to video file
   * @param audioPath Path to audio file
   * @param outputPath Path for output video
   */
  async addAudioToVideo(videoPath: string, audioPath: string, outputPath: string): Promise<string> {
    this.checkFFmpeg();

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`[VideoCompositor] Adding audio to video...`);

    try {
      const ffmpegCommand = `
        ffmpeg -i "${videoPath}" -i "${audioPath}" \
        -c:v copy -c:a aac -b:a 192k \
        -map 0:v:0 -map 1:a:0 \
        -shortest -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();

      execSync(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Audio added to video successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg add audio error:`, error.message);
      throw new Error(`Failed to add audio to video: ${error.message}`);
    }
  }
}

