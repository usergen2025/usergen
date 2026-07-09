import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  CreateShortParams,
  CreateShortResponse,
  StatusResponse,
  ShortsResponse,
  SsembleTemplate,
  SsembleMusicTrack,
  SsembleMemeHook,
  SsembleGameVideo,
} from './dto/ssemble.dto';

@Injectable()
export class SsembleService {
  private readonly logger = new Logger(SsembleService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://aiclipping.ssemble.com/api/v1';
  private readonly axios: AxiosInstance;

  private templatesCache: { data: SsembleTemplate[]; expiry: number } | null = null;
  private musicCache: { data: SsembleMusicTrack[]; expiry: number } | null = null;
  private memeHooksCache: { data: SsembleMemeHook[]; expiry: number } | null = null;
  private gameVideosCache: { data: SsembleGameVideo[]; expiry: number } | null = null;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SSEMBLE_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('SSEMBLE_API_KEY not configured');
    }

    this.axios = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  private handleError(error: unknown, context: string): never {
    if (error instanceof AxiosError) {
      const status = error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
      const message = error.response?.data?.error?.message || error.message;
      this.logger.error(`Ssemble ${context} failed: ${message}`, error.stack);
      throw new HttpException(`Ssemble ${context} failed: ${message}`, status);
    }
    throw error;
  }

  async createShort(params: CreateShortParams): Promise<CreateShortResponse> {
    try {
      this.logger.log(`Creating short: start=${params.start}, end=${params.end}`);
      const { data } = await this.axios.post('/shorts/create', params);
      this.logger.log(`Short created: requestId=${data.data?.requestId}`);
      return data.data;
    } catch (error) {
      this.handleError(error, 'createShort');
    }
  }

  async getStatus(requestId: string): Promise<StatusResponse> {
    try {
      const { data } = await this.axios.get(`/shorts/${requestId}/status`);
      return data.data;
    } catch (error) {
      this.handleError(error, 'getStatus');
    }
  }

  async getShorts(requestId: string): Promise<ShortsResponse> {
    try {
      const { data } = await this.axios.get(`/shorts/${requestId}`);
      return data.data;
    } catch (error) {
      this.handleError(error, 'getShorts');
    }
  }

  async listTemplates(): Promise<SsembleTemplate[]> {
    const now = Date.now();
    if (this.templatesCache && this.templatesCache.expiry > now) {
      return this.templatesCache.data;
    }

    try {
      const { data } = await this.axios.get('/templates');
      const templates = (data.data?.templates || data.data || []) as SsembleTemplate[];
      this.templatesCache = { data: templates, expiry: now + this.CACHE_TTL_MS };
      return templates;
    } catch (error) {
      this.handleError(error, 'listTemplates');
    }
  }

  async listMusic(page = 1, limit = 100): Promise<SsembleMusicTrack[]> {
    const now = Date.now();
    if (this.musicCache && this.musicCache.expiry > now) {
      return this.musicCache.data;
    }

    try {
      const { data } = await this.axios.get('/music', { params: { page, limit } });
      const tracks = (data.data?.music || data.data || []) as SsembleMusicTrack[];
      this.musicCache = { data: tracks, expiry: now + this.CACHE_TTL_MS };
      return tracks;
    } catch (error) {
      this.handleError(error, 'listMusic');
    }
  }

  async listMemeHooks(page = 1, limit = 100): Promise<SsembleMemeHook[]> {
    const now = Date.now();
    if (this.memeHooksCache && this.memeHooksCache.expiry > now) {
      return this.memeHooksCache.data;
    }

    try {
      const { data } = await this.axios.get('/meme-hooks', { params: { page, limit } });
      const hooks = (data.data?.memeHooks || data.data || []) as SsembleMemeHook[];
      this.memeHooksCache = { data: hooks, expiry: now + this.CACHE_TTL_MS };
      return hooks;
    } catch (error) {
      this.handleError(error, 'listMemeHooks');
    }
  }

  async listGameVideos(page = 1, limit = 100): Promise<SsembleGameVideo[]> {
    const now = Date.now();
    if (this.gameVideosCache && this.gameVideosCache.expiry > now) {
      return this.gameVideosCache.data;
    }

    try {
      const { data } = await this.axios.get('/game-videos', { params: { page, limit } });
      const videos = (data.data?.gameVideos || data.data || []) as SsembleGameVideo[];
      this.gameVideosCache = { data: videos, expiry: now + this.CACHE_TTL_MS };
      return videos;
    } catch (error) {
      this.handleError(error, 'listGameVideos');
    }
  }

  detectUrlType(url: string): 'YOUTUBE' | 'DIRECT' | 'INVALID' {
    if (!url || typeof url !== 'string') return 'INVALID';
    
    const normalizedUrl = url.trim().toLowerCase();
    
    // YouTube patterns
    if (
      normalizedUrl.includes('youtube.com') ||
      normalizedUrl.includes('youtu.be')
    ) {
      return 'YOUTUBE';
    }
    
    // Direct video file extensions
    if (/\.(mp4|mov|webm|avi|mkv)(\?|$)/i.test(url)) {
      return 'DIRECT';
    }
    
    // Cloud storage patterns (S3, GCS, Azure, etc.)
    if (
      normalizedUrl.includes('s3.amazonaws.com') ||
      normalizedUrl.includes('storage.googleapis.com') ||
      normalizedUrl.includes('blob.core.windows.net') ||
      normalizedUrl.includes('cloudfront.net') ||
      normalizedUrl.includes('r2.cloudflarestorage.com')
    ) {
      return 'DIRECT';
    }
    
    // Any http(s) URL - treat as potentially valid direct URL
    if (normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')) {
      return 'DIRECT';
    }
    
    return 'INVALID';
  }

  extractYouTubeVideoId(url: string): string | null {
    const patterns = [
      /youtu\.be\/([^?&]+)/,
      /youtube\.com\/watch\?v=([^&]+)/,
      /youtube\.com\/embed\/([^?&]+)/,
      /youtube\.com\/shorts\/([^?&]+)/,
      /youtube\.com\/v\/([^?&]+)/,
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }

  buildYouTubeThumbnailUrl(videoId: string): string {
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }
}
