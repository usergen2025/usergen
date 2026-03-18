import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import axios from 'axios';
import { ElevenLabsProvider, ElevenLabsVoice, GenerateSpeechRequest } from './providers/elevenlabs.provider';
import { PublicUrlService } from '../common/storage/public-url.service';
import type { Multer } from 'multer';

/**
 * Extended result type that includes GCS URL
 */
export interface AudioFileResult {
  filePath: string;
  localUrl: string;
  duration?: number;
  gcsUrl?: string;
  publicUrl?: string;
}

@Injectable()
export class VoiceService {
  private readonly uploadsDir: string;
  private readonly ffmpegAvailable: boolean;

  constructor(
    private readonly elevenLabsProvider: ElevenLabsProvider,
    private readonly configService: ConfigService,
    private readonly publicUrlService: PublicUrlService,
  ) {
    // Create uploads directory for storing generated audio files
    this.uploadsDir = path.join(process.cwd(), 'uploads', 'audio');
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }

    // Check FFmpeg availability on startup
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 });
      this.ffmpegAvailable = true;
      console.log('[VoiceService] FFmpeg is available for audio conversion');
    } catch (error) {
      this.ffmpegAvailable = false;
      console.warn('[VoiceService] WARNING: FFmpeg not found. WebM/OGG audio conversion will fail.');
      console.warn('[VoiceService] Please install FFmpeg or upload MP3/WAV/M4A format files.');
    }
  }

  /**
   * Get language-specific voice settings for optimal quality
   */
  private getVoiceSettingsForLanguage(
    language?: 'english' | 'hindi' | 'hinglish'
  ): {
    stability: number;
    similarity_boost: number;
    use_speaker_boost: boolean;
    style?: number;
  } {
    const baseSettings = {
      stability: 0.5,
      similarity_boost: 0.75,
      use_speaker_boost: true,
      style: 0.0,
    };

    // Hindi/Hinglish might need different settings for accent clarity
    if (language === 'hindi' || language === 'hinglish') {
      return {
        ...baseSettings,
        stability: 0.6,  // Slightly more stable for accent clarity
        similarity_boost: 0.85,  // Higher similarity for accent preservation
      };
    }

    return baseSettings;
  }

  /**
   * Get list of available voices from ElevenLabs
   */
  async getVoices(options?: {
    pageSize?: number;
    search?: string;
    category?: string;
    language?: 'english' | 'hindi' | 'hinglish';
  }): Promise<ElevenLabsVoice[]> {
    const response = await this.elevenLabsProvider.listVoices({
      pageSize: options?.pageSize || 100,
      search: options?.search,
      category: options?.category,
      language: options?.language,
    });
    return response.voices;
  }

  /**
   * Get a specific voice by ID
   */
  async getVoice(voiceId: string): Promise<ElevenLabsVoice> {
    return await this.elevenLabsProvider.getVoice(voiceId);
  }

  /**
   * Generate speech audio file from text
   * Returns the local file path of the saved audio with optional GCS URL
   */
  async generateSpeechAudio(
    voiceId: string,
    text: string,
    outputFilename: string,
    userId: string,
    options?: {
      model_id?: string;
      output_format?: string;
      voice_settings?: {
        stability?: number;
        similarity_boost?: number;
        style?: number;
        use_speaker_boost?: boolean;
        speed?: number;
      };
    }
  ): Promise<AudioFileResult> {
    // Create user-specific directory
    const userDir = path.join(this.uploadsDir, userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // Generate speech audio
    const audioBuffer = await this.elevenLabsProvider.generateSpeech({
      voice_id: voiceId,
      text,
      model_id: options?.model_id || 'eleven_multilingual_v2',
      output_format: options?.output_format || 'mp3_44100_128',
      voice_settings: options?.voice_settings,
    });

    // Save to file
    const filePath = path.join(userDir, outputFilename);
    fs.writeFileSync(filePath, audioBuffer);

    // Local URL for serving the file
    const localUrl = `/uploads/audio/${userId}/${outputFilename}`;

    // Calculate audio duration using ffprobe
    let duration: number | undefined;
    try {
      const { execSync } = require('child_process');
      const output = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, { encoding: 'utf-8' });
      duration = parseFloat(output.trim());
      if (isNaN(duration)) {
        duration = undefined;
      }
    } catch (ffprobeError: any) {
      console.warn(`FFprobe not available or failed for ${filePath}:`, ffprobeError.message);
      // Duration will be undefined, caller can handle it
    }

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string | undefined;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        filePath,
        `audio/${userId}`,
        outputFilename,
        'audio/mpeg'
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
    } catch (error: any) {
      console.warn(`[VoiceService] GCS upload failed for ${outputFilename}: ${error.message}`);
      // Fall back to local URL
      publicUrl = localUrl;
    }

    return {
      filePath,
      localUrl,
      duration,
      gcsUrl,
      publicUrl,
    };
  }

  /**
   * Round up audio duration to next integer and add padding (with threshold-based logic)
   * This ensures video generation has exact duration matching without excessive silence
   * @param audioPath Path to audio file
   * @param outputPath Path for processed audio file
   * @param paddingSeconds Padding to add when needed (default: 1 second for final scene)
   * @param roundUp Whether to round up to next integer (default: true)
   * @param threshold Decimal threshold to determine if extra padding is needed (default: 0.7)
   *                  If decimal part <= threshold: only round up (no extra padding)
   *                  If decimal part > threshold: round up + add padding
   *                  If decimal = 0.0 (exact integer): round up + add padding
   * @returns New duration after processing
   */
  async processAudioWithPadding(
    audioPath: string,
    outputPath: string,
    paddingSeconds: number = 1.0,
    roundUp: boolean = true,
    threshold: number = 0.7
  ): Promise<number> {
    if (!this.ffmpegAvailable) {
      throw new Error('FFmpeg is required for audio processing but is not available');
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get current audio duration using ffprobe
    let currentDuration: number;
    try {
      const { execSync } = require('child_process');
      const output = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
        { encoding: 'utf-8' }
      );
      currentDuration = parseFloat(output.trim());
      if (isNaN(currentDuration) || currentDuration <= 0) {
        throw new Error(`Invalid audio duration: ${output.trim()}`);
      }
    } catch (error: any) {
      throw new Error(`Failed to get audio duration: ${error.message}`);
    }

    console.log(`[VoiceService] Processing audio with padding: original duration=${currentDuration.toFixed(2)}s`);

    // Calculate target duration with threshold-based logic
    let targetDuration: number;
    let actualPadding: number = 0;
    
    if (roundUp) {
      const decimalPart = currentDuration % 1;
      const roundedDuration = Math.ceil(currentDuration);
      
      // Special case: if already an integer (decimal = 0.0), add padding
      if (decimalPart === 0.0) {
        targetDuration = roundedDuration + paddingSeconds;
        actualPadding = paddingSeconds;
        console.log(`[VoiceService] Exact integer (${currentDuration.toFixed(2)}s), rounding up and adding ${paddingSeconds}s padding`);
      } else if (decimalPart <= threshold) {
        // Decimal <= threshold: Only round up, no extra padding
        targetDuration = roundedDuration;
        actualPadding = 0;
        console.log(`[VoiceService] Decimal part (${decimalPart.toFixed(2)}) <= threshold (${threshold}), only rounding up to ${roundedDuration}s, no extra padding`);
      } else {
        // Decimal > threshold: Round up + add padding
        targetDuration = roundedDuration + paddingSeconds;
        actualPadding = paddingSeconds;
        console.log(`[VoiceService] Decimal part (${decimalPart.toFixed(2)}) > threshold (${threshold}), rounding up to ${roundedDuration}s and adding ${paddingSeconds}s padding`);
      }
    } else {
      targetDuration = currentDuration + paddingSeconds;
      actualPadding = paddingSeconds;
    }

    console.log(`[VoiceService] Target duration: ${targetDuration.toFixed(2)}s (padding: ${actualPadding.toFixed(2)}s)`);

    try {
      // Use FFmpeg to extend audio with silence padding
      // Calculate the total padding needed (difference between target and original)
      const totalPaddingNeeded = targetDuration - currentDuration;
      
      const ffmpegArgs = ['-i', audioPath];
      
      if (totalPaddingNeeded > 0) {
        // Add padding filter to extend audio to target duration
        ffmpegArgs.push('-af', `apad=pad_dur=${totalPaddingNeeded}`);
      }
      
      ffmpegArgs.push(
        '-t', targetDuration.toString(),
        '-c:a', 'libmp3lame',
        '-b:a', '192k',
        '-y',
        outputPath
      );
      
      execFileSync('ffmpeg', ffmpegArgs, {
        stdio: 'inherit',
        maxBuffer: 10 * 1024 * 1024, // 10MB max buffer
      });

      // Verify output file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('FFmpeg processing completed but output file was not created');
      }

      // Get actual duration of processed file
      let actualDuration: number;
      try {
        const { execSync } = require('child_process');
        const output = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`,
          { encoding: 'utf-8' }
        );
        actualDuration = parseFloat(output.trim());
        if (isNaN(actualDuration)) {
          actualDuration = targetDuration; // Fallback to target duration
        }
      } catch (error: any) {
        console.warn(`[VoiceService] Failed to verify processed audio duration, using target duration: ${error.message}`);
        actualDuration = targetDuration;
      }

      console.log(`[VoiceService] Audio processed successfully: ${actualDuration.toFixed(2)}s`);
      return actualDuration;
    } catch (error: any) {
      console.error(`[VoiceService] Failed to process audio with padding:`, error.message);
      throw new Error(`Failed to process audio with padding: ${error.message}`);
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
    if (!this.ffmpegAvailable) {
      throw new Error('FFmpeg is required for audio fade-out but is not available');
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get audio duration using ffprobe
    let audioDuration: number;
    try {
      const { execSync } = require('child_process');
      const output = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
        { encoding: 'utf-8' }
      );
      audioDuration = parseFloat(output.trim());
      if (isNaN(audioDuration) || audioDuration <= 0) {
        throw new Error(`Invalid audio duration: ${output.trim()}`);
      }
    } catch (error: any) {
      throw new Error(`Failed to get audio duration: ${error.message}`);
    }

    // Calculate fade start time
    const fadeStart = Math.max(0, audioDuration - fadeDuration);
    
    console.log(`[VoiceService] Applying fade-out to audio: duration=${audioDuration.toFixed(2)}s, fade starts at ${fadeStart.toFixed(2)}s, fade duration=${fadeDuration}s`);

    try {
      execFileSync('ffmpeg', [
        '-i', audioPath,
        '-af', `afade=t=out:st=${fadeStart}:d=${fadeDuration}`,
        '-c:a', 'libmp3lame',
        '-b:a', '192k',
        '-y',
        outputPath,
      ], {
        stdio: 'inherit',
        maxBuffer: 10 * 1024 * 1024, // 10MB max buffer
      });

      // Verify output file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('FFmpeg fade-out completed but output file was not created');
      }

      console.log(`[VoiceService] Audio fade-out applied successfully: ${outputPath}`);
      return outputPath;
    } catch (error: any) {
      console.error(`[VoiceService] Failed to apply audio fade-out:`, error.message);
      throw new Error(`Failed to apply audio fade-out: ${error.message}`);
    }
  }

  /**
   * Generate multiple speech audio files for script scenes
   */
  async generateScriptAudio(
    voiceId: string,
    scenes: Array<{ sceneNumber: number; voiceover: string; timeRange?: string }>,
    userId: string,
    projectId: string,
    options?: {
      model_id?: string;
      output_format?: string;
      language?: 'english' | 'hindi' | 'hinglish';
      voice_settings?: {
        stability?: number;
        similarity_boost?: number;
        style?: number;
        use_speaker_boost?: boolean;
        speed?: number;
      };
      applyPaddingToLastScene?: boolean; // Default: true
      paddingSeconds?: number; // Default: 1.0
      applyFadeOutToLastScene?: boolean; // Default: true
      fadeOutDuration?: number; // Default: 1.0
    }
  ): Promise<Array<{ sceneNumber: number; filePath: string; localUrl: string; voiceover: string; duration?: number; gcsUrl?: string; publicUrl?: string }>> {
    const audioFiles: Array<{ sceneNumber: number; filePath: string; localUrl: string; voiceover: string; duration?: number; gcsUrl?: string; publicUrl?: string }> = [];

    console.log(`[VoiceService] Generating audio for ${scenes.length} scenes for project ${projectId}`);
    console.log(`[VoiceService] Scenes:`, scenes.map(s => ({ sceneNumber: s.sceneNumber, voiceoverLength: s.voiceover.length })));

    // Identify the last scene (highest sceneNumber)
    const lastSceneNumber = Math.max(...scenes.map(s => s.sceneNumber));
    console.log(`[VoiceService] Last scene identified: scene ${lastSceneNumber}`);

    // Get options with defaults
    const applyPadding = options?.applyPaddingToLastScene !== false; // Default: true
    const paddingSeconds = options?.paddingSeconds ?? 1.0;
    const applyFadeOut = options?.applyFadeOutToLastScene !== false; // Default: true
    const fadeOutDuration = options?.fadeOutDuration ?? 1.0;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const isLastScene = scene.sceneNumber === lastSceneNumber;
      console.log(`[VoiceService] Generating audio for scene ${scene.sceneNumber} (${i + 1}/${scenes.length})${isLastScene ? ' [LAST SCENE - will apply padding and fade-out]' : ''}`);
      
      const filename = `scene_${scene.sceneNumber}_${projectId}_${Date.now()}.mp3`;
      
      try {
        // Merge language-specific settings with provided settings
        const languageSettings = this.getVoiceSettingsForLanguage(options?.language);
        const mergedSettings = {
          ...languageSettings,
          ...options?.voice_settings, // User-provided settings override defaults
        };

        const result = await this.generateSpeechAudio(
          voiceId,
          scene.voiceover,
          filename,
          userId,
          {
            ...options,
            voice_settings: mergedSettings,
          }
        );

        console.log(`[VoiceService] Audio generated for scene ${scene.sceneNumber}: ${result.localUrl}, duration: ${result.duration}s${result.gcsUrl ? ', GCS: ' + result.gcsUrl : ''}`);

        let finalFilePath = result.filePath;
        let finalLocalUrl = result.localUrl;
        let finalDuration = result.duration;
        let finalGcsUrl = result.gcsUrl;
        let finalPublicUrl = result.publicUrl;

        let processedAudioPath = result.filePath;

        // Step 1: Apply padding (round up for every scene; last scene may get extra padding)
        if (applyPadding) {
          // For non-last scenes, we only want to round up to the next whole second (no extra padding)
          const scenePaddingSeconds = isLastScene ? paddingSeconds : 0.0;
          const paddedFilename = `scene_${scene.sceneNumber}_${projectId}_padded_${Date.now()}.mp3`;
          const paddedPath = path.join(path.dirname(result.filePath), paddedFilename);

          try {
            finalDuration = await this.processAudioWithPadding(
              processedAudioPath,
              paddedPath,
              scenePaddingSeconds,
              true, // roundUp
              0.7   // threshold: if decimal <= 0.7, only round up; if > 0.7, round up + paddingSeconds
            );

            // Update processed audio path for next steps (including optional fade-out)
            processedAudioPath = paddedPath;

            // Clean up original file if it's different from processed
            if (processedAudioPath !== result.filePath && fs.existsSync(result.filePath)) {
              try {
                fs.unlinkSync(result.filePath);
              } catch (e) {
                console.warn(`[VoiceService] Failed to cleanup original audio file: ${e}`);
              }
            }

            console.log(`[VoiceService] Scene ${scene.sceneNumber} padding applied: new duration=${finalDuration.toFixed(2)}s (isLastScene=${isLastScene})`);
          } catch (error: any) {
            console.error(`[VoiceService] Failed to apply padding to scene ${scene.sceneNumber}: ${error.message}`);
            throw new Error(`Failed to apply padding to scene ${scene.sceneNumber}: ${error.message}`);
          }
        }

        // Step 2: Apply fade-out only for the last scene (after any padding)
        if (isLastScene && applyFadeOut) {
          console.log(`[VoiceService] Applying fade-out to last scene ${scene.sceneNumber}`);
          const fadedFilename = `scene_${scene.sceneNumber}_${projectId}_faded_${Date.now()}.mp3`;
          const fadedPath = path.join(path.dirname(processedAudioPath), fadedFilename);

          try {
            await this.applyAudioFadeOut(
              processedAudioPath,
              fadedPath,
              fadeOutDuration
            );

            // Clean up intermediate padded file if it exists
            if (fadedPath !== processedAudioPath && fs.existsSync(processedAudioPath)) {
              try {
                fs.unlinkSync(processedAudioPath);
              } catch (e) {
                console.warn(`[VoiceService] Failed to cleanup intermediate audio file: ${e}`);
              }
            }

            finalFilePath = fadedPath;
            finalLocalUrl = `/uploads/audio/${userId}/${fadedFilename}`;

            // Re-upload to GCS if original was uploaded
            if (result.gcsUrl) {
              try {
                const storageResult = await this.publicUrlService.uploadFromPath(
                  finalFilePath,
                  `audio/${userId}`,
                  fadedFilename,
                  'audio/mpeg'
                );
                finalGcsUrl = storageResult.gcsUrl;
                finalPublicUrl = storageResult.publicUrl;
              } catch (error: any) {
                console.warn(`[VoiceService] GCS upload failed for processed audio: ${error.message}`);
                finalPublicUrl = finalLocalUrl;
              }
            } else {
              finalPublicUrl = finalLocalUrl;
            }

            console.log(`[VoiceService] Last scene fade-out applied successfully`);
          } catch (error: any) {
            console.error(`[VoiceService] Failed to apply fade-out to last scene: ${error.message}`);
            throw new Error(`Failed to apply fade-out to last scene: ${error.message}`);
          }
        } else if (applyPadding && processedAudioPath !== result.filePath) {
          // If only padding was applied (non-last scene or last without fade-out), update URLs
          const paddedFilename = path.basename(processedAudioPath);
          finalFilePath = processedAudioPath;
          finalLocalUrl = `/uploads/audio/${userId}/${paddedFilename}`;

          // Re-upload to GCS if original was uploaded
          if (result.gcsUrl) {
            try {
              const storageResult = await this.publicUrlService.uploadFromPath(
                finalFilePath,
                `audio/${userId}`,
                paddedFilename,
                'audio/mpeg'
              );
              finalGcsUrl = storageResult.gcsUrl;
              finalPublicUrl = storageResult.publicUrl;
            } catch (error: any) {
              console.warn(`[VoiceService] GCS upload failed for processed audio: ${error.message}`);
              finalPublicUrl = finalLocalUrl;
            }
          } else {
            finalPublicUrl = finalLocalUrl;
          }
        }

        audioFiles.push({
          sceneNumber: scene.sceneNumber,
          filePath: finalFilePath,
          localUrl: finalLocalUrl,
          voiceover: scene.voiceover,
          duration: finalDuration,
          gcsUrl: finalGcsUrl,
          publicUrl: finalPublicUrl,
        });
      } catch (error: any) {
        console.error(`[VoiceService] Failed to generate audio for scene ${scene.sceneNumber}:`, error.message);
        throw new Error(`Failed to generate audio for scene ${scene.sceneNumber}: ${error.message}`);
      }
    }

    console.log(`[VoiceService] Successfully generated ${audioFiles.length} audio files`);
    return audioFiles;
  }

  /**
   * Generate audio with word-level timestamps for captions
   * Uses ElevenLabs with-timestamps API for accurate timing
   */
  async generateScriptAudioWithTimestamps(
    voiceId: string,
    scenes: Array<{ sceneNumber: number; voiceover: string; timeRange?: string }>,
    userId: string,
    projectId: string,
    options?: {
      model_id?: string;
      output_format?: string;
      language?: 'english' | 'hindi' | 'hinglish';
      voice_settings?: {
        stability?: number;
        similarity_boost?: number;
        style?: number;
        use_speaker_boost?: boolean;
        speed?: number;
      };
    }
  ): Promise<Array<{
    sceneNumber: number;
    filePath: string;
    localUrl: string;
    voiceover: string;
    duration?: number;
    gcsUrl?: string;
    publicUrl?: string;
    wordTimestamps?: Array<{ word: string; startTime: number; endTime: number }>;
  }>> {
    const audioFiles: Array<{
      sceneNumber: number;
      filePath: string;
      localUrl: string;
      voiceover: string;
      duration?: number;
      gcsUrl?: string;
      publicUrl?: string;
      wordTimestamps?: Array<{ word: string; startTime: number; endTime: number }>;
    }> = [];

    console.log(`[VoiceService] Generating audio WITH TIMESTAMPS for ${scenes.length} scenes for project ${projectId}`);

    // Get language-specific settings
    const languageSettings = this.getVoiceSettingsForLanguage(options?.language);
    const mergedSettings = {
      ...languageSettings,
      ...options?.voice_settings,
    };

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      console.log(`[VoiceService] Generating audio with timestamps for scene ${scene.sceneNumber} (${i + 1}/${scenes.length})`);

      const filename = `scene_${scene.sceneNumber}_${projectId}_${Date.now()}.mp3`;
      const userDir = path.join(this.uploadsDir, 'audio', userId);

      // Ensure directory exists
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      try {
        // Generate speech with timestamps
        const result = await this.elevenLabsProvider.generateSpeechWithTimestamps({
          voice_id: voiceId,
          text: scene.voiceover,
          model_id: options?.model_id || 'eleven_multilingual_v2',
          output_format: options?.output_format || 'mp3_44100_128',
          voice_settings: mergedSettings,
        });

        // Save audio file
        const filePath = path.join(userDir, filename);
        fs.writeFileSync(filePath, result.audio);

        // Get duration using ffprobe
        let duration = 0;
        try {
          duration = this.getAudioDurationRobust(filePath);
        } catch (e) {
          console.warn(`[VoiceService] Could not get duration for ${filename}`);
        }

        // Convert character timestamps to word timestamps
        const wordTimestamps = this.elevenLabsProvider.convertCharacterTimestampsToWords(
          scene.voiceover,
          result.alignment
        );

        // Save timestamps to a JSON file alongside audio
        const timestampsFilename = `scene_${scene.sceneNumber}_${projectId}_timestamps.json`;
        const timestampsPath = path.join(userDir, timestampsFilename);
        fs.writeFileSync(timestampsPath, JSON.stringify({
          sceneNumber: scene.sceneNumber,
          voiceover: scene.voiceover,
          duration,
          wordTimestamps,
          characterAlignment: result.alignment,
        }, null, 2));

        // Upload to GCS
        let gcsUrl: string | undefined;
        let publicUrl: string = `/uploads/audio/${userId}/${filename}`;

        try {
          const storageResult = await this.publicUrlService.uploadFromPath(
            filePath,
            `audio/${userId}`,
            filename,
            'audio/mpeg'
          );
          gcsUrl = storageResult.gcsUrl;
          publicUrl = storageResult.publicUrl;

          // Also upload timestamps JSON
          await this.publicUrlService.uploadFromPath(
            timestampsPath,
            `audio/${userId}`,
            timestampsFilename,
            'application/json'
          );
        } catch (error: any) {
          console.warn(`[VoiceService] GCS upload failed: ${error.message}`);
        }

        console.log(`[VoiceService] Audio with timestamps generated for scene ${scene.sceneNumber}: ${wordTimestamps.length} words`);

        audioFiles.push({
          sceneNumber: scene.sceneNumber,
          filePath,
          localUrl: `/uploads/audio/${userId}/${filename}`,
          voiceover: scene.voiceover,
          duration,
          gcsUrl,
          publicUrl,
          wordTimestamps,
        });
      } catch (error: any) {
        console.error(`[VoiceService] Failed to generate audio with timestamps for scene ${scene.sceneNumber}:`, error.message);
        throw new Error(`Failed to generate audio with timestamps for scene ${scene.sceneNumber}: ${error.message}`);
      }
    }

    console.log(`[VoiceService] Successfully generated ${audioFiles.length} audio files with timestamps`);
    return audioFiles;
  }

  /**
   * Get word timestamps from existing audio using Speech-to-Text
   * Useful for user-recorded audio that wasn't generated with timestamps
   */
  async getTimestampsForAudio(
    audioBuffer: Buffer,
    text: string
  ): Promise<Array<{ word: string; startTime: number; endTime: number }>> {
    try {
      // Use ElevenLabs Speech-to-Text to get transcript with timestamps
      const transcription = await this.elevenLabsProvider.transcribeSpeech(audioBuffer);
      
      // For now, we just have the text - word-level timestamps require using
      // the full transcription response. This is a simplified version.
      // TODO: Update transcribeSpeech to return word-level timing data
      
      console.log(`[VoiceService] Transcribed audio: "${transcription.text.substring(0, 50)}..."`);
      
      // Fallback: estimate timestamps based on word count and duration
      const words = text.split(/\s+/).filter(w => w.length > 0);
      const estimatedDuration = words.length * 0.3; // Rough estimate: 0.3s per word
      const wordTimestamps: Array<{ word: string; startTime: number; endTime: number }> = [];
      
      let currentTime = 0;
      for (const word of words) {
        const wordDuration = (word.length / 5) * 0.3; // Longer words take more time
        wordTimestamps.push({
          word,
          startTime: currentTime,
          endTime: currentTime + wordDuration,
        });
        currentTime += wordDuration;
      }
      
      return wordTimestamps;
    } catch (error: any) {
      console.error(`[VoiceService] Failed to get timestamps for audio: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process last scene manual audio: download from URL, apply padding and fade-out, re-upload.
   * Same processing as AI-generated last scene.
   */
  async processLastSceneAudio(
    audioUrl: string,
    userId: string,
    projectId: string,
    sceneNumber: number,
    options?: { paddingSeconds?: number; fadeOutDuration?: number }
  ): Promise<{ publicUrl: string; gcsUrl?: string; duration: number }> {
    const paddingSeconds = options?.paddingSeconds ?? 1.0;
    const fadeOutDuration = options?.fadeOutDuration ?? 1.0;

    const tempDir = path.join(os.tmpdir(), `manual-audio-${projectId}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    let inputPath: string | null = null;
    let paddedPath: string | null = null;
    let fadedPath: string | null = null;

    let convertedPath: string | null = null;

    try {
      const ext = audioUrl.includes('.webm') ? '.webm' : audioUrl.includes('.mp3') ? '.mp3' : '.webm';
      inputPath = path.join(tempDir, `input_${sceneNumber}${ext}`);

      const response = await axios.get(audioUrl, { responseType: 'arraybuffer' });
      fs.writeFileSync(inputPath, Buffer.from(response.data));

      // If WebM, convert to MP3 first for reliable duration extraction
      // WebM files from browser MediaRecorder often have missing/incomplete duration metadata
      let audioForProcessing = inputPath;
      if (ext === '.webm') {
        console.log(`[VoiceService] Converting WebM to MP3 for reliable processing...`);
        convertedPath = path.join(tempDir, `converted_${sceneNumber}.mp3`);
        try {
          execFileSync('ffmpeg', [
            '-i', inputPath,
            '-vn',
            '-acodec', 'libmp3lame',
            '-b:a', '192k',
            '-y',
            convertedPath
          ], { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
          audioForProcessing = convertedPath;
          console.log(`[VoiceService] WebM to MP3 conversion successful`);
        } catch (convErr: any) {
          console.error(`[VoiceService] WebM to MP3 conversion failed: ${convErr?.message}`);
          throw new Error(`Failed to convert WebM to MP3: ${convErr?.message}`);
        }
      }

      paddedPath = path.join(tempDir, `padded_${sceneNumber}.mp3`);
      const finalDuration = await this.processAudioWithPadding(
        audioForProcessing,
        paddedPath,
        paddingSeconds,
        true,
        0.7
      );

      fadedPath = path.join(tempDir, `faded_${sceneNumber}.mp3`);
      await this.applyAudioFadeOut(paddedPath, fadedPath, fadeOutDuration);

      const outFilename = `manual_scene_${sceneNumber}_${projectId}_processed_${Date.now()}.mp3`;
      const userDir = path.join(this.uploadsDir, userId);
      this.ensureDirectory(userDir);
      const localOutPath = path.join(userDir, outFilename);

      fs.copyFileSync(fadedPath, localOutPath);

      let gcsUrl: string | undefined;
      let publicUrl: string;
      try {
        const storageResult = await this.publicUrlService.uploadFromPath(
          localOutPath,
          `audio/${userId}`,
          outFilename,
          'audio/mpeg'
        );
        gcsUrl = storageResult.gcsUrl;
        publicUrl = storageResult.publicUrl;
      } catch (e: any) {
        console.warn(`[VoiceService] GCS upload failed for processed manual audio: ${e?.message}`);
        publicUrl = `/uploads/audio/${userId}/${outFilename}`;
      }

      if (fs.existsSync(localOutPath)) {
        try {
          fs.unlinkSync(localOutPath);
        } catch (e) {
          console.warn(`[VoiceService] Failed to cleanup local file: ${e}`);
        }
      }

      return { publicUrl, gcsUrl, duration: finalDuration };
    } finally {
      for (const p of [inputPath, convertedPath, paddedPath, fadedPath]) {
        if (p && fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch (e) {
            console.warn(`[VoiceService] Failed to cleanup temp file ${p}: ${e}`);
          }
        }
      }
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmdirSync(tempDir);
        }
      } catch (e) {
        console.warn(`[VoiceService] Failed to remove temp dir: ${e}`);
      }
    }
  }

  /**
   * Clone a voice from audio files
   */
  async cloneVoice(
    name: string,
    audioFiles: Array<{ buffer: Buffer; filename: string; mimetype: string }>,
    userId: string,
    options?: {
      description?: string;
      labels?: string;
      remove_background_noise?: boolean;
    }
  ): Promise<{ voice_id: string; requires_verification: boolean }> {
    return await this.elevenLabsProvider.cloneVoice(name, audioFiles, options);
  }

  /**
   * Get voices that support speech-to-speech conversion
   */
  async getSpeechToSpeechVoices(options?: {
    search?: string;
    language?: 'english' | 'hindi' | 'hinglish';
  }): Promise<any[]> {
    return await this.elevenLabsProvider.getSpeechToSpeechVoices(options);
  }

  /**
   * Transcribe audio to text using ElevenLabs Speech-to-Text API
   */
  async transcribeSpeech(
    audioBuffer: Buffer,
    options?: {
      languageCode?: string;
    }
  ): Promise<{ text: string; languageCode: string }> {
    return await this.elevenLabsProvider.transcribeSpeech(audioBuffer, options);
  }

  /**
   * Convert a single concatenated audio to speech (for manual recording: concat-transform-split flow).
   * Same as convertAndStoreSpeechToSpeech but without sceneNumber - used when transforming
   * concatenated scene audios as one file.
   */
  async convertAndStoreSpeechToSpeechSingle(
    audioUrl: string,
    voiceId: string,
    userId: string,
    projectId: string,
    settings?: {
      stability?: number;
      similarityBoost?: number;
      style?: number;
      useSpeakerBoost?: boolean;
      removeBackgroundNoise?: boolean;
    }
  ): Promise<{ publicUrl: string; gcsUrl?: string; duration: number; filePath: string; localUrl: string }> {
    return this.convertAndStoreSpeechToSpeech(
      audioUrl,
      voiceId,
      userId,
      projectId,
      0, // sceneNumber 0 = concatenated (filename will use 0)
      settings,
    );
  }

  /**
   * Convert speech to speech and store the result
   * Downloads the original audio, transforms it using ElevenLabs STS, and uploads to GCS
   */
  async convertAndStoreSpeechToSpeech(
    audioUrl: string,
    voiceId: string,
    userId: string,
    projectId: string,
    sceneNumber: number,
    settings?: {
      stability?: number;
      similarityBoost?: number;
      style?: number;
      useSpeakerBoost?: boolean;
      removeBackgroundNoise?: boolean;
    },
    seed?: number
  ): Promise<{ publicUrl: string; gcsUrl?: string; duration: number; filePath: string; localUrl: string }> {
    const tempDir = path.join(os.tmpdir(), `sts-${projectId}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    let inputPath: string | null = null;
    let convertedPath: string | null = null;
    let outputPath: string | null = null;

    try {
      // Download the original audio
      const ext = audioUrl.includes('.webm') ? '.webm' : audioUrl.includes('.mp3') ? '.mp3' : '.webm';
      const inputLabel = sceneNumber === 0 ? 'concatenated' : `scene_${sceneNumber}`;
      inputPath = path.join(tempDir, `input_${inputLabel}${ext}`);
      
      console.log(`[VoiceService] Downloading audio from ${audioUrl}`);
      const response = await axios.get(audioUrl, { responseType: 'arraybuffer' });
      fs.writeFileSync(inputPath, Buffer.from(response.data));

      // Convert WebM to MP3 if needed
      let audioForSTS = inputPath;
      if (ext === '.webm') {
        console.log(`[VoiceService] Converting WebM to MP3 for STS...`);
        convertedPath = path.join(tempDir, `converted_${inputLabel}.mp3`);
        try {
          execFileSync('ffmpeg', [
            '-i', inputPath,
            '-vn',
            '-acodec', 'libmp3lame',
            '-b:a', '192k',
            '-y',
            convertedPath
          ], { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
          audioForSTS = convertedPath;
          console.log(`[VoiceService] WebM to MP3 conversion successful`);
        } catch (convErr: any) {
          console.error(`[VoiceService] WebM to MP3 conversion failed: ${convErr?.message}`);
          throw new Error(`Failed to convert WebM to MP3: ${convErr?.message}`);
        }
      }

      // Read the audio buffer
      const audioBuffer = fs.readFileSync(audioForSTS);

      // Transform using ElevenLabs Speech-to-Speech API
      console.log(`[VoiceService] Transforming audio with voice ${voiceId}`);
      const transformedBuffer = await this.elevenLabsProvider.convertSpeechToSpeech(
        audioBuffer,
        voiceId,
        {
          voiceSettings: settings ? {
            stability: settings.stability,
            similarity_boost: settings.similarityBoost,
            style: settings.style,
            use_speaker_boost: settings.useSpeakerBoost,
          } : undefined,
          removeBackgroundNoise: settings?.removeBackgroundNoise,
          seed,
        }
      );

      // Save transformed audio locally
      const outFilename = sceneNumber === 0
        ? `sts_concatenated_${projectId}_${Date.now()}.mp3`
        : `sts_scene_${sceneNumber}_${projectId}_${Date.now()}.mp3`;
      const userDir = path.join(this.uploadsDir, userId);
      this.ensureDirectory(userDir);
      outputPath = path.join(userDir, outFilename);
      fs.writeFileSync(outputPath, transformedBuffer);

      // Get duration of transformed audio
      let duration = 0;
      try {
        duration = this.getAudioDurationRobust(outputPath);
      } catch (e) {
        console.warn(`[VoiceService] Could not get duration for transformed audio: ${e}`);
      }

      // Upload to GCS
      let gcsUrl: string | undefined;
      let publicUrl: string;
      try {
        const storageResult = await this.publicUrlService.uploadFromPath(
          outputPath,
          `audio/${userId}`,
          outFilename,
          'audio/mpeg'
        );
        gcsUrl = storageResult.gcsUrl;
        publicUrl = storageResult.publicUrl;
      } catch (e: any) {
        console.warn(`[VoiceService] GCS upload failed for STS audio: ${e?.message}`);
        publicUrl = `/uploads/audio/${userId}/${outFilename}`;
      }

      console.log(`[VoiceService] Speech-to-speech conversion complete: ${publicUrl}, duration: ${duration}s`);
      const localUrl = `/uploads/audio/${userId}/${outFilename}`;
      return { publicUrl, gcsUrl, duration, filePath: outputPath, localUrl };
    } finally {
      // Cleanup temp files
      for (const p of [inputPath, convertedPath]) {
        if (p && fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch (e) {
            console.warn(`[VoiceService] Failed to cleanup temp file ${p}: ${e}`);
          }
        }
      }
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmdirSync(tempDir);
        }
      } catch (e) {
        console.warn(`[VoiceService] Failed to remove temp dir: ${e}`);
      }
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\-_.]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'voice';
  }

  private ensureDirectory(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Get audio duration with multiple fallback strategies for WebM and other formats.
   * Tries format.duration, then stream.duration, then decodes and measures.
   * @param audioPath Path to the audio file
   * @returns Duration in seconds
   */
  private getAudioDurationRobust(audioPath: string): number {
    const { execSync } = require('child_process');

    // Strategy 1: Try format.duration (works for most formats)
    try {
      const output = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
        { encoding: 'utf-8' }
      ).trim();
      const duration = parseFloat(output);
      if (!isNaN(duration) && duration > 0) {
        console.log(`[VoiceService] Duration from format: ${duration.toFixed(2)}s`);
        return duration;
      }
    } catch (e) {
      console.warn(`[VoiceService] format.duration extraction failed`);
    }

    // Strategy 2: Try stream duration (more reliable for WebM)
    try {
      const output = execSync(
        `ffprobe -v error -select_streams a:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
        { encoding: 'utf-8' }
      ).trim();
      const duration = parseFloat(output);
      if (!isNaN(duration) && duration > 0) {
        console.log(`[VoiceService] Duration from stream: ${duration.toFixed(2)}s`);
        return duration;
      }
    } catch (e) {
      console.warn(`[VoiceService] stream.duration extraction failed`);
    }

    // Strategy 3: Decode and measure (last resort, always works)
    try {
      console.log(`[VoiceService] Decoding audio to measure duration...`);
      const output = execSync(
        `ffmpeg -i "${audioPath}" -f null - 2>&1`,
        { encoding: 'utf-8', shell: true, maxBuffer: 50 * 1024 * 1024 }
      );
      const matches = output.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
      if (matches && matches.length > 0) {
        const last = matches[matches.length - 1];
        const parts = last.replace('time=', '').split(':');
        const duration = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
        if (!isNaN(duration) && duration > 0) {
          console.log(`[VoiceService] Duration from decode: ${duration.toFixed(2)}s`);
          return duration;
        }
      }
    } catch (e) {
      console.warn(`[VoiceService] decode-and-measure failed`);
    }

    throw new Error('Could not determine audio duration using any strategy');
  }

  private getExtensionFromMime(mimetype: string | undefined, fallback = '.mp3') {
    if (!mimetype) return fallback;
    if (mimetype.includes('wav')) return '.wav';
    if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return '.mp3';
    if (mimetype.includes('ogg')) return '.ogg';
    if (mimetype.includes('webm')) return '.webm';
    if (mimetype.includes('m4a') || mimetype.includes('mp4')) return '.m4a';
    return fallback;
  }

  async storeCloneAudioSample(
    userId: string,
    audioFile: Multer.File,
    suggestedName?: string,
  ): Promise<{
    filePath: string;
    localUrl: string;
    buffer: Buffer;
    filename: string;
    mimetype: string;
    duration?: number;
    gcsUrl?: string;
    publicUrl?: string;
  }> {
    // Validate input file
    if (!audioFile || !audioFile.buffer) {
      throw new Error('Audio file is missing or invalid');
    }

    if (audioFile.buffer.length === 0) {
      throw new Error('Audio file buffer is empty. Please ensure the file was uploaded correctly.');
    }

    console.log(`[VoiceService] Storing clone audio sample: ${audioFile.originalname}, size: ${audioFile.buffer.length} bytes, mimetype: ${audioFile.mimetype}`);

    const baseDir = path.join(this.uploadsDir, 'cloned', userId);
    this.ensureDirectory(baseDir);

    const safeName = this.sanitizeFilename(suggestedName || audioFile.originalname || 'voice');
    const originalExt = path.extname(audioFile.originalname || '');
    const originalMimeExt = this.getExtensionFromMime(audioFile.mimetype, '.webm');
    const detectedExt = originalExt ? originalExt.toLowerCase() : originalMimeExt;
    const allowedExtensions = ['.mp3', '.wav', '.m4a'];

    let finalPath: string;
    let finalMimetype: string;
    let bufferToSend: Buffer;

    if (allowedExtensions.includes(detectedExt)) {
      const filename = `${Date.now()}_${safeName}${detectedExt}`;
      finalPath = path.join(baseDir, filename);
      fs.writeFileSync(finalPath, audioFile.buffer);
      finalMimetype = audioFile.mimetype || 'audio/mpeg';
      bufferToSend = fs.readFileSync(finalPath);
      
      // Validate buffer was read correctly
      if (!bufferToSend || bufferToSend.length === 0) {
        throw new Error(`Failed to read audio file from disk. File may be corrupted.`);
      }
      
      console.log(`[VoiceService] Stored audio file: ${filename}, size: ${bufferToSend.length} bytes`);
    } else {
      // Check if FFmpeg is available before attempting conversion
      if (!this.ffmpegAvailable) {
        throw new Error(
          'FFmpeg is not installed on the server. WebM/OGG audio conversion is not available. ' +
          'Please upload audio files in MP3, WAV, or M4A format, or contact support to install FFmpeg.'
        );
      }

      // Write to temp file and convert to mp3 using ffmpeg
      const tempInput = path.join(baseDir, `${Date.now()}_${safeName}.tmp${detectedExt}`);
      fs.writeFileSync(tempInput, audioFile.buffer);
      const filename = `${Date.now()}_${safeName}.mp3`;
      finalPath = path.join(baseDir, filename);

      console.log(`[VoiceService] Converting audio from ${detectedExt} to MP3 using ffmpeg`);

      try {
        // Convert audio with specific codec settings for better compatibility
        execFileSync('ffmpeg', [
          '-y',
          '-i', tempInput,
          '-acodec', 'libmp3lame',
          '-ar', '44100',
          '-ac', '2',
          '-b:a', '128k',
          finalPath
        ], { 
          stdio: 'ignore',
          maxBuffer: 10 * 1024 * 1024 // 10MB max buffer
        });
        
        // Verify converted file exists and is not empty
        if (!fs.existsSync(finalPath)) {
          throw new Error('FFmpeg conversion completed but output file was not created');
        }
        
        const convertedFileStats = fs.statSync(finalPath);
        if (convertedFileStats.size === 0) {
          throw new Error('FFmpeg conversion produced an empty file');
        }
        
        console.log(`[VoiceService] Conversion successful: ${filename}, size: ${convertedFileStats.size} bytes`);
      } catch (error: any) {
        // Clean up temp file before throwing
        if (fs.existsSync(tempInput)) {
          try {
            fs.unlinkSync(tempInput);
          } catch (unlinkError) {
            // Ignore cleanup errors
          }
        }
        if (fs.existsSync(finalPath)) {
          try {
            fs.unlinkSync(finalPath);
          } catch (unlinkError) {
            // Ignore cleanup errors
          }
        }

        // Provide more specific error messages
        let errorMessage = 'Failed to convert audio sample';
        if (error?.code === 'ENOENT') {
          errorMessage = 'FFmpeg executable not found. Please contact support.';
        } else if (error?.signal === 'SIGTERM' || error?.killed) {
          errorMessage = 'Audio conversion timed out. The file may be too large or corrupted.';
        } else if (error?.message) {
          errorMessage = `Audio conversion failed: ${error.message}`;
        }

        throw new Error(
          `${errorMessage} Please upload MP3, WAV, or M4A format files, or try a shorter audio sample.`
        );
      } finally {
        // Clean up temp file
        if (fs.existsSync(tempInput)) {
          try {
            fs.unlinkSync(tempInput);
          } catch (unlinkError) {
            // Ignore cleanup errors
          }
        }
      }

      finalMimetype = 'audio/mpeg';
      bufferToSend = fs.readFileSync(finalPath);
      
      // Validate converted buffer
      if (!bufferToSend || bufferToSend.length === 0) {
        throw new Error(`Failed to read converted audio file from disk. Conversion may have failed.`);
      }
    }

    let duration: number | undefined;
    try {
      const output = execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        finalPath,
      ]);
      const parsed = parseFloat(output.toString().trim());
      if (!Number.isNaN(parsed)) {
        duration = parsed;
      }
    } catch (error) {
      // FFprobe optional; ignore errors
    }

    const localUrl = `/uploads/audio/cloned/${userId}/${path.basename(finalPath)}`;

    // Upload to GCS if available
    let gcsUrl: string | undefined;
    let publicUrl: string | undefined;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        finalPath,
        `cloned/${userId}`,
        path.basename(finalPath),
        finalMimetype
      );
      gcsUrl = storageResult.gcsUrl;
      publicUrl = storageResult.publicUrl;
    } catch (error: any) {
      console.warn(`[VoiceService] GCS upload failed for cloned audio: ${error.message}`);
      publicUrl = localUrl;
    }

    return {
      filePath: finalPath,
      localUrl,
      buffer: bufferToSend,
      filename: path.basename(finalPath),
      mimetype: finalMimetype,
      duration,
      gcsUrl,
      publicUrl,
    };
  }
}
