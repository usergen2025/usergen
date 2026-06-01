import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  BrandPackagingMetadata,
  LogoBrandMetadata,
  getCornerOverlayRef,
  getEndCardLogoRef,
  getEndCardPlateRef,
  logoBrandHasPackagingAssets,
} from '@shared/brand/logo-brand.types';
import { metadataHasLogoAsset, metadataHasLogoInAnalyzed } from '@shared/brand';
import {
  resolveStorageRefToLocalPath,
  resolveStorageRefExternalUrl,
  storageResultToRef,
} from '@shared/storage';
import { DatabaseService } from '../common/database/database.service';
import { PublicUrlService } from '../common/storage/public-url.service';
import { BrandVideoPostProcessorService } from './brand-video-post-processor.service';
import { BrandLogoResolverService } from './brand-logo-resolver.service';

const DEFAULT_PLATE_WIDTH = 1080;
const DEFAULT_PLATE_HEIGHT = 1920;

@Injectable()
export class BrandPackagingService {
  private readonly uploadsDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly publicUrlService: PublicUrlService,
    private readonly brandVideoPostProcessor: BrandVideoPostProcessorService,
    private readonly brandLogoResolver: BrandLogoResolverService,
  ) {
    this.uploadsDir =
      this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  isEnabled(): boolean {
    return this.configService.get<string>('BRAND_PACKAGING_ENABLED') !== 'false';
  }

  getTimeoutMs(): number {
    const v = Number(this.configService.get<string>('BRAND_PACKAGING_TIMEOUT_MS') || 120000);
    return Number.isFinite(v) && v > 0 ? v : 120000;
  }

  hasLogoAsset(metadata: Record<string, unknown>): boolean {
    return (
      metadataHasLogoAsset(metadata.assets) ||
      metadataHasLogoInAnalyzed(metadata.analyzedAssets)
    );
  }

  async getStatus(projectId: string, userId: string) {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }
    const metadata = this.asMetadata(project.metadata);
    return {
      brandPackaging: (metadata.brandPackaging as BrandPackagingMetadata) || { status: 'pending' },
      logoBrand: metadata.logoBrand as LogoBrandMetadata | undefined,
    };
  }

  async prepareStart(
    projectId: string,
    userId: string,
  ): Promise<{ status: BrandPackagingMetadata['status']; jobId?: string; skipQueue?: boolean }> {
    if (!this.isEnabled()) {
      await this.patchBrandPackaging(projectId, { status: 'skipped', updatedAt: new Date().toISOString() });
      return { status: 'skipped', skipQueue: true };
    }

    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const metadata = this.asMetadata(project.metadata);
    const existing = metadata.brandPackaging as BrandPackagingMetadata | undefined;

    if (existing?.status === 'ready') {
      return { status: 'ready', jobId: existing.jobId, skipQueue: true };
    }
    if (existing?.status === 'processing' && existing.jobId) {
      return { status: 'processing', jobId: existing.jobId, skipQueue: true };
    }
    if (!this.hasLogoAsset(metadata)) {
      console.warn(`[BrandPackaging] BRAND_SKIPPED_NO_LOGO_ASSET project=${projectId}`);
      await this.patchBrandPackaging(projectId, { status: 'skipped', updatedAt: new Date().toISOString() });
      return { status: 'skipped', skipQueue: true };
    }

    const jobId = `brand-packaging-${projectId}`;
    await this.patchBrandPackaging(projectId, {
      status: 'processing',
      jobId,
      updatedAt: new Date().toISOString(),
      error: undefined,
    });

    return { status: 'processing', jobId };
  }

  async markFailed(projectId: string, error: string) {
    await this.patchBrandPackaging(projectId, {
      status: 'failed',
      error,
      updatedAt: new Date().toISOString(),
    });
  }

  async waitUntilReady(projectId: string, timeoutMs?: number): Promise<boolean> {
    const deadline = Date.now() + (timeoutMs ?? this.getTimeoutMs());
    while (Date.now() < deadline) {
      const project = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });
      if (!project) return false;
      const metadata = this.asMetadata(project.metadata);
      const bp = metadata.brandPackaging as BrandPackagingMetadata | undefined;
      if (bp?.status === 'ready' || bp?.status === 'skipped') return true;
      if (bp?.status === 'failed') return false;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  /**
   * Phase B processor entry — validate PNGs, build end-card plate, persist ready state.
   */
  async processProject(projectId: string, userId: string, workDir: string): Promise<void> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    let metadata = this.asMetadata(project.metadata);

    if (!this.hasLogoAsset(metadata)) {
      await this.patchBrandPackaging(projectId, { status: 'skipped', updatedAt: new Date().toISOString() });
      return;
    }

    let logoBrand = await this.waitForLogoBrand(projectId, userId, metadata, workDir);

    if (!logoBrand || !logoBrandHasPackagingAssets(logoBrand)) {
      throw new Error('logoBrand PNG assets unavailable after wait');
    }

    logoBrand = await this.ensureCornerOverlayReady(logoBrand, projectId, workDir);

    const resolveOpts = this.getResolveOptions();
    const cornerRef = getCornerOverlayRef(logoBrand);
    const endCardLogoRef = getEndCardLogoRef(logoBrand);

    let cornerReady = false;
    if (cornerRef && logoBrand.overlayPolicy?.showCornerBug) {
      const resolved = await resolveStorageRefToLocalPath(cornerRef, resolveOpts);
      if (!resolved?.localPath) {
        throw new Error('Corner overlay PNG unreachable');
      }
      cornerReady = true;
    }

    if (!endCardLogoRef && logoBrand.overlayPolicy?.showEndCard) {
      throw new Error('End card logo PNG unreachable');
    }

    let endCardPlateReady = false;
    const existingPlate = getEndCardPlateRef(logoBrand);
    if (existingPlate) {
      const resolved = await resolveStorageRefToLocalPath(existingPlate, resolveOpts);
      endCardPlateReady = Boolean(resolved?.localPath);
    }

    if (!endCardPlateReady && logoBrand.overlayPolicy?.showEndCard && endCardLogoRef) {
      const endCardLogoResolved = await resolveStorageRefToLocalPath(endCardLogoRef, resolveOpts);
      if (!endCardLogoResolved?.localPath) {
        throw new Error('End card logo PNG unreachable');
      }

      const plateLocalPath = await this.buildEndCardPlate(
        logoBrand,
        endCardLogoResolved.localPath,
        workDir,
      );

      const plateUpload = await this.publicUrlService.uploadFromPath(
        plateLocalPath,
        `logos/${projectId}`,
        path.basename(plateLocalPath),
        'image/png',
      );

      const endCardPlate = storageResultToRef(plateUpload, 'video-processing');
      logoBrand = { ...logoBrand, endCardPlate, endCardBackgroundUrl: plateUpload.publicUrl };
      endCardPlateReady = true;

      metadata = {
        ...metadata,
        logoBrand,
      };
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: { metadata: metadata as any },
      });
    }

    await this.patchBrandPackaging(projectId, {
      status: 'ready',
      cornerReady,
      endCardPlateReady,
      processedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: undefined,
    });
  }

  /**
   * When AI marks the logo unsuitable for corner, generate a compact BytePlus corner mark.
   */
  private async ensureCornerOverlayReady(
    logoBrand: LogoBrandMetadata,
    projectId: string,
    workDir: string,
  ): Promise<LogoBrandMetadata> {
    const needsVariant = logoBrand.cornerNeedsBytePlusVariant === true;
    if (!needsVariant || !logoBrand.overlayPolicy?.showCornerBug) {
      return logoBrand;
    }

    const resolveOpts = this.getResolveOptions();
    const existingCorner = getCornerOverlayRef(logoBrand);
    const existingResolved = existingCorner
      ? await resolveStorageRefToLocalPath(existingCorner, resolveOpts)
      : null;
    if (existingResolved?.localPath) {
      const meta = await (await import('sharp')).default(existingResolved.localPath).metadata();
      const minDim = Math.min(meta.width || 0, meta.height || 0);
      if (minDim >= 32 && minDim <= 400) {
        return logoBrand;
      }
    }

    const sourceRef = getEndCardLogoRef(logoBrand) || getCornerOverlayRef(logoBrand);
    const externalUrl = resolveStorageRefExternalUrl(sourceRef, {
      aiContentServiceUrl: resolveOpts.aiContentServiceUrl,
      backendBaseUrl: resolveOpts.backendBaseUrl,
    });
    if (!externalUrl) {
      console.warn(`[BrandPackaging] BRAND_PACKAGING_NOOP corner-variant: no external URL for ${projectId}`);
      return logoBrand;
    }

    const bpUrl = await this.brandVideoPostProcessor.generateBytePlusCornerMark(
      externalUrl,
      logoBrand.dominantColors,
      logoBrand.brandName,
    );
    if (!bpUrl) {
      console.warn(`[BrandPackaging] BytePlus corner variant failed for ${projectId}, using sharp corner`);
      return logoBrand;
    }

    const dest = path.join(workDir, `corner_byteplus_${Date.now()}.png`);
    if (bpUrl.startsWith('http')) {
      const axios = (await import('axios')).default;
      const res = await axios.get(bpUrl, { responseType: 'arraybuffer', timeout: 120000 });
      fs.writeFileSync(dest, Buffer.from(res.data));
    } else if (fs.existsSync(bpUrl)) {
      fs.copyFileSync(bpUrl, dest);
    }
    if (!fs.existsSync(dest)) {
      return logoBrand;
    }

    const cornerUpload = await this.publicUrlService.uploadFromPath(
      dest,
      `logos/${projectId}`,
      path.basename(dest),
      'image/png',
    );
    const cornerOverlay = storageResultToRef(cornerUpload, 'video-processing');
    console.log(`[BrandPackaging] BRAND_PACKAGING_APPLIED corner=byteplus_variant project=${projectId}`);
    return {
      ...logoBrand,
      cornerOverlay,
      cornerOverlayPngUrl: cornerUpload.publicUrl,
      cornerNeedsBytePlusVariant: false,
    };
  }

  private async buildEndCardPlate(
    logoBrand: LogoBrandMetadata,
    endCardLogoLocalPath: string,
    workDir: string,
  ): Promise<string> {
    const width = DEFAULT_PLATE_WIDTH;
    const height = DEFAULT_PLATE_HEIGHT;
    const ts = Date.now();

    if (
      logoBrand.overlayPolicy.endCardMode === 'byteplus' &&
      this.configService.get<string>('BRAND_END_CARD_BYTEPLUS_ENABLED') !== 'false'
    ) {
      const endCardLogoRef = getEndCardLogoRef(logoBrand);
      const externalUrl = resolveStorageRefExternalUrl(endCardLogoRef, {
        aiContentServiceUrl: this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9001',
        backendBaseUrl: this.configService.get<string>('BACKEND_BASE_URL'),
      });
      if (externalUrl) {
        const bpUrl = await this.brandVideoPostProcessor.generateBytePlusEndCardPlate(
          externalUrl,
          logoBrand.dominantColors,
          logoBrand.brandName,
        );
        if (bpUrl) {
          const dest = path.join(workDir, `endcard_plate_byteplus_${ts}.png`);
          if (bpUrl.startsWith('http')) {
            const axios = (await import('axios')).default;
            const res = await axios.get(bpUrl, { responseType: 'arraybuffer', timeout: 120000 });
            fs.writeFileSync(dest, Buffer.from(res.data));
          } else if (fs.existsSync(bpUrl)) {
            fs.copyFileSync(bpUrl, dest);
          }
          if (fs.existsSync(dest)) return dest;
        }
      }
    }

    return this.brandVideoPostProcessor.buildSolidOrGradientEndCardPng(
      width,
      height,
      endCardLogoLocalPath,
      logoBrand.dominantColors,
      logoBrand.brandName,
    );
  }

  private async waitForLogoBrand(
    projectId: string,
    userId: string,
    metadata: Record<string, unknown>,
    workDir: string,
  ): Promise<LogoBrandMetadata | null> {
    const waitSec = Number(this.configService.get<string>('BRAND_PACKAGING_LOGO_WAIT_SEC') || 90);
    const deadline = Date.now() + waitSec * 1000;

    while (Date.now() < deadline) {
      const logoBrand = metadata.logoBrand as LogoBrandMetadata | undefined;
      if (logoBrand && logoBrandHasPackagingAssets(logoBrand)) {
        return logoBrand;
      }

      const fresh = await this.databaseService.videoProject.findFirst({ where: { id: projectId } });
      if (fresh?.metadata && typeof fresh.metadata === 'object') {
        metadata = fresh.metadata as Record<string, unknown>;
        const lb = metadata.logoBrand as LogoBrandMetadata | undefined;
        if (lb && logoBrandHasPackagingAssets(lb)) return lb;
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    const resolved = await this.brandLogoResolver.resolve({
      metadata,
      projectId,
      userId,
      workDir,
    });

    if (resolved.logoBrand) {
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          metadata: {
            ...metadata,
            logoBrand: resolved.logoBrand,
          } as any,
        },
      });
      return resolved.logoBrand;
    }

    return null;
  }

  private async patchBrandPackaging(projectId: string, patch: Partial<BrandPackagingMetadata>) {
    const project = await this.databaseService.videoProject.findFirst({ where: { id: projectId } });
    if (!project) return;
    const metadata = this.asMetadata(project.metadata);
    const current = (metadata.brandPackaging as BrandPackagingMetadata) || {};
    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        metadata: {
          ...metadata,
          brandPackaging: { ...current, ...patch },
        } as any,
      },
    });
  }

  private asMetadata(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { ...(raw as Record<string, unknown>) };
    }
    return {};
  }

  getResolveOptions() {
    const aiContentUrl =
      this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9001';
    const aiContentUploadsDir =
      this.configService.get<string>('AI_CONTENT_UPLOADS_DIR') ||
      path.join(process.cwd(), '../ai-content-service/uploads');
    return {
      uploadsDir: this.uploadsDir,
      aiContentServiceUrl: aiContentUrl,
      backendBaseUrl: this.configService.get<string>('BACKEND_BASE_URL') || aiContentUrl,
      aiContentUploadsDir,
    };
  }
}
