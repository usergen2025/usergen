/**
 * API Client for UserGen.ai Backend
 * Handles all HTTP requests to the backend services using Axios
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
const AUTH_SERVICE_URL = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || 'http://localhost:9000/api';
const VIDEO_SERVICE_URL = process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004/api';
const AI_CONTENT_SERVICE_URL = process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL || 'http://localhost:9001/api';
const VOICE_SERVICE_URL = process.env.NEXT_PUBLIC_VOICE_SERVICE_URL || 'http://localhost:9002/api';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  statusCode?: number;
  timestamp?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  mobile?: string;
  role: string;
  credits: number;
  isEmailVerified?: boolean;
  isMobileVerified?: boolean;
  createdAt?: string;
}

class ApiClient {
  private axiosInstance: AxiosInstance;

  constructor(baseURL: string = API_BASE_URL) {
    this.axiosInstance = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to include auth token
    this.axiosInstance.interceptors.request.use(
      (config) => {
        const token = this.getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => {
        return response;
      },
      (error: AxiosError<ApiResponse>) => {
        // Handle 401: emit event for auth expiry overlay (do not redirect; let global handler react)
        if (error.response?.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
        // Handle axios errors
        if (error.response) {
          // Server responded with error status
          const errorData = error.response.data;
          const errorMessage = errorData?.message || errorData?.error || `HTTP ${error.response.status}`;
          // Create a custom error that preserves response status
          const customError: any = new Error(errorMessage);
          customError.response = error.response;
          customError.status = error.response.status;
          throw customError;
        } else if (error.request) {
          // Request was made but no response received
          throw new Error('Network error: No response from server');
        } else {
          // Something happened in setting up the request
          throw new Error(error.message || 'An error occurred');
        }
      }
    );
  }

  private async request<T>(
    endpoint: string,
    config: AxiosRequestConfig = {}
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.axiosInstance.request<ApiResponse<T>>({
        url: endpoint,
        ...config,
      });

      return response.data;
    } catch (error: any) {
      // Error is already handled by interceptor, but rethrow if needed
      throw error;
    }
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
  }

  // Auth endpoints
  async register(data: {
    name: string;
    email: string;
    mobile?: string;
    password?: string;
  }): Promise<ApiResponse<{ user: User; tokens: AuthTokens }>> {
    // For OTP-based registration, we don't need password
    // But the endpoint might still require it, so we'll handle it differently
    return this.request('/auth/register', {
      method: 'POST',
      data,
    });
  }

  async login(data: { email: string; password: string }): Promise<ApiResponse<{ user: User; tokens: AuthTokens }>> {
    return this.request('/auth/login', {
      method: 'POST',
      data,
    });
  }

  async sendOtp(data: {
    email: string;
    mobile?: string;
    type: 'EMAIL_VERIFICATION' | 'MOBILE_VERIFICATION' | 'LOGIN' | 'PASSWORD_RESET';
  }): Promise<ApiResponse<null>> {
    return this.request('/auth/send-otp', {
      method: 'POST',
      data,
    });
  }

  async verifyOtp(data: {
    email: string;
    otp: string;
    type: 'EMAIL_VERIFICATION' | 'MOBILE_VERIFICATION' | 'LOGIN' | 'PASSWORD_RESET';
    name?: string;
    mobile?: string;
    brandName?: string;
    brandDescription?: string;
    brandLogo?: string;
    role?: string;
  }): Promise<ApiResponse<{ user?: User; tokens?: AuthTokens }>> {
    return this.request('/auth/verify-otp', {
      method: 'POST',
      data,
    });
  }

  async socialLogin(provider: 'google' | 'facebook'): Promise<void> {
    // Redirect to social login endpoint
    window.location.href = `${AUTH_SERVICE_URL}/auth/${provider}`;
  }

  async refreshToken(refreshToken: string): Promise<ApiResponse<{ tokens: AuthTokens }>> {
    return this.request('/auth/refresh', {
      method: 'POST',
      data: { refreshToken },
    });
  }

  async logout(refreshToken: string): Promise<ApiResponse<null>> {
    return this.request('/auth/logout', {
      method: 'POST',
      data: { refreshToken },
    });
  }

  async getProfile(): Promise<ApiResponse<User>> {
    return this.request('/auth/profile', {
      method: 'GET',
    });
  }

  // Avatar endpoints
  async uploadAvatarImage(file: File): Promise<ApiResponse<{ imageKey: string; assetId: string; localUrl?: string }>> {
    const formData = new FormData();
    formData.append('file', file);

    // Use environment variable for service URL
    const avatarServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ imageKey: string; assetId: string; localUrl?: string }>>(
      `${avatarServiceUrl}/avatars/upload`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async createAvatarFromUpload(data: {
    imageKey: string;
    assetId?: string;
    name?: string;
    description?: string;
    userId?: string;
    originalImageUrl?: string;
  }): Promise<ApiResponse<{ avatarId: string; jobId: string }>> {
    const avatarServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ avatarId: string; jobId: string }>>(
      `${avatarServiceUrl}/avatars/create-from-upload`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getAvatarJobStatus(jobId: string, userId?: string): Promise<ApiResponse<any>> {
    const avatarServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any>>(
      `${avatarServiceUrl}/avatars/jobs/${jobId}/status${userId ? `?userId=${userId}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getUserAvatars(filters?: { source?: string; category?: string }): Promise<ApiResponse<any[]>> {
    const avatarServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();
    const params = new URLSearchParams();
    if (filters?.source) params.append('source', filters.source);
    if (filters?.category) params.append('category', filters.category);

    const response = await axios.get<ApiResponse<any[]>>(
      `${avatarServiceUrl}/avatars${params.toString() ? `?${params.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getAvatar(avatarId: string): Promise<ApiResponse<any>> {
    const avatarServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any>>(
      `${avatarServiceUrl}/avatars/${avatarId}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getLibraryAvatars(filters?: { category?: string; search?: string }): Promise<ApiResponse<any[]>> {
    const avatarServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();
    const params = new URLSearchParams();
    if (filters?.category) params.append('category', filters.category);
    if (filters?.search) params.append('search', filters.search);

    const response = await axios.get<ApiResponse<any[]>>(
      `${avatarServiceUrl}/avatars/library?${params.toString()}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async generateAvatarPreview(data: {
    projectId: string;
    avatarId: string;
    userId?: string;
    script: { avatar_image_prompt?: string; visual_style_guide?: any; scenes?: unknown[]; scene_plan?: unknown[] };
    style?: string;
    avatarVisualStylePreset?: string;
    productImageUrl?: string;
    previewSceneIndex?: number;
  }): Promise<ApiResponse<{ publicUrl: string; imageKey?: string }>> {
    const avatarServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ publicUrl: string; imageKey?: string }>>(
      `${avatarServiceUrl}/avatars/generate-preview`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async finalizeAvatarPreview(data: {
    avatarId: string;
    previewImageUrl: string;
  }): Promise<ApiResponse<{ imageKey: string }>> {
    const avatarServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ imageKey: string }>>(
      `${avatarServiceUrl}/avatars/finalize-preview`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async generateAvatarFromText(data: {
    prompt: string;
    projectId?: string;
    style?: string;
    avatarVisualStylePreset?: string | null;
    script?: { avatar_image_prompt?: string; visual_style_guide?: unknown };
  }): Promise<{
    success: boolean;
    avatarId?: string;
    thumbnailUrl?: string;
    avatarUrl?: string;
    originalImageUrl?: string;
    error?: string;
  }> {
    const avatarServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<{
      success: boolean;
      avatarId?: string;
      thumbnailUrl?: string;
      avatarUrl?: string;
      originalImageUrl?: string;
      error?: string;
    }>(
      `${avatarServiceUrl}/avatars/generate-from-text`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  // Video Project endpoints
  async createVideoProject(data: {
    videoType: 'WITH_AVATAR' | 'WITHOUT_AVATAR';
    style?: 'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT' | 'AVATAR_ONLY' | 'PRODUCT_ONLY' | 'AVATAR_PRODUCT' | 'ANIMATED_AVATAR' | 'B_ROLL_ONLY';
    [key: string]: any;
  }): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getVideoProjects(): Promise<ApiResponse<any[]>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any[]>>(
      `${videoServiceUrl}/video-projects`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getActiveVideoProject(): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/active`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getVideoProject(projectId: string): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${projectId}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async updateVideoProject(projectId: string, data: any): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    try {
      const response = await axios.put<ApiResponse<any>>(
        `${videoServiceUrl}/video-projects/${projectId}`,
        data,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );

      return response.data;
    } catch (error: any) {
      // Preserve error response structure for better error handling
      if (error.response) {
        throw {
          ...error,
          response: {
            ...error.response,
            status: error.response.status,
            data: error.response.data,
          },
        };
      }
      throw error;
    }
  }

  async updateVideoProjectStep(projectId: string, step: string, updateData?: any): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.put<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${projectId}/step`,
      {
        step,
        updateData,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async updateSceneBroll(projectId: string, sceneNumber: number, data: {
    brollUrl: string;
    brollType: 'image' | 'video';
    source: 'freepik' | 'upload';
  }): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    try {
      const response = await axios.put<ApiResponse<any>>(
        `${videoServiceUrl}/video-projects/${projectId}/scenes/${sceneNumber}/broll`,
        data,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );

      return response.data;
    } catch (error: any) {
      console.error(`Failed to update scene ${sceneNumber} B-roll:`, error);
      if (error.response) {
        throw {
          ...error,
          response: {
            ...error.response,
            status: error.response.status,
            data: error.response.data,
          },
        };
      }
      throw error;
    }
  }

  async deleteVideoProject(projectId: string): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.delete<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${projectId}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async startVideoRendering(projectId: string): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${projectId}/start-rendering`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getRenderingStatus(projectId: string): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${projectId}/rendering-status`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  // Script generation endpoints
  async uploadProductImage(file: File): Promise<ApiResponse<{ publicUrl: string; localUrl: string }>> {
    const aiContentServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const formData = new FormData();
    formData.append('file', file);

    const response = await axios.post<ApiResponse<{ publicUrl: string; localUrl: string }>>(
      `${aiContentServiceUrl}/scripts/upload-product-image`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async generateVideoScript(data: {
    userPrompt: string;
    videoStyle: 'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT' | 'AVATAR_ONLY' | 'PRODUCT_ONLY' | 'AVATAR_PRODUCT' | 'ANIMATED_AVATAR';
    duration?: string;
    language?: 'english' | 'hindi' | 'hinglish';
    tags?: string[];
    projectId?: string;
    productImageUrl?: string;
    hasAvatar?: boolean;
    avatarId?: string;
  }): Promise<ApiResponse<any>> {
    const aiContentServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${aiContentServiceUrl}/scripts/generate-video-script`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async regenerateScene(data: {
    sceneNumber: number;
    videoStyle: 'HALF_N_HALF' | 'ALTERNATE' | 'AVATAR_CUTOUT';
    existingScript: any;
    originalUserPrompt: string;
    operation: 'regenerate' | 'edit';
    newVoiceover?: string;
    language?: 'english' | 'hindi' | 'hinglish';
  }): Promise<ApiResponse<{ scene: any; tokensUsed: number; processingTime: number; model: string }>> {
    const aiContentServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ scene: any; tokensUsed: number; processingTime: number; model: string }>>(
      `${aiContentServiceUrl}/scripts/regenerate-scene`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  // Voice/Audio endpoints
  async getElevenLabsVoices(
    search?: string, 
    category?: string,
    language?: 'english' | 'hindi' | 'hinglish'
  ): Promise<ApiResponse<any[]>> {
    const voiceServiceUrl = VOICE_SERVICE_URL;
    const token = this.getToken();
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (category) params.append('category', category);
    if (language) params.append('language', language);
    params.append('pageSize', '100');

    const response = await axios.get<ApiResponse<any[]>>(
      `${voiceServiceUrl}/voice/voices${params.toString() ? `?${params.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async cloneVoice(data: {
    name: string;
    audioFile: File;
    description?: string;
    labels?: string;
    removeBackgroundNoise?: boolean;
  }): Promise<ApiResponse<{ voiceId: string; requiresVerification: boolean }>> {
    const voiceServiceUrl = VOICE_SERVICE_URL;
    const token = this.getToken();

    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('audioFile', data.audioFile);
    if (data.description) {
      formData.append('description', data.description);
    }
    if (data.labels) {
      formData.append('labels', data.labels);
    }
    if (data.removeBackgroundNoise !== undefined) {
      formData.append('removeBackgroundNoise', String(data.removeBackgroundNoise));
    }

    const response = await axios.post<ApiResponse<{ voiceId: string; requiresVerification: boolean }>>(
      `${voiceServiceUrl}/voice/clone`,
      formData,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // DO NOT set Content-Type - browser will set it automatically with boundary
        },
      }
    );

    return response.data;
  }

  async generateScriptAudio(data: {
    voiceId: string;
    scenes: Array<{ sceneNumber: number; voiceover: string; timeRange?: string }>;
    userId?: string;
    projectId: string;
    model_id?: string;
    output_format?: string;
    language?: 'english' | 'hindi' | 'hinglish';
  }): Promise<ApiResponse<any[]>> {
    const voiceServiceUrl = VOICE_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any[]>>(
      `${voiceServiceUrl}/voice/generate-script-audio`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async processManualAudio(projectId: string): Promise<ApiResponse<{ audioFiles: any[] }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ audioFiles: any[] }>>(
      `${videoServiceUrl}/video-projects/${projectId}/process-manual-audio`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async uploadManualSceneAudio(data: {
    projectId: string;
    sceneNumber: number;
    file: File;
    duration?: number;
    voiceover?: string;
  }): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const formData = new FormData();
    formData.append('file', data.file);
    formData.append('sceneNumber', String(data.sceneNumber));
    if (data.duration !== undefined) {
      formData.append('duration', String(data.duration));
    }
    if (data.voiceover) {
      formData.append('voiceover', data.voiceover);
    }

    const response = await axios.post<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${data.projectId}/manual-audio/${data.sceneNumber}`,
      formData,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // Let the browser set multipart boundary
        },
      }
    );

    return response.data;
  }

  // Queue operations
  async generateAudio(projectId: string): Promise<ApiResponse<{ jobId?: string; existing?: boolean; audioFiles?: any[] }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ jobId: string }>>(
      `${videoServiceUrl}/video-projects/${projectId}/generate-audio`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async regenerateImage(
    projectId: string, 
    sceneNumber: number, 
    prompt?: string,
    modelId?: string,
    aspectRatio?: string,
    resolution?: string,
    productImageUrl?: string,
    videoStyle?: string,
    force?: boolean
  ): Promise<ApiResponse<{ jobId: string; existing?: boolean; image?: any }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ jobId: string; existing?: boolean; image?: any }>>(
      `${videoServiceUrl}/video-projects/${projectId}/regenerate-image/${sceneNumber}`,
      { prompt, modelId, aspectRatio, resolution, productImageUrl, videoStyle, force },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getImageGenerationModels(): Promise<ApiResponse<{
    models: Array<{
      id: string;
      displayName: string;
      platform: string;
      defaultConfig: any;
      capabilities: any;
    }>;
    default: string;
  }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<{
      models: Array<{
        id: string;
        displayName: string;
        platform: string;
        defaultConfig: any;
        capabilities: any;
      }>;
      default: string;
    }>>(
      `${videoServiceUrl}/video-projects/image-generation-models`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getVideoGenerationModels(): Promise<ApiResponse<{
    models: Array<{
      id: string;
      displayName: string;
      platform: string;
      defaultConfig: any;
      capabilities: any;
    }>;
    default: string;
  }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<{
      models: Array<{
        id: string;
        displayName: string;
        platform: string;
        defaultConfig: any;
        capabilities: any;
      }>;
      default: string;
    }>>(
      `${videoServiceUrl}/video-projects/video-generation-models`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async convertToVideos(
    projectId: string,
    options?: { forceRegenerate?: boolean }
  ): Promise<ApiResponse<{ jobs: { sceneNumber: number; jobId: string; type: 'broll' | 'scene' }[] }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post(
      `${videoServiceUrl}/video-projects/${projectId}/convert-to-videos`,
      options || {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async retryAvatar(
    projectId: string,
    sceneNumber: number
  ): Promise<ApiResponse<{ jobId: string; type?: 'scene' }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post(
      `${videoServiceUrl}/video-projects/${projectId}/retry-avatar/${sceneNumber}`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async regenerateVideo(
    projectId: string, 
    sceneNumber: number, 
    modelId?: string,
    force: boolean = false
  ): Promise<ApiResponse<{ jobId: string; type?: 'scene'; existing?: boolean; video?: any }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ jobId: string; existing?: boolean; video?: any }>>(
      `${videoServiceUrl}/video-projects/${projectId}/regenerate-video/${sceneNumber}`,
      { modelId, force },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getQueueJobStatus(jobId: string, queueType: 'audio-generation' | 'image-generation' | 'video-generation' | 'scene-composite'): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/queue-status/${jobId}?queueType=${queueType}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  // Campaign endpoints (will connect to campaign service once backend is ready)
  async getCampaigns(params?: { status?: string; page?: number; limit?: number }): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = process.env.NEXT_PUBLIC_CAMPAIGN_SERVICE_URL || 'http://localhost:9011/api';
    const token = this.getToken();
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());

    const response = await axios.get<ApiResponse<any[]>>(
      `${campaignServiceUrl}/campaigns${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getCampaign(campaignId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = process.env.NEXT_PUBLIC_CAMPAIGN_SERVICE_URL || 'http://localhost:9011/api';
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any>>(
      `${campaignServiceUrl}/campaigns/${campaignId}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async createCampaign(data: {
    name: string;
    description: string;
    brandAssetsUrl?: string;
    deadlineToApply: string;
    startDate: string;
    endDate: string;
    payoutRate: number;
    totalBudget: number;
  }): Promise<ApiResponse<any>> {
    const campaignServiceUrl = process.env.NEXT_PUBLIC_CAMPAIGN_SERVICE_URL || 'http://localhost:9011/api';
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${campaignServiceUrl}/campaigns`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async updateCampaign(campaignId: string, data: Partial<{
    name: string;
    description: string;
    brandAssetsUrl: string;
    deadlineToApply: string;
    startDate: string;
    endDate: string;
    payoutRate: number;
    totalBudget: number;
  }>): Promise<ApiResponse<any>> {
    const campaignServiceUrl = process.env.NEXT_PUBLIC_CAMPAIGN_SERVICE_URL || 'http://localhost:9011/api';
    const token = this.getToken();

    const response = await axios.put<ApiResponse<any>>(
      `${campaignServiceUrl}/campaigns/${campaignId}`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async pauseCampaign(campaignId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = process.env.NEXT_PUBLIC_CAMPAIGN_SERVICE_URL || 'http://localhost:9011/api';
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${campaignServiceUrl}/campaigns/${campaignId}/pause`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getCampaignApplicants(campaignId: string, params?: { status?: string }): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = process.env.NEXT_PUBLIC_CAMPAIGN_SERVICE_URL || 'http://localhost:9011/api';
    const token = this.getToken();
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);

    const response = await axios.get<ApiResponse<any[]>>(
      `${campaignServiceUrl}/campaigns/${campaignId}/applicants${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async shortlistApplicant(campaignId: string, applicantId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = process.env.NEXT_PUBLIC_CAMPAIGN_SERVICE_URL || 'http://localhost:9011/api';
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${campaignServiceUrl}/campaigns/${campaignId}/applicants/${applicantId}/shortlist`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getBrandDashboardStats(params?: { dateRange?: string }): Promise<ApiResponse<any>> {
    const campaignServiceUrl = process.env.NEXT_PUBLIC_CAMPAIGN_SERVICE_URL || 'http://localhost:9011/api';
    const token = this.getToken();
    const queryParams = new URLSearchParams();
    if (params?.dateRange) queryParams.append('dateRange', params.dateRange);

    const response = await axios.get<ApiResponse<any>>(
      `${campaignServiceUrl}/brands/dashboard/stats${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  // Speech-to-Speech (Voice Transformation) API methods
  
  /**
   * Get voices that support speech-to-speech conversion
   */
  async getSpeechToSpeechVoices(options?: {
    search?: string;
    language?: 'english' | 'hindi' | 'hinglish';
  }): Promise<ApiResponse<any[]>> {
    const voiceServiceUrl = VOICE_SERVICE_URL;
    const token = this.getToken();
    const queryParams = new URLSearchParams();
    if (options?.search) queryParams.append('search', options.search);
    if (options?.language) queryParams.append('language', options.language);

    const response = await axios.get<ApiResponse<any[]>>(
      `${voiceServiceUrl}/voice/speech-to-speech/voices${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  /**
   * Transform a single scene's audio using speech-to-speech
   */
  async transformSceneAudio(
    projectId: string,
    sceneNumber: number,
    voiceId: string,
    settings: {
      stability?: number;
      similarityBoost?: number;
      style?: number;
      useSpeakerBoost?: boolean;
      removeBackgroundNoise?: boolean;
    }
  ): Promise<ApiResponse<{
    sceneNumber: number;
    originalUrl: string;
    transformedUrl: string;
    duration: number;
  }>> {
    const voiceServiceUrl = VOICE_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{
      sceneNumber: number;
      originalUrl: string;
      transformedUrl: string;
      duration: number;
    }>>(
      `${voiceServiceUrl}/voice/speech-to-speech`,
      {
        projectId,
        sceneNumber,
        voiceId,
        settings,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  /**
   * Transform all scenes' audio using speech-to-speech with global settings
   */
  async transformAllSceneAudio(
    projectId: string,
    voiceId: string,
    settings: {
      stability?: number;
      similarityBoost?: number;
      style?: number;
      useSpeakerBoost?: boolean;
      removeBackgroundNoise?: boolean;
    },
    sceneNumbers?: number[]
  ): Promise<ApiResponse<{
    results: Array<{
      sceneNumber: number;
      status: 'success' | 'error';
      originalUrl?: string;
      transformedUrl?: string;
      duration?: number;
      error?: string;
    }>;
  }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{
      results: Array<{
        sceneNumber: number;
        status: 'success' | 'error';
        originalUrl?: string;
        transformedUrl?: string;
        duration?: number;
        error?: string;
      }>;
    }>>(
      `${videoServiceUrl}/video-projects/${projectId}/transform-voice`,
      {
        voiceId,
        settings,
        sceneNumbers,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  /**
   * Transcribe audio to text using ElevenLabs Speech-to-Text API
   */
  async transcribeSpeech(audioBlob: Blob, languageCode?: string): Promise<ApiResponse<{
    text: string;
    languageCode: string;
  }>> {
    const voiceServiceUrl = VOICE_SERVICE_URL;
    const token = this.getToken();

    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');
    if (languageCode) {
      formData.append('languageCode', languageCode);
    }

    const response = await axios.post<ApiResponse<{
      text: string;
      languageCode: string;
    }>>(
      `${voiceServiceUrl}/voice/speech-to-text`,
      formData,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  /**
   * Set audio preference for video rendering (original vs transformed)
   */
  async setAudioPreference(
    projectId: string,
    useTransformed: boolean,
    sceneNumbers?: number[]
  ): Promise<ApiResponse<{
    audioFiles: any[];
  }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{
      audioFiles: any[];
    }>>(
      `${videoServiceUrl}/video-projects/${projectId}/set-audio-preference`,
      {
        useTransformed,
        sceneNumbers,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }
}

// Global 401 handler for direct axios calls (e.g. uploadAvatarImage, createAvatarFromUpload)
axios.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiResponse>) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    }
    return Promise.reject(error);
  }
);

export const apiClient = new ApiClient();

