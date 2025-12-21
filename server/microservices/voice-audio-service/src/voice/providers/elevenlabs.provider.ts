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
    
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      console.warn('[ElevenLabsProvider] WARNING: ELEVENLABS_API_KEY is not set. Voice cloning will fail.');
    } else if (!this.apiKey.startsWith('sk_')) {
      console.warn('[ElevenLabsProvider] WARNING: ELEVENLABS_API_KEY format may be invalid (should start with "sk_")');
    }
    
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
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors, let us handle them
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
      // Validate API key
      if (!this.apiKey || this.apiKey.trim().length === 0) {
        throw new Error('ElevenLabs API key is not configured. Please set ELEVENLABS_API_KEY environment variable.');
      }

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
      // Note: Browser FormData uses 'files[]', but Node.js form-data library uses 'files'
      audioFiles.forEach((file) => {
        // Use 'files' (not 'files[]') - form-data library handles multiple files correctly
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
      console.log(`[ElevenLabsProvider] API Key present: ${!!this.apiKey}`);
      console.log(`[ElevenLabsProvider] API Key length: ${this.apiKey?.length || 0}`);

      try {
        // Ensure API key is included in headers (spreading formDataHeaders might override axios instance headers)
        const requestHeaders = {
          ...formDataHeaders, // This includes Content-Type: multipart/form-data; boundary=...
          'xi-api-key': this.apiKey, // Explicitly include API key
        };

        console.log(`[ElevenLabsProvider] Request headers:`, Object.keys(requestHeaders));

        const response = await this.axiosInstance.post(
          '/v1/voices/add',
          formData,
          {
            headers: requestHeaders,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            // Don't use transformRequest with form-data - it can break the stream
            // form-data library handles the stream correctly on its own
          }
        );

        // Log full response for debugging
        console.log(`[ElevenLabsProvider] Response status: ${response.status}`);
        console.log(`[ElevenLabsProvider] Response data:`, JSON.stringify(response.data, null, 2));
        console.log(`[ElevenLabsProvider] Response content-type: ${response.headers['content-type']}`);

        // Check if response is successful (200-299)
        if (response.status < 200 || response.status >= 300) {
          const errorMessage = response.data?.detail?.message 
            || response.data?.message 
            || response.statusText 
            || 'Unknown error';
          throw new Error(`ElevenLabs API returned error status ${response.status}: ${errorMessage}`);
        }

        // Validate response structure according to API docs
        // Expected response: { "voice_id": "string", "requires_verification": boolean }
        if (!response.data) {
          throw new Error('ElevenLabs API returned empty response');
        }

        // Check for voice_id in response (API docs specify it should be present)
        if (!response.data.voice_id) {
          console.error(`[ElevenLabsProvider] Invalid response structure. Expected voice_id but got:`, response.data);
          throw new Error(`ElevenLabs API response missing voice_id. Response: ${JSON.stringify(response.data)}`);
        }

        console.log(`[ElevenLabsProvider] Voice cloning successful: voice_id=${response.data.voice_id}, requires_verification=${response.data.requires_verification}`);

        // Return normalized response structure
        return {
          voice_id: response.data.voice_id,
          requires_verification: response.data.requires_verification ?? false,
        };
      } catch (requestError: any) {
        // Log detailed error information
        console.error(`[ElevenLabsProvider] ElevenLabs API request failed:`, {
          status: requestError.response?.status,
          statusText: requestError.response?.statusText,
          data: requestError.response?.data,
          message: requestError.message,
          code: requestError.code,
          config: {
            url: requestError.config?.url,
            method: requestError.config?.method,
            headers: requestError.config?.headers ? Object.keys(requestError.config.headers) : null,
          }
        });

        if (requestError.response) {
          // Handle 422 Unprocessable Entity (validation errors) specifically
          if (requestError.response.status === 422) {
            const errorMessage = requestError.response.data?.detail?.message 
              || requestError.response.data?.message 
              || 'Invalid voice cloning data. Please check your audio file format, size, and parameters.';
            throw new Error(`Voice cloning validation failed: ${errorMessage}`);
          }
          // Handle 401 Unauthorized (invalid API key)
          if (requestError.response.status === 401) {
            throw new Error('Invalid ElevenLabs API key. Please check your ELEVENLABS_API_KEY configuration.');
          }
          // Handle 429 Rate Limit
          if (requestError.response.status === 429) {
            throw new Error('ElevenLabs API rate limit exceeded. Please try again later.');
          }
          // Handle other API errors
          const errorMessage = requestError.response.data?.detail?.message 
            || requestError.response.data?.message 
            || requestError.response.statusText;
          throw new Error(`ElevenLabs voice cloning failed: ${requestError.response.status} - ${errorMessage}`);
        }
        // Handle network/timeout errors
        if (requestError.code === 'ECONNABORTED') {
          throw new Error('Voice cloning request timed out. Please try again with a shorter audio file.');
        }
        if (requestError.code === 'ECONNREFUSED') {
          throw new Error('Cannot connect to ElevenLabs API. Please check your network connection.');
        }
        if (requestError.code === 'ENOTFOUND') {
          throw new Error('ElevenLabs API host not found. Please check your network connection.');
        }
        throw new Error(`Failed to clone voice: ${requestError.message || 'Unknown error'}`);
      }
    } catch (error: any) {
      // Re-throw if it's already been processed
      if (error.message && error.message.includes('ElevenLabs') || error.message.includes('Voice cloning')) {
        throw error;
      }
      // Wrap unexpected errors
      console.error(`[ElevenLabsProvider] Unexpected error in cloneVoice:`, error);
      throw new Error(`Failed to clone voice: ${error.message || 'Unknown error'}`);
    }
  }
}
