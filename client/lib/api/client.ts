/**
 * API Client for UserGen.ai Backend
 * Handles all HTTP requests to the backend services using Axios
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { getCampaignServiceApiRoot } from '@/lib/campaign-media';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
const AUTH_SERVICE_URL = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || 'http://localhost:9000/api';
const VIDEO_SERVICE_URL = process.env.NEXT_PUBLIC_VIDEO_SERVICE_URL || 'http://localhost:9004/api';
/** In-app bell notifications (notification-service, port 9006) */
const NOTIFICATION_SERVICE_URL =
  process.env.NEXT_PUBLIC_NOTIFICATION_SERVICE_URL || 'http://localhost:9006/api';
const AI_CONTENT_SERVICE_URL = process.env.NEXT_PUBLIC_AI_CONTENT_SERVICE_URL || 'http://localhost:9001/api';
const VOICE_SERVICE_URL = process.env.NEXT_PUBLIC_VOICE_SERVICE_URL || 'http://localhost:9002/api';
const PAYMENT_SERVICE_URL = process.env.NEXT_PUBLIC_PAYMENT_SERVICE_URL || 'http://localhost:9005/api';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  statusCode?: number;
  timestamp?: string;
}

export interface BackgroundMusicSearchSeed {
  query?: string;
  genres?: string[];
  moods?: string[];
}

export interface BackgroundMusicConfig {
  enabled: boolean;
  source?: 'magnific' | 'upload' | 'heygen';
  externalId?: number;
  title?: string;
  artist?: string;
  durationSeconds?: number;
  /** Magnific preview URL for in-browser playback only (not used at export). */
  previewUrl?: string;
  publicUrl?: string;
  gcsUrl?: string;
  searchSeed?: BackgroundMusicSearchSeed;
  mixVolume?: number;
  voiceDuckTo?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  // HeyGen-specific fields
  /** HeyGen track ID (used for verification when re-fetching at export time) */
  heygenTrackId?: string;
  /** HeyGen track name */
  heygenTrackName?: string;
  /** HeyGen track duration in seconds */
  heygenTrackDuration?: number;
  /** HeyGen semantic similarity score (0-1) */
  heygenTrackScore?: number;
}

/**
 * campaign-service often returns raw JSON (arrays, DTOs) without an ApiResponse envelope.
 * Brand and admin UIs expect `response.data` — normalize so all campaign-service calls are consistent.
 */
function normalizeCampaignServiceResponse<T>(body: unknown): ApiResponse<T> {
  if (body === null || body === undefined) {
    return { success: false, error: 'Empty response' };
  }
  if (typeof body === 'object' && !Array.isArray(body) && 'success' in (body as object)) {
    if ('data' in (body as object)) {
      return body as ApiResponse<T>;
    }
  }
  return { success: true, data: body as T };
}

function extractCampaignAssetId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.assetId === 'string' && record.assetId.trim()) return record.assetId;
  if (typeof record.id === 'string' && record.id.trim()) return record.id;
  if (record.data && typeof record.data === 'object') {
    return extractCampaignAssetId(record.data);
  }
  if (record.asset && typeof record.asset === 'object') {
    return extractCampaignAssetId(record.asset);
  }
  return undefined;
}

function normalizeCampaignAssetResponse(body: unknown): ApiResponse<{ assetId: string }> {
  const normalized = normalizeCampaignServiceResponse<unknown>(body);
  const assetId = extractCampaignAssetId(normalized.data) ?? extractCampaignAssetId(body);
  if (assetId) {
    return { success: true, data: { assetId } };
  }
  // Brand upload returns `{ url: ".../api/uploads/campaign-assets/..." }` — easy to mistake for creator draft upload.
  const raw = normalized.data ?? body;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const url = (raw as Record<string, unknown>).url;
    if (typeof url === 'string' && url.includes('/campaign-assets/')) {
      return {
        success: false,
        error:
          'Unexpected response: got a brand campaign-asset URL instead of a creator draft id. Use POST /campaigns/drafts/upload on campaign-service (creator flow).',
      };
    }
  }
  return {
    success: false,
    error: normalized.error || 'Campaign media asset id missing from response',
  };
}

function logCampaignDraftAxiosError(context: string, error: unknown): void {
  if (process.env.NODE_ENV !== 'development') return;
  if (!axios.isAxiosError(error)) return;
  console.warn(`[apiClient] ${context}`, {
    status: error.response?.status,
    url: error.config?.url,
    data: error.response?.data,
  });
}

function throwCampaignDraftHttpError(context: string, error: unknown): never {
  logCampaignDraftAxiosError(context, error);
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const url = String(error.config?.url ?? '');
    if (status === 404) {
      throw new Error(
        `${context}: endpoint returned 404. Confirm NEXT_PUBLIC_CAMPAIGN_SERVICE_URL targets campaign-service (e.g. http://localhost:9011 — /api is appended automatically). Request: ${url}`,
      );
    }
    const data = error.response?.data;
    let detail = '';
    if (typeof data === 'string') detail = data;
    else if (data && typeof data === 'object' && 'message' in data) {
      const m = (data as { message?: unknown }).message;
      detail = Array.isArray(m) ? m.map(String).join(', ') : typeof m === 'string' ? m : '';
    }
    throw new Error(detail || error.message || `${context} failed (HTTP ${status ?? '?'})`);
  }
  throw error instanceof Error ? error : new Error(String(error));
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
          const rawMessage = errorData?.message || errorData?.error || `HTTP ${error.response.status}`;
          const normalizedRaw = Array.isArray(rawMessage) ? rawMessage[0] : rawMessage;
          const errorMessage =
            typeof normalizedRaw === 'string' &&
            /insufficient|balance|required|wallet/i.test(normalizedRaw)
              ? 'Insufficient credits in your wallet. Please top up and try again.'
              : normalizedRaw;
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

  async loginWithPassword(email: string, password: string): Promise<ApiResponse<{ user: User; tokens: AuthTokens }>> {
    const response = await axios.post<ApiResponse<{ user: User; tokens: AuthTokens }>>(
      `${AUTH_SERVICE_URL}/auth/login`,
      { email, password }
    );
    return response.data;
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
  }): Promise<ApiResponse<{ publicUrl: string; imageKey?: string; originalImageUrl?: string }>> {
    const avatarServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ publicUrl: string; imageKey?: string; originalImageUrl?: string }>>(
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
    originalImageUrl?: string;
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
    language?: 'english' | 'hindi' | 'hinglish';
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

  async getVideoProjectsPaginated(params?: {
    limit?: number;
    cursor?: string | null;
    status?: 'all' | 'draft' | 'in-progress' | 'completed';
  }): Promise<ApiResponse<{ items: any[]; nextCursor: string | null; hasMore: boolean }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.status && params.status !== 'all') {
      const mappedStatus =
        params.status === 'in-progress'
          ? 'IN_PROGRESS'
          : params.status.toUpperCase();
      query.set('status', mappedStatus);
    }

    const response = await axios.get<ApiResponse<{ items: any[]; nextCursor: string | null; hasMore: boolean }>>(
      `${videoServiceUrl}/video-projects?${query.toString()}`,
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

  async getVideoProject(projectId: string): Promise<ApiResponse<any & { backgroundMusic?: BackgroundMusicConfig }>> {
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

  async updateVideoProject(
    projectId: string,
    data: any & { backgroundMusic?: BackgroundMusicConfig },
  ): Promise<ApiResponse<any>> {
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
    source: 'stock-image' | 'stock-video' | 'upload-image' | 'upload-video' | 'freepik' | 'upload';
    localPath?: string;
    gcsUrl?: string;
    videoPrompt?: string;
    skipConversion?: boolean;
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

  async startRawAvatarRendering(projectId: string): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${projectId}/start-raw-avatar-rendering`,
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

  async postProcessVideoExport(projectId: string): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${projectId}/post-process-export`,
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

  /** Resolve signed GCS, public GCS, or proxy download URL for clean final video. */
  async getVideoDownloadUrl(projectId: string): Promise<
    ApiResponse<{
      downloadUrl: string;
      filename: string;
      strategy: 'signed_gcs' | 'proxy_stream' | 'public_gcs';
      expiresInSeconds?: number;
    }>
  > {
    const token = this.getToken();
    const response = await axios.get<
      ApiResponse<{
        downloadUrl: string;
        filename: string;
        strategy: 'signed_gcs' | 'proxy_stream' | 'public_gcs';
        expiresInSeconds?: number;
      }>
    >(`/api/video/${projectId}/download-url`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return response.data;
  }

  /** Download clean final video (no preview watermark) via Next.js proxy. */
  async downloadVideoProject(projectId: string): Promise<Blob> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Please log in to download');
    }
    const response = await axios.get(`/api/video/${projectId}/download`, {
      responseType: 'blob',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      validateStatus: (status) => status < 500,
    });

    const contentType = String(response.headers['content-type'] || '');
    if (response.status !== 200) {
      if (contentType.includes('json') || contentType.includes('text')) {
        const text =
          response.data instanceof Blob
            ? await response.data.text()
            : String(response.data);
        try {
          const parsed = JSON.parse(text) as { message?: string };
          throw new Error(parsed.message || `Download failed (${response.status})`);
        } catch (e) {
          if (e instanceof Error && !e.message.startsWith('Download failed')) throw e;
          throw new Error(`Download failed (${response.status})`);
        }
      }
      throw new Error(`Download failed (${response.status})`);
    }

    const blob = response.data as Blob;
    if (!contentType.includes('video') && blob.size < 4096) {
      const text = await blob.text();
      try {
        const parsed = JSON.parse(text) as { message?: string };
        throw new Error(parsed.message || 'Download failed');
      } catch (e) {
        if (e instanceof Error && e.message !== 'Download failed') throw e;
        throw new Error('Download failed: unexpected response from server');
      }
    }

    return blob;
  }

  async regenerateVideoPreview(projectId: string): Promise<ApiResponse<{ message?: string }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();
    const response = await axios.post<ApiResponse<{ message?: string }>>(
      `${videoServiceUrl}/video-projects/${projectId}/regenerate-preview`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return response.data;
  }

  // Script generation endpoints
  async uploadProductImage(file: File): Promise<ApiResponse<{
    publicUrl: string;
    localUrl: string;
    localPath?: string;
    gcsUrl?: string;
    gcsUploaded?: boolean;
  }>> {
    const aiContentServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const formData = new FormData();
    formData.append('file', file);

    const response = await axios.post<ApiResponse<{
      publicUrl: string;
      localUrl: string;
      localPath?: string;
      gcsUrl?: string;
      gcsUploaded?: boolean;
    }>>(
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

  async registerStagedAsset(
    projectId: string,
    payload: {
      clientAssetId: string;
      category: string;
      publicUrl: string;
      localPath?: string;
      gcsPath?: string;
      mimeType?: string;
      assetType?: 'image' | 'url';
    },
  ): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${projectId}/staged-assets/register`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );

    return response.data;
  }

  async orphanStagedAssets(
    projectId: string,
    clientAssetIds: string[],
  ): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${projectId}/staged-assets/orphan`,
      { clientAssetIds },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );

    return response.data;
  }

  async commitStagedAssets(
    projectId: string,
    assets: Array<{
      clientAssetId: string;
      category: string;
      label?: string;
      type?: 'image' | 'url';
      url?: string;
    }>,
  ): Promise<ApiResponse<any>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<any>>(
      `${videoServiceUrl}/video-projects/${projectId}/staged-assets/commit`,
      { assets },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
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

  // B-roll image analysis for video prompt generation
  async analyzeBrollImage(imageUrl: string, sceneVoiceover: string): Promise<ApiResponse<{ videoPrompt: string }>> {
    const aiContentServiceUrl = AI_CONTENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ videoPrompt: string }>>(
      `${aiContentServiceUrl}/assets/analyze-broll-image`,
      { imageUrl, sceneVoiceover },
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

  async validateVoice(voiceId: string): Promise<ApiResponse<{
    usable: boolean;
    reason?: string;
    voiceName?: string;
  }>> {
    const voiceServiceUrl = VOICE_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<{
      usable: boolean;
      reason?: string;
      voiceName?: string;
    }>>(
      `${voiceServiceUrl}/voice/voices/${voiceId}/validate`,
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

  async startBrandPackaging(projectId: string): Promise<ApiResponse<{ jobId?: string; status: string }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ jobId?: string; status: string }>>(
      `${videoServiceUrl}/video-projects/${projectId}/brand-packaging/start`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );

    return response.data;
  }

  async repairBrandMetadata(
    projectId: string,
  ): Promise<
    ApiResponse<{
      assetsCount: number;
      hasLogo: boolean;
      assetAnalysisQueued: boolean;
      brandPackagingStatus?: string;
    }>
  > {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post(
      `${videoServiceUrl}/video-projects/${projectId}/repair-brand-metadata`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );

    return response.data;
  }

  async getBrandPackagingStatus(projectId: string): Promise<ApiResponse<{ brandPackaging: Record<string, unknown> }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<{ brandPackaging: Record<string, unknown> }>>(
      `${videoServiceUrl}/video-projects/${projectId}/brand-packaging/status`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );

    return response.data;
  }

  async queueStockDownloads(
    projectId: string, 
    scenes: Array<{ sceneNumber: number; searchTerm: string }>
  ): Promise<ApiResponse<{ jobIds: Array<{ sceneNumber: number; jobId: string }> }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<ApiResponse<{ jobIds: Array<{ sceneNumber: number; jobId: string }> }>>(
      `${videoServiceUrl}/video-projects/${projectId}/queue-stock-downloads`,
      { scenes },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async ensureProductAdPresenter(
    projectId: string,
  ): Promise<ApiResponse<{ skipped: boolean; reason?: string; ephemeralPresenter?: unknown }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.post<
      ApiResponse<{ skipped: boolean; reason?: string; ephemeralPresenter?: unknown }>
    >(
      `${videoServiceUrl}/video-projects/${projectId}/product-ad/ensure-presenter`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
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
  ): Promise<ApiResponse<{ jobId: string; type?: 'scene' | 'avatar' | 'broll'; existing?: boolean; video?: any }>> {
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

  async getTranslationLanguages(): Promise<ApiResponse<{ languages: string[] }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();
    const response = await axios.get<ApiResponse<{ languages: string[] }>>(
      `${videoServiceUrl}/video-projects/translation-languages`,
      { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
    );
    return response.data;
  }

  async getOperationCreditCost(operationType: string): Promise<ApiResponse<{ operationType: string; creditCost: number }>> {
    const paymentServiceUrl = PAYMENT_SERVICE_URL;
    const response = await axios.get<ApiResponse<{ operationType: string; creditCost: number }>>(
      `${paymentServiceUrl}/pricing/${encodeURIComponent(operationType)}/cost`,
    );
    return response.data;
  }

  async getVideoTranslations(projectId: string): Promise<ApiResponse<{ translations: any[] }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();
    const response = await axios.get<ApiResponse<{ translations: any[] }>>(
      `${videoServiceUrl}/video-projects/${projectId}/translations`,
      { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
    );
    return response.data;
  }

  async createVideoTranslations(
    projectId: string,
    languages: string[],
  ): Promise<ApiResponse<{ variants: any[]; jobs: { variantId: string; jobId: string; language: string }[] }>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();
    const response = await axios.post(
      `${videoServiceUrl}/video-projects/${projectId}/translations`,
      { languages },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return response.data;
  }

  async deleteVideoTranslation(projectId: string, variantId: string): Promise<ApiResponse<null>> {
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const token = this.getToken();
    const response = await axios.delete(
      `${videoServiceUrl}/video-projects/${projectId}/translations/${variantId}`,
      { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
    );
    return response.data;
  }

  /** Download clean final translated video (no preview watermark) via Next.js proxy. */
  async downloadVideoTranslation(projectId: string, variantId: string): Promise<Blob> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Please log in to download');
    }
    const response = await axios.get(
      `/api/video/${projectId}/translations/${variantId}/download`,
      {
        responseType: 'blob',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        validateStatus: (status) => status < 500,
      },
    );

    const contentType = String(response.headers['content-type'] || '');
    if (response.status !== 200) {
      if (contentType.includes('json') || contentType.includes('text')) {
        const text =
          response.data instanceof Blob
            ? await response.data.text()
            : String(response.data);
        try {
          const parsed = JSON.parse(text) as { message?: string };
          throw new Error(parsed.message || `Download failed (${response.status})`);
        } catch (e) {
          if (e instanceof Error && !e.message.startsWith('Download failed')) throw e;
          throw new Error(`Download failed (${response.status})`);
        }
      }
      throw new Error(`Download failed (${response.status})`);
    }

    const blob = response.data as Blob;
    if (!contentType.includes('video') && blob.size < 4096) {
      const text = await blob.text();
      try {
        const parsed = JSON.parse(text) as { message?: string };
        throw new Error(parsed.message || 'Download failed');
      } catch (e) {
        if (e instanceof Error && e.message !== 'Download failed') throw e;
        throw new Error('Download failed: unexpected response from server');
      }
    }

    return blob;
  }

  async getQueueJobStatus(jobId: string, queueType: 'audio-generation' | 'image-generation' | 'video-generation' | 'avatar-video-generation' | 'scene-composite' | 'stock-download' | 'brand-packaging' | 'video-translation'): Promise<ApiResponse<any>> {
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
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());

    const response = await axios.get(
      `${campaignServiceUrl}/campaigns${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async getCampaign(campaignId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.get(`${campaignServiceUrl}/campaigns/${campaignId}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async createCampaign(data: {
    name: string;
    description: string;
    brandAssetsUrl?: string;
    campaignType?: string;
    industry?: string;
    platformTarget?: string;
    regionFilter?: string;
    deadlineToApply: string;
    startDate: string;
    endDate: string;
    payoutRate?: number;
    totalBudget: number;
    payoutModel?: 'CPM' | 'POOL';
    prizePool?: {
      templateKey?: 'WINNER_HEAVY' | 'BALANCED' | 'WIDE_REACH' | 'CUSTOM';
      tiers?: Array<{ rankCutoff: number | null; bps: number; label?: string }>;
      bands?: Array<{ from: number; to: number; percentageBps: number; label?: string }>;
      tieBreaker?: string;
      minViewsToQualify?: number;
      gracePeriodHours?: number;
    };
    previewN?: number;
  }): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.post(`${campaignServiceUrl}/campaigns`, data, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async uploadCampaignBrandAsset(file: File): Promise<ApiResponse<{ url: string }>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);
    const response = await axios.post<{ url?: string } & Record<string, unknown>>(
      `${campaignServiceUrl}/campaigns/assets/upload`,
      formData,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<{ url: string }>(response.data);
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
    payoutModel: 'CPM' | 'POOL';
    prizePool: {
      templateKey?: 'WINNER_HEAVY' | 'BALANCED' | 'WIDE_REACH' | 'CUSTOM';
      tiers?: Array<{ rankCutoff: number | null; bps: number; label?: string }>;
      bands?: Array<{ from: number; to: number; percentageBps: number; label?: string }>;
      tieBreaker?: string;
      minViewsToQualify?: number;
      gracePeriodHours?: number;
    };
    previewN: number;
  }>): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.put(`${campaignServiceUrl}/campaigns/${campaignId}`, data, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async pauseCampaign(campaignId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/pause`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async resumeCampaign(campaignId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/resume`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async publishCampaign(campaignId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/publish`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getPendingApplicationsCount(
    campaignId: string,
  ): Promise<ApiResponse<{ count: number }>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(
      `${campaignServiceUrl}/campaigns/${campaignId}/pending-applications-count`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<{ count: number }>(response.data);
  }

  async startCampaign(
    campaignId: string,
    options?: { handlePendingAs?: 'REJECT_ALL' | 'KEEP_PENDING' },
  ): Promise<
    ApiResponse<{
      campaign: unknown;
      pendingApplicationsCount: number;
      rejectedCount?: number;
    }>
  > {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/start`,
      options ?? {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse(response.data);
  }

  async endCampaign(
    campaignId: string,
    options?: { skipGracePeriod?: boolean },
  ): Promise<ApiResponse<unknown>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/end`,
      options ?? {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse(response.data);
  }

  async topUpCampaign(campaignId: string, amount: number): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/top-up`,
      { amount },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getCampaignApplicants(campaignId: string, params?: { status?: string }): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);

    const response = await axios.get(
      `${campaignServiceUrl}/campaigns/${campaignId}/applicants${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async getCampaignApplications(campaignId: string): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/campaigns/${campaignId}/applications`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async shortlistApplicant(campaignId: string, applicantId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/applicants/${applicantId}/shortlist`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async reviewSubmission(
    submissionId: string,
    data: { status: 'APPROVED' | 'REJECTED'; comment?: string }
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.post(
      `${campaignServiceUrl}/submissions/${submissionId}/review`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async reviewApplication(
    applicationId: string,
    data: { status: 'APPROVED' | 'REJECTED'; comment?: string }
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/applications/${applicationId}/review`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getBrandDashboardStats(params?: { dateRange?: string }): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const queryParams = new URLSearchParams();
    if (params?.dateRange) queryParams.append('dateRange', params.dateRange);

    const response = await axios.get(
      `${campaignServiceUrl}/brands/dashboard/stats${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getCreatorCampaigns(params?: { search?: string }): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const queryParams = new URLSearchParams();
    if (params?.search) queryParams.append('search', params.search);

    const response = await axios.get(
      `${campaignServiceUrl}/creator/campaigns${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async applyToCampaign(
    campaignId: string,
    data: {
      draftMediaUrl?: string;
      draftAssetId?: string;
      platform: 'INSTAGRAM' | 'YOUTUBE';
      termsAccepted: boolean;
      note?: string;
      sourceType?: 'PROJECT_LIBRARY' | 'UPLOAD' | 'EXTERNAL_URL';
      projectId?: string;
    }
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/apply`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async uploadCreatorDraftAsset(
    file: File,
    params?: { campaignId?: string },
  ): Promise<ApiResponse<{ assetId: string }>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);
    const q = new URLSearchParams();
    if (params?.campaignId) q.set('campaignId', params.campaignId);
    const query = q.toString() ? `?${q.toString()}` : '';
    const uploadUrl = `${campaignServiceUrl}/campaigns/drafts/upload${query}`;
    try {
      const response = await axios.post(uploadUrl, formData, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (process.env.NODE_ENV === 'development') {
        console.warn('[apiClient] uploadCreatorDraftAsset raw response', response.data);
      }
      return normalizeCampaignAssetResponse(response.data);
    } catch (e) {
      throwCampaignDraftHttpError('uploadCreatorDraftAsset', e);
    }
  }

  async ingestCreatorDraftFromUrl(
    url: string,
    params?: { campaignId?: string },
  ): Promise<ApiResponse<{ assetId: string }>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const ingestUrl = `${campaignServiceUrl}/campaigns/drafts/ingest-url`;
    try {
      const response = await axios.post(
        ingestUrl,
        { url, campaignId: params?.campaignId },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      if (process.env.NODE_ENV === 'development') {
        console.warn('[apiClient] ingestCreatorDraftFromUrl raw response', response.data);
      }
      return normalizeCampaignAssetResponse(response.data);
    } catch (e) {
      throwCampaignDraftHttpError('ingestCreatorDraftFromUrl', e);
    }
  }

  async ingestCreatorDraftFromProject(
    projectId: string,
    params: { campaignId: string },
  ): Promise<ApiResponse<{ assetId: string }>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const url = `${campaignServiceUrl}/campaigns/drafts/from-project`;
    try {
      const response = await axios.post(
        url,
        { projectId, campaignId: params.campaignId },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      if (process.env.NODE_ENV === 'development') {
        console.warn('[apiClient] ingestCreatorDraftFromProject raw response', response.data);
      }
      return normalizeCampaignAssetResponse(response.data);
    } catch (e) {
      throwCampaignDraftHttpError('ingestCreatorDraftFromProject', e);
    }
  }

  async getCreatorCampaignDetail(campaignId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/creator/campaigns/${campaignId}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async replacePendingApplicationDraft(
    campaignId: string,
    draftAssetId: string,
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/creator/campaigns/${campaignId}/replace-draft`,
      { draftAssetId },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getCreatorCampaignStates(): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/creator/campaign-states`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async submitFinalPostLink(
    campaignId: string,
    data: { postUrl: string; platform: 'INSTAGRAM' | 'YOUTUBE' },
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/post-submissions`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getCampaignPostSubmissions(campaignId: string): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/campaigns/${campaignId}/post-submissions`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async reviewPostSubmission(
    submissionId: string,
    data: { status: 'VERIFIED' | 'REJECTED'; comment?: string },
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(`${campaignServiceUrl}/post-submissions/${submissionId}/review`, data, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async verifyPostViews(
    submissionId: string,
    data: { currentViews: number; note?: string },
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(`${campaignServiceUrl}/post-submissions/${submissionId}/verify-views`, data, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async updatePostViews(
    submissionId: string,
    data: { currentViews: number; note?: string },
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(`${campaignServiceUrl}/post-submissions/${submissionId}/update-views`, data, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async disqualifyPostSubmission(
    submissionId: string,
    data: { reason: string },
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(`${campaignServiceUrl}/post-submissions/${submissionId}/disqualify`, data, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getCampaignLeaderboard(campaignId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/campaigns/${campaignId}/leaderboard`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getCampaignLeaderboardSnapshot(campaignId: string): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/campaigns/${campaignId}/leaderboard/snapshot`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async getCampaignPrizePool(campaignId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/campaigns/${campaignId}/prize-pool`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async previewCampaignPrizePool(
    campaignId: string,
    previewN?: number,
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const params = previewN ? `?previewN=${previewN}` : '';
    const response = await axios.get(
      `${campaignServiceUrl}/campaigns/${campaignId}/prize-pool/preview${params}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async finalizeCampaign(
    campaignId: string,
    options?: { force?: boolean; reason?: string },
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/finalize`,
      options ?? {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async refreshCampaignLeaderboard(
    campaignId: string,
    options?: { force?: boolean },
  ): Promise<ApiResponse<{ runId: string; status: string; postsRequested: number }>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/refresh-leaderboard`,
      options ?? {},
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<{ runId: string; status: string; postsRequested: number }>(
      response.data,
    );
  }

  async getCampaignScrapeRuns(campaignId: string): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/campaigns/${campaignId}/scrape-runs`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async getCampaignScrapeRun(campaignId: string, runId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(
      `${campaignServiceUrl}/campaigns/${campaignId}/scrape-runs/${runId}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async resetCampaignFinalization(campaignId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/finalize/reset`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getCampaignCreatorEarnings(campaignId: string): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/campaigns/${campaignId}/creator-earnings`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async processLockedEarningsUnlock(): Promise<ApiResponse<{ processed: number }>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/creator-earnings/process-unlock`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<{ processed: number }>(response.data);
  }

  async reverseLockedEarning(earningId: string, reason?: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/creator-earnings/${earningId}/reverse`,
      { reason },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async submitCampaignContent(
    campaignId: string,
    data: {
      contentUrl: string;
      platform: 'INSTAGRAM' | 'YOUTUBE';
      creatorName?: string;
      creatorHandle?: string;
    }
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();

    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/submissions`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getCreatorEarnings(): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/creator/earnings`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async requestCreatorWithdrawal(amount: number): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/creator/withdrawals`,
      { amount },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getCampaignWalletSyncEvents(params?: {
    status?: 'SYNCED' | 'RETRY_PENDING' | 'FAILED';
    eventType?: string;
    limit?: number;
    cursor?: string | null;
    startDate?: string;
    endDate?: string;
  }): Promise<ApiResponse<{ items: any[]; nextCursor: string | null; hasMore: boolean }>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.eventType) query.append('eventType', params.eventType);
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.cursor) query.append('cursor', params.cursor);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    const response = await axios.get(
      `${campaignServiceUrl}/wallet-sync-events${query.toString() ? `?${query.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return normalizeCampaignServiceResponse<{ items: any[]; nextCursor: string | null; hasMore: boolean }>(
      response.data
    );
  }

  async getCampaignWalletSyncSummary(): Promise<
    ApiResponse<{
      syncedCount: number;
      retryPendingCount: number;
      failedCount: number;
      totalCount: number;
      eventTypes: string[];
    }>
  > {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/wallet-sync-events/summary`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<{
      syncedCount: number;
      retryPendingCount: number;
      failedCount: number;
      totalCount: number;
      eventTypes: string[];
    }>(response.data);
  }

  async retryCampaignWalletSyncEvent(eventId: string): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/wallet-sync-events/${eventId}/retry`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async retryCampaignWalletSyncEvents(
    statuses: Array<'RETRY_PENDING' | 'FAILED'> = ['RETRY_PENDING', 'FAILED'],
  ): Promise<ApiResponse<{ processed: number; synced: number; failed: number; skipped: number }>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/wallet-sync-events/retry-all`,
      { statuses },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return normalizeCampaignServiceResponse<{
      processed: number;
      synced: number;
      failed: number;
      skipped: number;
    }>(response.data);
  }

  async exportCampaignWalletSyncEventsCsv(params?: {
    status?: 'SYNCED' | 'RETRY_PENDING' | 'FAILED';
    eventType?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<Blob> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.eventType) query.append('eventType', params.eventType);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    const response = await axios.get(
      `${campaignServiceUrl}/wallet-sync-events/export${query.toString() ? `?${query.toString()}` : ''}`,
      {
        responseType: 'blob',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return response.data as Blob;
  }

  // ==================== CAMPAIGN SOURCE VIDEOS ====================

  async addCampaignSourceVideo(
    campaignId: string,
    data: { url: string; title?: string; orderIndex?: number },
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/source-videos`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getCampaignSourceVideos(campaignId: string): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(
      `${campaignServiceUrl}/campaigns/${campaignId}/source-videos`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async updateCampaignSourceVideo(
    campaignId: string,
    videoId: string,
    data: { title?: string; orderIndex?: number },
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.patch(
      `${campaignServiceUrl}/campaigns/${campaignId}/source-videos/${videoId}`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async deleteCampaignSourceVideo(
    campaignId: string,
    videoId: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/campaigns/${campaignId}/source-videos/${videoId}/delete`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<{ success: boolean }>(response.data);
  }

  // ==================== SSEMBLE CLIP GENERATION ====================

  async generateSsembleClips(
    campaignId: string,
    data: {
      sourceVideoId: string;
      startSec: number;
      endSec: number;
      preferredLength?: string;
      language?: string;
      captionLanguage?: string;
      templateId?: string;
      hookTitle?: boolean;
      memeHook?: boolean;
      memeHookName?: string;
      gameVideo?: boolean;
      gameVideoName?: string;
      ctaEnabled?: boolean;
      ctaText?: string;
      music?: boolean;
      musicName?: string;
      musicVolume?: number;
      layout?: string;
    },
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.post(
      `${campaignServiceUrl}/creator/campaigns/${campaignId}/clips/generate`,
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  async getMyClipRequests(campaignId: string): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(
      `${campaignServiceUrl}/creator/campaigns/${campaignId}/clips/requests`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async getClipRequestDetail(
    campaignId: string,
    requestId: string,
  ): Promise<ApiResponse<any>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(
      `${campaignServiceUrl}/creator/campaigns/${campaignId}/clips/requests/${requestId}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any>(response.data);
  }

  // ==================== SSEMBLE CATALOG ====================

  async getSsembleTemplates(): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const response = await axios.get(`${campaignServiceUrl}/ssemble/templates`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async getSsembleMusic(params?: { page?: number; limit?: number }): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const query = new URLSearchParams();
    if (params?.page) query.append('page', String(params.page));
    if (params?.limit) query.append('limit', String(params.limit));
    const response = await axios.get(
      `${campaignServiceUrl}/ssemble/music${query.toString() ? `?${query.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async getSsembleMemeHooks(params?: { page?: number; limit?: number }): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const query = new URLSearchParams();
    if (params?.page) query.append('page', String(params.page));
    if (params?.limit) query.append('limit', String(params.limit));
    const response = await axios.get(
      `${campaignServiceUrl}/ssemble/meme-hooks${query.toString() ? `?${query.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any[]>(response.data);
  }

  async getSsembleGameVideos(params?: { page?: number; limit?: number }): Promise<ApiResponse<any[]>> {
    const campaignServiceUrl = getCampaignServiceApiRoot();
    const token = this.getToken();
    const query = new URLSearchParams();
    if (params?.page) query.append('page', String(params.page));
    if (params?.limit) query.append('limit', String(params.limit));
    const response = await axios.get(
      `${campaignServiceUrl}/ssemble/game-videos${query.toString() ? `?${query.toString()}` : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    return normalizeCampaignServiceResponse<any[]>(response.data);
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

  // ==================== Credits/Billing APIs ====================

  async getCreditsBalance(userId: string, workspaceId?: string): Promise<ApiResponse<{ credits: number }>> {
    const paymentServiceUrl = PAYMENT_SERVICE_URL;
    const token = this.getToken();

    const params = new URLSearchParams({ userId });
    if (workspaceId) {
      params.append('workspaceId', workspaceId);
    }

    const response = await axios.get<ApiResponse<{ credits: number }>>(
      `${paymentServiceUrl}/transactions/balance?${params.toString()}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getTransactionHistory(
    userId: string, 
    options?: { 
      workspaceId?: string; 
      limit?: number;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<ApiResponse<any[]>> {
    const paymentServiceUrl = PAYMENT_SERVICE_URL;
    const token = this.getToken();

    const params = new URLSearchParams({ userId });
    if (options?.workspaceId) params.append('workspaceId', options.workspaceId);
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.startDate) params.append('startDate', options.startDate);
    if (options?.endDate) params.append('endDate', options.endDate);

    const response = await axios.get<ApiResponse<any[]>>(
      `${paymentServiceUrl}/transactions/history?${params.toString()}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getProjectCostBreakdown(projectId: string): Promise<ApiResponse<any>> {
    const paymentServiceUrl = PAYMENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any>>(
      `${paymentServiceUrl}/credits/project/${projectId}/breakdown`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async getPricingConfig(): Promise<ApiResponse<any[]>> {
    const paymentServiceUrl = PAYMENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any[]>>(
      `${paymentServiceUrl}/pricing`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  /** Admin: all pricing rows including inactive (for toggles). */
  async getPricingConfigForAdmin(): Promise<ApiResponse<any[]>> {
    const paymentServiceUrl = PAYMENT_SERVICE_URL;
    const token = this.getToken();

    const response = await axios.get<ApiResponse<any[]>>(
      `${paymentServiceUrl}/pricing/admin/all`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    return response.data;
  }

  async updatePricingActivation(
    operationType: string,
    isActive: boolean,
    adminUserId: string
  ): Promise<ApiResponse<any>> {
    const token = this.getToken();
    const paymentServiceUrl = PAYMENT_SERVICE_URL;
    const response = await axios.patch<ApiResponse<any>>(
      `${paymentServiceUrl}/pricing/${encodeURIComponent(operationType)}/activation`,
      { isActive, adminUserId },
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async getUserBillingSummary(
    userId: string,
    options?: { startDate?: string; endDate?: string }
  ): Promise<ApiResponse<any>> {
    const paymentServiceUrl = PAYMENT_SERVICE_URL;
    const token = this.getToken();

    const params = new URLSearchParams();
    if (options?.startDate) params.append('startDate', options.startDate);
    if (options?.endDate) params.append('endDate', options.endDate);

    const queryString = params.toString();
    const url = `${paymentServiceUrl}/credits/user/${userId}/summary${queryString ? '?' + queryString : ''}`;

    const response = await axios.get<ApiResponse<any>>(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    return response.data;
  }

  // ==================== ADMIN API METHODS ====================

  // Admin - Dashboard Stats
  async getAdminDashboardStats(): Promise<ApiResponse<{
    totalUsers: number;
    activeUsersToday: number;
    totalAdmins: number;
    newUsersToday: number;
    usersByRole: Record<string, number>;
  }>> {
    const token = this.getToken();
    const response = await axios.get<ApiResponse<any>>(
      `${AUTH_SERVICE_URL}/admin/stats`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  // Admin - Users
  async getAdminUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    userId?: string;
  }): Promise<ApiResponse<{
    users: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>> {
    const token = this.getToken();
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.role) queryParams.append('role', params.role);
    if (params?.userId) queryParams.append('userId', params.userId);

    const queryString = queryParams.toString();
    const response = await axios.get<ApiResponse<any>>(
      `${AUTH_SERVICE_URL}/admin/users${queryString ? '?' + queryString : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async getAdminUsersByIds(
    ids: string[]
  ): Promise<ApiResponse<Array<{ id: string; email: string; name: string | null }>>> {
    const token = this.getToken();
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 100);
    if (unique.length === 0) {
      return { success: true, data: [] };
    }
    const query = `ids=${encodeURIComponent(unique.join(','))}`;
    const response = await axios.get<ApiResponse<Array<{ id: string; email: string; name: string | null }>>>(
      `${AUTH_SERVICE_URL}/admin/users/batch?${query}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async getAdminUserById(userId: string): Promise<ApiResponse<any>> {
    const token = this.getToken();
    const response = await axios.get<ApiResponse<any>>(
      `${AUTH_SERVICE_URL}/admin/users/${userId}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async updateUserRole(userId: string, role: string): Promise<ApiResponse<any>> {
    const token = this.getToken();
    const response = await axios.put<ApiResponse<any>>(
      `${AUTH_SERVICE_URL}/admin/users/${userId}/role`,
      { role },
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async updateUserCredits(userId: string, credits: number, addToExisting?: boolean): Promise<ApiResponse<any>> {
    const token = this.getToken();
    const response = await axios.put<ApiResponse<any>>(
      `${AUTH_SERVICE_URL}/admin/users/${userId}/credits`,
      { credits, addToExisting },
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async createAdminUser(data: {
    email: string;
    password: string;
    name: string;
    role: 'ADMIN' | 'OWNER';
  }): Promise<ApiResponse<any>> {
    const token = this.getToken();
    const response = await axios.post<ApiResponse<any>>(
      `${AUTH_SERVICE_URL}/admin/users`,
      data,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async deactivateUser(userId: string): Promise<ApiResponse<any>> {
    const token = this.getToken();
    const response = await axios.delete<ApiResponse<any>>(
      `${AUTH_SERVICE_URL}/admin/users/${userId}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async reactivateUser(userId: string): Promise<ApiResponse<any>> {
    const token = this.getToken();
    const response = await axios.put<ApiResponse<any>>(
      `${AUTH_SERVICE_URL}/admin/users/${userId}/reactivate`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async getAdminUsersList(): Promise<ApiResponse<any[]>> {
    const token = this.getToken();
    const response = await axios.get<ApiResponse<any[]>>(
      `${AUTH_SERVICE_URL}/admin/admins`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  // Admin - Projects/Generations
  async getAdminProjects(params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    userId?: string;
  }): Promise<ApiResponse<{
    projects: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>> {
    const token = this.getToken();
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.status) queryParams.append('status', params.status);
    if (params?.search) queryParams.append('search', params.search);
    if (params?.userId) queryParams.append('userId', params.userId);

    const queryString = queryParams.toString();
    const response = await axios.get<ApiResponse<any>>(
      `${videoServiceUrl}/admin/projects${queryString ? '?' + queryString : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async getAdminProjectById(projectId: string): Promise<ApiResponse<any>> {
    const token = this.getToken();
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const response = await axios.get<ApiResponse<any>>(
      `${videoServiceUrl}/admin/projects/${projectId}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async getAdminProjectLogs(projectId: string): Promise<
    ApiResponse<{
      source: string;
      body: string;
      lastGcsSyncedAt: string | null;
      gcsUrl: string | null;
      hint?: string;
    }>
  > {
    const token = this.getToken();
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const response = await axios.get(
      `${videoServiceUrl}/admin/projects/${projectId}/logs`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async getNotifications(): Promise<ApiResponse<{ notifications: any[] }>> {
    const token = this.getToken();
    const response = await axios.get<ApiResponse<{ notifications: any[] }>>(
      `${NOTIFICATION_SERVICE_URL}/notifications`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async markNotificationRead(id: string): Promise<ApiResponse<void>> {
    const token = this.getToken();
    const response = await axios.patch<ApiResponse<void>>(
      `${NOTIFICATION_SERVICE_URL}/notifications/${id}/read`,
      {},
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  /** Heartbeat while user is on a video project page (suppresses duplicate "video ready" notifications). */
  async postVideoPresence(projectId: string | null): Promise<ApiResponse<void>> {
    const token = this.getToken();
    const response = await axios.post<ApiResponse<void>>(
      `${NOTIFICATION_SERVICE_URL}/notifications/presence`,
      { projectId },
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async getAdminProjectStats(): Promise<ApiResponse<any>> {
    const token = this.getToken();
    const videoServiceUrl = VIDEO_SERVICE_URL;
    const response = await axios.get<ApiResponse<any>>(
      `${videoServiceUrl}/admin/project-stats`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  // Admin - Pricing
  async updatePricing(
    operationType: string,
    creditCost: number,
    adminUserId: string,
    reason?: string
  ): Promise<ApiResponse<any>> {
    const token = this.getToken();
    const paymentServiceUrl = PAYMENT_SERVICE_URL;
    const response = await axios.put<ApiResponse<any>>(
      `${paymentServiceUrl}/pricing/${operationType}`,
      { creditCost, adminUserId, reason },
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  async getPricingHistory(operationType: string, limit?: number): Promise<ApiResponse<any[]>> {
    const token = this.getToken();
    const paymentServiceUrl = PAYMENT_SERVICE_URL;
    const params = limit ? `?limit=${limit}` : '';
    const response = await axios.get<ApiResponse<any[]>>(
      `${paymentServiceUrl}/pricing/${operationType}/history${params}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return response.data;
  }

  // Admin - IAM (Nest controllers often return raw arrays; normalize to ApiResponse)
  private normalizeIamResponse<T>(raw: unknown): ApiResponse<T> {
    if (Array.isArray(raw)) {
      return { success: true, data: raw as T };
    }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if ('success' in obj) {
        return raw as ApiResponse<T>;
      }
      if (Array.isArray(obj.data)) {
        return { success: true, data: obj.data as T };
      }
    }
    return { success: false, message: 'Unexpected IAM service response' };
  }

  async getIamRoles(): Promise<ApiResponse<any[]>> {
    const token = this.getToken();
    const iamServiceUrl = process.env.NEXT_PUBLIC_IAM_SERVICE_URL || 'http://localhost:9010/api';
    const response = await axios.get(
      `${iamServiceUrl}/roles`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return this.normalizeIamResponse<any[]>(response.data);
  }

  async getIamPermissions(): Promise<ApiResponse<any[]>> {
    const token = this.getToken();
    const iamServiceUrl = process.env.NEXT_PUBLIC_IAM_SERVICE_URL || 'http://localhost:9010/api';
    const response = await axios.get(
      `${iamServiceUrl}/permissions`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return this.normalizeIamResponse<any[]>(response.data);
  }

  async getAuditLogs(params?: {
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<any[]>> {
    const token = this.getToken();
    const iamServiceUrl = process.env.NEXT_PUBLIC_IAM_SERVICE_URL || 'http://localhost:9010/api';
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());

    const queryString = queryParams.toString();
    const response = await axios.get(
      `${iamServiceUrl}/access/logs${queryString ? '?' + queryString : ''}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
    return this.normalizeIamResponse<any[]>(response.data);
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

