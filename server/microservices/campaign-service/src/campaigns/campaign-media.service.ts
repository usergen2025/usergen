import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CampaignMediaAsset, CampaignMediaSourceType, CampaignMediaStatus } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';
import { createUnifiedStorageFromEnv } from '@shared/storage/unified-storage.service';
import type { UnifiedStorageService } from '@shared/storage/unified-storage.service';
import { getContentType } from '@shared/storage/storage.constants';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { mkdir } from 'fs/promises';
import { applyUsergenTiledWatermark } from '@shared/ffmpeg/usergen-tiled-watermark';
import type { Response } from 'express';
import { downloadExternalVideo } from './external-url-resolver';

const ALLOWED_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);

/** Fetch limits for external URL ingestion */
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

@Injectable()
export class CampaignMediaService {
  private readonly logger = new Logger(CampaignMediaService.name);
  private readonly unified: UnifiedStorageService;
  private readonly uploadsBaseDir: string;
  private readonly publicBase: string;
  private readonly videoProcessingBase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {
    const port = this.configService.get<number>('SERVICE_PORT', 9011);
    const backendBase =
      this.configService.get<string>('PUBLIC_ASSET_BASE_URL')?.replace(/\/$/, '') ||
      `http://localhost:${port}`;
    this.publicBase = backendBase;
    this.uploadsBaseDir = path.join(process.cwd(), 'uploads');
    this.unified = createUnifiedStorageFromEnv('campaign', backendBase, this.uploadsBaseDir, process.env);
    this.videoProcessingBase = CampaignMediaService.normalizeApiRoot(
      this.configService.get<string>('VIDEO_PROCESSING_SERVICE_URL') || 'http://localhost:9004/api',
    );
  }

  /** Ensure video-processing calls use .../api prefix (same as Nest global prefix). */
  private static normalizeApiRoot(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (/\/api$/i.test(trimmed)) return trimmed;
    return `${trimmed}/api`;
  }

  private buildLocalUrlFromPath(absolutePath: string): string {
    const rel = path.relative(this.uploadsBaseDir, absolutePath);
    return `/uploads/${rel.split(path.sep).join('/')}`;
  }

  private async runFfmpegWatermark(inputPath: string, outputPath: string): Promise<void> {
    await applyUsergenTiledWatermark({ inputPath, outputPath });
  }

  /**
   * Multipart upload: write original, optional GCS, watermark, upload watermarked, persist asset.
   */
  async createFromUpload(
    file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number },
    ownerId: string,
    campaignId: string | undefined,
  ): Promise<{ assetId: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    const maxBytes = 50 * 1024 * 1024;
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException('File is too large (max 50MB)');
    }
    const ext = path.extname(file.originalname || '') || '.mp4';
    const safeExt = ALLOWED_EXT.has(ext.toLowerCase()) ? ext : '.mp4';
    if (!String(file.mimetype || '').startsWith('video/') && !String(file.mimetype || '').includes('octet-stream')) {
      if (!file.mimetype) {
        /* allow when extension is video */
        if (!['.mp4', '.webm', '.mov', '.m4v'].some((e) => safeExt.toLowerCase().endsWith(e))) {
          throw new BadRequestException('Only video uploads are allowed');
        }
      } else {
        throw new BadRequestException('Only video uploads are allowed');
      }
    }

    const asset = await this.databaseService.campaignMediaAsset.create({
      data: {
        ownerId,
        campaignId: campaignId || null,
        sourceType: 'UPLOAD' as CampaignMediaSourceType,
        status: 'PROCESSING' as CampaignMediaStatus,
        sizeBytes: file.buffer.length,
        mimeType: file.mimetype || getContentType(`f${safeExt}`),
      },
    });

    try {
      const subPath = `campaign-drafts/${ownerId}`;
      const origName = `${asset.id}-orig${safeExt}`;
      const localDir = path.join(this.uploadsBaseDir, 'campaign', subPath);
      await mkdir(localDir, { recursive: true });
      const result = await this.unified.uploadFromBuffer({
        service: 'campaign',
        buffer: file.buffer,
        localDir,
        filename: origName,
        contentType: file.mimetype || getContentType(`f${safeExt}`),
        subPath,
        makePublic: false,
      });

      const wmName = `${asset.id}-wm${safeExt}`;
      const wmPath = path.join(localDir, wmName);
      await this.runFfmpegWatermark(result.localPath, wmPath);

      const wmResult = await this.unified.uploadFromPath({
        service: 'campaign',
        localPath: wmPath,
        filename: wmName,
        contentType: 'video/mp4',
        subPath: `${subPath}/watermarked`,
        makePublic: false,
      });

      await this.databaseService.campaignMediaAsset.update({
        where: { id: asset.id },
        data: {
          originalLocalPath: result.localPath,
          originalGcsUrl: result.gcsUrl || null,
          watermarkedLocalPath: wmPath,
          watermarkedGcsUrl: wmResult.gcsUrl || null,
          status: 'READY' as CampaignMediaStatus,
        },
      });
    } catch (e: any) {
      this.logger.error(`createFromUpload failed: ${e?.message || e}`);
      await this.databaseService.campaignMediaAsset.update({
        where: { id: asset.id },
        data: { status: 'FAILED' as CampaignMediaStatus, error: e?.message || 'process failed' },
      });
      throw new BadRequestException(e?.message || 'Failed to process video');
    }

    return { assetId: asset.id };
  }

  /**
   * Download external video URL, store, watermark, persist.
   * Supports direct file links plus Google Drive, Dropbox, OneDrive, and Box share URLs.
   */
  async createFromExternalUrl(
    sourceUrl: string,
    ownerId: string,
    campaignId: string | undefined,
  ): Promise<{ assetId: string }> {
    const asset = await this.databaseService.campaignMediaAsset.create({
      data: {
        ownerId,
        campaignId: campaignId || null,
        sourceType: 'EXTERNAL_URL' as CampaignMediaSourceType,
        originalSourceUrl: sourceUrl,
        status: 'PROCESSING' as CampaignMediaStatus,
      },
    });

    try {
      const downloaded = await downloadExternalVideo(sourceUrl, MAX_DOWNLOAD_BYTES);
      const buf = downloaded.buffer;
      const ct = downloaded.mimeType;
      const safeExt = ALLOWED_EXT.has(downloaded.ext.toLowerCase()) ? downloaded.ext : '.mp4';
      const subPath = `campaign-drafts/${ownerId}`;
      const origName = `${asset.id}-orig${safeExt}`;
      const localDir = path.join(this.uploadsBaseDir, 'campaign', subPath);
      await mkdir(localDir, { recursive: true });
      const result = await this.unified.uploadFromBuffer({
        service: 'campaign',
        buffer: buf,
        localDir,
        filename: origName,
        contentType: ct || getContentType(`f${safeExt}`),
        subPath,
        makePublic: false,
      });

      const wmName = `${asset.id}-wm${safeExt}`;
      const wmPath = path.join(localDir, wmName);
      await this.runFfmpegWatermark(result.localPath, wmPath);

      const wmResult = await this.unified.uploadFromPath({
        service: 'campaign',
        localPath: wmPath,
        filename: wmName,
        contentType: 'video/mp4',
        subPath: `${subPath}/watermarked`,
        makePublic: false,
      });

      await this.databaseService.campaignMediaAsset.update({
        where: { id: asset.id },
        data: {
          originalLocalPath: result.localPath,
          originalGcsUrl: result.gcsUrl || null,
          watermarkedLocalPath: wmPath,
          watermarkedGcsUrl: wmResult.gcsUrl || null,
          sizeBytes: buf.length,
          mimeType: ct || 'video/mp4',
          status: 'READY' as CampaignMediaStatus,
        },
      });
    } catch (e: any) {
      this.logger.error(`createFromExternalUrl failed: ${e?.message || e}`);
      await this.databaseService.campaignMediaAsset.update({
        where: { id: asset.id },
        data: { status: 'FAILED' as CampaignMediaStatus, error: e?.message || 'ingest failed' },
      });
      if (e instanceof BadRequestException) throw e;
      const message = typeof e?.message === 'string' ? e.message : 'Failed to download or process video URL';
      throw new BadRequestException(message);
    }

    return { assetId: asset.id };
  }

  /**
   * Copy completed project render into campaign storage, watermark, persist.
   */
  async createFromProject(
    projectId: string,
    ownerId: string,
    campaignId: string,
    authorizationHeader: string | undefined,
  ): Promise<{ assetId: string }> {
    if (!authorizationHeader) {
      throw new BadRequestException('Authorization required');
    }
    const asset = await this.databaseService.campaignMediaAsset.create({
      data: {
        ownerId,
        campaignId,
        projectId,
        sourceType: 'PROJECT_LIBRARY' as CampaignMediaSourceType,
        status: 'PROCESSING' as CampaignMediaStatus,
      },
    });

    try {
      const projectUrl = `${this.videoProcessingBase}/video-projects/${encodeURIComponent(projectId)}`;
      this.logger.log(`createFromProject: fetching ${projectUrl}`);
      const projRes = await axios.get(projectUrl, {
        headers: { Authorization: authorizationHeader },
        timeout: 30000,
      });
      const wrap = projRes.data as { data?: Record<string, unknown> };
      const proj = wrap?.data ?? (projRes.data as Record<string, unknown>);
      if (!proj || typeof proj !== 'object') {
        throw new BadRequestException('Invalid project response');
      }
      if (String(proj.status || '').toUpperCase() !== 'COMPLETED') {
        throw new BadRequestException('Project video is not completed');
      }

      const meta = (proj.metadata as Record<string, unknown>) || {};
      const directUrl =
        (proj.videoUrl as string) ||
        (meta.previewVideoUrl as string) ||
        (meta.videoPublicUrl as string) ||
        (proj.videoPublicUrl as string);
      if (!directUrl) {
        throw new BadRequestException('No video file available for this project');
      }
      const hostBase = this.videoProcessingBase.replace(/\/api\/?$/, '');
      const absoluteUrl =
        typeof directUrl === 'string' && directUrl.startsWith('http')
          ? directUrl
          : `${hostBase}${String(directUrl).startsWith('/') ? '' : '/'}${directUrl}`;

      const res = await axios.get(absoluteUrl, {
        responseType: 'arraybuffer',
        maxContentLength: MAX_DOWNLOAD_BYTES,
        maxBodyLength: MAX_DOWNLOAD_BYTES,
        timeout: 120000,
      });
      const buf = Buffer.from(res.data);
      const ext = '.mp4';
      const subPath = `campaign-drafts/${ownerId}`;
      const origName = `${asset.id}-orig${ext}`;
      const localDir = path.join(this.uploadsBaseDir, 'campaign', subPath);
      await mkdir(localDir, { recursive: true });
      const result = await this.unified.uploadFromBuffer({
        service: 'campaign',
        buffer: buf,
        localDir,
        filename: origName,
        contentType: 'video/mp4',
        subPath,
        makePublic: false,
      });

      const wmName = `${asset.id}-wm${ext}`;
      const wmPath = path.join(localDir, wmName);
      await this.runFfmpegWatermark(result.localPath, wmPath);

      const wmResult = await this.unified.uploadFromPath({
        service: 'campaign',
        localPath: wmPath,
        filename: wmName,
        contentType: 'video/mp4',
        subPath: `${subPath}/watermarked`,
        makePublic: false,
      });

      await this.databaseService.campaignMediaAsset.update({
        where: { id: asset.id },
        data: {
          originalLocalPath: result.localPath,
          originalGcsUrl: result.gcsUrl || null,
          originalSourceUrl: absoluteUrl,
          watermarkedLocalPath: wmPath,
          watermarkedGcsUrl: wmResult.gcsUrl || null,
          sizeBytes: buf.length,
          mimeType: 'video/mp4',
          status: 'READY' as CampaignMediaStatus,
        },
      });
    } catch (e: any) {
      const status = e?.response?.status as number | undefined;
      const upstreamBody =
        typeof e?.response?.data === 'string'
          ? e.response.data.slice(0, 200)
          : e?.response?.data != null
            ? JSON.stringify(e.response.data).slice(0, 300)
            : '';
      this.logger.error(
        `createFromProject failed: ${e?.message || e}${status != null ? ` (upstream HTTP ${status})` : ''}${upstreamBody ? ` body=${upstreamBody}` : ''}`,
      );
      await this.databaseService.campaignMediaAsset.update({
        where: { id: asset.id },
        data: { status: 'FAILED' as CampaignMediaStatus, error: e?.message || 'project ingest failed' },
      });
      if (e instanceof BadRequestException || e instanceof ForbiddenException) throw e;
      if (axios.isAxiosError(e) && status === 404) {
        throw new BadRequestException(
          'Video project was not found in the video service. Check VIDEO_PROCESSING_SERVICE_URL includes /api, the video-processing service is running, and the project ID is valid.',
        );
      }
      throw new BadRequestException(e?.message || 'Failed to import project video');
    }

    return { assetId: asset.id };
  }

  async getAssetForOwner(assetId: string, ownerId: string): Promise<CampaignMediaAsset> {
    const asset = await this.databaseService.campaignMediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.ownerId !== ownerId) {
      throw new NotFoundException('Asset not found');
    }
    return asset;
  }

  async assertPreviewAccess(assetId: string, user: { id: string; role: string }): Promise<CampaignMediaAsset> {
    const asset = await this.databaseService.campaignMediaAsset.findUnique({
      where: { id: assetId },
      include: { campaign: true },
    });
    if (!asset || asset.status !== 'READY') {
      throw new NotFoundException('Preview not available');
    }
    const wm = asset.watermarkedLocalPath || asset.watermarkedGcsUrl;
    if (!wm) {
      throw new NotFoundException('Preview not available');
    }

    if (asset.ownerId === user.id) {
      return asset;
    }
    if (asset.campaignId && asset.campaign?.brandId === user.id) {
      return asset;
    }
    const app = await this.databaseService.campaignApplication.findFirst({
      where: { draftMediaAssetId: assetId },
      include: { campaign: true },
    });
    if (app && app.campaign.brandId === user.id) {
      return asset;
    }
    if (user.role === 'ADMIN' || user.role === 'OWNER') {
      return asset;
    }
    throw new ForbiddenException('No access to this media');
  }

  async streamWatermarkedPreview(assetId: string, user: { id: string; role: string }, res: Response, req: any) {
    const asset = await this.assertPreviewAccess(assetId, user);
    const filePath = asset.watermarkedLocalPath;
    if (!filePath || !fs.existsSync(filePath)) {
      throw new NotFoundException('Watermarked file missing');
    }
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const range = req.headers?.range as string | undefined;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', asset.mimeType || 'video/mp4');
    res.setHeader('Cache-Control', 'private, no-store');

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (!match) {
        res.status(416).end();
        return;
      }
      let start = match[1] ? parseInt(match[1], 10) : 0;
      let end = match[2] ? parseInt(match[2], 10) : size - 1;
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end) || end >= size) end = size - 1;
      if (start >= size || start > end) {
        res.status(416).end();
        return;
      }
      const chunk = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(chunk));
      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(size));
    fs.createReadStream(filePath).pipe(res);
  }

  /** Public URL for legacy draftMediaUrl field (still requires auth on preview route when using API path). */
  previewApiPath(assetId: string): string {
    return `${this.publicBase}/api/campaign-media/${assetId}/preview`;
  }
}
