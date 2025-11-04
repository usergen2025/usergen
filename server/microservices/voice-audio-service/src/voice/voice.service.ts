import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { ElevenLabsProvider, ElevenLabsVoice, GenerateSpeechRequest } from './providers/elevenlabs.provider';

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
    audioFiles: Array<{ buffer: Buffer; filename: string }>,
    userId: string,
    options?: {
      description?: string;
      labels?: string;
      remove_background_noise?: boolean;
    }
  ): Promise<{ voice_id: string; requires_verification: boolean }> {
    return await this.elevenLabsProvider.cloneVoice(name, audioFiles, options);
  }
}
