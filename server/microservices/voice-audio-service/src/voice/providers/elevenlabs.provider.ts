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
    
    // Create axios instance without Content-Type header
    // Content-Type will be set per-request based on the data type
    // For JSON requests, we'll set it explicitly; for multipart/form-data, form-data library will set it
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      headers: {
        'xi-api-key': this.apiKey,
        // DO NOT set Content-Type here - it will be set per-request
      },
      timeout: 180000, // 180 seconds (3 minutes) timeout for voice cloning operations
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
        headers: {
          'Content-Type': 'application/json',
        },
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
      const response = await this.axiosInstance.get<ElevenLabsVoice>(`/v1/voices/${voiceId}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
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
          headers: {
            'Content-Type': 'application/json',
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
    audioFiles: Array<{ buffer: Buffer; filename: string; mimetype: string }>,
    options?: {
      description?: string;
      labels?: string;
      remove_background_noise?: boolean;
    }
  ): Promise<{ voice_id: string; requires_verification: boolean }> {
    try {
      // Validate audio files
      if (!audioFiles || audioFiles.length === 0) {
        throw new Error('No audio files provided for voice cloning');
      }

      // Validate each file has a non-empty buffer
      audioFiles.forEach((file, index) => {
        if (!file.buffer || file.buffer.length === 0) {
          throw new Error(`Audio file ${index + 1} (${file.filename}) has an empty buffer`);
        }
        if (!file.filename) {
          throw new Error(`Audio file ${index + 1} is missing a filename`);
        }
        console.log(`[ElevenLabsProvider] Preparing audio file ${index + 1}: ${file.filename}, size: ${file.buffer.length} bytes, mimetype: ${file.mimetype}`);
      });

      const FormData = require('form-data');
      const formData = new FormData();

      formData.append('name', name);
      
      // ElevenLabs API accepts multiple files with the same field name 'files'
      // When using Node.js form-data library, use 'files' without brackets
      // The library will send multiple files with the same field name, which ElevenLabs expects
      audioFiles.forEach((file) => {
        // Append buffer with proper options for form-data library
        // Using 'files' (not 'files[]') - form-data library handles multiple files correctly
        formData.append('files', file.buffer, {
          filename: file.filename,
          contentType: file.mimetype || 'audio/mpeg',
        });
      });

      if (options?.description) {
        formData.append('description', options.description);
      }
      if (options?.labels) {
        // Labels must be a serialized JSON dictionary string according to API docs
        try {
          // If labels is already a JSON string, validate it; otherwise stringify it
          let labelsValue: string;
          if (typeof options.labels === 'string') {
            // Validate it's valid JSON
            JSON.parse(options.labels);
            labelsValue = options.labels;
          } else {
            // Convert object to JSON string
            labelsValue = JSON.stringify(options.labels);
          }
          formData.append('labels', labelsValue);
        } catch (error) {
          throw new Error('Labels must be a valid JSON string or object. Example: \'{"accent":"American","gender":"male"}\'');
        }
      }
      if (options?.remove_background_noise !== undefined) {
        formData.append('remove_background_noise', options.remove_background_noise.toString());
      }

      // Get form-data headers (includes Content-Type with boundary)
      const formDataHeaders = formData.getHeaders();
      
      console.log(`[ElevenLabsProvider] Sending voice cloning request to ElevenLabs API`);
      console.log(`[ElevenLabsProvider] Content-Type: ${formDataHeaders['content-type']}`);
      console.log(`[ElevenLabsProvider] Number of files: ${audioFiles.length}`);
      console.log(`[ElevenLabsProvider] Total buffer size: ${audioFiles.reduce((sum, f) => sum + f.buffer.length, 0)} bytes`);

      const response = await this.axiosInstance.post(
        '/v1/voices/add',
        formData,
        {
          headers: {
            ...formDataHeaders, // This includes Content-Type: multipart/form-data; boundary=...
            'xi-api-key': this.apiKey,
            // Explicitly ensure Content-Type is from form-data, not from axios instance
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          // Ensure axios doesn't try to transform the form-data stream
          transformRequest: [(data) => data], // Pass form-data as-is without transformation
        }
      );

      return response.data;
    } catch (error: any) {
      if (error.response) {
        // Handle 422 Unprocessable Entity (validation errors) specifically
        if (error.response.status === 422) {
          const errorMessage = error.response.data?.detail?.message 
            || error.response.data?.message 
            || 'Invalid voice cloning data. Please check your audio file format, size, and parameters.';
          throw new Error(`Voice cloning validation failed: ${errorMessage}`);
        }
        // Handle other API errors
        const errorMessage = error.response.data?.detail?.message 
          || error.response.data?.message 
          || error.response.statusText;
        throw new Error(`ElevenLabs voice cloning failed: ${error.response.status} - ${errorMessage}`);
      }
      // Handle network/timeout errors
      if (error.code === 'ECONNABORTED') {
        throw new Error('Voice cloning request timed out. Please try again with a shorter audio file.');
      }
      throw new Error(`Failed to clone voice: ${error.message}`);
    }
  }
}
