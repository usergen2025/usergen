import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ElevenLabsProvider, ElevenLabsVoice, GenerateSpeechRequest } from './providers/elevenlabs.provider';
import type { Multer } from 'multer';

@Injectable()
export class VoiceService {
  private readonly uploadsDir: string;

  constructor(
    private readonly elevenLabsProvider: ElevenLabsProvider,
    private readonly configService: ConfigService,
  ) {
    // Create uploads directory for storing generated audio files
    this.uploadsDir = path.join(process.cwd(), 'uploads', 'audio');
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  /**
   * Get list of available voices from ElevenLabs
   */
  async getVoices(options?: {
    pageSize?: number;
    search?: string;
    category?: string;
  }): Promise<ElevenLabsVoice[]> {
    const response = await this.elevenLabsProvider.listVoices({
      pageSize: options?.pageSize || 100,
      search: options?.search,
      category: options?.category,
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
   * Returns the local file path of the saved audio
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
  ): Promise<{ filePath: string; localUrl: string; duration?: number }> {
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

    return {
      filePath,
      localUrl,
      duration,
    };
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
      voice_settings?: {
        stability?: number;
        similarity_boost?: number;
        style?: number;
        use_speaker_boost?: boolean;
        speed?: number;
      };
    }
  ): Promise<Array<{ sceneNumber: number; filePath: string; localUrl: string; voiceover: string; duration?: number }>> {
    const audioFiles: Array<{ sceneNumber: number; filePath: string; localUrl: string; voiceover: string; duration?: number }> = [];

    console.log(`[VoiceService] Generating audio for ${scenes.length} scenes for project ${projectId}`);
    console.log(`[VoiceService] Scenes:`, scenes.map(s => ({ sceneNumber: s.sceneNumber, voiceoverLength: s.voiceover.length })));

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      console.log(`[VoiceService] Generating audio for scene ${scene.sceneNumber} (${i + 1}/${scenes.length})`);
      
      const filename = `scene_${scene.sceneNumber}_${projectId}_${Date.now()}.mp3`;
      
      try {
        const result = await this.generateSpeechAudio(
          voiceId,
          scene.voiceover,
          filename,
          userId,
          options
        );

        console.log(`[VoiceService] Audio generated for scene ${scene.sceneNumber}: ${result.localUrl}, duration: ${result.duration}s`);

        audioFiles.push({
          sceneNumber: scene.sceneNumber,
          filePath: result.filePath,
          localUrl: result.localUrl,
          voiceover: scene.voiceover,
          duration: result.duration,
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
      // Write to temp file and convert to mp3 using ffmpeg
      const tempInput = path.join(baseDir, `${Date.now()}_${safeName}.tmp${detectedExt}`);
      fs.writeFileSync(tempInput, audioFile.buffer);
      const filename = `${Date.now()}_${safeName}.mp3`;
      finalPath = path.join(baseDir, filename);

      console.log(`[VoiceService] Converting audio from ${detectedExt} to MP3 using ffmpeg`);

      try {
        execFileSync('ffmpeg', ['-y', '-i', tempInput, finalPath], { stdio: 'ignore' });
        
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
          fs.unlinkSync(tempInput);
        }
        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
        }
        throw new Error(
          `Failed to convert audio sample using ffmpeg. Please upload MP3, WAV, or M4A format. (${error?.message || 'Unknown error'})`,
        );
      } finally {
        if (fs.existsSync(tempInput)) {
          fs.unlinkSync(tempInput);
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

    return {
      filePath: finalPath,
      localUrl,
      buffer: bufferToSend,
      filename: path.basename(finalPath),
      mimetype: finalMimetype,
      duration,
    };
  }
}
