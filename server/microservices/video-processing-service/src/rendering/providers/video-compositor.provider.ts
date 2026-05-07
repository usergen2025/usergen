import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class VideoCompositorProvider {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Directory of TTF/OTF files for libass (optional). Env CAPTION_FONTS_DIR, else `<cwd>/assets/fonts` if it exists.
   */
  private getCaptionFontsDirectory(): string | undefined {
    try {
      const envDir = this.configService.get<string>('CAPTION_FONTS_DIR')?.trim();
      if (envDir && fs.existsSync(envDir)) {
        return path.resolve(envDir);
      }
    } catch {
      /* ignore */
    }
    const bundled = path.join(process.cwd(), 'assets', 'fonts');
    if (fs.existsSync(bundled)) {
      return bundled;
    }
    return undefined;
  }

  /**
   * When no fontsdir is available, libass often lacks web fonts — use a system face so glyphs render.
   */
  private resolveFontFamilyForAss(requested: string): string {
    const raw = (requested || '').trim();
    const first = raw.split(',')[0].replace(/['"]/g, '').trim();
    if (!first) return 'Arial';
    if (this.getCaptionFontsDirectory()) return first;
    const lower = first.toLowerCase();
    if (lower === 'inter' || lower.includes('inter')) return 'Arial';
    if (lower === 'system-ui' || lower === 'sans-serif' || lower === 'ui-sans-serif') return 'Arial';
    return first;
  }

  /** Escape path segments for FFmpeg filter strings (ass / fontsdir). */
  private escapeFilterPath(p: string): string {
    return p.replace(/\\/g, '/').replace(/:/g, '\\:');
  }

  private buildAssVideoFilter(escapedAssPath: string): string {
    const fontsDir = this.getCaptionFontsDirectory();
    let vf = `ass='${escapedAssPath}'`;
    if (fontsDir) {
      vf += `:fontsdir='${this.escapeFilterPath(fontsDir)}'`;
      console.log(`[VideoCompositor] ASS fontsdir=${fontsDir}`);
    }
    return vf;
  }

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
   * Top video (B-roll): Should be 1080x960 (already scaled if needed)
   * Bottom video (Avatar): Should be 1080x960 (generated directly)
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

    // Verify both videos are correct dimensions, scale if needed (safety check)
    const topRes = await this.getVideoResolution(topVideoPath);
    const bottomRes = await this.getVideoResolution(bottomVideoPath);
    
    let finalTopPath = topVideoPath;
    let finalBottomPath = bottomVideoPath;

    if (topRes && (topRes.width !== finalWidth || topRes.height !== topHeight)) {
      console.log(`[VideoCompositor] Scaling top video from ${topRes.width}x${topRes.height} to ${finalWidth}x${topHeight}`);
      const scaledTop = topVideoPath.replace('.mp4', '_scaled_top.mp4');
      await this.scaleVideoToDimensions(topVideoPath, scaledTop, finalWidth, topHeight);
      finalTopPath = scaledTop;
    }

    if (bottomRes && (bottomRes.width !== finalWidth || bottomRes.height !== bottomHeight)) {
      console.log(`[VideoCompositor] Scaling bottom video from ${bottomRes.width}x${bottomRes.height} to ${finalWidth}x${bottomHeight}`);
      const scaledBottom = bottomVideoPath.replace('.mp4', '_scaled_bottom.mp4');
      await this.scaleVideoToDimensions(bottomVideoPath, scaledBottom, finalWidth, bottomHeight);
      finalBottomPath = scaledBottom;
    }

    // CRITICAL: Normalize both videos to same frame rate (24fps) before compositing
    // This ensures both inputs to vstack have the same frame rate, preventing jerky playback
    const targetFps = 24;
    const normalizedTopPath = path.join(outputDir, `normalized_top_${Date.now()}.mp4`);
    const normalizedBottomPath = path.join(outputDir, `normalized_bottom_${Date.now()}.mp4`);
    
    try {
      const normalizeTopCommand = `
        ffmpeg -i "${finalTopPath}" \
        -r ${targetFps} -c:v libx264 -preset medium -crf 23 \
        -c:a copy \
        -vsync cfr \
        -y "${normalizedTopPath}"
      `.replace(/\s+/g, ' ').trim();
      execSync(normalizeTopCommand, { stdio: 'inherit' });

      const normalizeBottomCommand = `
        ffmpeg -i "${finalBottomPath}" \
        -r ${targetFps} -c:v libx264 -preset medium -crf 23 \
        -c:a copy \
        -vsync cfr \
        -y "${normalizedBottomPath}"
      `.replace(/\s+/g, ' ').trim();
      execSync(normalizeBottomCommand, { stdio: 'inherit' });
    } catch (error: any) {
      console.error(`[VideoCompositor] Error normalizing videos before compositing:`, error.message);
      throw new Error(`Failed to normalize videos for compositing: ${error.message}`);
    }

    // FFmpeg command to composite videos vertically
    // Both videos are now normalized to same frame rate, so vstack will work correctly
    const ffmpegCommand = `
      ffmpeg -i "${normalizedTopPath}" -i "${normalizedBottomPath}" \
      -filter_complex "[0:v][1:v]vstack=inputs=2[v]" \
      -map "[v]" -c:v libx264 -preset medium -crf 23 \
      -map 1:a -c:a aac -b:a 192k \
      -shortest -y "${outputPath}"
    `.replace(/\s+/g, ' ').trim();

    try {
      console.log(`[VideoCompositor] Executing FFmpeg command for HALF_N_HALF compositing...`);
      execSync(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Video composited successfully: ${outputPath}`);
      
      // Cleanup temporary files
      if (finalTopPath !== topVideoPath && fs.existsSync(finalTopPath)) {
        try {
          fs.unlinkSync(finalTopPath);
        } catch (e) {
          console.warn(`[VideoCompositor] Failed to cleanup scaled top video: ${e}`);
        }
      }
      if (finalBottomPath !== bottomVideoPath && fs.existsSync(finalBottomPath)) {
        try {
          fs.unlinkSync(finalBottomPath);
        } catch (e) {
          console.warn(`[VideoCompositor] Failed to cleanup scaled bottom video: ${e}`);
        }
      }
      if (fs.existsSync(normalizedTopPath)) {
        try {
          fs.unlinkSync(normalizedTopPath);
        } catch (e) {
          console.warn(`[VideoCompositor] Failed to cleanup normalized top video: ${e}`);
        }
      }
      if (fs.existsSync(normalizedBottomPath)) {
        try {
          fs.unlinkSync(normalizedBottomPath);
        } catch (e) {
          console.warn(`[VideoCompositor] Failed to cleanup normalized bottom video: ${e}`);
        }
      }
      
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg error:`, error.message);
      // Cleanup on error
      if (fs.existsSync(normalizedTopPath)) {
        try { fs.unlinkSync(normalizedTopPath); } catch (e) {}
      }
      if (fs.existsSync(normalizedBottomPath)) {
        try { fs.unlinkSync(normalizedBottomPath); } catch (e) {}
      }
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

    // Normalize all videos to same frame rate and format before concatenation
    // This prevents duration issues and frame rate mismatches
    const normalizedPaths: string[] = [];
    const targetFps = 24; // Standardize to 24fps
    
    console.log(`[VideoCompositor] Normalizing ${absolutePaths.length} videos to ${targetFps}fps before concatenation...`);
    
    // Ensure outputDir is absolute to avoid path duplication in concat list
    const absoluteOutputDir = path.isAbsolute(outputDir) ? outputDir : path.resolve(outputDir);
    
    for (let i = 0; i < absolutePaths.length; i++) {
      const normalizedPath = path.resolve(absoluteOutputDir, `normalized_${i}_${Date.now()}.mp4`);
      
      try {
        // Normalize: same frame rate, same codec, same resolution, ensure proper duration
        const normalizeCommand = `
          ffmpeg -i "${absolutePaths[i]}" \
          -r ${targetFps} -c:v libx264 -preset medium -crf 23 \
          -c:a aac -b:a 192k \
          -pix_fmt yuv420p \
          -vsync cfr \
          -y "${normalizedPath}"
        `.replace(/\s+/g, ' ').trim();
        
        execSync(normalizeCommand, { stdio: 'inherit' });
        
        // Verify normalized video exists
        if (fs.existsSync(normalizedPath)) {
          normalizedPaths.push(normalizedPath);
          console.log(`[VideoCompositor] Normalized video ${i + 1}/${absolutePaths.length}: ${normalizedPath}`);
        } else {
          throw new Error(`Normalized video not created: ${normalizedPath}`);
        }
      } catch (error: any) {
        // Cleanup any normalized files created so far
        normalizedPaths.forEach(p => {
          if (fs.existsSync(p)) {
            try {
              fs.unlinkSync(p);
            } catch (e) {
              console.warn(`[VideoCompositor] Failed to cleanup normalized file: ${p}`);
            }
          }
        });
        throw new Error(`Failed to normalize video ${i + 1} (${absolutePaths[i]}): ${error.message}`);
      }
    }
    
    // Create a temporary file list for FFmpeg concat using normalized videos
    const listPath = path.resolve(absoluteOutputDir, `concat_list_${Date.now()}.txt`);
    // Use absolute paths in the concat list to avoid path duplication
    // FFmpeg concat interprets paths relative to the concat list file's directory
    // So we must use absolute paths to prevent duplication
    const listContent = normalizedPaths.map(vp => {
      // Ensure path is absolute
      const absPath = path.isAbsolute(vp) ? vp : path.resolve(vp);
      // Escape single quotes for shell safety
      return `file '${absPath.replace(/'/g, "'\\''")}'`;
    }).join('\n');
    fs.writeFileSync(listPath, listContent);

    console.log(`[VideoCompositor] Concatenating ${normalizedPaths.length} normalized videos...`);

    try {
      // Use concat demuxer with stream copy after normalization (faster, maintains quality)
      // Since videos are already normalized, we can use copy for faster processing
      const ffmpegCommand = `
        ffmpeg -f concat -safe 0 -i "${listPath}" \
        -c copy \
        -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();

      execSync(ffmpegCommand, { stdio: 'inherit' });
      
      // Clean up temporary files
      normalizedPaths.forEach(p => {
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch (e) {
            console.warn(`[VideoCompositor] Failed to cleanup normalized file: ${p}`);
          }
        }
      });
      if (fs.existsSync(listPath)) {
        fs.unlinkSync(listPath);
      }
      
      console.log(`[VideoCompositor] Videos concatenated successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      // Clean up temporary files on error
      normalizedPaths.forEach(p => {
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch (e) {
            console.warn(`[VideoCompositor] Failed to cleanup normalized file: ${p}`);
          }
        }
      });
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
   * Scale video to exact dimensions (for HALF_N_HALF b-roll videos)
   * @param videoPath Input video path
   * @param outputPath Output video path
   * @param targetWidth Target width
   * @param targetHeight Target height
   */
  async scaleVideoToDimensions(
    videoPath: string,
    outputPath: string,
    targetWidth: number,
    targetHeight: number
  ): Promise<string> {
    this.checkFFmpeg();
    
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Get current video resolution
    const currentRes = await this.getVideoResolution(videoPath);
    if (!currentRes) {
      throw new Error('Failed to get video resolution');
    }
    
    // Check if scaling is needed
    if (currentRes.width === targetWidth && currentRes.height === targetHeight) {
      console.log(`[VideoCompositor] Video already at target dimensions ${targetWidth}x${targetHeight}, copying...`);
      fs.copyFileSync(videoPath, outputPath);
      return outputPath;
    }
    
    console.log(`[VideoCompositor] Scaling video from ${currentRes.width}x${currentRes.height} to ${targetWidth}x${targetHeight}`);
    
    // Get original frame rate to preserve it
    let targetFps = '24/1'; // Default frame rate
    try {
      const fpsCommand = `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
      const fpsOutput = execSync(fpsCommand, { encoding: 'utf-8' }).trim();
      if (fpsOutput && fpsOutput !== '0/0' && fpsOutput !== 'N/A') {
        targetFps = fpsOutput;
        console.log(`[VideoCompositor] Detected frame rate: ${targetFps}`);
      } else {
        console.warn(`[VideoCompositor] Could not detect frame rate, using default 24fps`);
      }
    } catch (e) {
      console.warn(`[VideoCompositor] Could not detect frame rate, using default 24fps: ${e}`);
    }
    
    // Scale video to exact dimensions (crop if needed to maintain aspect ratio)
    // Preserve original frame rate to prevent jerky playback
    const ffmpegCommand = `
      ffmpeg -i "${videoPath}" \
      -vf "scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}" \
      -r ${targetFps} \
      -c:v libx264 -preset medium -crf 23 \
      -c:a copy \
      -vsync cfr \
      -y "${outputPath}"
    `.replace(/\s+/g, ' ').trim();
    
    try {
      execSync(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Video scaled successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] Video scaling error:`, error.message);
      throw new Error(`Failed to scale video: ${error.message}`);
    }
  }

  /**
   * Remove background from video using AI (for non-green backgrounds)
   * Uses spawn instead of execSync to avoid blocking the event loop
   * @param videoPath Path to input video
   * @param outputPath Path for output video with alpha channel
   * @param modelName AI model to use ('u2net', 'u2net_human_seg', 'silueta', etc.)
   */
  async removeBackgroundAI(
    videoPath: string,
    outputPath: string,
    modelName: string = 'u2net_human_seg'
  ): Promise<string> {
    this.checkFFmpeg();
    
    const startTime = Date.now();
    console.log(`[VideoCompositor] ========== BACKGROUND REMOVAL START ==========`);
    console.log(`[VideoCompositor] Start time: ${new Date().toISOString()}`);

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Resolve paths from service root (works regardless of process cwd / PM2)
    // This service builds with webpack into dist/main.js, so __dirname is
    // typically <serviceRoot>/dist at runtime. Walk up one level.
    const serviceRoot = path.resolve(__dirname, '..');
    // Check if Python script exists
    const scriptPath = path.join(serviceRoot, 'scripts', 'remove_background.py');
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Background removal script not found: ${scriptPath}`);
    }

    // Try to use venv Python if available, otherwise fall back to system python3
    const venvPython = path.join(serviceRoot, 'venv', 'bin', 'python3');
    const pythonCommand = fs.existsSync(venvPython) ? venvPython : 'python3';

    console.log(`[VideoCompositor] Removing background using AI model: ${modelName}`);
    console.log(`[VideoCompositor] Using Python: ${pythonCommand}`);
    console.log(`[VideoCompositor] Input video: ${videoPath}`);
    console.log(`[VideoCompositor] Output base path: ${outputPath}`);
    console.log(`[VideoCompositor] Expected outputs:`);
    console.log(`[VideoCompositor]   - WebM: ${outputPath.replace(/\.[^.]+$/, '.webm')}`);
    console.log(`[VideoCompositor]   - PNG dir: ${outputPath.replace(/\.[^.]+$/, '_frames')}`);

    return new Promise((resolve, reject) => {
      // Use spawn instead of execSync to avoid blocking event loop
      // This allows the service to handle other HTTP requests while processing
      const pythonProcess = spawn(pythonCommand, [
        scriptPath,
        videoPath,
        outputPath,
        modelName
      ], {
        stdio: ['ignore', 'pipe', 'pipe'] // Capture stdout/stderr for logging
      });

      let stdout = '';
      let stderr = '';
      let lastProgressLog = Date.now();
      const progressInterval = 10000; // Log progress heartbeat every 10 seconds

      // Set timeout (15 minutes for video processing - should be enough for most videos)
      const timeoutDuration = 15 * 60 * 1000; // 15 minutes
      const timeout = setTimeout(() => {
        pythonProcess.kill('SIGTERM');
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[VideoCompositor] ❌ Background removal TIMEOUT after ${timeoutDuration / 1000 / 60} minutes (${elapsed}s elapsed)`);
        reject(new Error(`Background removal timeout after ${timeoutDuration / 1000 / 60} minutes`));
      }, timeoutDuration);
      
      // Heartbeat interval to show process is still running
      const heartbeat = setInterval(() => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[VideoCompositor] 💓 Background removal still running... (${elapsed}s elapsed)`);
      }, 30000); // Every 30 seconds

      // Capture stdout (Python script progress logs)
      if (pythonProcess.stdout) {
        pythonProcess.stdout.on('data', (data) => {
          const output = data.toString();
          stdout += output;
          // Log progress in real-time
          const lines = output.trim().split('\n').filter((line: string) => line.trim());
          lines.forEach((line: string) => {
            // Log all output from Python script, not just [BackgroundRemoval] lines
            if (line.trim()) {
              console.log(`[VideoCompositor] [Python] ${line}`);
            }
          });
        });
      }

      // Capture stderr (Python script errors/warnings)
      if (pythonProcess.stderr) {
        pythonProcess.stderr.on('data', (data) => {
          const output = data.toString();
          stderr += output;
          // Log warnings/errors in real-time
          const lines = output.trim().split('\n').filter((line: string) => line.trim());
          lines.forEach((line: string) => {
            if (line.trim()) {
              // Filter out common non-error messages
              if (line.includes('WARNING') || line.includes('Error') || line.includes('error')) {
                console.warn(`[VideoCompositor] [Python Warning] ${line}`);
              }
            }
          });
        });
      }

      // Handle process completion
      pythonProcess.on('close', (code) => {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[VideoCompositor] Background removal process completed in ${elapsed}s with exit code: ${code}`);
        
        if (code === 0) {
          // The Python script now outputs:
          // 1. A WebM file with alpha at outputPath.replace('.mp4', '.webm')
          // 2. A PNG sequence directory at outputPath.replace('.mp4', '_frames/')
          // 3. A metadata JSON at outputPath.replace('.mp4', '_metadata.json')
          // 4. A marker file at outputPath with paths to the above
          
          const outputBase = outputPath.replace(/\.[^.]+$/, '');
          const webmPath = outputBase + '.webm';
          const pngDir = outputBase + '_frames';
          const metadataPath = outputBase + '_metadata.json';
          
          // Check which outputs exist
          const hasWebm = fs.existsSync(webmPath);
          const hasPngDir = fs.existsSync(pngDir);
          
          console.log(`[VideoCompositor] Checking output files:`);
          console.log(`[VideoCompositor]   WebM exists: ${hasWebm} (${webmPath})`);
          console.log(`[VideoCompositor]   PNG dir exists: ${hasPngDir} (${pngDir})`);
          
          if (!hasWebm && !hasPngDir) {
            console.error(`[VideoCompositor] ❌ No output files found after ${elapsed}s`);
            reject(new Error('Background removal script completed but no output files found'));
            return;
          }
          
          // Log file sizes for debugging
          if (hasWebm) {
            try {
              const stats = fs.statSync(webmPath);
              console.log(`[VideoCompositor]   WebM size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
            } catch (e) {
              console.warn(`[VideoCompositor]   Could not get WebM file size`);
            }
          }
          
          if (hasPngDir) {
            try {
              const files = fs.readdirSync(pngDir);
              console.log(`[VideoCompositor]   PNG sequence: ${files.length} frames`);
            } catch (e) {
              console.warn(`[VideoCompositor]   Could not count PNG frames`);
            }
          }
          
          console.log(`[VideoCompositor] ✅ Background removed successfully in ${elapsed}s`);
          console.log(`[VideoCompositor] ========== BACKGROUND REMOVAL END ==========`);
          
          // Return the WebM path if it exists, otherwise return a reference to PNG dir
          if (hasWebm) {
            console.log(`[VideoCompositor] Returning WebM path: ${webmPath}`);
            resolve(webmPath);
          } else {
            // Return the PNG directory path - caller needs to handle this
            console.log(`[VideoCompositor] Returning PNG directory path: ${pngDir}`);
            resolve(pngDir);
          }
        } else {
          const errorMsg = stderr || stdout || `Process exited with code ${code}`;
          console.error(`[VideoCompositor] ❌ Background removal failed after ${elapsed}s (exit code ${code})`);
          console.error(`[VideoCompositor] Error output: ${errorMsg.substring(0, 500)}`);
          console.log(`[VideoCompositor] ========== BACKGROUND REMOVAL FAILED ==========`);
          reject(new Error(`Failed to remove background: ${errorMsg}`));
        }
      });

      // Handle process spawn errors
      pythonProcess.on('error', (error) => {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[VideoCompositor] ❌ Failed to start background removal process after ${elapsed}s: ${error.message}`);
        console.log(`[VideoCompositor] ========== BACKGROUND REMOVAL FAILED ==========`);
        reject(new Error(`Failed to start background removal: ${error.message}`));
      });
    });
  }

  /**
   * Check if video has alpha channel (transparent background)
   * @param videoPath Path to video file
   * @returns true if video has alpha channel, false otherwise
   */
  async hasAlphaChannel(videoPath: string): Promise<boolean> {
    this.checkFFmpeg();

    try {
      // Use ffprobe to check pixel format
      const command = `ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
      
      const result = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
      const pixelFormat = result.trim().toLowerCase();
      
      // Check if pixel format includes alpha channel
      // Common formats with alpha: yuva420p, yuva422p, yuva444p, rgba, etc.
      const hasAlpha = pixelFormat.includes('yuva') || 
                       pixelFormat.includes('rgba') || 
                       pixelFormat.includes('alpha');
      
      console.log(`[VideoCompositor] Video pixel format: ${pixelFormat}, has alpha: ${hasAlpha}`);
      return hasAlpha;
    } catch (error: any) {
      console.warn(`[VideoCompositor] Failed to check alpha channel: ${error.message}`);
      // If we can't check, assume no alpha (safer to process)
      return false;
    }
  }

  /**
   * Detect if video has green screen background
   * Uses FFmpeg to extract a frame and analyze green color presence
   * @param videoPath Path to video file
   * @returns true if green screen detected, false otherwise
   */
  async detectGreenScreen(videoPath: string): Promise<boolean> {
    this.checkFFmpeg();

    try {
      const tempFramePath = path.join(path.dirname(videoPath), `temp_frame_${Date.now()}.png`);
      
      // Extract first frame
      const extractCommand = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,0)" -vframes 1 -y "${tempFramePath}" 2>&1`;
      
      try {
        execSync(extractCommand, { stdio: 'pipe' });
        
        if (!fs.existsSync(tempFramePath)) {
          console.warn(`[VideoCompositor] Could not extract frame for green screen detection`);
          return false;
        }

        // Use FFmpeg to analyze frame and check for green color dominance
        // Sample center region of the frame (where subject usually isn't)
        // Check if green (#00FF00 or similar) is present in corners/edges
        const analyzeCommand = `ffmpeg -i "${tempFramePath}" -vf "crop=iw*0.2:ih*0.2:iw*0.4:ih*0.4" -frames:v 1 -f rawvideo -pix_fmt rgb24 - 2>/dev/null | head -c 10000`;
        
        try {
          // Use encoding: null to get Buffer instead of string
          // Buffer allows direct byte access as numbers (0-255)
          const frameDataBuffer = execSync(analyzeCommand, { encoding: null, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1024 * 1024 });
          const frameData = Buffer.isBuffer(frameDataBuffer) ? frameDataBuffer : Buffer.from(frameDataBuffer);
          
          // Check for green color (RGB: 0, 255, 0 or close variations)
          // Count pixels that are close to pure green
          let greenPixelCount = 0;
          const totalPixels = Math.floor(frameData.length / 3);
          
          for (let i = 0; i < frameData.length - 2; i += 3) {
            // Buffer indices return numbers (0-255), not strings
            const r = frameData[i];
            const g = frameData[i + 1];
            const b = frameData[i + 2];
            
            // Check if pixel is green (high green, low red and blue)
            // Green screen typically has: G > 200, R < 50, B < 50
            if (g > 200 && r < 50 && b < 50) {
              greenPixelCount++;
            }
          }
          
          // Clean up temp frame
          if (fs.existsSync(tempFramePath)) {
            fs.unlinkSync(tempFramePath);
          }
          
          // If more than 30% of sampled pixels are green, consider it green screen
          const greenPercentage = (greenPixelCount / totalPixels) * 100;
          const hasGreenScreen = greenPercentage > 30;
          
          console.log(`[VideoCompositor] Green screen detection: ${hasGreenScreen} (green pixels: ${greenPixelCount}/${totalPixels}, ${greenPercentage.toFixed(1)}%)`);
          return hasGreenScreen;
        } catch (analyzeError: any) {
          // If analysis fails, assume no green screen
          if (fs.existsSync(tempFramePath)) {
            fs.unlinkSync(tempFramePath);
          }
          console.warn(`[VideoCompositor] Green screen analysis failed: ${analyzeError.message}`);
          return false;
        }
      } catch (extractError: any) {
        // If frame extraction fails, assume no green screen
        if (fs.existsSync(tempFramePath)) {
          fs.unlinkSync(tempFramePath);
        }
        console.warn(`[VideoCompositor] Green screen detection failed: ${extractError.message}`);
        return false;
      }
    } catch (error: any) {
      // If detection fails, assume no green screen
      console.warn(`[VideoCompositor] Green screen detection failed, assuming no green screen: ${error.message}`);
      return false;
    }
  }

  /**
   * Overlay avatar video on b-roll video (for CUTOUT style)
   * Avatar video is positioned based on normalized coordinates with background removal
   * Supports both green screen (chroma key) and AI-based background removal
   * @param brollVideoPath Path to b-roll video (background)
   * @param avatarVideoPath Path to avatar video (foreground)
   * @param outputPath Path for output video
   * @param position Normalized position object with x (0-1), y (0-1), and scale (0.2-0.8)
   *                 x: 0 = left edge, 1 = right edge, 0.5 = center
   *                 y: 0 = top edge, 1 = bottom edge, 1.0 = bottom
   *                 scale: percentage of video height (0.4 = 40%)
   * @param useAIBackgroundRemoval Force AI background removal even if green screen is detected (default: false)
   */
  async overlayAvatarOnBroll(
    brollVideoPath: string,
    avatarVideoPath: string,
    outputPath: string,
    position: { x: number; y: number; scale: number } = { x: 0.5, y: 0.85, scale: 0.4 },
    useAIBackgroundRemoval: boolean = false
  ): Promise<string> {
    this.checkFFmpeg();
    
    const overlayStartTime = Date.now();
    console.log(`[VideoCompositor] ========== AVATAR OVERLAY START ==========`);
    console.log(`[VideoCompositor] Start time: ${new Date().toISOString()}`);
    console.log(`[VideoCompositor] B-roll video: ${brollVideoPath}`);
    console.log(`[VideoCompositor] Avatar video: ${avatarVideoPath}`);
    console.log(`[VideoCompositor] Output path: ${outputPath}`);
    console.log(`[VideoCompositor] Use AI background removal: ${useAIBackgroundRemoval}`);

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
    
    // Calculate avatar dimensions from normalized scale
    // IMPORTANT: libx264 requires dimensions to be divisible by 2, so we round to even numbers
    const rawAvatarHeight = Math.floor(brollHeight * position.scale);
    const avatarHeightPx = Math.floor(rawAvatarHeight / 2) * 2; // Ensure even height
    
    // Get avatar video resolution to maintain aspect ratio
    // Handle both video files and directories (PNG sequences)
    let avatarRes: { width: number; height: number } | null = null;
    const isDirectory = fs.existsSync(avatarVideoPath) && fs.statSync(avatarVideoPath).isDirectory();
    
    if (isDirectory) {
      // For PNG sequences, get resolution from actual first frame (most accurate)
      // Metadata might have original video dimensions, but PNG frames might differ
      const firstFramePath = path.join(avatarVideoPath, 'frame_000000.png');
      if (fs.existsSync(firstFramePath)) {
        try {
          // Use ffprobe to get actual PNG dimensions
          const probeCommand = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${firstFramePath}"`;
          const result = execSync(probeCommand, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
          const [width, height] = result.split('x').map(Number);
          if (width && height) {
            avatarRes = { width, height };
            console.log(`[VideoCompositor] Got PNG frame resolution from first frame: ${avatarRes.width}x${avatarRes.height}`);
          }
        } catch (e) {
          console.warn(`[VideoCompositor] Could not probe first PNG frame, trying metadata`);
        }
      }
      
      // Fallback to metadata if probing failed
      if (!avatarRes) {
        const metadataPath = avatarVideoPath.replace(/_frames$/, '_metadata.json');
        if (fs.existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            if (metadata.width && metadata.height) {
              avatarRes = { width: metadata.width, height: metadata.height };
              console.log(`[VideoCompositor] Got PNG sequence resolution from metadata: ${avatarRes.width}x${avatarRes.height}`);
            }
          } catch (e) {
            console.warn(`[VideoCompositor] Could not read PNG metadata for resolution`);
          }
        }
      }
    } else {
      avatarRes = await this.getVideoResolution(avatarVideoPath);
    }
    
    let avatarWidthPx: number;
    if (avatarRes) {
      const avatarAspectRatio = avatarRes.width / avatarRes.height;
      const rawWidth = Math.floor(avatarHeightPx * avatarAspectRatio);
      avatarWidthPx = Math.floor(rawWidth / 2) * 2; // Ensure even width
    } else {
      // Fallback: assume 9:16 portrait aspect ratio
      const rawWidth = Math.floor(avatarHeightPx * (9 / 16));
      avatarWidthPx = Math.floor(rawWidth / 2) * 2; // Ensure even width
    }
    
    // Calculate pixel position from normalized coordinates
    // x: 0 = avatar left edge at video left, 1 = avatar right edge at video right
    // y: 0 = avatar top edge at video top, 1 = avatar bottom edge at video bottom
    const avatarX = Math.floor((brollWidth - avatarWidthPx) * position.x);
    const avatarY = Math.floor((brollHeight - avatarHeightPx) * position.y);

    // Calculate what frontend would have used (9:16 hardcoded aspect ratio for comparison)
    const frontendAspectRatio = 9 / 16;
    const frontendWidth = Math.floor(avatarHeightPx * frontendAspectRatio / 2) * 2;
    const frontendX = Math.floor((brollWidth - frontendWidth) * position.x);
    
    console.log(`[VideoCompositor] ========== OVERLAY POSITION DEBUG ==========`);
    console.log(`[VideoCompositor] B-roll resolution: ${brollWidth}x${brollHeight}`);
    console.log(`[VideoCompositor] Avatar source resolution: ${avatarRes ? `${avatarRes.width}x${avatarRes.height}` : 'unknown (using 9:16 fallback)'}`);
    console.log(`[VideoCompositor] Avatar actual aspect ratio: ${avatarRes ? (avatarRes.width / avatarRes.height).toFixed(4) : '0.5625 (9:16 default)'}`);
    console.log(`[VideoCompositor] Overlay position params: scale=${(position.scale * 100).toFixed(0)}%, x=${position.x.toFixed(4)}, y=${position.y.toFixed(4)}`);
    console.log(`[VideoCompositor] Backend calculated avatar size: ${avatarWidthPx}x${avatarHeightPx}`);
    console.log(`[VideoCompositor] Backend calculated avatar position: x=${avatarX}, y=${avatarY}`);
    console.log(`[VideoCompositor] Frontend would calculate (9:16): size=${frontendWidth}x${avatarHeightPx}, x=${frontendX}`);
    if (avatarX !== frontendX) {
      console.log(`[VideoCompositor] ⚠️ POSITION MISMATCH: Backend X=${avatarX} vs Frontend X=${frontendX} (diff=${avatarX - frontendX}px)`);
    }
    console.log(`[VideoCompositor] ==========================================`);

    // Track if we're using PNG sequence (directory) or video file
    let usePngSequence = false;
    let pngSequenceDir = '';
    let pngMetadata: { fps?: number; width?: number; height?: number } = {};
    let processedAvatarPath = avatarVideoPath;
    let hasGreenScreen = false;
    let isAlreadyProcessed = false;

    // Check if input is already a processed format (PNG directory or WebM with alpha)
    if (isDirectory) {
      // Input is a PNG sequence directory - already processed!
      console.log(`[VideoCompositor] Input is PNG sequence directory (already processed): ${avatarVideoPath}`);
      usePngSequence = true;
      pngSequenceDir = avatarVideoPath;
      isAlreadyProcessed = true;
      
      // Try to read metadata from parent directory
      const metadataPath = avatarVideoPath.replace(/_frames$/, '_metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          pngMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
          console.log(`[VideoCompositor] PNG metadata: ${JSON.stringify(pngMetadata)}`);
        } catch (e) {
          console.warn(`[VideoCompositor] Could not read PNG metadata: ${e}`);
        }
      }
    } else if (avatarVideoPath.endsWith('.webm')) {
      // Input is WebM - check if it has alpha channel (already processed)
      const hasAlpha = await this.hasAlphaChannel(avatarVideoPath);
      if (hasAlpha) {
        console.log(`[VideoCompositor] Input is WebM with alpha channel (already processed): ${avatarVideoPath}`);
        isAlreadyProcessed = true;
        processedAvatarPath = avatarVideoPath;
      }
    }

    // Only do background removal if NOT already processed
    if (!isAlreadyProcessed) {
      if (!useAIBackgroundRemoval) {
        // Try to detect green screen
        hasGreenScreen = await this.detectGreenScreen(avatarVideoPath);
        console.log(`[VideoCompositor] Green screen detected: ${hasGreenScreen}`);
      }

      if (!hasGreenScreen || useAIBackgroundRemoval) {
        // Use AI background removal for non-green backgrounds
        console.log(`[VideoCompositor] Using AI background removal for avatar`);
        const tempAvatarPath = path.join(outputDir, `avatar_no_bg_${Date.now()}.mp4`);
        try {
          processedAvatarPath = await this.removeBackgroundAI(avatarVideoPath, tempAvatarPath, 'u2net_human_seg');
          
          // Check if we got a PNG sequence directory or a WebM file
          if (fs.existsSync(processedAvatarPath) && fs.statSync(processedAvatarPath).isDirectory()) {
            usePngSequence = true;
            pngSequenceDir = processedAvatarPath;
            console.log(`[VideoCompositor] Using PNG sequence from: ${pngSequenceDir}`);
            
            // Try to read metadata
            const metadataPath = tempAvatarPath.replace(/\.[^.]+$/, '_metadata.json');
            if (fs.existsSync(metadataPath)) {
              try {
                pngMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
                console.log(`[VideoCompositor] PNG metadata: ${JSON.stringify(pngMetadata)}`);
              } catch (e) {
                console.warn(`[VideoCompositor] Could not read PNG metadata: ${e}`);
              }
            }
          } else if (processedAvatarPath.endsWith('.webm')) {
            console.log(`[VideoCompositor] Using WebM with alpha: ${processedAvatarPath}`);
          }
        } catch (aiError: any) {
          console.error(`[VideoCompositor] AI background removal failed: ${aiError.message}`);
          console.log(`[VideoCompositor] Falling back to chroma key method`);
          // Fallback to chroma key if AI removal fails
          hasGreenScreen = true;
          processedAvatarPath = avatarVideoPath;
        }
      }
    } else {
      console.log(`[VideoCompositor] Skipping background removal - input already processed`);
    }

    // Overlay based on background removal method
    let ffmpegCommand: string;

    if (hasGreenScreen && !useAIBackgroundRemoval && !isAlreadyProcessed) {
      // Use chroma key for green screen (100% opacity - blend=0)
      // First scale the avatar
      const scaledAvatarPath = path.join(outputDir, `avatar_scaled_${Date.now()}.mp4`);
      const scaleCommand = `
        ffmpeg -i "${processedAvatarPath}" \
        -vf "scale=-2:${avatarHeightPx}:force_original_aspect_ratio=decrease" \
        -c:v libx264 -preset medium -crf 23 \
        -y "${scaledAvatarPath}"
      `.replace(/\s+/g, ' ').trim();

      try {
        console.log(`[VideoCompositor] Scaling avatar for chroma key...`);
        execSync(scaleCommand, { stdio: 'pipe' });
      } catch (error: any) {
        console.error(`[VideoCompositor] Failed to scale avatar: ${error.message}`);
        throw new Error(`Failed to scale avatar: ${error.message}`);
      }

      ffmpegCommand = `
        ffmpeg -i "${brollVideoPath}" -i "${scaledAvatarPath}" \
        -filter_complex "[1:v]chromakey=color=0x00FF00:similarity=0.25:blend=0:yuv=1[avatar_no_bg]; \
        [0:v][avatar_no_bg]overlay=${avatarX}:${avatarY}:shortest=1[v]" \
        -map "[v]" -c:v libx264 -preset medium -crf 23 \
        -map 0:a -c:a aac -b:a 192k \
        -shortest -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();
    } else if (usePngSequence) {
      // Use PNG sequence directly for overlay (BEST alpha preservation)
      console.log(`[VideoCompositor] Using PNG sequence for overlay with proper alpha...`);
      const fps = pngMetadata.fps || 30;
      
      // FFmpeg can read PNG sequence and overlay directly
      // This is the most reliable way to preserve alpha
      ffmpegCommand = `
        ffmpeg -i "${brollVideoPath}" \
        -framerate ${fps} -i "${path.join(pngSequenceDir, 'frame_%06d.png')}" \
        -filter_complex "[1:v]scale=${avatarWidthPx}:${avatarHeightPx}[scaled_avatar]; \
        [0:v][scaled_avatar]overlay=${avatarX}:${avatarY}:shortest=1[v]" \
        -map "[v]" -c:v libx264 -preset medium -crf 23 \
        -pix_fmt yuv420p \
        -map 0:a -c:a aac -b:a 192k \
        -shortest -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();
    } else {
      // Use WebM with alpha channel for overlay
      console.log(`[VideoCompositor] Using WebM with alpha for overlay...`);
      
      // WebM/VP9 already has alpha, we can overlay directly
      ffmpegCommand = `
        ffmpeg -i "${brollVideoPath}" -c:v libvpx-vp9 -i "${processedAvatarPath}" \
        -filter_complex "[1:v]scale=${avatarWidthPx}:${avatarHeightPx}[scaled_avatar]; \
        [0:v][scaled_avatar]overlay=${avatarX}:${avatarY}:shortest=1[v]" \
        -map "[v]" -c:v libx264 -preset medium -crf 23 \
        -pix_fmt yuv420p \
        -map 0:a -c:a aac -b:a 192k \
        -shortest -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();
    }

    try {
      const ffmpegStartTime = Date.now();
      console.log(`[VideoCompositor] Executing FFmpeg overlay command...`);
      console.log(`[VideoCompositor] Full command: ${ffmpegCommand}`);
      
      // Execute with pipe to capture output
      const result = execSync(ffmpegCommand, { 
        stdio: 'pipe',
        maxBuffer: 50 * 1024 * 1024 // 50MB buffer for FFmpeg output
      });
      
      const ffmpegElapsed = ((Date.now() - ffmpegStartTime) / 1000).toFixed(1);
      console.log(`[VideoCompositor] FFmpeg overlay completed in ${ffmpegElapsed}s`);
      
      // Verify output file exists and has size
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.log(`[VideoCompositor] ✅ Output video created: ${outputPath}`);
        console.log(`[VideoCompositor]   File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      } else {
        throw new Error(`FFmpeg completed but output file not found: ${outputPath}`);
      }
      
      // Cleanup temporary files
      if (processedAvatarPath !== avatarVideoPath) {
        // If it's a WebM file, clean it up
        if (fs.existsSync(processedAvatarPath) && !fs.statSync(processedAvatarPath).isDirectory()) {
          try {
            fs.unlinkSync(processedAvatarPath);
            console.log(`[VideoCompositor] Cleaned up temp WebM file`);
          } catch (e) {
            console.warn(`[VideoCompositor] Failed to cleanup temp avatar: ${e}`);
          }
        }
        // If it's a PNG sequence directory, clean it up
        if (usePngSequence && fs.existsSync(pngSequenceDir)) {
          try {
            // Remove all PNGs in the directory
            const files = fs.readdirSync(pngSequenceDir);
            for (const file of files) {
              fs.unlinkSync(path.join(pngSequenceDir, file));
            }
            fs.rmdirSync(pngSequenceDir);
            console.log(`[VideoCompositor] Cleaned up PNG sequence directory (${files.length} frames)`);
          } catch (e) {
            console.warn(`[VideoCompositor] Failed to cleanup PNG sequence: ${e}`);
          }
        }
      }
      
      const totalElapsed = ((Date.now() - overlayStartTime) / 1000).toFixed(1);
      console.log(`[VideoCompositor] ✅ Avatar overlay completed in ${totalElapsed}s total`);
      console.log(`[VideoCompositor] ========== AVATAR OVERLAY END ==========`);
      
      return outputPath;
    } catch (error: any) {
      const totalElapsed = ((Date.now() - overlayStartTime) / 1000).toFixed(1);
      console.error(`[VideoCompositor] ❌ FFmpeg overlay error after ${totalElapsed}s:`, error.message);
      
      // Try to extract stderr from the error for more details
      if (error.stderr) {
        console.error(`[VideoCompositor] FFmpeg stderr: ${error.stderr.toString().substring(0, 1000)}`);
      }
      if (error.stdout) {
        console.log(`[VideoCompositor] FFmpeg stdout: ${error.stdout.toString().substring(0, 500)}`);
      }
      
      console.log(`[VideoCompositor] ========== AVATAR OVERLAY FAILED ==========`);
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

  /**
   * Mix existing voice track from a video file with a background music file.
   * Short BGM is looped via -stream_loop; long BGM is trimmed to video duration (atrim).
   */
  async mixVoiceWithBackgroundMusic(
    videoWithVoicePath: string,
    bgmPath: string,
    outputPath: string,
    opts?: {
      mixVolume?: number;
      voiceDuckTo?: number;
      fadeInSec?: number;
      fadeOutSec?: number;
    },
  ): Promise<string> {
    this.checkFFmpeg();

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const durationSec = await this.getVideoDuration(videoWithVoicePath);
    if (!durationSec || durationSec <= 0) {
      throw new Error('Could not read video duration for BGM mix');
    }

    const mixVolume = Math.min(1, Math.max(0, opts?.mixVolume ?? 0.1));
    const voiceVol = Math.min(1, Math.max(0, opts?.voiceDuckTo ?? 0.85));
    const fadeIn = Math.min(5, Math.max(0, opts?.fadeInSec ?? 0.5));
    const fadeOut = Math.min(5, Math.max(0, opts?.fadeOutSec ?? 1.5));
    const fadeOutStart = Math.max(0, durationSec - fadeOut);

    const escV = videoWithVoicePath.replace(/"/g, '\\"');
    const escB = bgmPath.replace(/"/g, '\\"');
    const escO = outputPath.replace(/"/g, '\\"');

    const filter = `[1:a]atrim=0:${durationSec},asetpts=N/SR/TB,volume=${mixVolume},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutStart}:d=${fadeOut}[bgm];[0:a]volume=${voiceVol}[vo];[vo][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;

    console.log(`[VideoCompositor] Mixing BGM: duration=${durationSec.toFixed(2)}s mixVol=${mixVolume} voiceVol=${voiceVol}`);

    try {
      const ffmpegCommand = (
        `ffmpeg -y -i "${escV}" -stream_loop -1 -i "${escB}" ` +
        `-filter_complex "${filter}" ` +
        `-map 0:v:0 -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "${escO}"`
      )
        .replace(/\s+/g, ' ')
        .trim();

      execSync(ffmpegCommand, { stdio: 'inherit', maxBuffer: 50 * 1024 * 1024 });
      console.log(`[VideoCompositor] BGM mix complete: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg BGM mix error:`, error.message);
      throw new Error(`Failed to mix background music: ${error.message}`);
    }
  }

  /**
   * Apply fade-out to audio file
   * @param audioPath Path to input audio file
   * @param outputPath Path for output audio file with fade-out
   * @param fadeDuration Duration of fade-out in seconds (default: 1.0)
   * @returns Path to processed audio file
   */
  async applyAudioFadeOut(
    audioPath: string,
    outputPath: string,
    fadeDuration: number = 1.0
  ): Promise<string> {
    this.checkFFmpeg();

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get audio duration using getVideoDuration (works for audio too)
    const audioDuration = await this.getVideoDuration(audioPath);
    if (audioDuration <= 0) {
      throw new Error(`Invalid audio duration: ${audioDuration}`);
    }

    // Calculate fade start time
    const fadeStart = Math.max(0, audioDuration - fadeDuration);
    
    console.log(`[VideoCompositor] Applying fade-out to audio: duration=${audioDuration.toFixed(2)}s, fade starts at ${fadeStart.toFixed(2)}s, fade duration=${fadeDuration}s`);

    try {
      const ffmpegCommand = `
        ffmpeg -i "${audioPath}" \
        -af "afade=t=out:st=${fadeStart}:d=${fadeDuration}" \
        -c:a libmp3lame -b:a 192k \
        -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();

      execSync(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Audio fade-out applied successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg audio fade-out error:`, error.message);
      throw new Error(`Failed to apply audio fade-out: ${error.message}`);
    }
  }

  /**
   * Crop video to specific dimensions
   * @param videoPath Path to input video
   * @param outputPath Path for output video
   * @param x X offset (left position)
   * @param y Y offset (top position)
   * @param width Width to crop
   * @param height Height to crop
   */
  async cropVideo(
    videoPath: string,
    outputPath: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<string> {
    this.checkFFmpeg();

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get actual video dimensions to validate crop parameters
    const videoRes = await this.getVideoResolution(videoPath);
    if (!videoRes) {
      throw new Error('Failed to get video resolution for cropping');
    }

    // Validate crop parameters
    if (x + width > videoRes.width) {
      throw new Error(`Crop width (${x + width}) exceeds video width (${videoRes.width}). Video needs to be scaled first.`);
    }
    if (y + height > videoRes.height) {
      throw new Error(`Crop height (${y + height}) exceeds video height (${videoRes.height}). Video needs to be scaled first.`);
    }
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid crop dimensions: ${width}x${height}`);
    }

    console.log(`[VideoCompositor] Cropping video: x=${x}, y=${y}, width=${width}, height=${height} (from ${videoRes.width}x${videoRes.height})`);

    try {
      const ffmpegCommand = `
        ffmpeg -i "${videoPath}" \
        -vf "crop=${width}:${height}:${x}:${y}" \
        -c:v libx264 -preset medium -crf 23 \
        -c:a copy \
        -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();

      execSync(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Video cropped successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg crop error:`, error.message);
      throw new Error(`Failed to crop video: ${error.message}`);
    }
  }

  /**
   * Extract a segment/clip from a video by time range
   * @param videoPath Path to input video
   * @param outputPath Path for output video segment
   * @param startTime Start time in seconds
   * @param duration Duration in seconds
   * @param preserveAlpha Whether to preserve alpha channel (for transparent videos)
   */
  async extractVideoSegment(
    videoPath: string,
    outputPath: string,
    startTime: number,
    duration: number,
    preserveAlpha: boolean = false
  ): Promise<string> {
    this.checkFFmpeg();

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`[VideoCompositor] Extracting video segment: start=${startTime.toFixed(2)}s, duration=${duration.toFixed(2)}s`);

    try {
      const pixFmtFlag = preserveAlpha ? '-pix_fmt yuva420p' : '';
      const ffmpegCommand = `
        ffmpeg -ss ${startTime} -i "${videoPath}" \
        -t ${duration} \
        -c:v libx264 -preset medium -crf 23 \
        ${pixFmtFlag} \
        -c:a aac -b:a 192k \
        -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();

      execSync(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Video segment extracted successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg segment extraction error:`, error.message);
      throw new Error(`Failed to extract video segment: ${error.message}`);
    }
  }

  /**
   * Overlay avatar on a single b-roll clip with per-scene positioning
   * Returns the path to the composited scene video
   */
  async overlayAvatarOnBrollScene(
    brollVideoPath: string,
    avatarVideoPath: string,
    outputPath: string,
    position: { x: number; y: number; scale: number },
    useAIBackgroundRemoval: boolean = false
  ): Promise<string> {
    // This is a wrapper that calls the existing overlayAvatarOnBroll method
    // for a single scene. The avatar video should already be clipped to match
    // the b-roll scene duration.
    return this.overlayAvatarOnBroll(
      brollVideoPath,
      avatarVideoPath,
      outputPath,
      position,
      useAIBackgroundRemoval
    );
  }

  /**
   * Generate ASS subtitle file from caption entries
   * ASS format allows for rich styling including background boxes
   */
  generateAssSubtitles(
    captions: Array<{ text: string; startTime: number; endTime: number }>,
    style: {
      fontFamily: string;
      fontSize: number;
      fontWeight: 'normal' | 'bold';
      fontStyle: 'normal' | 'italic';
      textColor: string;
      backgroundColor: string;
      borderColor: string;
      borderWidth: number;
    },
    outputPath: string,
    videoWidth: number,
    videoHeight: number,
    position: { x: number; y: number }
  ): string {
    const py = Math.max(0, Math.min(1, position.y));
    const marginL = Math.floor(videoWidth * 0.05);
    const marginR = Math.floor(videoWidth * 0.05);
    const marginV = Math.floor(videoHeight * (1 - py));

    const primaryColor = this.cssColorToAssOpaque(style.textColor, '&H00FFFFFF');
    const rgbText = this.parseCssColor(style.textColor);
    let outlineColor =
      !style.borderColor || style.borderColor === 'transparent'
        ? '&H00000000'
        : this.cssColorToAssOpaque(style.borderColor, '&H00000000');
    const bgRaw = (style.backgroundColor || '').trim().toLowerCase();
    const parsedBg = this.parseCssColor(style.backgroundColor || '');
    const bgTransparent =
      !bgRaw ||
      bgRaw === 'transparent' ||
      (parsedBg !== null && parsedBg.a <= 0.01);
    // Readable outline on varied video: dark stroke on light text, light stroke on dark text when no explicit border color
    if (
      bgTransparent &&
      (!style.borderColor || style.borderColor === 'transparent') &&
      rgbText
    ) {
      const lum = (0.2126 * rgbText.r + 0.7152 * rgbText.g + 0.0722 * rgbText.b) / 255;
      outlineColor = lum > 0.62 ? '&H00000000' : '&H00FFFFFF';
    }
    const backColor = bgTransparent
      ? '&HFF000000'
      : this.cssColorToAssWithAlpha(style.backgroundColor, '&H00FFFFFF');
    const borderStyle = bgTransparent ? 1 : 3;
    if (!bgTransparent && (!style.borderColor || style.borderColor === 'transparent')) {
      // In boxed mode (BorderStyle=3), transparent outline can render as black on some ffmpeg builds.
      // Align outline with the box color to keep light/dark presets visually consistent with preview.
      outlineColor = backColor;
    }
    const outlineAss = bgTransparent
      ? Math.max(2, style.borderWidth || 0)
      : Math.max(1, typeof style.borderWidth === 'number' ? style.borderWidth : 0);
    const shadowAss = bgTransparent ? 1 : 0;

    const bold = style.fontWeight === 'bold' ? -1 : 0;
    const italic = style.fontStyle === 'italic' ? -1 : 0;
    const fontName = this.resolveFontFamilyForAss(style.fontFamily);

    // ASS file content
    let assContent = `[Script Info]
Title: Video Captions
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${style.fontSize},${primaryColor},${primaryColor},${outlineColor},${backColor},${bold},${italic},0,0,100,100,0,0,${borderStyle},${outlineAss},${shadowAss},2,${marginL},${marginR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    console.log(
      `[VideoCompositor] ASS style computed: font=${fontName} (requested=${style.fontFamily}), borderStyle=${borderStyle}, outline=${outlineAss}, shadow=${shadowAss}, bgTransparent=${bgTransparent}, backColor=${backColor}, outlineColor=${outlineColor}`,
    );

    // Add caption events
    for (const caption of captions) {
      const startTime = this.formatAssTime(caption.startTime);
      const endTime = this.formatAssTime(caption.endTime);
      // Escape special characters for ASS
      const text = caption.text
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\N')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}');
      assContent += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}\n`;
    }

    // Write ASS file
    fs.writeFileSync(outputPath, assContent, 'utf-8');
    console.log(`[VideoCompositor] Generated ASS subtitle file: ${outputPath} with ${captions.length} captions`);
    
    return outputPath;
  }

  /** Parse #rgb, #rrggbb, rgb(), rgba() — alpha 0–1 (default 1). */
  private parseCssColor(input: string): { r: number; g: number; b: number; a: number } | null {
    const c = (input || '').trim();
    if (!c) return null;
    const hex8 = c.match(/^#([0-9a-f]{8})$/i);
    if (hex8) {
      const h = hex8[1];
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: Math.min(1, Math.max(0, parseInt(h.slice(6, 8), 16) / 255)),
      };
    }
    const hex6 = c.match(/^#([0-9a-f]{6})$/i);
    if (hex6) {
      const h = hex6[1];
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: 1,
      };
    }
    const hex3 = c.match(/^#([0-9a-f]{3})$/i);
    if (hex3) {
      const h = hex3[1];
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: 1,
      };
    }
    const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i);
    if (m) {
      return {
        r: Math.min(255, Math.max(0, parseInt(m[1], 10))),
        g: Math.min(255, Math.max(0, parseInt(m[2], 10))),
        b: Math.min(255, Math.max(0, parseInt(m[3], 10))),
        a: m[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(m[4]))) : 1,
      };
    }
    const hsl = c.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)$/i);
    if (hsl) {
      const hue = parseFloat(hsl[1]);
      const sat = parseFloat(hsl[2]);
      const light = parseFloat(hsl[3]);
      const rgb = this.cssHslToRgb(hue, sat, light);
      return {
        ...rgb,
        a: hsl[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(hsl[4]))) : 1,
      };
    }
    const hslSpaced = c.match(
      /^hsla?\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+))?\s*\)$/i,
    );
    if (hslSpaced) {
      const hue = parseFloat(hslSpaced[1]);
      const sat = parseFloat(hslSpaced[2]);
      const light = parseFloat(hslSpaced[3]);
      const rgb = this.cssHslToRgb(hue, sat, light);
      return {
        ...rgb,
        a:
          hslSpaced[4] !== undefined
            ? Math.min(1, Math.max(0, parseFloat(hslSpaced[4])))
            : 1,
      };
    }
    return null;
  }

  /** CSS hsl(h, s%, l%), degrees and 0–100% channels. */
  private cssHslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    const hh = (((h % 360) + 360) % 360) / 60;
    const ss = Math.min(100, Math.max(0, s)) / 100;
    const ll = Math.min(100, Math.max(0, l)) / 100;
    const c = (1 - Math.abs(2 * ll - 1)) * ss;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let rp = 0;
    let gp = 0;
    let bp = 0;
    if (hh >= 0 && hh < 1) {
      rp = c;
      gp = x;
      bp = 0;
    } else if (hh < 2) {
      rp = x;
      gp = c;
      bp = 0;
    } else if (hh < 3) {
      rp = 0;
      gp = c;
      bp = x;
    } else if (hh < 4) {
      rp = 0;
      gp = x;
      bp = c;
    } else if (hh < 5) {
      rp = x;
      gp = 0;
      bp = c;
    } else {
      rp = c;
      gp = 0;
      bp = x;
    }
    const m = ll - c / 2;
    return {
      r: Math.round(Math.min(255, Math.max(0, (rp + m) * 255))),
      g: Math.round(Math.min(255, Math.max(0, (gp + m) * 255))),
      b: Math.round(Math.min(255, Math.max(0, (bp + m) * 255))),
    };
  }

  /** ASS &HAABBGGRR with AA=00 (opaque). */
  private assBgraFromRgb(r: number, g: number, b: number, alphaByte: string): string {
    const bb = b.toString(16).padStart(2, '0').toUpperCase();
    const gg = g.toString(16).padStart(2, '0').toUpperCase();
    const rr = r.toString(16).padStart(2, '0').toUpperCase();
    return `&H${alphaByte}${bb}${gg}${rr}`;
  }

  private cssColorToAssOpaque(color: string, fallback: string): string {
    const p = this.parseCssColor(color);
    if (!p) return fallback;
    return this.assBgraFromRgb(p.r, p.g, p.b, '00');
  }

  /** Background: honor rgba alpha; ASS alpha byte = round((1 - opacity) * 255). */
  private cssColorToAssWithAlpha(color: string, fallback: string): string {
    const p = this.parseCssColor(color);
    if (!p) return fallback;
    const transparency = Math.round((1 - p.a) * 255);
    const AA = Math.min(255, Math.max(0, transparency)).toString(16).padStart(2, '0').toUpperCase();
    return this.assBgraFromRgb(p.r, p.g, p.b, AA);
  }

  /**
   * Format time in seconds to ASS time format (H:MM:SS.CC)
   */
  private formatAssTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const centisecs = Math.floor((seconds % 1) * 100);
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centisecs).padStart(2, '0')}`;
  }

  /**
   * Add captions to video using ASS subtitles
   * @param videoPath Input video path
   * @param outputPath Output video path
   * @param captions Array of caption entries with text and timing
   * @param style Caption styling settings
   */
  async overlayCaptionLayerOnVideo(
    videoPath: string,
    captionLayerPath: string,
    outputPath: string,
  ): Promise<string> {
    this.checkFFmpeg();

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const ffmpegCommand = `
      ffmpeg -i "${videoPath}" -i "${captionLayerPath}" \
      -filter_complex "[0:v][1:v]overlay=0:0:format=auto[v]" \
      -map "[v]" -map 0:a? \
      -c:v libx264 -preset medium -crf 20 \
      -c:a copy \
      -shortest \
      -y "${outputPath}"
    `
      .replace(/\s+/g, ' ')
      .trim();

    execSync(ffmpegCommand, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
    return outputPath;
  }

  async addCaptionsToVideo(
    videoPath: string,
    outputPath: string,
    captions: Array<{ text: string; startTime: number; endTime: number }>,
    style: {
      fontFamily: string;
      fontSize: number;
      fontWeight: 'normal' | 'bold';
      fontStyle: 'normal' | 'italic';
      textColor: string;
      backgroundColor: string;
      borderColor: string;
      borderWidth: number;
      position: { x: number; y: number };
    }
  ): Promise<string> {
    this.checkFFmpeg();

    if (!captions || captions.length === 0) {
      console.log('[VideoCompositor] No captions to add, copying video as-is');
      fs.copyFileSync(videoPath, outputPath);
      return outputPath;
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get video resolution
    const videoRes = await this.getVideoResolution(videoPath);
    if (!videoRes) {
      throw new Error('Failed to get video resolution for caption rendering');
    }

    // Generate ASS subtitle file
    const assPath = outputPath.replace(/\.[^.]+$/, '_captions.ass');
    this.generateAssSubtitles(
      captions,
      style,
      assPath,
      videoRes.width,
      videoRes.height,
      style.position
    );

    console.log(`[VideoCompositor] Adding ${captions.length} captions to video...`);
    console.log(`[VideoCompositor] Caption style: font=${style.fontFamily}, size=${style.fontSize}, color=${style.textColor}, bg=${style.backgroundColor}`);

    try {
      // Use ass filter to burn in subtitles
      // Escape the path for filter (Windows and special characters)
      const escapedAssPath = this.escapeFilterPath(assPath);
      const vf = this.buildAssVideoFilter(escapedAssPath);

      const ffmpegCommand = `
        ffmpeg -i "${videoPath}" \
        -vf "${vf}" \
        -c:v libx264 -preset medium -crf 23 \
        -c:a copy \
        -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();

      console.log(`[VideoCompositor] FFmpeg caption command: ${ffmpegCommand}`);
      
      execSync(ffmpegCommand, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
      
      // Verify output
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.log(`[VideoCompositor] ✅ Captions added successfully: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      }

      // Cleanup ASS file
      try {
        if (fs.existsSync(assPath)) {
          fs.unlinkSync(assPath);
        }
      } catch (e) {
        console.warn(`[VideoCompositor] Could not cleanup ASS file: ${assPath}`);
      }

      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg caption error:`, error.message);
      
      // Cleanup ASS file on error
      try {
        if (fs.existsSync(assPath)) {
          fs.unlinkSync(assPath);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
      
      throw new Error(`Failed to add captions to video: ${error.message}`);
    }
  }

  /**
   * Add word-by-word captions that appear one word at a time
   * Creates multiple caption entries from word timestamps
   */
  async addWordByWordCaptions(
    videoPath: string,
    outputPath: string,
    wordTimestamps: Array<{ word: string; startTime: number; endTime: number }>,
    style: {
      fontFamily: string;
      fontSize: number;
      fontWeight: 'normal' | 'bold';
      fontStyle: 'normal' | 'italic';
      textColor: string;
      backgroundColor: string;
      borderColor: string;
      borderWidth: number;
      position: { x: number; y: number };
    }
  ): Promise<string> {
    // For word-by-word, each word becomes its own caption entry
    const captions = wordTimestamps.map(wt => ({
      text: wt.word,
      startTime: wt.startTime,
      endTime: wt.endTime,
    }));

    return this.addCaptionsToVideo(videoPath, outputPath, captions, style);
  }

  /**
   * Add full-sentence captions that show entire sentences
   * Groups words into sentences based on punctuation or timing gaps
   */
  async addFullSentenceCaptions(
    videoPath: string,
    outputPath: string,
    sceneVoiceovers: Array<{ sceneNumber: number; voiceover: string; startTime: number; duration: number }>,
    style: {
      fontFamily: string;
      fontSize: number;
      fontWeight: 'normal' | 'bold';
      fontStyle: 'normal' | 'italic';
      textColor: string;
      backgroundColor: string;
      borderColor: string;
      borderWidth: number;
      position: { x: number; y: number };
    }
  ): Promise<string> {
    // For full-sentence, each scene's voiceover becomes one caption
    const captions = sceneVoiceovers.map(sv => ({
      text: sv.voiceover,
      startTime: sv.startTime,
      endTime: sv.startTime + sv.duration,
    }));

    return this.addCaptionsToVideo(videoPath, outputPath, captions, style);
  }
}

