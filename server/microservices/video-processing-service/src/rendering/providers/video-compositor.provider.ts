import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { FFmpegResourceManager } from '@shared/utils/ffmpeg-resource-manager';

@Injectable()
export class VideoCompositorProvider {
  private readonly ffmpegManager: FFmpegResourceManager;

  constructor(private readonly configService?: ConfigService) {
    this.ffmpegManager = new FFmpegResourceManager(configService);
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
      this.ffmpegManager.execSyncString(normalizeTopCommand, { stdio: 'inherit' });

      const normalizeBottomCommand = `
        ffmpeg -i "${finalBottomPath}" \
        -r ${targetFps} -c:v libx264 -preset medium -crf 23 \
        -c:a copy \
        -vsync cfr \
        -y "${normalizedBottomPath}"
      `.replace(/\s+/g, ' ').trim();
      this.ffmpegManager.execSyncString(normalizeBottomCommand, { stdio: 'inherit' });
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
      this.ffmpegManager.execSyncString(ffmpegCommand, { stdio: 'inherit' });
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
        
        this.ffmpegManager.execSyncString(normalizeCommand, { stdio: 'inherit' });
        
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

      this.ffmpegManager.execSyncString(ffmpegCommand, { stdio: 'inherit' });
      
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
      this.ffmpegManager.execSyncString(ffmpegCommand, { stdio: 'inherit' });
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

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Check if Python script exists
    const scriptPath = path.join(process.cwd(), 'scripts', 'remove_background.py');
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Background removal script not found: ${scriptPath}`);
    }

    console.log(`[VideoCompositor] Removing background using AI model: ${modelName}`);
    console.log(`[VideoCompositor] Input: ${videoPath}`);
    console.log(`[VideoCompositor] Output: ${outputPath}`);

    return new Promise((resolve, reject) => {
      // Use spawn instead of execSync to avoid blocking event loop
      // This allows the service to handle other HTTP requests while processing
      const pythonProcess = spawn('python3', [
        scriptPath,
        videoPath,
        outputPath,
        modelName
      ], {
        stdio: ['ignore', 'pipe', 'pipe'] // Capture stdout/stderr for logging
      });

      let stdout = '';
      let stderr = '';

      // Set timeout (15 minutes for video processing - should be enough for most videos)
      const timeoutDuration = 15 * 60 * 1000; // 15 minutes
      const timeout = setTimeout(() => {
        pythonProcess.kill('SIGTERM');
        console.error(`[VideoCompositor] Background removal timeout after ${timeoutDuration / 1000 / 60} minutes`);
        reject(new Error(`Background removal timeout after ${timeoutDuration / 1000 / 60} minutes`));
      }, timeoutDuration);

      // Capture stdout (Python script progress logs)
      if (pythonProcess.stdout) {
        pythonProcess.stdout.on('data', (data) => {
          const output = data.toString();
          stdout += output;
          // Log progress in real-time (Python script already has progress logging)
          const lines = output.trim().split('\n').filter(line => line.trim());
          lines.forEach(line => {
            if (line.includes('[BackgroundRemoval]')) {
              console.log(`[VideoCompositor] ${line}`);
            }
          });
        });
      }

      // Capture stderr (Python script errors)
      if (pythonProcess.stderr) {
        pythonProcess.stderr.on('data', (data) => {
          const output = data.toString();
          stderr += output;
          // Log errors in real-time
          const lines = output.trim().split('\n').filter(line => line.trim());
          lines.forEach(line => {
            if (line.trim()) {
              console.error(`[VideoCompositor] ${line}`);
            }
          });
        });
      }

      // Handle process completion
      pythonProcess.on('close', (code) => {
        clearTimeout(timeout);
        
        if (code === 0) {
          // Check if output file exists
          if (!fs.existsSync(outputPath)) {
            reject(new Error('Background removal script completed but output file not found'));
            return;
          }
          console.log(`[VideoCompositor] ✅ Background removed successfully: ${outputPath}`);
          resolve(outputPath);
        } else {
          const errorMsg = stderr || stdout || `Process exited with code ${code}`;
          console.error(`[VideoCompositor] ❌ Background removal failed (exit code ${code}): ${errorMsg}`);
          reject(new Error(`Failed to remove background: ${errorMsg}`));
        }
      });

      // Handle process spawn errors
      pythonProcess.on('error', (error) => {
        clearTimeout(timeout);
        console.error(`[VideoCompositor] Failed to start background removal process: ${error.message}`);
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
        this.ffmpegManager.execSyncString(extractCommand, { stdio: 'pipe' });
        
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
   * Avatar video is positioned at bottom center with background removal
   * Supports both green screen (chroma key) and AI-based background removal
   * @param brollVideoPath Path to b-roll video (background)
   * @param avatarVideoPath Path to avatar video (foreground)
   * @param outputPath Path for output video
   * @param avatarMaxHeight Maximum height of avatar video as percentage of b-roll height (default: 40%)
   * @param useAIBackgroundRemoval Force AI background removal even if green screen is detected (default: false)
   */
  async overlayAvatarOnBroll(
    brollVideoPath: string,
    avatarVideoPath: string,
    outputPath: string,
    avatarMaxHeight: number = 40,
    useAIBackgroundRemoval: boolean = false
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

    // Determine background removal method
    let processedAvatarPath = avatarVideoPath;
    let hasGreenScreen = false;
    
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
      } catch (aiError: any) {
        console.error(`[VideoCompositor] AI background removal failed: ${aiError.message}`);
        console.log(`[VideoCompositor] Falling back to chroma key method`);
        // Fallback to chroma key if AI removal fails
        hasGreenScreen = true;
        processedAvatarPath = avatarVideoPath;
      }
    }

    // Scale avatar while preserving alpha channel (CRITICAL for AI-removed backgrounds)
    const scaledAvatarPath = path.join(outputDir, `avatar_scaled_${Date.now()}.mp4`);
    const pixFmtFlag = (!hasGreenScreen || useAIBackgroundRemoval) ? '-pix_fmt yuva420p' : '';
    const scaleCommand = `
      ffmpeg -i "${processedAvatarPath}" \
      -vf "scale=-1:${avatarMaxHeightPx}:force_original_aspect_ratio=decrease" \
      -c:v libx264 -preset medium -crf 23 \
      ${pixFmtFlag} \
      -y "${scaledAvatarPath}"
    `.replace(/\s+/g, ' ').trim();

    try {
      this.ffmpegManager.execSyncString(scaleCommand, { stdio: 'inherit' });
    } catch (error: any) {
      console.error(`[VideoCompositor] Failed to scale avatar: ${error.message}`);
      throw new Error(`Failed to scale avatar: ${error.message}`);
    }

    // Overlay based on background removal method
    let ffmpegCommand: string;

    if (hasGreenScreen && !useAIBackgroundRemoval) {
      // Use chroma key for green screen (100% opacity - blend=0)
      ffmpegCommand = `
        ffmpeg -i "${brollVideoPath}" -i "${scaledAvatarPath}" \
        -filter_complex "[1:v]chromakey=color=0x00FF00:similarity=0.25:blend=0:yuv=1[avatar_no_bg]; \
        [0:v][avatar_no_bg]overlay=${avatarX}:${avatarY}:shortest=1[v]" \
        -map "[v]" -c:v libx264 -preset medium -crf 23 \
        -map 0:a -c:a aac -b:a 192k \
        -shortest -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();
    } else {
      // Use alpha channel overlay (for AI-removed backgrounds)
      // The AI-processed video should have alpha channel (yuva420p)
      ffmpegCommand = `
        ffmpeg -i "${brollVideoPath}" -i "${scaledAvatarPath}" \
        -filter_complex "[1:v]format=yuva420p[avatar_alpha]; \
        [0:v][avatar_alpha]overlay=${avatarX}:${avatarY}:shortest=1[v]" \
        -map "[v]" -c:v libx264 -preset medium -crf 23 \
        -pix_fmt yuv420p \
        -map 0:a -c:a aac -b:a 192k \
        -shortest -y "${outputPath}"
      `.replace(/\s+/g, ' ').trim();
    }

    try {
      console.log(`[VideoCompositor] Executing FFmpeg overlay command...`);
      this.ffmpegManager.execSyncString(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Video overlaid successfully: ${outputPath}`);
      
      // Cleanup temporary files
      if (processedAvatarPath !== avatarVideoPath && fs.existsSync(processedAvatarPath)) {
        try {
          fs.unlinkSync(processedAvatarPath);
        } catch (e) {
          console.warn(`[VideoCompositor] Failed to cleanup temp avatar: ${e}`);
        }
      }
      if (fs.existsSync(scaledAvatarPath)) {
        try {
          fs.unlinkSync(scaledAvatarPath);
        } catch (e) {
          console.warn(`[VideoCompositor] Failed to cleanup scaled avatar: ${e}`);
        }
      }
      
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
      this.ffmpegManager.execSyncString(ffmpegCommand, { stdio: 'inherit' });
      
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

      this.ffmpegManager.execSyncString(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Audio added to video successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg add audio error:`, error.message);
      throw new Error(`Failed to add audio to video: ${error.message}`);
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

      this.ffmpegManager.execSyncString(ffmpegCommand, { stdio: 'inherit' });
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

      this.ffmpegManager.execSyncString(ffmpegCommand, { stdio: 'inherit' });
      console.log(`[VideoCompositor] Video cropped successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VideoCompositor] FFmpeg crop error:`, error.message);
      throw new Error(`Failed to crop video: ${error.message}`);
    }
  }
}

