import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/** Magnific Music API query params (GET /v1/music) */
export interface MagnificMusicSearchParams {
  q?: string;
  genre?: string[];
  mood?: string[];
  includePremium?: boolean;
  timeRange?: '7d' | '30d' | '90d';
  orderBy?: string;
  limit?: number;
  offset?: number;
}

export interface MagnificMusicListItem {
  id: number;
  title: string;
  artist?: { name?: string } | null;
  genres?: { name?: string }[];
  moods?: { name?: string }[];
  cover_url?: string | null;
  file_url?: string | null;
  preview_url?: string | null;
  download_url?: string | null;
  seconds?: number;
  time?: string;
  popularity?: number;
  is_premium?: boolean;
  is_active?: boolean;
  created_at?: string;
}

export interface MagnificMusicSearchResponse {
  count: number;
  results: MagnificMusicListItem[];
}

export interface MagnificMusicDownloadResponse {
  id: number;
  title: string;
  download_url: string;
}

@Injectable()
export class MagnificMusicProvider {
  private axiosInstance: AxiosInstance;
  private apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('MAGNIFIC_API_KEY') || '';
    const baseUrl =
      this.configService.get<string>('MAGNIFIC_API_BASE_URL') ||
      'https://api.magnific.com';

    this.axiosInstance = axios.create({
      baseURL: baseUrl.replace(/\/$/, ''),
      headers: {
        'x-magnific-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Build query string for GET /v1/music (genre/mood as comma-separated per API docs)
   */
  private buildSearchQueryString(params: MagnificMusicSearchParams): string {
    const qs = new URLSearchParams();
    if (params.q?.trim()) qs.set('q', params.q.trim());
    if (params.genre?.length) qs.set('genre', params.genre.join(','));
    if (params.mood?.length) qs.set('mood', params.mood.join(','));
    if (params.includePremium === true) qs.set('include-premium', 'true');
    else qs.set('include-premium', 'false');
    if (params.timeRange) qs.set('time_range', params.timeRange);
    if (params.orderBy) qs.set('order_by', params.orderBy);
    qs.set('limit', String(params.limit ?? 20));
    qs.set('offset', String(params.offset ?? 0));
    return qs.toString();
  }

  async searchMusic(params: MagnificMusicSearchParams): Promise<MagnificMusicSearchResponse> {
    const query = this.buildSearchQueryString(params);
    const { data } = await this.axiosInstance.get<MagnificMusicSearchResponse>(
      `/v1/music?${query}`,
    );
    return {
      count: data?.count ?? 0,
      results: Array.isArray(data?.results) ? data.results : [],
    };
  }

  async getMusicDetail(musicId: number): Promise<Record<string, unknown>> {
    const { data } = await this.axiosInstance.get(`/v1/music/${musicId}`);
    return data as Record<string, unknown>;
  }

  async downloadMusic(musicId: number): Promise<MagnificMusicDownloadResponse> {
    const { data } = await this.axiosInstance.get<MagnificMusicDownloadResponse>(
      `/v1/music/${musicId}/download`,
    );
    return data;
  }
}
