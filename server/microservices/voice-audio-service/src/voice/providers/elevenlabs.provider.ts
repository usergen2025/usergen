import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface VerifiedVoiceLanguage {
  language: string;  // e.g., "hi" for Hindi, "en" for English
  model_id: string;
  locale?: string | null;
  preview_url?: string | null;
}

export interface ElevenLabsVoiceSharing {
  status?: string;
  enabled_in_library?: boolean;
  public_owner_id?: string;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string> | null;
  preview_url?: string | null;
  verified_languages?: VerifiedVoiceLanguage[] | null;
  settings?: {
    stability: number;
    similarity_boost: number;
    style?: number;
    use_speaker_boost?: boolean;
  } | null;
  is_owner?: boolean | null;
  sharing?: ElevenLabsVoiceSharing | null;
  permission_on_resource?: string | null;
}

export function isVoiceUsable(voice: ElevenLabsVoice): boolean {
  if (voice.sharing?.status === 'copied_disabled') {
    return false;
  }
  if (voice.category === 'professional' && voice.sharing?.enabled_in_library === false) {
    return false;
  }
  return true;
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
   * Map application language to ElevenLabs language code
   */
  private mapLanguageToCode(language: string): string | null {
    const languageMap: Record<string, string> = {
      'english': 'en',
      'hindi': 'hi',
      'hinglish': 'hi', // Use Hindi voices for Hinglish
    };
    return languageMap[language.toLowerCase()] || null;
  }

  /**
   * Check if voice supports the requested language
   */
  private voiceSupportsLanguage(voice: ElevenLabsVoice, languageCode: string): boolean {
    if (!voice.verified_languages || voice.verified_languages.length === 0) {
      return false; // Skip voices without language info
    }
    
    // Match language code (e.g., "hi" matches "hi" or "hi-IN")
    return voice.verified_languages.some(vl => 
      vl.language?.toLowerCase().startsWith(languageCode.toLowerCase())
    );
  }

  /**
   * List all available voices from ElevenLabs
   */
  async listVoices(options?: {
    pageSize?: number;
    search?: string;
    category?: string;
    voiceType?: string;
    language?: string;  // e.g., "english", "hindi", "hinglish"
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

      // Validate response structure before processing
      if (!response.data) {
        console.error('[ElevenLabs] API returned empty response');
        throw new Error('ElevenLabs API returned empty response. Please check your API key.');
      }

      if (!response.data.voices || !Array.isArray(response.data.voices)) {
        console.error('[ElevenLabs] Unexpected API response structure:', JSON.stringify(response.data).substring(0, 500));
        const errorMessage = (response.data as any)?.detail?.message || (response.data as any)?.message || 'Unknown error';
        throw new Error(`ElevenLabs API error: ${errorMessage}. Please verify your ELEVENLABS_API_KEY is valid.`);
      }

      // Filter out disabled/unusable voices
      let filteredVoices = response.data.voices.filter((voice) => {
        if (!isVoiceUsable(voice)) {
          console.log(
            `[ElevenLabs] Filtering unusable voice: ${voice.name} (${voice.voice_id}), status=${voice.sharing?.status ?? 'unknown'}`,
          );
          return false;
        }
        return true;
      });

      // Filter by language if specified
      if (options?.language) {
        const languageCode = this.mapLanguageToCode(options.language);
        if (languageCode) {
          filteredVoices = filteredVoices.filter((voice) =>
            this.voiceSupportsLanguage(voice, languageCode),
          );
        }
      }

      return {
        ...response.data,
        voices: filteredVoices,
      };
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
   * Generate speech with character-level timestamp information
   * Useful for captions and audio-text synchronization
   */
  async generateSpeechWithTimestamps(request: GenerateSpeechRequest): Promise<{
    audio: Buffer;
    alignment: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
    normalized_alignment?: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
  }> {
    try {
      const {
        voice_id,
        text,
        model_id = 'eleven_multilingual_v2',
        output_format = 'mp3_44100_128',
        voice_settings,
      } = request;

      console.log(`[ElevenLabs] Generating speech with timestamps for ${text.length} chars`);

      const response = await this.axiosInstance.post(
        `/v1/text-to-speech/${voice_id}/with-timestamps`,
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
        }
      );

      if (response.status >= 400) {
        const errorDetail =
          response.data?.detail?.message ||
          response.data?.message ||
          `HTTP ${response.status}`;
        console.error('[ElevenLabs] TTS with-timestamps failed:', response.data);
        throw new Error(`ElevenLabs speech generation failed: ${errorDetail}`);
      }

      // Response contains audio_base64 and alignment data
      const { audio_base64, alignment, normalized_alignment } = response.data;

      if (!audio_base64) {
        throw new Error('No audio data received from ElevenLabs with-timestamps endpoint');
      }

      const audio = Buffer.from(audio_base64, 'base64');

      console.log(`[ElevenLabs] Generated speech with timestamps: ${audio.length} bytes, ${alignment?.characters?.length || 0} characters aligned`);

      return {
        audio,
        alignment: alignment || { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] },
        normalized_alignment,
      };
    } catch (error: any) {
      if (error.response) {
        const errorMessage = error.response.data?.detail?.message || error.response.statusText;
        throw new Error(`ElevenLabs speech with timestamps failed: ${error.response.status} - ${errorMessage}`);
      }
      throw new Error(`Failed to generate speech with timestamps: ${error.message}`);
    }
  }

  /**
   * Convert character-level timestamps to word-level timestamps
   * Groups characters by spaces to form words
   */
  convertCharacterTimestampsToWords(
    text: string,
    alignment: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    }
  ): Array<{ word: string; startTime: number; endTime: number }> {
    const words: Array<{ word: string; startTime: number; endTime: number }> = [];
    
    if (!alignment.characters || alignment.characters.length === 0) {
      return words;
    }

    let currentWord = '';
    let wordStartTime = 0;
    let wordEndTime = 0;

    for (let i = 0; i < alignment.characters.length; i++) {
      const char = alignment.characters[i];
      const startTime = alignment.character_start_times_seconds[i];
      const endTime = alignment.character_end_times_seconds[i];

      if (char === ' ' || char === '\n') {
        // End of word
        if (currentWord.length > 0) {
          words.push({
            word: currentWord,
            startTime: wordStartTime,
            endTime: wordEndTime,
          });
          currentWord = '';
        }
      } else {
        // Add character to current word
        if (currentWord.length === 0) {
          wordStartTime = startTime;
        }
        currentWord += char;
        wordEndTime = endTime;
      }
    }

    // Don't forget the last word
    if (currentWord.length > 0) {
      words.push({
        word: currentWord,
        startTime: wordStartTime,
        endTime: wordEndTime,
      });
    }

    console.log(`[ElevenLabs] Converted ${alignment.characters.length} characters to ${words.length} words`);

    return words;
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

  /**
   * Convert speech from one voice to another using ElevenLabs Speech-to-Speech API.
   * Maintains emotion, timing and delivery from the original audio.
   * 
   * @param audioBuffer The audio buffer to transform
   * @param voiceId The target voice ID to transform into
   * @param options Optional settings for the transformation
   * @returns The transformed audio buffer
   */
  async convertSpeechToSpeech(
    audioBuffer: Buffer,
    voiceId: string,
    options?: {
      modelId?: string;
      outputFormat?: string;
      voiceSettings?: {
        stability?: number;
        similarity_boost?: number;
        style?: number;
        use_speaker_boost?: boolean;
      };
      removeBackgroundNoise?: boolean;
      /** Integer 0-4294967295 for deterministic sampling across scenes */
      seed?: number;
    }
  ): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key is not configured');
    }

    const modelId = options?.modelId || 'eleven_multilingual_sts_v2';
    const outputFormat = options?.outputFormat || 'mp3_44100_128';

    console.log(`[ElevenLabsProvider] Converting speech to speech with voice ${voiceId}, model ${modelId}`);

    try {
      const FormData = require('form-data');
      const formData = new FormData();

      // Add the audio file
      formData.append('audio', audioBuffer, {
        filename: 'input.mp3',
        contentType: 'audio/mpeg',
      });

      // Add model ID
      formData.append('model_id', modelId);

      // Add voice settings if provided
      if (options?.voiceSettings) {
        formData.append('voice_settings', JSON.stringify(options.voiceSettings));
      }

      // Add background noise removal option
      if (options?.removeBackgroundNoise !== undefined) {
        formData.append('remove_background_noise', options.removeBackgroundNoise.toString());
      }

      // Add seed for deterministic sampling (consistent voice across scenes)
      if (options?.seed != null && Number.isInteger(options.seed) && options.seed >= 0 && options.seed <= 4294967295) {
        formData.append('seed', options.seed.toString());
      }

      const response = await this.axiosInstance.post(
        `/v1/speech-to-speech/${voiceId}`,
        formData,
        {
          params: {
            output_format: outputFormat,
          },
          headers: {
            ...formData.getHeaders(),
            'xi-api-key': this.apiKey,
          },
          responseType: 'arraybuffer',
          timeout: 120000, // 2 minute timeout for speech-to-speech
        }
      );

      const transformedBuffer = Buffer.from(response.data);
      
      // Validate response - ElevenLabs returns JSON error in arraybuffer on failure
      // Valid audio should be at least 1KB, and errors are typically small JSON responses
      const MIN_VALID_AUDIO_SIZE = 1000; // 1KB minimum for valid audio
      
      if (transformedBuffer.length < MIN_VALID_AUDIO_SIZE) {
        // Try to parse as JSON error response
        try {
          const errorText = transformedBuffer.toString('utf-8');
          const errorJson = JSON.parse(errorText);
          const errorMessage = errorJson?.detail?.message || errorJson?.message || errorJson?.error || 'Unknown API error';
          console.error(`[ElevenLabsProvider] Speech-to-speech returned error response (${transformedBuffer.length} bytes):`, errorText);
          throw new Error(`ElevenLabs API error: ${errorMessage}`);
        } catch (parseError) {
          // If not JSON, it might be a truncated/corrupt response
          console.error(`[ElevenLabsProvider] Speech-to-speech returned invalid audio (${transformedBuffer.length} bytes, too small)`);
          throw new Error(`ElevenLabs returned invalid audio data (${transformedBuffer.length} bytes). The response may be corrupted or the API returned an error.`);
        }
      }
      
      // Validate content type if available
      const contentType = response.headers['content-type'];
      if (contentType && !contentType.includes('audio/') && !contentType.includes('application/octet-stream')) {
        console.warn(`[ElevenLabsProvider] Unexpected content-type: ${contentType}, expected audio/* or application/octet-stream`);
        // Don't throw, just warn - the size check above is more reliable
      }

      console.log(`[ElevenLabsProvider] Speech-to-speech conversion successful, received ${transformedBuffer.length} bytes`);
      return transformedBuffer;
    } catch (error: any) {
      console.error(`[ElevenLabsProvider] Speech-to-speech conversion failed:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
      });

      if (error.response) {
        if (error.response.status === 401) {
          throw new Error('Invalid ElevenLabs API key for speech-to-speech.');
        }
        if (error.response.status === 422) {
          const errorMessage = error.response.data?.detail?.message 
            || 'Invalid audio data for speech-to-speech conversion.';
          throw new Error(`Speech-to-speech validation failed: ${errorMessage}`);
        }
        if (error.response.status === 429) {
          throw new Error('ElevenLabs API rate limit exceeded. Please try again later.');
        }
        throw new Error(`Speech-to-speech conversion failed: ${error.response.status} - ${error.response.statusText}`);
      }

      if (error.code === 'ECONNABORTED') {
        throw new Error('Speech-to-speech request timed out. Please try with a shorter audio file.');
      }

      throw new Error(`Failed to convert speech: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Get voices that support speech-to-speech conversion.
   * Filters the voice list to only include voices with can_do_voice_conversion capability.
   * 
   * @param options Optional filters
   * @returns List of voices that support STS
   */
  async getSpeechToSpeechVoices(options?: {
    search?: string;
    language?: 'english' | 'hindi' | 'hinglish';
    pageSize?: number;
  }): Promise<ElevenLabsVoice[]> {
    // Get all voices first
    const response = await this.listVoices(options);
    
    // For now, return all voices since ElevenLabs STS works with most voices
    // In the future, we can filter by can_do_voice_conversion if the API provides this
    console.log(`[ElevenLabsProvider] Returning ${response.voices.length} voices for speech-to-speech`);
    return response.voices;
  }

  /**
   * Transcribe audio to text using ElevenLabs Speech-to-Text API.
   * Uses the Scribe model for accurate transcription.
   * 
   * @param audioBuffer The audio buffer to transcribe
   * @param options Optional settings for transcription
   * @returns Object containing the transcribed text and detected language
   */
  async transcribeSpeech(
    audioBuffer: Buffer,
    options?: {
      languageCode?: string;
      modelId?: 'scribe_v1' | 'scribe_v2';
    }
  ): Promise<{ text: string; languageCode: string }> {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key is not configured');
    }

    const modelId = options?.modelId || 'scribe_v2';

    console.log(`[ElevenLabsProvider] Transcribing speech with model ${modelId}`);

    try {
      const FormData = require('form-data');
      const formData = new FormData();

      // Add the audio file
      formData.append('file', audioBuffer, {
        filename: 'audio.webm',
        contentType: 'audio/webm',
      });

      // Add model ID
      formData.append('model_id', modelId);

      // Add language code if provided (optional - helps with accuracy)
      if (options?.languageCode) {
        formData.append('language_code', options.languageCode);
      }

      const response = await this.axiosInstance.post(
        '/v1/speech-to-text',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'xi-api-key': this.apiKey,
          },
          timeout: 60000, // 1 minute timeout for transcription
        }
      );

      if (!response.data) {
        throw new Error('ElevenLabs API returned empty response');
      }

      // Handle error responses
      if (response.status >= 400) {
        const errorMessage = response.data?.detail?.message 
          || response.data?.message 
          || 'Unknown transcription error';
        throw new Error(`ElevenLabs transcription failed: ${errorMessage}`);
      }

      const { text, language_code } = response.data;

      console.log(`[ElevenLabsProvider] Transcription successful, detected language: ${language_code}, text length: ${text?.length || 0}`);

      return {
        text: text || '',
        languageCode: language_code || 'unknown',
      };
    } catch (error: any) {
      console.error(`[ElevenLabsProvider] Speech-to-text conversion failed:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
      });

      if (error.response) {
        if (error.response.status === 401) {
          throw new Error('Invalid ElevenLabs API key for speech-to-text.');
        }
        if (error.response.status === 422) {
          const errorMessage = error.response.data?.detail?.message 
            || 'Invalid audio data for transcription.';
          throw new Error(`Transcription validation failed: ${errorMessage}`);
        }
        if (error.response.status === 429) {
          throw new Error('ElevenLabs API rate limit exceeded. Please try again later.');
        }
        throw new Error(`Transcription failed: ${error.response.status} - ${error.response.statusText}`);
      }

      if (error.code === 'ECONNABORTED') {
        throw new Error('Transcription request timed out. Please try with a shorter audio file.');
      }

      throw new Error(`Failed to transcribe speech: ${error.message || 'Unknown error'}`);
    }
  }
}
