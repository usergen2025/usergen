import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string> | null;
  preview_url?: string | null;
  settings?: {
    stability: number;
    similarity_boost: number;
    style?: number;
    use_speaker_boost?: boolean;
  } | null;
}

export interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoice[];
  has_more: boolean;
  total_count: number;
  next_page_token?: string | null;
}

export interface GenerateSpeechRequest {
  voice_id: string;
  text: string;
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

@Injectable()
export class ElevenLabsProvider {
  private readonly apiKey: string;
  private readonly baseURL = 'https://api.elevenlabs.io';
  private readonly axiosInstance: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ELEVENLABS_API_KEY') || '';
    
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60 seconds timeout
    });
  }

  /**
   * List all available voices from ElevenLabs
   */
  async listVoices(options?: {
    pageSize?: number;
    search?: string;
    category?: string;
    voiceType?: string;
  }): Promise<ElevenLabsVoicesResponse> {
    try {
      const params: any = {};
      if (options?.pageSize) params.page_size = options.pageSize;
      if (options?.search) params.search = options.search;
      if (options?.category) params.category = options.category;
      if (options?.voiceType) params.voice_type = options.voiceType;

      const response = await this.axiosInstance.get<ElevenLabsVoicesResponse>('/v2/voices', {
        params,
      });

      return response.data;
    } catch (error: any) {
      if (error.response) {
        throw new Error(`ElevenLabs API error: ${error.response.status} - ${error.response.data?.detail?.message || error.response.statusText}`);
      }
      throw new Error(`Failed to fetch voices: ${error.message}`);
    }
  }

  /**
   * Get details of a specific voice
   */
  async getVoice(voiceId: string): Promise<ElevenLabsVoice> {
    try {
      const response = await this.axiosInstance.get<ElevenLabsVoice>(`/v1/voices/${voiceId}`);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        throw new Error(`ElevenLabs API error: ${error.response.status} - ${error.response.data?.detail?.message || error.response.statusText}`);
      }
      throw new Error(`Failed to fetch voice: ${error.message}`);
    }
  }

  /**
   * Generate speech from text using a voice
   */
  async generateSpeech(request: GenerateSpeechRequest): Promise<Buffer> {
    try {
      const {
        voice_id,
        text,
        model_id = 'eleven_multilingual_v2',
        output_format = 'mp3_44100_128',
        voice_settings,
      } = request;

      const response = await this.axiosInstance.post(
        `/v1/text-to-speech/${voice_id}`,
        {
          text,
          model_id,
          voice_settings,
        },
        {
          params: {
            output_format,
          },
          responseType: 'arraybuffer', // Get binary audio data
        }
      );

      return Buffer.from(response.data);
    } catch (error: any) {
      if (error.response) {
        const errorMessage = error.response.data?.detail?.message || error.response.statusText;
        throw new Error(`ElevenLabs speech generation failed: ${error.response.status} - ${errorMessage}`);
      }
      throw new Error(`Failed to generate speech: ${error.message}`);
    }
  }

  /**
   * Clone a voice from audio files
   */
  async cloneVoice(
    name: string,
    audioFiles: Array<{ buffer: Buffer; filename: string }>,
    options?: {
      description?: string;
      labels?: string;
      remove_background_noise?: boolean;
    }
  ): Promise<{ voice_id: string; requires_verification: boolean }> {
    try {
      const FormData = require('form-data');
      const formData = new FormData();

      formData.append('name', name);
      
      audioFiles.forEach((file, index) => {
        formData.append('files[]', file.buffer, {
          filename: file.filename,
          contentType: 'audio/mpeg',
        });
      });

      if (options?.description) {
        formData.append('description', options.description);
      }
      if (options?.labels) {
        formData.append('labels', options.labels);
      }
      if (options?.remove_background_noise !== undefined) {
        formData.append('remove_background_noise', options.remove_background_noise.toString());
      }

      const response = await this.axiosInstance.post(
        '/v1/voices/add',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'xi-api-key': this.apiKey,
          },
        }
      );

      return response.data;
    } catch (error: any) {
      if (error.response) {
        const errorMessage = error.response.data?.detail?.message || error.response.statusText;
        throw new Error(`ElevenLabs voice cloning failed: ${error.response.status} - ${errorMessage}`);
      }
      throw new Error(`Failed to clone voice: ${error.message}`);
    }
  }
}
