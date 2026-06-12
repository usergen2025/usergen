import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../common/database/database.service';
import { VideoService } from '../video/video.service';
import { BytePlusProvider } from './providers/byteplus.provider';
import {
  HeyGenAvatarIVRequest,
  HeyGenVideoProvider,
  HeyGenVideoStatus,
} from './providers/heygen-video.provider';
import { VideoCompositorProvider } from './providers/video-compositor.provider';
import { HtmlCaptionLayerProvider } from './providers/html-caption-layer.provider';
import { PublicUrlService } from '../common/storage/public-url.service';
import { QueueManagerService } from '../common/queue/queue-manager.service';
import { getRenderingRollbackStep } from '../common/constants/video-steps';
import { aggregateVoiceoversFromScript } from '../common/utils/script-aggregate';
import { UserNotificationService } from '../notifications/user-notification.service';
import { ProjectLogService } from '../common/logging/project-log.service';
import {
  BrandVideoPostProcessorService,
} from '../brand/brand-video-post-processor.service';
import { BrandLogoResolverService } from '../brand/brand-logo-resolver.service';
import { BrandPackagingService } from '../brand/brand-packaging.service';
import {
  LogoBrandMetadata,
  logoBrandHasPackagingAssets,
} from '@shared/brand/logo-brand.types';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class RenderingService {
  private readonly uploadsDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly videoService: VideoService,
    private readonly bytePlusProvider: BytePlusProvider,
    private readonly heygenVideoProvider: HeyGenVideoProvider,
    private readonly videoCompositor: VideoCompositorProvider,
    private readonly htmlCaptionLayerProvider: HtmlCaptionLayerProvider,
    private readonly publicUrlService: PublicUrlService,
    private readonly queueManager: QueueManagerService,
    private readonly userNotificationService: UserNotificationService,
    private readonly projectLog: ProjectLogService,
    private readonly brandVideoPostProcessor: BrandVideoPostProcessorService,
    private readonly brandLogoResolver: BrandLogoResolverService,
    private readonly brandPackagingService: BrandPackagingService,
  ) {
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  private buildHeyGenV3Context(
    project: { id: string; script?: unknown; voiceId?: string | null; metadata?: unknown },
    request: HeyGenAvatarIVRequest,
  ) {
    const fullScript = aggregateVoiceoversFromScript(project.script);
    const voiceId =
      (project.voiceId as string) ||
      this.configService.get<string>('HEYGEN_DEFAULT_VOICE_ID') ||
      '';
    const uploadedAudioId = request.audio_asset_id?.trim();
    const uploadedAudioUrl = request.audio_url?.trim();
    if (!uploadedAudioId && !uploadedAudioUrl && !(fullScript.trim() && voiceId.trim())) {
      return undefined;
    }
    const meta = (project.metadata as Record<string, unknown>) || {};
    return {
      fullScriptText: fullScript,
      voiceId,
      projectId: project.id,
      ...(uploadedAudioId ? { audioAssetId: uploadedAudioId } : {}),
      ...(typeof meta.heygenV3ImageAssetId === 'string'
        ? { cachedV3ImageAssetId: meta.heygenV3ImageAssetId }
        : {}),
      ...(typeof meta.heygenV3AvatarId === 'string'
        ? { cachedV3AvatarId: meta.heygenV3AvatarId }
        : {}),
    };
  }

  /**
   * HeyGen avatar video: legacy /video/av4 or v3 pipelines + unified polling.
   */
  async generateAndPollAvatarVideoUnified(
    project: { id: string; script?: unknown; voiceId?: string | null; metadata?: unknown },
    request: HeyGenAvatarIVRequest,
    maxPollingAttempts: number,
    intervalMs = 5000,
  ): Promise<HeyGenVideoStatus> {
    const v3Ctx = this.buildHeyGenV3Context(project, request);
    const pipelineMode = this.heygenVideoProvider.getAvatarPipelineMode();
    const engineType = this.heygenVideoProvider.getAvatarEngineType();
    const uploadedAudioId = request.audio_asset_id?.trim();
    await this.projectLog
      .logProject(
        project.id,
        'INFO',
        `HeyGen video start: pipeline=${pipelineMode}, engine=${engineType}, stitched_audio_upload=${uploadedAudioId ? 'yes' : 'no'}`,
        { op: 'heygen_video' },
      )
      .catch(() => {});
    const start = await this.heygenVideoProvider.generateAvatarVideoUnified(request, v3Ctx);
    return this.heygenVideoProvider.pollAvatarVideoUntilCompleteUnified(
      start,
      maxPollingAttempts,
      intervalMs,
    );
  }

  /** @deprecated Use generateAndPollAvatarVideoUnified */
  async generateAndPollAvatarIVUnified(
    project: { id: string; script?: unknown; voiceId?: string | null; metadata?: unknown },
    request: HeyGenAvatarIVRequest,
    maxPollingAttempts: number,
    intervalMs = 5000,
  ): Promise<HeyGenVideoStatus> {
    return this.generateAndPollAvatarVideoUnified(project, request, maxPollingAttempts, intervalMs);
  }

  private paymentServiceBase(): string {
    return (this.configService.get<string>('PAYMENT_SERVICE_URL') || 'http://localhost:9005').replace(/\/api\/?$/, '');
  }

  /** Block start of render if unsettled + final render fee exceeds wallet. */
  private async assertExportAffordable(projectId: string, userId: string): Promise<void> {
    const paymentBase = this.paymentServiceBase();
    try {
      const response = await axios.post(
        `${paymentBase}/api/credits/check-export-affordability`,
        { projectId, userId },
        { timeout: 12000 },
      );
      const data = response.data?.data;
      if (data && data.affordable === false) {
        throw new HttpException(
          {
            code: 'INSUFFICIENT_CREDITS',
            message: data.message || 'Insufficient credits',
            requiredCredits: data.requiredCredits,
            currentBalance: data.currentBalance,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      const msg = err?.response?.data?.message || err?.message || 'Payment service unavailable';
      throw new HttpException(
        {
          code: 'AFFORDABILITY_CHECK_FAILED',
          message: typeof msg === 'string' ? msg : 'Could not verify credits. Please try again.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Single wallet debit for all unsettled snapshots + FINAL_RENDER line (deferred billing).
   */
  private async chargeFinalRenderCredits(projectId: string, userId: string): Promise<void> {
    try {
      const proj = await this.databaseService.videoProject.findUnique({ where: { id: projectId } });
      if (!proj) return;

      const settlementNonce = crypto.randomUUID();

      const response = await axios.post(
        `${this.paymentServiceBase()}/api/credits/settle-project`,
        { projectId, userId, settlementNonce },
        { timeout: 30000 },
      );

      if (!response.data?.success) {
        console.warn(`[RenderingService] Settlement incomplete for ${projectId}:`, response.data);
        return;
      }

      if (response.data.data?.duplicate) {
        return;
      }

      const amount = typeof response.data.data?.amount === 'number' ? response.data.data.amount : 0;
      const raw = proj.metadata;
      const meta =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : {};
      meta.billingWalletSettledAt = new Date().toISOString();

      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          metadata: meta as object,
          creditsSpent: (proj.creditsSpent ?? 0) + amount,
        },
      });
    } catch (err: any) {
      console.error('[RenderingService] chargeFinalRenderCredits (settlement):', err?.message ?? err);
    }
  }

  /**
   * Queue lightweight preview derivatives generation.
   */
  private async enqueuePreviewDerivatives(projectId: string, userId: string, videoUrl: string): Promise<void> {
    try {
      await this.queueManager.addPreviewDerivativesJob({
        projectId,
        userId,
        videoUrl,
      });
    } catch (err: any) {
      console.warn(`[RenderingService] Failed to queue preview derivatives for ${projectId}: ${err?.message || err}`);
    }
  }

  /**
   * Apply brand packaging (corner logo + end card), upload, mark COMPLETED, queue preview.
   */
  private async finalizeAndPublishVideo(
    projectId: string,
    userId: string,
    project: any,
    pathForUpload: string,
    userDir: string,
    totalDuration: number,
    styleLabel: string,
  ): Promise<{ publicUrl: string; localVideoUrl: string; finalDuration: number }> {
    let finalPath = pathForUpload;
    let finalDuration = totalDuration;

    const freshProject = await this.databaseService.videoProject.findFirst({
      where: { id: projectId },
    });
    let metadata =
      freshProject?.metadata &&
      typeof freshProject.metadata === 'object' &&
      !Array.isArray(freshProject.metadata)
        ? ({ ...(freshProject.metadata as Record<string, unknown>) } as Record<string, unknown>)
        : project.metadata &&
            typeof project.metadata === 'object' &&
            !Array.isArray(project.metadata)
          ? ({ ...(project.metadata as Record<string, unknown>) } as Record<string, unknown>)
          : {};

    const resolved = await this.brandLogoResolver.resolve({
      metadata,
      projectId,
      userId,
      workDir: userDir,
    });

    if (resolved.source === 'fallback' && resolved.logoBrand) {
      metadata.logoBrand = resolved.logoBrand;
    }

    let logoBrand = resolved.logoBrand;
    const hasLogo = this.brandPackagingService.hasLogoAsset(metadata);

    if (hasLogo && (!logoBrand || !logoBrandHasPackagingAssets(logoBrand))) {
      console.warn(
        `[RenderingService] ${styleLabel}: BRAND_SKIPPED_NO_LOGO_BRAND — waiting for logoBrand (${resolved.reason || 'missing'})`,
      );
      try {
        const workDir = path.join(userDir, 'brand_emergency');
        if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
        await this.brandPackagingService.processProject(projectId, userId, workDir);
      } catch (e: any) {
        console.warn(`[RenderingService] ${styleLabel}: emergency logoBrand build failed: ${e?.message}`);
      }
      const refreshed = await this.databaseService.videoProject.findFirst({ where: { id: projectId } });
      if (refreshed?.metadata && typeof refreshed.metadata === 'object') {
        metadata = { ...(refreshed.metadata as Record<string, unknown>) };
        logoBrand = metadata.logoBrand as LogoBrandMetadata | undefined;
      }
    }

    if (hasLogo) {
      const bp = metadata.brandPackaging as { status?: string } | undefined;
      if (bp?.status !== 'ready' && bp?.status !== 'skipped') {
        const ready = await this.brandPackagingService.waitUntilReady(projectId);
        if (!ready) {
          console.warn(
            `[RenderingService] ${styleLabel}: brand packaging not ready in time — attempting emergency apply`,
          );
          try {
            const workDir = path.join(userDir, 'brand_emergency');
            if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
            await this.brandPackagingService.processProject(projectId, userId, workDir);
          } catch (e: any) {
            console.warn(`[RenderingService] ${styleLabel}: emergency brand packaging failed: ${e?.message}`);
          }
          const refreshed = await this.databaseService.videoProject.findFirst({ where: { id: projectId } });
          if (refreshed?.metadata && typeof refreshed.metadata === 'object') {
            metadata = { ...(refreshed.metadata as Record<string, unknown>) };
            logoBrand = metadata.logoBrand as LogoBrandMetadata | undefined;
          }
        } else {
          const refreshed = await this.databaseService.videoProject.findFirst({ where: { id: projectId } });
          if (refreshed?.metadata && typeof refreshed.metadata === 'object') {
            metadata = { ...(refreshed.metadata as Record<string, unknown>) };
            logoBrand = metadata.logoBrand as LogoBrandMetadata | undefined;
          }
        }
      }
    }

    if (logoBrand?.overlayPolicy && logoBrandHasPackagingAssets(logoBrand)) {
      try {
        const brandedPath = path.join(userDir, `final_branded_${projectId}_${Date.now()}.mp4`);
        const packaged = await this.brandVideoPostProcessor.applyBrandPackaging(
          pathForUpload,
          brandedPath,
          logoBrand,
          userDir,
        );
        if (packaged.cornerApplied || packaged.endCardApplied) {
          finalPath = packaged.outputPath;
          finalDuration += packaged.durationAddedSec;
          metadata.brandPackagingApplied = packaged.endCardApplied;
          console.log(
            `[RenderingService] ${styleLabel}: BRAND_PACKAGING_APPLIED corner=${packaged.cornerApplied} end=${packaged.endCardApplied} +${packaged.durationAddedSec}s source=${resolved.source}`,
          );
        } else {
          console.warn(
            `[RenderingService] ${styleLabel}: BRAND_PACKAGING_NOOP (source=${resolved.source})`,
          );
        }
      } catch (brandErr: any) {
        console.warn(`[RenderingService] ${styleLabel}: Brand packaging skipped: ${brandErr?.message}`);
      }
    } else if (hasLogo) {
      console.warn(
        `[RenderingService] ${styleLabel}: BRAND_SKIPPED_NO_LOGO_BRAND (${resolved.reason || 'unknown'})`,
      );
    }

    const localVideoUrl = `/uploads/videos/${userId}/${path.basename(finalPath)}`;
    let publicUrl: string = localVideoUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        finalPath,
        `videos/${userId}`,
        path.basename(finalPath),
        'video/mp4',
      );
      if (storageResult.publicUrl) {
        publicUrl = storageResult.publicUrl;
      }
      if (storageResult.gcsUrl) {
        console.log(`[RenderingService] ✅ ${styleLabel} final video uploaded to GCS: ${storageResult.gcsUrl}`);
      }
    } catch (error: any) {
      console.warn(`[RenderingService] GCS upload failed for ${styleLabel} final video: ${error.message}`);
    }

    const projectStyle = String(
      freshProject?.style || project?.style || styleLabel || '',
    );
    if (projectStyle === 'AVATAR_ONLY' || projectStyle === 'ANIMATED_AVATAR') {
      metadata.singleClipStyle = true;
    }

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        renderingStatus: 'completed' as any,
        renderingProgress: 100 as any,
        videoUrl: publicUrl || localVideoUrl,
        duration: finalDuration,
        currentStep: 'COMPLETED',
        completedAt: new Date(),
        metadata: metadata as any,
      } as any,
    });

    await this.enqueuePreviewDerivatives(projectId, userId, publicUrl || localVideoUrl);
    await this.chargeFinalRenderCredits(projectId, userId);
    await this.userNotificationService.notifyVideoReadyForProject(userId, projectId).catch(() => {});

    console.log(`[RenderingService] ${styleLabel} video completed: ${publicUrl || localVideoUrl}`);
    return { publicUrl: publicUrl || localVideoUrl, localVideoUrl, finalDuration };
  }

  private findExistingSourceVideoPath(
    userId: string,
    projectId: string,
    videoUrl?: string | null,
    brandPackagingApplied?: boolean,
  ): string | null {
    const dir = path.join(this.uploadsDir, 'videos', userId);
    if (!fs.existsSync(dir)) return null;

    const newestWithPrefix = (prefix: string): string | null => {
      const candidates = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.mp4'))
        .map((f) => {
          const full = path.join(dir, f);
          return { full, mtime: fs.statSync(full).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      return candidates[0]?.full ?? null;
    };

    if (videoUrl && !videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
      const basename = path.basename(videoUrl.replace(/\\/g, '/'));
      const exact = path.join(dir, basename);
      if (fs.existsSync(exact)) return exact;
    }

    const branded = newestWithPrefix(`final_branded_${projectId}_`);
    if (branded) return branded;

    if (brandPackagingApplied) return null;

    const avatarOnly = newestWithPrefix(`avatar_only_${projectId}_`);
    if (avatarOnly) return avatarOnly;

    return newestWithPrefix(`final_${projectId}_`);
  }

  private async resolveVideoUrlToLocalPath(
    sourceVideoUrl: string,
    workDir: string,
  ): Promise<string> {
    if (sourceVideoUrl.startsWith('/uploads/')) {
      const relative = sourceVideoUrl.replace(/^\/uploads\//, '');
      const local = path.join(this.uploadsDir, relative);
      if (!fs.existsSync(local)) {
        throw new Error(`Source video not found at ${local}`);
      }
      return local;
    }
    if (sourceVideoUrl.startsWith('http://') || sourceVideoUrl.startsWith('https://')) {
      const dest = path.join(workDir, `source_${Date.now()}.mp4`);
      const response = await axios.get<ArrayBuffer>(sourceVideoUrl, {
        responseType: 'arraybuffer',
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      fs.writeFileSync(dest, Buffer.from(response.data));
      return dest;
    }
    if (fs.existsSync(sourceVideoUrl)) {
      return sourceVideoUrl;
    }
    throw new Error(`Unsupported or missing source video: ${sourceVideoUrl}`);
  }

  /** BGM + captions + brand publish on an existing avatar clip (no HeyGen). */
  private async enhanceAndPublishFinalPath(
    projectId: string,
    userId: string,
    project: any,
    sourcePath: string,
    userDir: string,
    audioFiles: any[],
    styleLabel: string,
  ): Promise<void> {
    const sortedAudioFiles = [...audioFiles].sort(
      (a, b) => (a.sceneNumber ?? 0) - (b.sceneNumber ?? 0),
    );
    const totalDuration = sortedAudioFiles.reduce(
      (sum, af) => sum + (af.duration || 0),
      0,
    );

    await this.updateRenderingStatus(projectId, 'stitching', 50);

    let pathForUpload = await this.applyBackgroundMusicIfEnabled(
      project,
      sourcePath,
      userDir,
      projectId,
    );

    if (project.captionsEnabled && project.captionSettings) {
      try {
        console.log(`[RenderingService] ${styleLabel}: Adding captions to final video...`);
        const captionedPath = await this.addCaptionsToFinalVideo(
          pathForUpload,
          userDir,
          projectId,
          sortedAudioFiles,
          project.captionSettings,
        );
        if (captionedPath) {
          pathForUpload = captionedPath;
        }
      } catch (captionError: any) {
        console.error(
          `[RenderingService] ${styleLabel}: Failed to add captions: ${captionError.message}`,
        );
      }
    }

    await this.updateRenderingStatus(projectId, 'finalizing', 85);

    await this.finalizeAndPublishVideo(
      projectId,
      userId,
      project,
      pathForUpload,
      userDir,
      totalDuration,
      styleLabel,
    );
  }

  /**
   * Re-export for single-clip avatar styles: apply music/captions/brand only (no HeyGen).
   */
  async postProcessExport(
    projectId: string,
    userId: string,
    authToken?: string,
  ): Promise<{ success: boolean; message: string }> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const style = String(project.style || '');
    if (style !== 'AVATAR_ONLY' && style !== 'ANIMATED_AVATAR') {
      throw new HttpException(
        'Post-process export is only available for avatar-only video styles',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!project.videoUrl) {
      throw new HttpException(
        'No existing video to enhance. Complete avatar rendering first.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const audioFiles = (project.audioFiles as any[]) || [];
    if (audioFiles.length === 0) {
      throw new HttpException(
        'Audio files not found. Please generate audio first.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.assertExportAffordable(projectId, userId);

    const meta =
      project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
        ? (project.metadata as Record<string, unknown>)
        : {};
    const brandPackagingApplied = meta.brandPackagingApplied === true;

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'IN_PROGRESS',
        renderingStatus: 'stitching' as any,
        renderingProgress: 10 as any,
      },
    });

    await this.projectLog
      .logProject(
        projectId,
        'INFO',
        'Post-process export started: applying music, captions, and brand to your avatar video.',
        { op: 'post_process_export_start' },
      )
      .catch(() => {});

    this.processPostProcessExport(projectId, userId, authToken).catch(async (error) => {
      console.error(`[RenderingService] Post-process export failed for ${projectId}:`, error);
      const rollbackStep = getRenderingRollbackStep();
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          status: 'FAILED',
          renderingStatus: 'failed' as any,
          currentStep: rollbackStep as any,
          metadata: {
            ...meta,
            lastRenderError: error?.message || String(error),
          } as any,
        },
      });
    });

    return {
      success: true,
      message: 'Post-process export started',
    };
  }

  private async processPostProcessExport(
    projectId: string,
    userId: string,
    _authToken?: string,
  ): Promise<void> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId },
    });
    if (!project) throw new Error('Project not found');

    const meta =
      project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
        ? (project.metadata as Record<string, unknown>)
        : {};
    const brandPackagingApplied = meta.brandPackagingApplied === true;

    const userDir = path.join(this.uploadsDir, 'videos', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    let sourcePath = this.findExistingSourceVideoPath(
      userId,
      projectId,
      project.videoUrl,
      brandPackagingApplied,
    );

    if (!sourcePath) {
      const workDir = path.join(userDir, `post_process_${Date.now()}`);
      fs.mkdirSync(workDir, { recursive: true });
      sourcePath = await this.resolveVideoUrlToLocalPath(project.videoUrl!, workDir);
    }

    const audioFiles = (project.audioFiles as any[]) || [];
    const styleLabel = String(project.style || 'AVATAR_ONLY');

    await this.enhanceAndPublishFinalPath(
      projectId,
      userId,
      project,
      sourcePath,
      userDir,
      audioFiles,
      styleLabel,
    );
  }

  /**
   * Convert video style enum to kebab-case directory name
   * HALF_N_HALF -> half-n-half
   * AVATAR_CUTOUT -> avatar-cutout
   * ALTERNATE -> alternate
   */
  private getStyleDirectoryName(style: string | null | undefined): string {
    if (!style) {
      return 'unknown';
    }
    return style.toLowerCase().replace(/_/g, '-');
  }

  /**
   * Calculate dynamic max polling attempts based on video duration
   * Formula: 90 attempts per 30 seconds of video duration
   * This ensures longer videos have enough time to complete generation
   * 
   * @param durationSeconds Total duration of the video in seconds
   * @returns Number of max polling attempts
   */
  calculateMaxPollingAttempts(durationSeconds: number): number {
    // Each 30-second bucket gets 90 attempts
    // With 5-second polling interval, that's 7.5 minutes per 30 seconds of video
    const buckets = Math.ceil(durationSeconds / 30);
    const maxAttempts = buckets * 90;
    
    // Minimum of 90 attempts (covers videos up to 30 seconds)
    const finalAttempts = Math.max(90, maxAttempts);
    
    console.log(`[RenderingService] Calculated polling attempts: ${finalAttempts} for ${durationSeconds}s video (${buckets} x 30s buckets)`);
    
    return finalAttempts;
  }

  /**
   * Generate a hash of file paths and modification times to detect changes
   */
  private generateSourceHash(filePaths: string[]): string {
    const hash = crypto.createHash('sha256');
    
    for (const filePath of filePaths) {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        // Include file path and modification time in hash
        hash.update(`${filePath}:${stats.mtimeMs}:${stats.size}`);
      } else {
        hash.update(`${filePath}:missing`);
      }
    }
    
    return hash.digest('hex');
  }

  /**
   * Get cached intermediate file path from database
   */
  private getCachedIntermediateFile(project: any, fileType: 'stitched_broll' | 'stitched_audio'): { path: string; sourceHash: string } | null {
    const metadata = (project.metadata as any) || {};
    const intermediateFiles = metadata.intermediateFiles || {};
    const cached = intermediateFiles[fileType];
    
    if (cached && cached.path && fs.existsSync(cached.path)) {
      return cached;
    }
    
    return null;
  }

  /**
   * Save cached intermediate file path to database
   */
  private async saveCachedIntermediateFile(
    projectId: string,
    fileType: 'stitched_broll' | 'stitched_audio',
    filePath: string,
    sourceHash: string
  ): Promise<void> {
    const project = await this.databaseService.videoProject.findUnique({
      where: { id: projectId },
    });
    
    if (!project) return;
    
    const metadata = (project.metadata as any) || {};
    const intermediateFiles = metadata.intermediateFiles || {};
    
    intermediateFiles[fileType] = {
      path: filePath,
      sourceHash: sourceHash,
      cachedAt: new Date().toISOString(),
    };
    
    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        metadata: {
          ...metadata,
          intermediateFiles: intermediateFiles,
        } as any,
      },
    });
  }

  /**
   * Get the appropriate audio file path based on user's selection (original vs transformed)
   * @param audioFile The audio file object containing original, transformed, and useTransformed properties
   * @returns The filePath to use based on user's preference
   */
  private getAudioFilePath(audioFile: any): string | null {
    // If useTransformed is true and we have transformed audio, use it
    if (audioFile.useTransformed && audioFile.transformed?.filePath) {
      return audioFile.transformed.filePath;
    }
    
    // If we have original audio stored in the new structure, use it
    if (audioFile.original?.filePath) {
      return audioFile.original.filePath;
    }
    
    // Fallback to the legacy filePath field for backwards compatibility with old AI-generated audio
    return audioFile.filePath || null;
  }

  /**
   * Public method for AlternateAvatarService and other consumers to fetch avatar details for ALTERNATE style
   */
  async getAvatarDetailsForAlternate(avatarId: string, userId: string, authToken?: string) {
    return this.fetchAvatarDetails(avatarId, userId, authToken, false, true);
  }

  /**
   * Fetch avatar details from ai-content-service or HeyGen API to get talking_photo_id and imageKey
   * First tries to fetch from ai-content-service (for internal IDs) using userId.
   * If that fails with 404, tries HeyGen API as fallback.
   * @param useTransparent If true, will fetch/create transparent imageKey for CUTOUT mode
   * @param useHalfNHalf If true, will fetch imageKeyHalfNHalfWithWhite for HALF_N_HALF Premium mode
   */
  private async fetchAvatarDetails(avatarId: string, userId: string, authToken?: string, useTransparent: boolean = false, useHalfNHalf: boolean = false): Promise<{ providerAvatarId: string; imageKey?: string; imageKeyHalfNHalfWithWhite?: string; isHeyGenId: boolean }> {
    try {
      // First, try to fetch from ai-content-service (for internal IDs)
      const aiContentServiceUrl = this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9001';
      try {
        // IMPORTANT: Pass userId as query parameter to match the avatar correctly
        // authToken from controller already includes "Bearer " prefix, so use it directly
        const headers: Record<string, string> = {};
        if (authToken) {
          // If authToken already has "Bearer ", use it as-is, otherwise add it
          headers.Authorization = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
        }
        
        console.log(`[RenderingService] Fetching avatar ${avatarId} for userId ${userId} from ${aiContentServiceUrl}/api/avatars/${avatarId}`);
        const response = await axios.get(`${aiContentServiceUrl}/api/avatars/${avatarId}`, {
          headers,
          params: { userId }, // Pass userId to find the correct avatar
        });
        
        if (response.data?.success && response.data?.data) {
          // Internal avatar ID found - use providerAvatarId from ai-content-service
          const avatarData = response.data.data;
          let providerAvatarId = avatarData.providerAvatarId;
          
          // If providerAvatarId is not set, check generationMetadata for motionAvatarId
          if (!providerAvatarId) {
            const generationMetadata = avatarData.generationMetadata as any;
            if (generationMetadata) {
              providerAvatarId = generationMetadata.motionAvatarId || generationMetadata.motion_id;
              if (providerAvatarId) {
                console.log(`[RenderingService] Found motionAvatarId in generationMetadata: ${providerAvatarId}`);
              }
            }
          }
          
          if (!providerAvatarId) {
            throw new Error('Provider avatar ID (motion ID) not found in avatar details. Avatar may not be ready yet. Generation status: ' + (avatarData.generationStatus || 'unknown'));
          }
          
          // Get imageKey for Premium mode (Avatar IV)
          // For CUTOUT mode, use transparent imageKey if available (created from processed 1080x1920)
          // For HALF_N_HALF Premium mode, use imageKeyHalfNHalfWithWhite if available
          // For ALTERNATE Premium mode, use imageKey (which should be imageKeyFull - processed 1080x1920)
          // Note: imageKey gets updated to imageKeyFull after processing completes
          let imageKey = avatarData.imageKey;
          let imageKeyHalfNHalfWithWhite: string | undefined;
          
          // For ALTERNATE and CUTOUT Premium modes, ensure we use processed imageKeyFull if available
          // Check if processed images exist (imageKeyFull is stored in imageKey after processing)
          // For old avatars that haven't been processed, imageKey will still be original
          // In that case, we'll use the original (fallback behavior)
          
          if (useHalfNHalf) {
            console.log(`[RenderingService] HALF_N_HALF Premium mode: Checking for processed image key...`);
            
            // Check if HALF_N_HALF processed version exists
            if (avatarData.imageKeyHalfNHalfWithWhite) {
              imageKeyHalfNHalfWithWhite = avatarData.imageKeyHalfNHalfWithWhite;
              console.log(`[RenderingService] HALF_N_HALF Premium mode: Using processed imageKeyHalfNHalfWithWhite: ${imageKeyHalfNHalfWithWhite}`);
            } else {
              // Old avatar - trigger on-demand processing
              console.log(`[RenderingService] HALF_N_HALF Premium mode: ⚠️  Processed image key not found for old avatar, triggering on-demand processing...`);
              try {
                const headers: Record<string, string> = {};
                if (authToken) {
                  headers.Authorization = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
                }
                
                const processResponse = await axios.post(
                  `${aiContentServiceUrl}/api/avatars/${avatarId}/process-images`,
                  {},
                  { 
                    headers,
                    params: { userId },
                    timeout: 5000, // Short timeout - don't wait for completion
                  }
                );
                
                if (processResponse.data?.data?.jobId) {
                  console.log(`[RenderingService] HALF_N_HALF Premium mode: ✅ Image processing job queued (jobId: ${processResponse.data.data.jobId})`);
                  console.log(`[RenderingService] HALF_N_HALF Premium mode: ⚠️  Using default imageKey for now. Processed images will be available for future generations.`);
                }
              } catch (processError: any) {
                console.error(`[RenderingService] HALF_N_HALF Premium mode: ❌ Failed to trigger on-demand processing: ${processError.message}`);
                console.warn(`[RenderingService] HALF_N_HALF Premium mode: ⚠️  Using default imageKey (may not be optimal for HALF_N_HALF)`);
              }
              
              // Fall back to default imageKey
              imageKeyHalfNHalfWithWhite = undefined;
            }
          } else if (useTransparent) {
            console.log(`[RenderingService] CUTOUT mode: Checking for transparent imageKey...`);
            
            // Check if transparent version exists
            if (avatarData.transparentImageKey) {
              imageKey = avatarData.transparentImageKey;
              console.log(`[RenderingService] CUTOUT mode: Using existing transparent imageKey: ${imageKey}`);
            } else {
              // Create transparent version on-demand from processed 1080x1920 image
              // The create-transparent endpoint now uses processed full_9x16_1080x1920.jpg if available
              console.log(`[RenderingService] CUTOUT mode: Transparent version not found, creating from processed 1080x1920 image...`);
              try {
                const aiContentServiceUrl = this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9001';
                const headers: Record<string, string> = {};
                if (authToken) {
                  headers.Authorization = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
                }
                
                const transparentResponse = await axios.post(
                  `${aiContentServiceUrl}/api/avatars/${avatarId}/create-transparent`,
                  {},
                  { headers }
                );
                
                if (transparentResponse.data?.success && transparentResponse.data?.data?.imageKey) {
                  imageKey = transparentResponse.data.data.imageKey;
                  console.log(`[RenderingService] CUTOUT mode: ✅ Transparent version created successfully from processed image. ImageKey: ${imageKey}`);
                } else {
                  console.warn(`[RenderingService] CUTOUT mode: ⚠️  Failed to create transparent version, using processed imageKey`);
                  // Use processed imageKey (imageKeyFull) if available, otherwise fall back to original
                }
              } catch (transparentError: any) {
                console.error(`[RenderingService] CUTOUT mode: ❌ Failed to create transparent version: ${transparentError.message}`);
                console.warn(`[RenderingService] CUTOUT mode: ⚠️  Using processed imageKey (video may have background)`);
                // Use processed imageKey (imageKeyFull) if available, otherwise fall back to original
              }
            }
          } else {
            // ALTERNATE mode (no special params)
            // imageKey should be imageKeyFull (processed 1080x1920) after processing completes
            // For old avatars, it might still be original, but that's acceptable
            console.log(`[RenderingService] ALTERNATE mode: Using imageKey (processed 1080x1920 if available): ${imageKey || 'not available'}`);
          }
          
          console.log(`[RenderingService] Found internal avatar ${avatarId}, using providerAvatarId (motion ID): ${providerAvatarId}, imageKey: ${imageKey || 'not available'}, imageKeyHalfNHalfWithWhite: ${imageKeyHalfNHalfWithWhite || 'not available'}`);
          return { providerAvatarId, imageKey, imageKeyHalfNHalfWithWhite, isHeyGenId: false };
        }
      } catch (aiContentError: any) {
        // Log detailed error information for debugging
        console.error(`[RenderingService] Failed to fetch avatar from ai-content-service:`, {
          avatarId,
          userId,
          status: aiContentError.response?.status,
          statusText: aiContentError.response?.statusText,
          errorMessage: aiContentError.message,
          responseData: aiContentError.response?.data,
          url: `${aiContentServiceUrl}/api/avatars/${avatarId}?userId=${userId}`,
        });
        
        // If 404, try HeyGen API as fallback (for any ID format)
        if (aiContentError.response?.status === 404) {
          console.log(`[RenderingService] Avatar ${avatarId} not found in ai-content-service (404) for userId ${userId}. This could mean:`);
          console.log(`[RenderingService] 1. Avatar doesn't exist in database`);
          console.log(`[RenderingService] 2. Avatar exists but belongs to a different userId`);
          console.log(`[RenderingService] 3. Database mismatch between services`);
          console.log(`[RenderingService] Trying HeyGen API as fallback...`);
          
          try {
            const heygenAvatarDetails = await this.heygenVideoProvider.getAvatarDetails(avatarId);
            console.log(`[RenderingService] Avatar ${avatarId} found in HeyGen API, using directly as talking_photo_id`);
            return { providerAvatarId: avatarId, isHeyGenId: true };
          } catch (heygenError: any) {
            // HeyGen API also failed - provide more detailed error
            const heygenErrorMsg = heygenError.response?.data?.msg || heygenError.response?.data?.error?.message || heygenError.message;
            throw new Error(`Avatar ${avatarId} not found in ai-content-service or HeyGen. AI Content Service: ${aiContentError.message}. HeyGen: ${heygenErrorMsg}`);
          }
        } else {
          // Other error from ai-content-service (not 404)
          throw aiContentError;
        }
      }
      
      throw new Error('Failed to fetch avatar details');
    } catch (error: any) {
      console.error(`[RenderingService] Failed to fetch avatar details for ${avatarId}:`, error.message);
      throw new Error(`Failed to fetch avatar details: ${error.message}`);
    }
  }

  /**
   * Start rendering process for a video project
   */
  async startRendering(projectId: string, userId: string, authToken?: string): Promise<{ success: boolean; message: string }> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    await this.assertExportAffordable(projectId, userId);

    const meta =
      project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
        ? (project.metadata as Record<string, unknown>)
        : {};
    if (this.brandPackagingService.hasLogoAsset(meta)) {
      const bp = meta.brandPackaging as { status?: string } | undefined;
      if (!bp?.status || bp.status === 'pending') {
        try {
          const prepared = await this.brandPackagingService.prepareStart(projectId, userId);
          if (!prepared.skipQueue) {
            await this.queueManager.addBrandPackagingJob({ projectId, userId });
          }
        } catch (e: any) {
          console.warn(`[RenderingService] Failed to queue brand packaging for ${projectId}: ${e?.message}`);
        }
      }
    }

    const styleLabel = String((project as { style?: string }).style || meta.style || 'video');
    await this.projectLog
      .logProject(
        projectId,
        'INFO',
        `Export started: scenes, audio, and avatar are being combined into your final ${styleLabel} video (this can take several minutes).`,
        { op: 'final_render_start' },
      )
      .catch(() => {});

    // Update project status to IN_PROGRESS
    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        status: 'IN_PROGRESS',
        renderingStatus: 'avatar_generating' as any,
        renderingProgress: 0 as any,
        startedAt: new Date(),
      },
    });

    // Start rendering in background (don't await)
    this.processVideoRendering(projectId, userId, authToken).catch(async (error) => {
      console.error(`[RenderingService] Rendering failed for project ${projectId}:`, error);
      
      // Get current project to determine which step to rollback to
      const currentProject = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });
      
      // Determine rollback step using step configuration
      // Default to step before RENDERING (BROLL_VIDEOS)
      let rollbackStep: string = getRenderingRollbackStep();
      
      // Refine based on project state (more reliable than reading currentStep, since enum update may fail)
      const bRollVideos = (currentProject as any)?.bRollVideoTasks;
      const bRollImages = (currentProject as any)?.bRollImages;
      
      if (bRollVideos && Array.isArray(bRollVideos) && bRollVideos.length > 0) {
        rollbackStep = 'BROLL_VIDEOS';
      } else if (bRollImages && Array.isArray(bRollImages) && bRollImages.length > 0) {
        rollbackStep = 'BROLL_IMAGES';
      }
      
      // Also try to read currentStep as a fallback
      try {
        const currentStep = currentProject?.currentStep as string;
        if (currentStep === 'BROLL_VIDEOS' || currentStep === 'B_ROLL') {
          rollbackStep = 'BROLL_VIDEOS';
        } else if (currentStep === 'BROLL_IMAGES') {
          rollbackStep = 'BROLL_IMAGES';
        }
      } catch (e) {
        // If we can't read currentStep (enum issue), use project state check above
        console.warn(`[RenderingService] Could not read currentStep, using project state instead`);
      }
      
      console.log(`[RenderingService] Rolling back to step: ${rollbackStep}`);
      
      // Update project with error - use multiple fallback strategies
      try {
        // First try normal update
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: {
            status: 'FAILED',
            renderingStatus: 'failed' as any,
            currentStep: rollbackStep as any,
            errorMessage: error.message || 'Video rendering failed',
            errorCode: 'RENDERING_FAILED',
          },
        });
      } catch (updateError: any) {
        // If enum update fails, try raw SQL
        console.warn(`[RenderingService] Normal update failed (enum issue), trying raw SQL: ${updateError.message}`);
        try {
          await this.databaseService.$executeRawUnsafe(`
            UPDATE "video_projects" 
            SET 
              "status" = 'FAILED',
              "renderingStatus" = 'failed',
              "currentStep" = $1::text::"VideoCreationStep",
              "errorMessage" = $2,
              "errorCode" = 'RENDERING_FAILED',
              "updatedAt" = NOW()
            WHERE "id" = $3
          `, rollbackStep, error.message || 'Video rendering failed', projectId);
          console.log(`[RenderingService] Successfully updated project status using raw SQL`);
        } catch (rawSqlError: any) {
          // If raw SQL also fails, store rollback step in metadata
          console.error(`[RenderingService] Raw SQL update also failed: ${rawSqlError.message}`);
          const metadata = (currentProject?.metadata as any) || {};
          metadata.rollbackStep = rollbackStep;
          
          try {
            await this.databaseService.videoProject.update({
              where: { id: projectId },
              data: {
                status: 'FAILED',
                renderingStatus: 'failed' as any,
                errorMessage: error.message || 'Video rendering failed',
                errorCode: 'RENDERING_FAILED',
                metadata: metadata,
              },
            });
            console.log(`[RenderingService] Stored rollback step in metadata: ${rollbackStep}`);
          } catch (metadataError: any) {
            // Last resort: just log the error
            console.error(`[RenderingService] All update methods failed. Rollback step: ${rollbackStep}`, metadataError.message);
          }
        }
      }
    });

    return {
      success: true,
      message: 'Video rendering started',
    };
  }

  /**
   * Main rendering orchestrator - processes all phases based on video style
   */
  private async processVideoRendering(projectId: string, userId: string, authToken?: string): Promise<void> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Ensure avatar image exists for avatar styles before proceeding (fixes race when using newly uploaded avatar)
    const AVATAR_STYLES = ['HALF_N_HALF', 'ALTERNATE', 'AVATAR_CUTOUT', 'AVATAR_ONLY', 'AVATAR_PRODUCT', 'ANIMATED_AVATAR'];
    if (project.avatarId && AVATAR_STYLES.includes(project.style as string)) {
      await this.videoService.ensureProjectAvatarImage(projectId, userId, authToken);
      const refreshed = await this.databaseService.videoProject.findFirst({
        where: { id: projectId },
      });
      if (refreshed) {
        Object.assign(project, refreshed);
      }
    }

    // Get audio files (should already be generated)
    const audioFiles = (project.audioFiles as any[]) || [];
    if (audioFiles.length === 0) {
      throw new Error('Audio files not found. Please generate audio first.');
    }

    // Get b-roll images and videos (should already be generated on broll-images and broll-videos pages)
    const bRollImages = ((project as any).bRollImages as any[]) || [];
    const bRollVideos = ((project as any).bRollVideoTasks as any[]) || [];

    try {
      // Handle different video styles
      if (project.style === 'HALF_N_HALF') {
        await this.processHalfAndHalf(projectId, userId, audioFiles, bRollImages, bRollVideos, project, authToken);
      } else if (project.style === 'AVATAR_CUTOUT') {
        await this.processCutout(projectId, userId, audioFiles, bRollVideos, project, authToken);
      } else if (project.style === 'ALTERNATE') {
        await this.processAlternate(projectId, userId, audioFiles, bRollVideos, project, authToken);
      } else if (project.style === 'AVATAR_ONLY') {
        await this.processAvatarOnly(projectId, userId, audioFiles, project, authToken);
      } else if (project.style === 'ANIMATED_AVATAR') {
        await this.processAvatarOnly(projectId, userId, audioFiles, project, authToken);
      } else if (project.style === 'PRODUCT_ONLY' || (project.style as string) === 'B_ROLL_ONLY') {
        await this.processProductOnly(projectId, userId, audioFiles, bRollVideos, project);
      } else if (project.style === 'AVATAR_PRODUCT') {
        await this.processAvatarProduct(projectId, userId, audioFiles, bRollVideos, project, authToken);
      } else {
        throw new Error(`Unsupported video style: ${project.style}`);
      }
    } catch (error: any) {
      console.error(`[RenderingService] Error in rendering process:`, error);
      throw error;
    }
  }

  /**
   * Process HALF_N_HALF style:
   * - B-roll videos are 3:4 ratio (generated from images on broll-images page)
   * - Stitch all b-roll videos together
   * - Stitch all audios together
   * - Generate one avatar video from full audio with greyish background
   * - Stack avatar video below b-roll video for final 9:16 video
   */
  private async processHalfAndHalf(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollImages: any[],
    bRollVideos: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing HALF_N_HALF style for project ${projectId}`);

    if (!project.avatarId) {
      throw new Error('Avatar ID required for HALF_N_HALF style');
    }

    // Sort b-roll videos and audio files by scene number
    const sortedBrollVideos = [...bRollVideos].sort((a, b) => a.sceneNumber - b.sceneNumber);
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);

    await this.updateRenderingStatus(projectId, 'stitching_broll', 20);
    
    // Stitch all b-roll videos together
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    
    // Convert paths to absolute paths before concatenation
    // Log all videos for debugging
    console.log(`[RenderingService] HALF_N_HALF: Processing ${sortedBrollVideos.length} b-roll videos:`, 
      sortedBrollVideos.map(v => ({
        sceneNumber: v.sceneNumber,
        hasLocalPath: !!v.localPath,
        localPath: v.localPath,
        hasLocalUrl: !!v.localUrl,
        localUrl: v.localUrl,
      }))
    );
    
    // Helper to resolve video paths, supporting both regular and stock video paths
    const resolveVideoPath = (v: any, sceneLabel: string): string | null => {
      let videoPath: string | null = null;
      
      if (v.localPath) {
        // Convert to absolute path if relative
        videoPath = path.isAbsolute(v.localPath) 
          ? v.localPath 
          : path.resolve(v.localPath);
      } else if (v.localUrl) {
        // If no localPath, try to derive from localUrl
        const urlPath = v.localUrl.startsWith('/uploads') ? v.localUrl : v.localUrl;
        
        // Handle different localUrl formats:
        // - /uploads/videos/{userId}/{filename} (AI-generated)
        // - /uploads/stock/{projectId}/{filename} (stock videos)
        if (urlPath.includes('/uploads/stock/')) {
          // Stock video path - resolve relative to media-management-service
          const serverRoot = path.join(process.cwd(), '..', '..');
          const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
          videoPath = path.join(mediaServiceDir, urlPath);
        } else {
          // Regular video path
          const relativePath = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
          videoPath = path.join(userDir, relativePath);
        }
      }
      
      if (!videoPath) {
        console.warn(`[RenderingService] ${sceneLabel}: Scene ${v.sceneNumber} has no localPath or localUrl`);
        return null;
      }
      
      // Check if file exists at primary path
      if (fs.existsSync(videoPath)) {
        return videoPath;
      }
      
      // Fallback: Try stock path if localPath was absolute but file doesn't exist
      // This handles the case where media-management-service stored the file
      if (v.localUrl && v.localUrl.includes('/uploads/stock/')) {
        const serverRoot = path.join(process.cwd(), '..', '..');
        const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
        const stockPath = path.join(mediaServiceDir, v.localUrl);
        if (fs.existsSync(stockPath)) {
          console.log(`[RenderingService] ${sceneLabel}: Found stock video at fallback path: ${stockPath}`);
          return stockPath;
        }
      }
      
      console.warn(`[RenderingService] ${sceneLabel}: Video file not found for scene ${v.sceneNumber}: ${videoPath}`);
      return null;
    };
    
    const brollVideoPaths = sortedBrollVideos
      .map(v => resolveVideoPath(v, 'HALF_N_HALF'))
      .filter((p): p is string => p !== null);
    
    if (brollVideoPaths.length === 0) {
      throw new Error('No valid b-roll video paths found for stitching');
    }
    
    // Check for cached stitched b-roll video
    const sourceHashBroll = this.generateSourceHash(brollVideoPaths);
    const cachedBroll = this.getCachedIntermediateFile(project, 'stitched_broll');
    
    let stitchedBrollPath: string;
    
    if (cachedBroll && cachedBroll.sourceHash === sourceHashBroll) {
      console.log(`[RenderingService] HALF_N_HALF: Reusing cached stitched b-roll video: ${cachedBroll.path}`);
      stitchedBrollPath = cachedBroll.path;
    } else {
      // Generate new stitched b-roll video with consistent filename
      stitchedBrollPath = path.join(userDir, `stitched_broll_${projectId}.mp4`);
      
      console.log(`[RenderingService] HALF_N_HALF: Stitching ${brollVideoPaths.length} videos (filtered from ${sortedBrollVideos.length})...`);
    await this.videoCompositor.concatenateVideos(brollVideoPaths, stitchedBrollPath);
      
      // Save to cache
      await this.saveCachedIntermediateFile(projectId, 'stitched_broll', stitchedBrollPath, sourceHashBroll);
      console.log(`[RenderingService] HALF_N_HALF: Stitched b-roll video cached`);
    }

    await this.updateRenderingStatus(projectId, 'stitching_audio', 40);

    // Stitch all audio files together
    // Convert file paths to absolute paths (same logic as CUTOUT)
    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');
    
    const audioPaths = sortedAudioFiles.map(af => {
      const audioFilePath = this.getAudioFilePath(af);
      if (!audioFilePath) return null;
      
      // Try multiple path resolution strategies
      let resolvedPath: string | null = null;
      
      if (path.isAbsolute(audioFilePath) && fs.existsSync(audioFilePath)) {
        resolvedPath = audioFilePath;
      } else {
        const voiceServicePath = path.join(voiceServiceDir, audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
        if (fs.existsSync(voiceServicePath)) {
          resolvedPath = voiceServicePath;
        } else {
          const serverRootPath = path.join(serverRoot, audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
          if (fs.existsSync(serverRootPath)) {
            resolvedPath = serverRootPath;
          } else {
            const cwdPath = path.join(process.cwd(), audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
            if (fs.existsSync(cwdPath)) {
              resolvedPath = cwdPath;
            }
          }
        }
      }
      
      if (!resolvedPath) {
        console.warn(`[RenderingService] Audio file not found. Tried: ${audioFilePath}`);
      }
      return resolvedPath;
    }).filter(p => p !== null && fs.existsSync(p)) as string[];
    
    if (audioPaths.length === 0) {
      throw new Error('No valid audio file paths found for stitching');
    }
    
    // Check for cached stitched audio
    const sourceHashAudio = this.generateSourceHash(audioPaths);
    const cachedAudio = this.getCachedIntermediateFile(project, 'stitched_audio');
    
    let stitchedAudioPath: string;
    
    if (cachedAudio && cachedAudio.sourceHash === sourceHashAudio) {
      console.log(`[RenderingService] HALF_N_HALF: Reusing cached stitched audio: ${cachedAudio.path}`);
      stitchedAudioPath = cachedAudio.path;
    } else {
      // Generate new stitched audio with consistent filename
      stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}.mp3`);
      
      console.log(`[RenderingService] HALF_N_HALF: Stitching ${audioPaths.length} audio files...`);
    await this.videoCompositor.concatenateAudios(audioPaths, stitchedAudioPath);
      
      // Save to cache
      await this.saveCachedIntermediateFile(projectId, 'stitched_audio', stitchedAudioPath, sourceHashAudio);
      console.log(`[RenderingService] HALF_N_HALF: Stitched audio cached`);
    }

    await this.updateRenderingStatus(projectId, 'avatar_generating', 60);

    // Generate one avatar video from full stitched audio with greyish background
    // Check if avatar video already exists from previous attempt
    let avatarVideoPath: string | null = null;
    let originalAvatarVideoPath: string | null = null;
    let imageKeyHalfNHalfWithWhite: string | undefined;
    const existingAvatarVideos = (project.avatarVideos as any) || [];
    const avatarMode = (project.avatarMode as string) || 'BASIC';
    const existingAvatarVideo = existingAvatarVideos.find((av: any) => 
      av.type === 'HALF_N_HALF' && av.mode === avatarMode
    );

    if (existingAvatarVideo && existingAvatarVideo.originalPath && fs.existsSync(existingAvatarVideo.originalPath)) {
      console.log(`[RenderingService] HALF_N_HALF: Reusing existing avatar video from previous attempt: ${existingAvatarVideo.originalPath}`);
      originalAvatarVideoPath = existingAvatarVideo.originalPath;
      avatarVideoPath = existingAvatarVideo.originalPath;
      
      // Check if cropped version exists for Premium mode
      if (avatarMode === 'PREMIUM' && existingAvatarVideo.croppedPath && fs.existsSync(existingAvatarVideo.croppedPath)) {
        console.log(`[RenderingService] HALF_N_HALF Premium: Reusing existing cropped video: ${existingAvatarVideo.croppedPath}`);
        avatarVideoPath = existingAvatarVideo.croppedPath;
      } else if (avatarMode === 'BASIC') {
        // For Basic mode, original is the final processed video
        avatarVideoPath = existingAvatarVideo.originalPath;
      }
      
      // Ensure finalProcessedPath is set if not already set
      if (!existingAvatarVideo.finalProcessedPath) {
        const updatedProject = await this.databaseService.videoProject.findUnique({
          where: { id: projectId },
        });
        const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
        const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
          av.type === 'HALF_N_HALF' && av.mode === avatarMode
        );
        
        if (avatarVideoIndex >= 0) {
          updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = avatarVideoPath;
          updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = avatarMode === 'PREMIUM' && existingAvatarVideo.croppedUrl 
            ? existingAvatarVideo.croppedUrl 
            : existingAvatarVideo.originalUrl;
          
          await this.databaseService.videoProject.update({
            where: { id: projectId },
            data: {
              avatarVideos: updatedAvatarVideos as any,
            },
          });
        }
      }
    } else {
      // Generate new avatar video
      console.log(`[RenderingService] HALF_N_HALF: Generating new avatar video...`);
      
    if (!fs.existsSync(stitchedAudioPath)) {
      throw new Error(`Stitched audio file not found: ${stitchedAudioPath}`);
    }
    const audioBuffer = fs.readFileSync(stitchedAudioPath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `full_audio_${projectId}.mp3`);

    // Avatar IV only: use project-scoped generated avatar image key (set when user was on b-roll images step)
    const projectMeta = (project.metadata as Record<string, unknown>) || {};
    const imageKeyToUse = projectMeta.generatedAvatarImageKey as string | undefined;
    if (!imageKeyToUse) {
      throw new Error(
        'Avatar image for this project has not been generated yet. Please complete the b-roll images step (generate at least one b-roll image), then try rendering again. If you just changed the script, go back to the b-roll images step and trigger image generation to regenerate the avatar image.',
      );
    }
    imageKeyHalfNHalfWithWhite = imageKeyToUse; // used later for Premium crop
    console.log(`[RenderingService] HALF_N_HALF: Using Avatar IV with project image_key`);

    const totalAudioDurationHNH = sortedAudioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);
    const maxPollingAttemptsHNH = this.calculateMaxPollingAttempts(totalAudioDurationHNH);

    const completedVideo = await this.generateAndPollAvatarVideoUnified(
      project,
      {
        image_key: imageKeyToUse,
        video_title: `Avatar Video ${projectId}`,
        audio_asset_id: audioAssetId,
        video_orientation: 'portrait',
        fit: 'cover',
      },
      maxPollingAttemptsHNH,
      5000,
    );

    const videoResponse = { video_id: completedVideo.data.id };
    console.log(`[RenderingService] Created avatar video task ${videoResponse.video_id}`);

    if (!completedVideo.data.video_url) {
      throw new Error('Avatar video generation completed but no video URL');
    }

      // Create directory structure: avatars/{projectId}/{styleType}/{avatarType}/
      const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
      const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
      const avatarDir = path.join(userDir, 'avatars', projectId, styleType, avatarType);
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

      // Use consistent filename based on projectId (not timestamp) for retry capability
      const avatarVideoFilename = `avatar_full_${projectId}.mp4`;
      originalAvatarVideoPath = path.join(avatarDir, avatarVideoFilename);
      
      // Only download if file doesn't exist
      if (!fs.existsSync(originalAvatarVideoPath)) {
        await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, originalAvatarVideoPath);
        console.log(`[RenderingService] HALF_N_HALF: Avatar video downloaded to: ${originalAvatarVideoPath}`);
      } else {
        console.log(`[RenderingService] HALF_N_HALF: Avatar video already exists, skipping download: ${originalAvatarVideoPath}`);
      }
      
      avatarVideoPath = originalAvatarVideoPath;
      
      // Save avatar video info to database for future retries
      const avatarVideoInfo = {
        type: 'HALF_N_HALF',
        mode: avatarMode,
        originalPath: originalAvatarVideoPath,
        originalUrl: `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${avatarVideoFilename}`,
        videoId: videoResponse.video_id, // Use the video_id from the response, not from completedVideo.data
        videoUrl: completedVideo.data.video_url,
        generatedAt: new Date().toISOString(),
        dimensions: avatarMode === 'PREMIUM' ? '1080x1920' : '1080x960',
      };
      
      // Update project with avatar video info
      const updatedAvatarVideos = existingAvatarVideos.filter((av: any) => 
        !(av.type === 'HALF_N_HALF' && av.mode === avatarMode)
      );
      updatedAvatarVideos.push(avatarVideoInfo);
      
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          avatarVideos: updatedAvatarVideos as any,
        },
      });
      
      console.log(`[RenderingService] HALF_N_HALF: Avatar video info saved to database for retry capability`);
    }

    // For HALF_N_HALF Premium mode, crop the white top portion (remove top 960px, keep bottom 960px)
    // When reusing existing video, use project-scoped key for crop decision
    if (avatarMode === 'PREMIUM' && originalAvatarVideoPath && !imageKeyHalfNHalfWithWhite) {
      const meta = (project.metadata as Record<string, unknown>) || {};
      imageKeyHalfNHalfWithWhite = meta.generatedAvatarImageKey as string | undefined;
    }

    if (avatarMode === 'PREMIUM' && imageKeyHalfNHalfWithWhite && originalAvatarVideoPath) {
      console.log(`[RenderingService] HALF_N_HALF Premium: Cropping white top portion from avatar video...`);
      
      // Use consistent filename for cropped version
      const croppedAvatarFilename = `avatar_cropped_${projectId}.mp4`;
      const croppedAvatarPath = path.join(path.dirname(originalAvatarVideoPath), croppedAvatarFilename);
      
      // Check if cropped version already exists
      if (!fs.existsSync(croppedAvatarPath)) {
        try {
          // Get video dimensions first to validate crop parameters
          const videoRes = await this.videoCompositor.getVideoResolution(originalAvatarVideoPath);
          if (!videoRes) {
            throw new Error('Failed to get video resolution');
          }
          
          console.log(`[RenderingService] HALF_N_HALF Premium: Video dimensions: ${videoRes.width}x${videoRes.height}`);
          
          // If video is not 1080x1920, scale it first
          if (videoRes.width !== 1080 || videoRes.height !== 1920) {
            console.log(`[RenderingService] HALF_N_HALF Premium: Scaling video from ${videoRes.width}x${videoRes.height} to 1080x1920`);
            const scaledPath = path.join(path.dirname(originalAvatarVideoPath), `avatar_scaled_${projectId}.mp4`);
            await this.videoCompositor.scaleVideoToDimensions(originalAvatarVideoPath, scaledPath, 1080, 1920);
            
            if (fs.existsSync(scaledPath)) {
              // Use scaled version for cropping
              await this.videoCompositor.cropVideo(
                scaledPath,
                croppedAvatarPath,
                0,      // x offset
                960,    // y offset (start from 960px down - skip white top)
                1080,   // width
                960     // height (crop to 1080x960)
              );
              
              // Cleanup scaled version after cropping
              try {
                fs.unlinkSync(scaledPath);
              } catch (e) {
                console.warn(`[RenderingService] Failed to cleanup scaled video: ${e}`);
              }
            } else {
              throw new Error('Video scaling failed');
            }
          } else {
            // Video is already correct size, just crop it
            await this.videoCompositor.cropVideo(
              originalAvatarVideoPath,
              croppedAvatarPath,
              0,      // x offset
              960,    // y offset (start from 960px down - skip white top)
              1080,   // width
              960     // height (crop to 1080x960)
            );
          }
          
          if (fs.existsSync(croppedAvatarPath)) {
            avatarVideoPath = croppedAvatarPath;
            console.log(`[RenderingService] HALF_N_HALF Premium: ✅ Video cropped successfully to 1080x960`);
            
            // Update database with cropped path and final processed path
            // Refetch project to get latest avatarVideos
            const updatedProject = await this.databaseService.videoProject.findUnique({
              where: { id: projectId },
            });
            const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
            const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
              av.type === 'HALF_N_HALF' && av.mode === avatarMode
            );
            
            if (avatarVideoIndex >= 0) {
              const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
              const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
              updatedAvatarVideos[avatarVideoIndex].croppedPath = croppedAvatarPath;
              updatedAvatarVideos[avatarVideoIndex].croppedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${croppedAvatarFilename}`;
              updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = croppedAvatarPath; // Final video used for composition
              updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${croppedAvatarFilename}`;
              
              await this.databaseService.videoProject.update({
                where: { id: projectId },
                data: {
                  avatarVideos: updatedAvatarVideos as any,
                },
              });
              
              console.log(`[RenderingService] HALF_N_HALF Premium: ✅ Cropped video path saved to database`);
            }
          }
        } catch (cropError: any) {
          console.error(`[RenderingService] HALF_N_HALF Premium: ⚠️ Crop failed: ${cropError.message}`);
          console.log(`[RenderingService] HALF_N_HALF Premium: Using original video (cropping can be retried later)`);
          // Don't throw - use original video as fallback
          // The original video is preserved, so user can retry cropping
          avatarVideoPath = originalAvatarVideoPath;
        }
      } else {
        console.log(`[RenderingService] HALF_N_HALF Premium: Cropped video already exists, reusing: ${croppedAvatarPath}`);
        avatarVideoPath = croppedAvatarPath;
      }
    } else if (avatarMode === 'BASIC' && originalAvatarVideoPath) {
      // For Basic mode HALF_N_HALF, the video is already 1080x960, so it's the final processed video
      // Update database to mark this as the final processed path
      const updatedProject = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
      });
      const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
      const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
        av.type === 'HALF_N_HALF' && av.mode === avatarMode
      );
      
      if (avatarVideoIndex >= 0) {
        const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
        const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
        updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = originalAvatarVideoPath;
        updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/avatar_full_${projectId}.mp4`;
        
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: {
            avatarVideos: updatedAvatarVideos as any,
          },
        });
        
        console.log(`[RenderingService] HALF_N_HALF Basic: ✅ Final processed video path saved to database`);
      }
    }

    await this.updateRenderingStatus(projectId, 'stitching', 80);

    // Stack avatar video below b-roll video for final 9:16 video
    const finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.compositeHalfAndHalf(
      stitchedBrollPath,
      avatarVideoPath,
      finalVideoPath,
      1080,
      1920 // 9:16 aspect ratio
    );

    // Add stitched audio to final video
    const finalVideoWithAudioPath = path.join(userDir, `final_with_audio_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.addAudioToVideo(finalVideoPath, stitchedAudioPath, finalVideoWithAudioPath);

    const withBgmPath = await this.applyBackgroundMusicIfEnabled(
      project,
      finalVideoWithAudioPath,
      userDir,
      projectId,
    );

    // Calculate total duration
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);

    let pathForUpload = withBgmPath;
    if (project.captionsEnabled && project.captionSettings) {
      try {
        console.log(`[RenderingService] HALF_N_HALF: Adding captions to final video...`);
        const captionedPath = await this.addCaptionsToFinalVideo(
          pathForUpload,
          userDir,
          projectId,
          sortedAudioFiles,
          project.captionSettings,
        );
        if (captionedPath) {
          pathForUpload = captionedPath;
        }
      } catch (captionError: any) {
        console.error(`[RenderingService] HALF_N_HALF: Failed to add captions: ${captionError.message}`);
        console.warn(`[RenderingService] HALF_N_HALF: Proceeding without captions`);
      }
    }

    await this.finalizeAndPublishVideo(
      projectId,
      userId,
      project,
      pathForUpload,
      userDir,
      totalDuration,
      'HALF_N_HALF',
    );
  }

  /**
   * Process CUTOUT style:
   * - Stitch all audios together
   * - Generate one avatar video from full audio (with or without green background)
   * - Stitch all b-roll videos together
   * - Overlay avatar video on stitched b-roll (bottom center, max 40% height, remove background)
   *   - Uses AI background removal for non-green backgrounds (works for both Basic and Premium avatars)
   *   - Falls back to chroma key if green screen is detected or AI removal fails
   * - Final 9:16 video
   */
  private async processCutout(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollVideos: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing CUTOUT style for project ${projectId}`);

    if (!project.avatarId) {
      throw new Error('Avatar ID required for CUTOUT style');
    }

    // Sort by scene number
    const sortedBrollVideos = [...bRollVideos].sort((a, b) => a.sceneNumber - b.sceneNumber);
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);

    await this.updateRenderingStatus(projectId, 'stitching_audio', 20);

    // Stitch all audio files together
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    // Convert file paths to absolute paths
    // Audio files from voice service are stored at voice-service/uploads/audio/userId/file.mp3
    // If running from server root, voice service cwd is server/microservices/voice-audio-service
    // If running from voice-service directory, cwd is server/microservices/voice-audio-service
    // We need to resolve paths relative to the server root or voice-service directory
    const serverRoot = path.join(process.cwd(), '..', '..'); // Go up from video-processing-service to server root
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');
    
    const audioPaths = sortedAudioFiles.map(af => {
      const audioFilePath = this.getAudioFilePath(af);
      if (!audioFilePath) return null;
      
      // Try multiple path resolution strategies
      let resolvedPath: string | null = null;
      
      // Strategy 1: If path is already absolute and exists, use it
      if (path.isAbsolute(audioFilePath) && fs.existsSync(audioFilePath)) {
        resolvedPath = audioFilePath;
      }
      // Strategy 2: Try relative to voice-service directory
      else if (!resolvedPath) {
        const voiceServicePath = path.join(voiceServiceDir, audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
        if (fs.existsSync(voiceServicePath)) {
          resolvedPath = voiceServicePath;
        }
      }
      // Strategy 3: Try relative to server root
      else if (!resolvedPath) {
        const serverRootPath = path.join(serverRoot, audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
        if (fs.existsSync(serverRootPath)) {
          resolvedPath = serverRootPath;
        }
      }
      // Strategy 4: Try relative to current working directory
      else if (!resolvedPath) {
        const cwdPath = path.join(process.cwd(), audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
        if (fs.existsSync(cwdPath)) {
          resolvedPath = cwdPath;
        }
      }
      
      if (!resolvedPath) {
        console.warn(`[RenderingService] Audio file not found. Tried: ${audioFilePath}`);
      }
      return resolvedPath;
    }).filter(p => p !== null && fs.existsSync(p)) as string[];
    
    if (audioPaths.length === 0) {
      throw new Error('No valid audio file paths found for stitching');
    }
    
    // Check for cached stitched audio
    const sourceHashAudio = this.generateSourceHash(audioPaths);
    const cachedAudio = this.getCachedIntermediateFile(project, 'stitched_audio');
    
    let stitchedAudioPath: string;
    
    if (cachedAudio && cachedAudio.sourceHash === sourceHashAudio) {
      console.log(`[RenderingService] CUTOUT: Reusing cached stitched audio: ${cachedAudio.path}`);
      stitchedAudioPath = cachedAudio.path;
    } else {
      // Generate new stitched audio with consistent filename
      stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}.mp3`);
      
      console.log(`[RenderingService] CUTOUT: Stitching ${audioPaths.length} audio files...`);
    await this.videoCompositor.concatenateAudios(audioPaths, stitchedAudioPath);
      
      // Save to cache
      await this.saveCachedIntermediateFile(projectId, 'stitched_audio', stitchedAudioPath, sourceHashAudio);
      console.log(`[RenderingService] CUTOUT: Stitched audio cached`);
    }

    await this.updateRenderingStatus(projectId, 'avatar_generating', 40);

    // Generate one avatar video from full stitched audio with green background
    // Check if avatar video already exists from previous attempt
    let avatarVideoPath: string | null = null;
    let originalAvatarVideoPath: string | null = null;
    const existingAvatarVideos = (project.avatarVideos as any) || [];
    const avatarMode = (project.avatarMode as string) || 'BASIC';
    const existingAvatarVideo = existingAvatarVideos.find((av: any) => 
      av.type === 'CUTOUT' && av.mode === avatarMode
    );

    if (existingAvatarVideo && existingAvatarVideo.originalPath && fs.existsSync(existingAvatarVideo.originalPath)) {
      console.log(`[RenderingService] CUTOUT: Reusing existing avatar video from previous attempt: ${existingAvatarVideo.originalPath}`);
      originalAvatarVideoPath = existingAvatarVideo.originalPath;
      avatarVideoPath = existingAvatarVideo.originalPath;
      
      // Check if processed (transparent) version exists
      if (existingAvatarVideo.processedPath && fs.existsSync(existingAvatarVideo.processedPath)) {
        console.log(`[RenderingService] CUTOUT: Reusing existing processed video: ${existingAvatarVideo.processedPath}`);
        avatarVideoPath = existingAvatarVideo.processedPath;
      }
      
      // Ensure finalProcessedPath is set if not already set
      if (!existingAvatarVideo.finalProcessedPath) {
        const updatedProject = await this.databaseService.videoProject.findUnique({
          where: { id: projectId },
        });
        const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
        const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
          av.type === 'CUTOUT' && av.mode === avatarMode
        );
        
        if (avatarVideoIndex >= 0) {
          updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = avatarVideoPath;
          updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = existingAvatarVideo.processedUrl || existingAvatarVideo.originalUrl;
          
          await this.databaseService.videoProject.update({
            where: { id: projectId },
            data: {
              avatarVideos: updatedAvatarVideos as any,
            },
          });
        }
      }
    } else {
      // Generate new avatar video
      console.log(`[RenderingService] CUTOUT: Generating new avatar video...`);
      
    const audioBuffer = fs.readFileSync(stitchedAudioPath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `full_audio_${projectId}.mp3`);

    // Avatar IV only: use project-scoped generated avatar image key
    const projectMetaCutout = (project.metadata as Record<string, unknown>) || {};
    const imageKeyCutout = projectMetaCutout.generatedAvatarImageKey as string | undefined;
    if (!imageKeyCutout) {
      throw new Error(
        'Avatar image for this project has not been generated yet. Please complete the b-roll images step, then try rendering again.',
      );
    }
    console.log(`[RenderingService] CUTOUT: Using Avatar IV with project image_key`);

    const totalAudioDurationCutout = sortedAudioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);
    const maxPollingAttemptsCutout = this.calculateMaxPollingAttempts(totalAudioDurationCutout);

    const completedVideo = await this.generateAndPollAvatarVideoUnified(
      project,
      {
        image_key: imageKeyCutout,
        video_title: `Avatar Video ${projectId}`,
        audio_asset_id: audioAssetId,
        video_orientation: 'portrait',
        fit: 'cover',
      },
      maxPollingAttemptsCutout,
      5000,
    );

    const videoResponse = { video_id: completedVideo.data.id };
    console.log(`[RenderingService] Created avatar video task ${videoResponse.video_id}`);

    if (!completedVideo.data.video_url) {
      throw new Error('Avatar video generation completed but no video URL');
    }

      // Create directory structure: avatars/{projectId}/{styleType}/{avatarType}/
      const avatarType = avatarMode.toLowerCase(); // 'basic' or 'premium'
      const styleType = this.getStyleDirectoryName(project.style); // 'half-n-half', 'avatar-cutout', or 'alternate'
      const avatarDir = path.join(userDir, 'avatars', projectId, styleType, avatarType);
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

      // Use consistent filename based on projectId (not timestamp) for retry capability
      const avatarVideoFilename = `avatar_full_${projectId}.mp4`;
      originalAvatarVideoPath = path.join(avatarDir, avatarVideoFilename);
      
      // Only download if file doesn't exist
      if (!fs.existsSync(originalAvatarVideoPath)) {
        await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, originalAvatarVideoPath);
        console.log(`[RenderingService] CUTOUT: Avatar video downloaded to: ${originalAvatarVideoPath}`);
      } else {
        console.log(`[RenderingService] CUTOUT: Avatar video already exists, skipping download: ${originalAvatarVideoPath}`);
      }
      
      avatarVideoPath = originalAvatarVideoPath;
      
      // Save avatar video info to database for future retries
      const avatarVideoInfo = {
        type: 'CUTOUT',
        mode: avatarMode,
        originalPath: originalAvatarVideoPath,
        originalUrl: `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${avatarVideoFilename}`,
        videoId: videoResponse.video_id, // Use video_id from the generation response
        videoUrl: completedVideo.data.video_url,
        generatedAt: new Date().toISOString(),
        dimensions: '1080x1920',
      };
      
      // Update project with avatar video info
      const updatedAvatarVideos = existingAvatarVideos.filter((av: any) => 
        !(av.type === 'CUTOUT' && av.mode === avatarMode)
      );
      updatedAvatarVideos.push(avatarVideoInfo);
      
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          avatarVideos: updatedAvatarVideos as any,
        },
      });
      
      console.log(`[RenderingService] CUTOUT: Avatar video info saved to database for retry capability`);
    }

    // Check if video has transparent background, if not remove it
    let finalAvatarVideoPath = avatarVideoPath;
    console.log(`[RenderingService] CUTOUT: Checking if avatar video has transparent background...`);
    const hasTransparency = await this.videoCompositor.hasAlphaChannel(avatarVideoPath);

    if (!hasTransparency) {
      console.log(`[RenderingService] CUTOUT: Avatar video doesn't have transparency, removing background using AI...`);
      await this.updateRenderingStatus(projectId, 'avatar_generating', 65);
      
      // Use base path for processed version - removeBackgroundAI will create .webm and _frames directory
      // Note: We pass .mp4 extension but the actual outputs are .webm (alpha-supporting) and PNG sequence
      const transparentVideoBasename = `avatar_transparent_${projectId}`;
      const transparentVideoBasePath = path.join(path.dirname(avatarVideoPath), transparentVideoBasename);
      const transparentVideoMarkerPath = transparentVideoBasePath + '.mp4'; // Marker file path
      const transparentWebmPath = transparentVideoBasePath + '.webm'; // Actual WebM with alpha
      const transparentPngDir = transparentVideoBasePath + '_frames'; // PNG sequence directory
      
      // Check if processed version already exists (check for WebM or PNG directory)
      const hasExistingWebm = fs.existsSync(transparentWebmPath);
      const hasExistingPngDir = fs.existsSync(transparentPngDir);
      
      if (!hasExistingWebm && !hasExistingPngDir) {
        console.log(`[RenderingService] CUTOUT: No cached transparent video found, processing...`);
        try {
          // Remove background from video using AI
          // IMPORTANT: Capture the return value - it returns the actual usable path (.webm or PNG dir)
          const actualTransparentPath = await this.videoCompositor.removeBackgroundAI(
            avatarVideoPath,
            transparentVideoMarkerPath, // Pass the marker path, but use the return value
            'u2net_human_seg'
          );
          
          // Use the returned path - this is the actual WebM or PNG sequence path
          if (actualTransparentPath && fs.existsSync(actualTransparentPath)) {
            finalAvatarVideoPath = actualTransparentPath;
            console.log(`[RenderingService] CUTOUT: ✅ Background removed successfully`);
            console.log(`[RenderingService] CUTOUT: Using transparent video: ${actualTransparentPath}`);
            
            // Determine the actual filename for URL generation
            const actualFilename = path.basename(actualTransparentPath);
            const isWebm = actualTransparentPath.endsWith('.webm');
            const isPngDir = fs.statSync(actualTransparentPath).isDirectory();
            
            // Upload WebM to GCS for accessibility
            let transparentGcsUrl: string | undefined;
            let transparentPublicUrl: string | undefined;
            
            if (isWebm) {
              try {
                const avatarType = avatarMode.toLowerCase();
                const styleType = this.getStyleDirectoryName(project.style);
                const gcsPath = `videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}`;
                
                console.log(`[RenderingService] CUTOUT: Uploading transparent WebM to GCS...`);
                const storageResult = await this.publicUrlService.uploadFromPath(
                  actualTransparentPath,
                  gcsPath,
                  actualFilename,
                  'video/webm'
                );
                transparentGcsUrl = storageResult.gcsUrl;
                transparentPublicUrl = storageResult.publicUrl;
                console.log(`[RenderingService] CUTOUT: ✅ Transparent video uploaded to GCS: ${transparentGcsUrl}`);
              } catch (gcsError: any) {
                console.warn(`[RenderingService] CUTOUT: GCS upload failed for transparent video: ${gcsError.message}`);
              }
            }
            
            // Update database with processed path (don't delete original - keep it for retry)
            const updatedProject = await this.databaseService.videoProject.findUnique({
              where: { id: projectId },
            });
            const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
            const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
              av.type === 'CUTOUT' && av.mode === avatarMode
            );
            
            if (avatarVideoIndex >= 0) {
              const avatarType = avatarMode.toLowerCase();
              const styleType = this.getStyleDirectoryName(project.style);
              
              // Store the actual path (WebM or PNG dir), not the marker file
              updatedAvatarVideos[avatarVideoIndex].processedPath = actualTransparentPath;
              updatedAvatarVideos[avatarVideoIndex].processedUrl = transparentPublicUrl || `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${actualFilename}`;
              updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = actualTransparentPath;
              updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = transparentPublicUrl || `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/${actualFilename}`;
              updatedAvatarVideos[avatarVideoIndex].processedFormat = isWebm ? 'webm' : (isPngDir ? 'png_sequence' : 'unknown');
              
              // Store GCS URL separately for easy access
              if (transparentGcsUrl) {
                updatedAvatarVideos[avatarVideoIndex].processedGcsUrl = transparentGcsUrl;
              }
              
              await this.databaseService.videoProject.update({
                where: { id: projectId },
                data: {
                  avatarVideos: updatedAvatarVideos as any,
                },
              });
              
              console.log(`[RenderingService] CUTOUT: ✅ Processed video path saved to database`);
            }
          } else {
            throw new Error(`Background removal completed but output file not found at: ${actualTransparentPath}`);
          }
        } catch (bgRemovalError: any) {
          console.error(`[RenderingService] CUTOUT: ❌ Background removal failed: ${bgRemovalError.message}`);
          console.log(`[RenderingService] CUTOUT: ⚠️ Using original video (may have background, can retry later)`);
          // Continue with original video if background removal fails
          finalAvatarVideoPath = avatarVideoPath;
          
          // Still save the original as final processed path
          const updatedProject = await this.databaseService.videoProject.findUnique({
            where: { id: projectId },
          });
          const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
          const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
            av.type === 'CUTOUT' && av.mode === avatarMode
          );
          
          if (avatarVideoIndex >= 0) {
            const avatarType = avatarMode.toLowerCase();
            const styleType = this.getStyleDirectoryName(project.style);
            updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = avatarVideoPath;
            updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/avatar_full_${projectId}.mp4`;
            updatedAvatarVideos[avatarVideoIndex].processedFormat = 'mp4_no_alpha';
            
            await this.databaseService.videoProject.update({
              where: { id: projectId },
              data: {
                avatarVideos: updatedAvatarVideos as any,
              },
            });
          }
        }
      } else {
        // Use existing cached transparent video
        if (hasExistingWebm) {
          finalAvatarVideoPath = transparentWebmPath;
          console.log(`[RenderingService] CUTOUT: Reusing cached WebM video: ${transparentWebmPath}`);
        } else if (hasExistingPngDir) {
          finalAvatarVideoPath = transparentPngDir;
          console.log(`[RenderingService] CUTOUT: Reusing cached PNG sequence: ${transparentPngDir}`);
        }
      }
    } else {
      console.log(`[RenderingService] CUTOUT: ✅ Avatar video already has transparent background`);
      // Video already has transparency, so original is the final processed video
      // Update database to mark this as the final processed path
      const updatedProject = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
      });
      const updatedAvatarVideos = (updatedProject?.avatarVideos as any) || [];
      const avatarVideoIndex = updatedAvatarVideos.findIndex((av: any) => 
        av.type === 'CUTOUT' && av.mode === avatarMode
      );
      
      if (avatarVideoIndex >= 0) {
        const avatarType = avatarMode.toLowerCase();
        const styleType = this.getStyleDirectoryName(project.style);
        updatedAvatarVideos[avatarVideoIndex].finalProcessedPath = avatarVideoPath;
        updatedAvatarVideos[avatarVideoIndex].finalProcessedUrl = `/uploads/videos/${userId}/avatars/${projectId}/${styleType}/${avatarType}/avatar_full_${projectId}.mp4`;
        updatedAvatarVideos[avatarVideoIndex].processedFormat = 'original_with_alpha';
        
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: {
            avatarVideos: updatedAvatarVideos as any,
          },
        });
        
        console.log(`[RenderingService] CUTOUT: ✅ Final processed video path saved to database (already transparent)`);
      }
    }

    await this.updateRenderingStatus(projectId, 'stitching_broll', 60);

    // Stitch all b-roll videos together
    // Log all videos for debugging
    console.log(`[RenderingService] CUTOUT: Processing ${sortedBrollVideos.length} b-roll videos:`, 
      sortedBrollVideos.map(v => ({
        sceneNumber: v.sceneNumber,
        hasLocalPath: !!v.localPath,
        localPath: v.localPath,
        hasLocalUrl: !!v.localUrl,
        localUrl: v.localUrl,
      }))
    );
    
    // Helper to resolve video paths, supporting both regular and stock video paths
    const resolveVideoPathCutout = (v: any, sceneLabel: string): string | null => {
      let videoPath: string | null = null;
      
      if (v.localPath) {
        // Convert to absolute path if relative
        videoPath = path.isAbsolute(v.localPath) 
          ? v.localPath 
          : path.resolve(v.localPath);
      } else if (v.localUrl) {
        // If no localPath, try to derive from localUrl
        const urlPath = v.localUrl.startsWith('/uploads') ? v.localUrl : v.localUrl;
        
        // Handle different localUrl formats:
        // - /uploads/videos/{userId}/{filename} (AI-generated)
        // - /uploads/stock/{projectId}/{filename} (stock videos)
        if (urlPath.includes('/uploads/stock/')) {
          // Stock video path - resolve relative to media-management-service
          const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
          videoPath = path.join(mediaServiceDir, urlPath);
        } else {
          // Regular video path
          const relativePath = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
          videoPath = path.join(userDir, relativePath);
        }
      }
      
      if (!videoPath) {
        console.warn(`[RenderingService] ${sceneLabel}: Scene ${v.sceneNumber} has no localPath or localUrl`);
        return null;
      }
      
      // Check if file exists at primary path
      if (fs.existsSync(videoPath)) {
        return videoPath;
      }
      
      // Fallback: Try stock path if localPath was absolute but file doesn't exist
      if (v.localUrl && v.localUrl.includes('/uploads/stock/')) {
        const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
        const stockPath = path.join(mediaServiceDir, v.localUrl);
        if (fs.existsSync(stockPath)) {
          console.log(`[RenderingService] ${sceneLabel}: Found stock video at fallback path: ${stockPath}`);
          return stockPath;
        }
      }
      
      console.warn(`[RenderingService] ${sceneLabel}: Video file not found for scene ${v.sceneNumber}: ${videoPath}`);
      return null;
    };
    
    // Convert paths to absolute paths before concatenation
    const brollVideoPaths = sortedBrollVideos
      .map(v => resolveVideoPathCutout(v, 'CUTOUT'))
      .filter((p): p is string => p !== null);
    
    if (brollVideoPaths.length === 0) {
      throw new Error('No valid b-roll video paths found for stitching');
    }
    
    // Check for cached stitched b-roll video
    const sourceHashBroll = this.generateSourceHash(brollVideoPaths);
    const cachedBroll = this.getCachedIntermediateFile(project, 'stitched_broll');
    
    let stitchedBrollPath: string;
    
    if (cachedBroll && cachedBroll.sourceHash === sourceHashBroll) {
      console.log(`[RenderingService] CUTOUT: Reusing cached stitched b-roll video: ${cachedBroll.path}`);
      stitchedBrollPath = cachedBroll.path;
    } else {
      // Generate new stitched b-roll video with consistent filename
      stitchedBrollPath = path.join(userDir, `stitched_broll_${projectId}.mp4`);
      
      console.log(`[RenderingService] CUTOUT: Stitching ${brollVideoPaths.length} videos (filtered from ${sortedBrollVideos.length})...`);
    await this.videoCompositor.concatenateVideos(brollVideoPaths, stitchedBrollPath);
      
      // Save to cache
      await this.saveCachedIntermediateFile(projectId, 'stitched_broll', stitchedBrollPath, sourceHashBroll);
      console.log(`[RenderingService] CUTOUT: Stitched b-roll video cached`);
    }

    // Add audio to stitched b-roll
    const stitchedBrollWithAudioPath = path.join(userDir, `stitched_broll_audio_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.addAudioToVideo(stitchedBrollPath, stitchedAudioPath, stitchedBrollWithAudioPath);

    await this.updateRenderingStatus(projectId, 'overlaying', 80);

    // Get avatar overlay settings from project metadata (or use defaults)
    const avatarOverlay = project.metadata?.avatarOverlay || {
      enabled: true,
      applyToAll: true,
      globalPosition: { x: 0.5, y: 0.85, scale: 0.4 }
    };
    
    const globalPosition = avatarOverlay.globalPosition || { x: 0.5, y: 0.85, scale: 0.4 };
    const perScenePositions = avatarOverlay.perScenePositions || {};
    const applyToAll = avatarOverlay.applyToAll !== false; // Default to true
    
    console.log(`[RenderingService] CUTOUT: Avatar overlay settings - enabled: ${avatarOverlay.enabled}, applyToAll: ${applyToAll}`);
    console.log(`[RenderingService] CUTOUT: Global position - x: ${globalPosition.x}, y: ${globalPosition.y}, scale: ${globalPosition.scale}`);
    
    let finalVideoPath: string;
    
    if (applyToAll) {
      // Use global position for all scenes - overlay on stitched b-roll
      console.log(`[RenderingService] CUTOUT: Using global position for all scenes`);
      
      finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
      console.log(`[RenderingService] CUTOUT: Overlaying avatar video on b-roll...`);
      await this.videoCompositor.overlayAvatarOnBroll(
        stitchedBrollWithAudioPath,
        finalAvatarVideoPath,
        finalVideoPath,
        globalPosition,
        true // useAIBackgroundRemoval: Always use AI removal for CUTOUT mode
      );
    } else {
      // Per-scene positioning: clip avatar video per scene and overlay with scene-specific positions
      console.log(`[RenderingService] CUTOUT: Using per-scene positions`);
      console.log(`[RenderingService] CUTOUT: Per-scene positions:`, perScenePositions);
      
      // Calculate audio duration breakpoints per scene
      const sceneDurations: { sceneNumber: number; duration: number; startTime: number }[] = [];
      let cumulativeTime = 0;
      
      for (const audioFile of audioFiles) {
        const duration = audioFile.duration || 0;
        sceneDurations.push({
          sceneNumber: audioFile.sceneNumber,
          duration,
          startTime: cumulativeTime
        });
        cumulativeTime += duration;
      }
      
      console.log(`[RenderingService] CUTOUT: Scene durations:`, sceneDurations);
      
      // Process each scene: extract avatar segment, overlay on b-roll
      const sceneComposites: string[] = [];
      const tempDir = path.join(userDir, 'temp_scenes');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      for (let i = 0; i < sortedBrollVideos.length; i++) {
        const brollVideo = sortedBrollVideos[i];
        const sceneNumber = brollVideo.sceneNumber;
        const sceneDuration = sceneDurations.find(sd => sd.sceneNumber === sceneNumber);
        
        if (!sceneDuration) {
          console.warn(`[RenderingService] CUTOUT: No duration found for scene ${sceneNumber}, skipping`);
          continue;
        }
        
        // Get b-roll video path (supports both regular and stock videos)
        let brollPath: string | null = null;
        if (brollVideo.localPath) {
          brollPath = path.isAbsolute(brollVideo.localPath) 
            ? brollVideo.localPath 
            : path.resolve(brollVideo.localPath);
        } else if (brollVideo.localUrl) {
          const urlPath = brollVideo.localUrl.startsWith('/uploads') ? brollVideo.localUrl : brollVideo.localUrl;
          
          // Handle different localUrl formats
          if (urlPath.includes('/uploads/stock/')) {
            const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
            brollPath = path.join(mediaServiceDir, urlPath);
          } else {
            const relativePath = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
            brollPath = path.join(userDir, relativePath);
          }
        }
        
        // Check primary path, then try stock fallback
        if (!brollPath || !fs.existsSync(brollPath)) {
          if (brollVideo.localUrl && brollVideo.localUrl.includes('/uploads/stock/')) {
            const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
            const stockPath = path.join(mediaServiceDir, brollVideo.localUrl);
            if (fs.existsSync(stockPath)) {
              console.log(`[RenderingService] CUTOUT: Found stock video at fallback path: ${stockPath}`);
              brollPath = stockPath;
            }
          }
        }
        
        if (!brollPath || !fs.existsSync(brollPath)) {
          console.warn(`[RenderingService] CUTOUT: B-roll video not found for scene ${sceneNumber}, skipping`);
          continue;
        }
        
        // Get position for this scene (fall back to global if not specified)
        const scenePosition = perScenePositions[sceneNumber] || globalPosition;
        console.log(`[RenderingService] CUTOUT: Scene ${sceneNumber} position - x: ${scenePosition.x}, y: ${scenePosition.y}, scale: ${scenePosition.scale}`);
        
        // Extract avatar video segment for this scene
        const avatarSegmentPath = path.join(tempDir, `avatar_segment_scene_${sceneNumber}.mp4`);
        await this.videoCompositor.extractVideoSegment(
          finalAvatarVideoPath,
          avatarSegmentPath,
          sceneDuration.startTime,
          sceneDuration.duration,
          true // preserveAlpha: avatar video should have transparency
        );
        
        // Add audio to b-roll for this scene
        const sceneAudioFile = audioFiles.find(af => af.sceneNumber === sceneNumber);
        let brollWithAudioPath = brollPath;
        
        if (sceneAudioFile) {
          const audioPath = sceneAudioFile.localPath || 
            (sceneAudioFile.localUrl ? path.join(process.cwd(), sceneAudioFile.localUrl.replace(/^\//, '')) : null);
          
          if (audioPath && fs.existsSync(audioPath)) {
            brollWithAudioPath = path.join(tempDir, `broll_audio_scene_${sceneNumber}.mp4`);
            await this.videoCompositor.addAudioToVideo(brollPath, audioPath, brollWithAudioPath);
          }
        }
        
        // Overlay avatar segment on b-roll scene
        const sceneCompositePath = path.join(tempDir, `composite_scene_${sceneNumber}.mp4`);
        await this.videoCompositor.overlayAvatarOnBroll(
          brollWithAudioPath,
          avatarSegmentPath,
          sceneCompositePath,
          scenePosition,
          true // useAIBackgroundRemoval
        );
        
        sceneComposites.push(sceneCompositePath);
        console.log(`[RenderingService] CUTOUT: Scene ${sceneNumber} composite created`);
      }
      
      if (sceneComposites.length === 0) {
        throw new Error('No scene composites were created');
      }
      
      // Concatenate all scene composites into final video
      finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
      console.log(`[RenderingService] CUTOUT: Concatenating ${sceneComposites.length} scene composites...`);
      await this.videoCompositor.concatenateVideos(sceneComposites, finalVideoPath);
      
      // Cleanup temp directory
      try {
        const tempFiles = fs.readdirSync(tempDir);
        for (const file of tempFiles) {
          fs.unlinkSync(path.join(tempDir, file));
        }
        fs.rmdirSync(tempDir);
        console.log(`[RenderingService] CUTOUT: Cleaned up temp directory`);
      } catch (cleanupError: any) {
        console.warn(`[RenderingService] CUTOUT: Failed to cleanup temp directory: ${cleanupError.message}`);
      }
    }

    // Calculate total duration
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);

    let pathForUploadCutout = await this.applyBackgroundMusicIfEnabled(
      project,
      finalVideoPath,
      userDir,
      projectId,
    );
    const sortedAudioForCutout = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);
    if (project.captionsEnabled && project.captionSettings) {
      try {
        console.log(`[RenderingService] CUTOUT: Adding captions to final video...`);
        const captionedPath = await this.addCaptionsToFinalVideo(
          pathForUploadCutout,
          userDir,
          projectId,
          sortedAudioForCutout,
          project.captionSettings,
        );
        if (captionedPath) {
          pathForUploadCutout = captionedPath;
        }
      } catch (captionError: any) {
        console.error(`[RenderingService] CUTOUT: Failed to add captions: ${captionError.message}`);
        console.warn(`[RenderingService] CUTOUT: Proceeding without captions`);
      }
    }

    await this.finalizeAndPublishVideo(
      projectId,
      userId,
      project,
      pathForUploadCutout,
      userDir,
      totalDuration,
      'CUTOUT',
    );
  }

  /**
   * Generate a per-scene avatar video for ALTERNATE style (odd / half-n-half scenes)
   * Avatar IV only: uses project.metadata.generatedAvatarImageKey
   */
  private async generateAlternateSceneAvatarVideo(
    projectId: string,
    userId: string,
    sceneNumber: number,
    audioFilePath: string,
    avatarMode: string,
    _talkingPhotoId: string,
    _imageKey: string | undefined,
    _imageKeyHalfNHalfWithWhite: string | undefined,
    avatarDir: string,
    project: any
  ): Promise<string> {
    const projectMeta = (project.metadata as Record<string, unknown>) || {};
    const imageKeyToUse = projectMeta.generatedAvatarImageKey as string | undefined;
    if (!imageKeyToUse) {
      throw new Error(
        'Avatar image for this project has not been generated yet. Please complete the b-roll images step, then try again.',
      );
    }

    const audioBuffer = fs.readFileSync(audioFilePath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `scene_${sceneNumber}_audio.mp3`);

    const sceneAudioDuration = await this.videoCompositor.getVideoDuration(audioFilePath);
    const maxPollingAttemptsAlternate = this.calculateMaxPollingAttempts(sceneAudioDuration);

    const completedVideo = await this.generateAndPollAvatarVideoUnified(
      project,
      {
        image_key: imageKeyToUse,
        video_title: `Avatar Video Scene ${sceneNumber} - ${projectId}`,
        audio_asset_id: audioAssetId,
        video_orientation: 'portrait',
        fit: 'cover',
      },
      maxPollingAttemptsAlternate,
      5000,
    );

    const videoResponse = { video_id: completedVideo.data.id };
    console.log(
      `[RenderingService] ALTERNATE: Created avatar video task ${videoResponse.video_id} for scene ${sceneNumber}`,
    );

    if (!completedVideo.data.video_url) {
      throw new Error(`Avatar video generation completed but no video URL for scene ${sceneNumber}`);
    }

    const avatarVideoPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_${projectId}.mp4`);
    await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, avatarVideoPath);

    // Avatar IV produces 9:16; crop to bottom 960px (same as HALF_N_HALF)
    const videoRes = await this.videoCompositor.getVideoResolution(avatarVideoPath);
    if (!videoRes) {
      throw new Error('Failed to get video resolution for avatar video');
    }
    console.log(`[RenderingService] ALTERNATE: Avatar video dimensions for scene ${sceneNumber}: ${videoRes.width}x${videoRes.height}`);

    if (videoRes.width !== 1080 || videoRes.height !== 1920) {
      const scaledPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_scaled_${projectId}.mp4`);
      await this.videoCompositor.scaleVideoToDimensions(avatarVideoPath, scaledPath, 1080, 1920);
      if (!fs.existsSync(scaledPath)) throw new Error('Video scaling failed');
      const croppedPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_cropped_${projectId}.mp4`);
      await this.videoCompositor.cropVideo(scaledPath, croppedPath, 0, 960, 1080, 960);
      try { fs.unlinkSync(scaledPath); } catch (e) { /* ignore */ }
      if (fs.existsSync(croppedPath)) {
        fs.unlinkSync(avatarVideoPath);
        fs.renameSync(croppedPath, avatarVideoPath);
      }
    } else {
      const croppedPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_cropped_${projectId}.mp4`);
      await this.videoCompositor.cropVideo(avatarVideoPath, croppedPath, 0, 960, 1080, 960);
      if (fs.existsSync(croppedPath)) {
        fs.unlinkSync(avatarVideoPath);
        fs.renameSync(croppedPath, avatarVideoPath);
      }
    }

    return avatarVideoPath;
  }

  /**
   * Process ALTERNATE style (simplified - avatar and compositing done during Convert to Videos):
   * - Odd scenes: pre-composed (b-roll+avatar) from bRollVideoTasks, already has audio (isComposite)
   * - Even scenes: b-roll from bRollVideoTasks, add audio (full 9:16)
   * - Stitch all scene videos together
   */
  private async processAlternate(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollVideos: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing ALTERNATE style for project ${projectId} (stitch-only mode)`);

    if (!project.avatarId) {
      throw new Error('Avatar ID required for ALTERNATE style');
    }

    const script = typeof project.script === 'string' 
      ? JSON.parse(project.script) 
      : project.script;
    const scenes = script.scenes || script.scene_plan || [];
    const sortedScenes = [...scenes].sort((a, b) => 
      (a.scene_number || a.sceneNumber || 1) - (b.scene_number || b.sceneNumber || 1)
    );

    await this.updateRenderingStatus(projectId, 'stitching_broll', 30);

    const userDir = path.join(this.uploadsDir, 'videos', userId);
    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');

    const resolveAudioPath = (audioFile: any): string | null => {
      const p = this.getAudioFilePath(audioFile);
      if (!p) return null;
      if (path.isAbsolute(p) && fs.existsSync(p)) return p;
      const rel = p.startsWith('/') ? p.slice(1) : p;
      for (const base of [voiceServiceDir, serverRoot, process.cwd()]) {
        const full = path.join(base, rel);
        if (fs.existsSync(full)) return full;
      }
      return null;
    };

    const sceneVideoPaths: string[] = [];
    const sceneDurations: number[] = [];

    for (const scene of sortedScenes) {
      const sceneNumber = scene.scene_number || scene.sceneNumber || 1;
      const videoEntry = bRollVideos.find((v: any) => v.sceneNumber === sceneNumber);
      const audioFile = audioFiles.find((af: any) => af.sceneNumber === sceneNumber);

      if (!videoEntry || (!videoEntry.localPath && !videoEntry.localUrl)) {
        throw new Error(`Missing video for scene ${sceneNumber}`);
      }

      // Resolve video path (supports both regular and stock videos)
      let videoPath: string | null = null;
      if (videoEntry.localPath) {
        videoPath = path.isAbsolute(videoEntry.localPath) ? videoEntry.localPath : path.resolve(videoEntry.localPath);
      } else if (videoEntry.localUrl) {
        const urlPath = (videoEntry.localUrl as string).startsWith('/uploads') ? videoEntry.localUrl : videoEntry.localUrl;
        
        // Handle different localUrl formats
        if (urlPath.includes('/uploads/stock/')) {
          const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
          videoPath = path.join(mediaServiceDir, urlPath);
        } else {
          const rel = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
          videoPath = path.join(userDir, rel);
        }
      }
      
      // Check primary path, then try stock fallback
      if (!videoPath || !fs.existsSync(videoPath)) {
        if (videoEntry.localUrl && videoEntry.localUrl.includes('/uploads/stock/')) {
          const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
          const stockPath = path.join(mediaServiceDir, videoEntry.localUrl);
          if (fs.existsSync(stockPath)) {
            console.log(`[RenderingService] ALTERNATE: Found stock video at fallback path: ${stockPath}`);
            videoPath = stockPath;
          }
        }
      }
      
      if (!videoPath || !fs.existsSync(videoPath)) {
        throw new Error(`Video file not found for scene ${sceneNumber}`);
      }

      const isComposite = !!(videoEntry as any).isComposite;

      if (isComposite) {
        // Odd scene: pre-composed half-n-half (already has audio)
        sceneVideoPaths.push(path.resolve(videoPath));
        sceneDurations.push(audioFile?.duration || 0);
        console.log(`[RenderingService] ALTERNATE: Using pre-composed scene ${sceneNumber}`);
      } else {
        // Even scene: add audio to full 9:16 b-roll
        if (!audioFile) throw new Error(`Missing audio for scene ${sceneNumber}`);
        const audioPath = resolveAudioPath(audioFile);
        if (!audioPath || !fs.existsSync(audioPath)) {
          throw new Error(`Audio file not found for scene ${sceneNumber}`);
        }
        const brollRes = await this.videoCompositor.getVideoResolution(videoPath);
        if (brollRes && (brollRes.width !== 1080 || brollRes.height !== 1920)) {
          const scaledPath = path.join(userDir, `broll_scaled_${sceneNumber}_${projectId}.mp4`);
          await this.videoCompositor.scaleVideoToDimensions(videoPath, scaledPath, 1080, 1920);
          if (fs.existsSync(scaledPath)) videoPath = scaledPath;
        }
        const completePath = path.join(userDir, `complete_scene_${sceneNumber}_${projectId}_${Date.now()}.mp4`);
        await this.videoCompositor.addAudioToVideo(videoPath, audioPath, completePath);
        sceneVideoPaths.push(path.resolve(completePath));
        sceneDurations.push(audioFile.duration || 0);
        console.log(`[RenderingService] ALTERNATE: Processed even (full b-roll) scene ${sceneNumber} with audio`);
      }
    }

    if (sceneVideoPaths.length === 0) {
      throw new Error('No valid scene videos to stitch together');
    }

    console.log(`[RenderingService] ALTERNATE: Processed ${sceneVideoPaths.length} complete scene videos. Total expected duration: ${sceneDurations.reduce((sum, d) => sum + d, 0).toFixed(2)}s`);

    await this.updateRenderingStatus(projectId, 'stitching', 70);

    // Stitch all complete per-scene videos together (each already has its own audio)
    const finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    const absoluteSceneVideoPaths = sceneVideoPaths
      .map(vp => {
        if (!vp) return null;
        const absolutePath = path.isAbsolute(vp) 
          ? vp 
          : path.resolve(vp);
        return absolutePath;
      })
      .filter(p => p && fs.existsSync(p)) as string[];
    
    if (absoluteSceneVideoPaths.length === 0) {
      throw new Error('No valid scene videos to stitch together');
    }
    
    console.log(`[RenderingService] ALTERNATE: Stitching ${absoluteSceneVideoPaths.length} complete scene videos together...`);
    await this.videoCompositor.concatenateVideos(absoluteSceneVideoPaths, finalVideoPath);

    // Calculate total duration from scenes that made it into the final video
    // Use ffprobe to get actual video duration as the source of truth
    let totalDuration: number;
    try {
      const videoDuration = await this.videoCompositor.getVideoDuration(finalVideoPath);
      totalDuration = videoDuration;
      console.log(`[RenderingService] ALTERNATE: Final video duration (from ffprobe): ${totalDuration.toFixed(2)}s`);
      
      // Log comparison with expected duration
      const expectedDuration = sceneDurations.reduce((sum, d) => sum + d, 0);
      const durationDiff = Math.abs(totalDuration - expectedDuration);
      if (durationDiff > 0.5) {
        console.warn(`[RenderingService] ALTERNATE: Duration mismatch! Expected: ${expectedDuration.toFixed(2)}s, Actual: ${totalDuration.toFixed(2)}s, Diff: ${durationDiff.toFixed(2)}s`);
      } else {
        console.log(`[RenderingService] ALTERNATE: Duration matches expected (${expectedDuration.toFixed(2)}s)`);
      }
    } catch (error: any) {
      console.warn(`[RenderingService] ALTERNATE: Failed to get video duration from ffprobe, using sum of scene durations: ${error.message}`);
      // Fallback to sum of scene durations
      totalDuration = sceneDurations.reduce((sum, d) => sum + d, 0);
    }

    // Final video already has all audio, no need to add stitched audio again
    let finalVideoWithAudioPath = await this.applyBackgroundMusicIfEnabled(
      project,
      finalVideoPath,
      userDir,
      projectId,
    );

    // Add captions if enabled
    if (project.captionsEnabled && project.captionSettings) {
      try {
        console.log(`[RenderingService] ALTERNATE: Adding captions to final video...`);
        // Sort audio files by scene number for caption generation
        const sortedAudioFilesForCaptions = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);
        const captionedVideoPath = await this.addCaptionsToFinalVideo(
          finalVideoWithAudioPath,
          userDir,
          projectId,
          sortedAudioFilesForCaptions,
          project.captionSettings
        );
        if (captionedVideoPath) {
          finalVideoWithAudioPath = captionedVideoPath;
        }
      } catch (captionError: any) {
        console.error(`[RenderingService] ALTERNATE: Failed to add captions: ${captionError.message}`);
        console.warn(`[RenderingService] ALTERNATE: Proceeding without captions`);
      }
    }

    await this.finalizeAndPublishVideo(
      projectId,
      userId,
      project,
      finalVideoWithAudioPath,
      userDir,
      totalDuration,
      'ALTERNATE',
    );
  }

  /**
   * Process AVATAR_ONLY style:
   * - Generate one full avatar video from stitched audio (9:16)
   * - No b-roll overlay, just the avatar video
   */
  private async processAvatarOnly(
    projectId: string,
    userId: string,
    audioFiles: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing AVATAR_ONLY style for project ${projectId}`);

    if (!project.avatarId) {
      throw new Error('Avatar ID required for AVATAR_ONLY style');
    }

    // Sort audio files by scene number
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);

    await this.updateRenderingStatus(projectId, 'stitching_audio', 20);

    // Stitch all audio files together
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');

    const audioPaths = sortedAudioFiles.map(af => {
      const audioFilePath = this.getAudioFilePath(af);
      if (!audioFilePath) return null;
      
      let resolvedPath: string | null = null;
      
      if (path.isAbsolute(audioFilePath) && fs.existsSync(audioFilePath)) {
        resolvedPath = audioFilePath;
      } else {
        const voiceServicePath = path.join(voiceServiceDir, audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
        if (fs.existsSync(voiceServicePath)) {
          resolvedPath = voiceServicePath;
        } else {
          const serverRootPath = path.join(serverRoot, audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
          if (fs.existsSync(serverRootPath)) {
            resolvedPath = serverRootPath;
          } else {
            const cwdPath = path.join(process.cwd(), audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
            if (fs.existsSync(cwdPath)) {
              resolvedPath = cwdPath;
            }
          }
        }
      }
      
      if (!resolvedPath) {
        console.warn(`[RenderingService] Audio file not found: ${audioFilePath}`);
      }
      return resolvedPath;
    }).filter(p => p !== null && fs.existsSync(p)) as string[];

    if (audioPaths.length === 0) {
      throw new Error('No valid audio file paths found for stitching');
    }

    const stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}.mp3`);
    console.log(`[RenderingService] AVATAR_ONLY: Stitching ${audioPaths.length} audio files...`);
    await this.videoCompositor.concatenateAudios(audioPaths, stitchedAudioPath);

    await this.updateRenderingStatus(projectId, 'avatar_generating', 40);

    // Generate avatar video from stitched audio
    const audioBuffer = fs.readFileSync(stitchedAudioPath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `full_audio_${projectId}.mp3`);

    const projectMetaAvatarOnly = (project.metadata as Record<string, unknown>) || {};
    const imageKeyAvatarOnly = projectMetaAvatarOnly.generatedAvatarImageKey as string | undefined;
    if (!imageKeyAvatarOnly) {
      throw new Error(
        'Avatar image for this project has not been generated yet. Please complete the b-roll images step, then try rendering again.',
      );
    }
    console.log(`[RenderingService] AVATAR_ONLY: Using Avatar IV with project image_key`);

    await this.updateRenderingStatus(projectId, 'avatar_generating', 60);

    const totalAudioDurationAvatarOnly = sortedAudioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);
    const maxPollingAttemptsAvatarOnly = this.calculateMaxPollingAttempts(totalAudioDurationAvatarOnly);

    const completedVideo = await this.generateAndPollAvatarVideoUnified(
      project,
      {
        image_key: imageKeyAvatarOnly,
        video_title: `Avatar Video ${projectId}`,
        audio_asset_id: audioAssetId,
        video_orientation: 'portrait',
        fit: 'cover',
      },
      maxPollingAttemptsAvatarOnly,
      5000,
    );

    const videoResponse = { video_id: completedVideo.data.id };
    console.log(`[RenderingService] AVATAR_ONLY: Created avatar video task ${videoResponse.video_id}`);

    if (!completedVideo.data.video_url) {
      throw new Error('Avatar video generation completed but no video URL returned');
    }

    await this.updateRenderingStatus(projectId, 'stitching', 80);

    const avatarVideoPath = path.join(userDir, `avatar_only_${projectId}_${Date.now()}.mp4`);
    await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, avatarVideoPath);

    await this.enhanceAndPublishFinalPath(
      projectId,
      userId,
      project,
      avatarVideoPath,
      userDir,
      audioFiles,
      'AVATAR_ONLY',
    );
  }

  /**
   * Process PRODUCT_ONLY style:
   * - Stitch all b-roll videos together
   * - Stitch all audio files together
   * - Combine into final video (no avatar)
   */
  private async processProductOnly(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollVideos: any[],
    project: any
  ): Promise<void> {
    console.log(`[RenderingService] Processing PRODUCT_ONLY style for project ${projectId}`);

    // Sort by scene number
    const sortedBrollVideos = [...bRollVideos].sort((a, b) => a.sceneNumber - b.sceneNumber);
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);

    await this.updateRenderingStatus(projectId, 'stitching_audio', 20);

    // Setup paths
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');

    // Resolve audio paths
    const audioPaths = sortedAudioFiles.map(af => {
      const audioFilePath = this.getAudioFilePath(af);
      if (!audioFilePath) return null;
      
      let resolvedPath: string | null = null;
      
      if (path.isAbsolute(audioFilePath) && fs.existsSync(audioFilePath)) {
        resolvedPath = audioFilePath;
      } else {
        const voiceServicePath = path.join(voiceServiceDir, audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
        if (fs.existsSync(voiceServicePath)) {
          resolvedPath = voiceServicePath;
        } else {
          const serverRootPath = path.join(serverRoot, audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
          if (fs.existsSync(serverRootPath)) {
            resolvedPath = serverRootPath;
          } else {
            const cwdPath = path.join(process.cwd(), audioFilePath.startsWith('/') ? audioFilePath.slice(1) : audioFilePath);
            if (fs.existsSync(cwdPath)) {
              resolvedPath = cwdPath;
            }
          }
        }
      }
      
      if (!resolvedPath) {
        console.warn(`[RenderingService] Audio file not found: ${audioFilePath}`);
      }
      return resolvedPath;
    }).filter(p => p !== null && fs.existsSync(p)) as string[];

    if (audioPaths.length === 0) {
      throw new Error('No valid audio file paths found for stitching');
    }

    // Stitch audio
    const stitchedAudioPath = path.join(userDir, `stitched_audio_${projectId}.mp3`);
    console.log(`[RenderingService] PRODUCT_ONLY: Stitching ${audioPaths.length} audio files...`);
    await this.videoCompositor.concatenateAudios(audioPaths, stitchedAudioPath);

    await this.updateRenderingStatus(projectId, 'stitching_broll', 40);

    // Helper to resolve video paths, supporting both regular and stock video paths
    const resolveVideoPathProductOnly = (v: any): string | null => {
      let videoPath: string | null = null;
      
      if (v.localPath) {
        videoPath = path.isAbsolute(v.localPath) ? v.localPath : path.resolve(v.localPath);
      } else if (v.localUrl) {
        const urlPath = v.localUrl.startsWith('/uploads') ? v.localUrl : v.localUrl;
        
        // Handle different localUrl formats:
        // - /uploads/videos/{userId}/{filename} (AI-generated)
        // - /uploads/stock/{projectId}/{filename} (stock videos)
        if (urlPath.includes('/uploads/stock/')) {
          const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
          videoPath = path.join(mediaServiceDir, urlPath);
        } else {
          const relativePath = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
          videoPath = path.join(userDir, relativePath);
        }
      }
      
      // Check primary path
      if (videoPath && fs.existsSync(videoPath)) {
        return videoPath;
      }
      
      // Fallback: Try stock path
      if (v.localUrl && v.localUrl.includes('/uploads/stock/')) {
        const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
        const stockPath = path.join(mediaServiceDir, v.localUrl);
        if (fs.existsSync(stockPath)) {
          console.log(`[RenderingService] PRODUCT_ONLY: Found stock video at fallback path: ${stockPath}`);
          return stockPath;
        }
      }
      
      console.warn(`[RenderingService] PRODUCT_ONLY: B-roll video not found for scene ${v.sceneNumber}: ${v.localPath || v.localUrl}`);
      return null;
    };
    
    // Resolve b-roll video paths
    const videoPaths = sortedBrollVideos.map(v => resolveVideoPathProductOnly(v)).filter(p => p !== null) as string[];

    if (videoPaths.length === 0) {
      throw new Error('No valid b-roll video paths found for stitching');
    }

    // Stitch b-roll videos
    const stitchedBrollPath = path.join(userDir, `stitched_broll_${projectId}_${Date.now()}.mp4`);
    console.log(`[RenderingService] PRODUCT_ONLY: Stitching ${videoPaths.length} b-roll videos...`);
    await this.videoCompositor.concatenateVideos(videoPaths, stitchedBrollPath);

    await this.updateRenderingStatus(projectId, 'stitching', 70);

    // Add stitched audio to stitched video
    let finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.addAudioToVideo(stitchedBrollPath, stitchedAudioPath, finalVideoPath);

    finalVideoPath = await this.applyBackgroundMusicIfEnabled(project, finalVideoPath, userDir, projectId);

    // Calculate total duration and scene start times for captions
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);
    
    // Add captions if enabled
    if (project.captionsEnabled && project.captionSettings) {
      try {
        console.log(`[RenderingService] PRODUCT_ONLY: Adding captions to final video...`);
        const captionedVideoPath = await this.addCaptionsToFinalVideo(
          finalVideoPath,
          userDir,
          projectId,
          sortedAudioFiles,
          project.captionSettings
        );
        if (captionedVideoPath) {
          finalVideoPath = captionedVideoPath;
        }
      } catch (captionError: any) {
        console.error(`[RenderingService] PRODUCT_ONLY: Failed to add captions: ${captionError.message}`);
        console.warn(`[RenderingService] PRODUCT_ONLY: Proceeding without captions`);
      }
    }

    await this.finalizeAndPublishVideo(
      projectId,
      userId,
      project,
      finalVideoPath,
      userDir,
      totalDuration,
      'PRODUCT_ONLY',
    );
  }

  /**
   * Process AVATAR_PRODUCT style:
   * - Similar to ALTERNATE but with product context
   * - B-roll videos already have avatar+product composited (from image generation)
   * - Stitch all scene videos with their audio
   * - Combine into final video
   */
  private async processAvatarProduct(
    projectId: string,
    userId: string,
    audioFiles: any[],
    bRollVideos: any[],
    project: any,
    authToken?: string
  ): Promise<void> {
    console.log(`[RenderingService] Processing AVATAR_PRODUCT style for project ${projectId}`);

    // Parse script to get scene info
    const script = typeof project.script === 'string' 
      ? JSON.parse(project.script) 
      : project.script;
    
    const scenes = script.scenes || script.scene_plan || [];

    // Sort by scene number
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.sceneNumber - b.sceneNumber);
    const sortedScenes = [...scenes].sort((a: any, b: any) => 
      (a.scene_number || a.sceneNumber || 1) - (b.scene_number || b.sceneNumber || 1)
    );

    await this.updateRenderingStatus(projectId, 'stitching_audio', 20);

    // Setup paths
    const userDir = path.join(this.uploadsDir, 'videos', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');

    await this.updateRenderingStatus(projectId, 'stitching_broll', 40);

    const sceneVideoPaths: string[] = [];
    const sceneAudioPaths: string[] = [];

    // Process each scene
    for (const scene of sortedScenes) {
      const sceneNumber = scene.scene_number || scene.sceneNumber || 1;
      const brollVideo = bRollVideos.find((v: any) => v.sceneNumber === sceneNumber);
      const audioFile = sortedAudioFiles.find((af: any) => af.sceneNumber === sceneNumber);

      if (!brollVideo || !audioFile) {
        console.warn(`[RenderingService] AVATAR_PRODUCT: Missing video or audio for scene ${sceneNumber}`);
        continue;
      }

      // Resolve b-roll video path (supports both regular and stock videos)
      let brollVideoPath: string | null = null;
      if (brollVideo.localPath) {
        brollVideoPath = path.isAbsolute(brollVideo.localPath) 
          ? brollVideo.localPath 
          : path.resolve(brollVideo.localPath);
      } else if (brollVideo.localUrl) {
        const urlPath = brollVideo.localUrl.startsWith('/uploads') ? brollVideo.localUrl : brollVideo.localUrl;
        
        // Handle different localUrl formats:
        // - /uploads/videos/{userId}/{filename} (AI-generated)
        // - /uploads/stock/{projectId}/{filename} (stock videos)
        if (urlPath.includes('/uploads/stock/')) {
          const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
          brollVideoPath = path.join(mediaServiceDir, urlPath);
        } else {
          const relativePath = urlPath.replace(/^\/uploads\/videos\/[^/]+\//, '');
          brollVideoPath = path.join(userDir, relativePath);
        }
      }
      
      // Check primary path, then try stock fallback
      if (!brollVideoPath || !fs.existsSync(brollVideoPath)) {
        if (brollVideo.localUrl && brollVideo.localUrl.includes('/uploads/stock/')) {
          const mediaServiceDir = path.join(serverRoot, 'microservices', 'media-management-service');
          const stockPath = path.join(mediaServiceDir, brollVideo.localUrl);
          if (fs.existsSync(stockPath)) {
            console.log(`[RenderingService] AVATAR_PRODUCT: Found stock video at fallback path: ${stockPath}`);
            brollVideoPath = stockPath;
          }
        }
      }
      
      if (!brollVideoPath || !fs.existsSync(brollVideoPath)) {
        console.warn(`[RenderingService] AVATAR_PRODUCT: B-roll video not found for scene ${sceneNumber}`);
        continue;
      }
        
      // Resolve audio path
        const audioFilePathFromHelper = this.getAudioFilePath(audioFile);
        let audioFilePath: string | null = null;
        if (audioFilePathFromHelper) {
          if (path.isAbsolute(audioFilePathFromHelper) && fs.existsSync(audioFilePathFromHelper)) {
            audioFilePath = audioFilePathFromHelper;
          } else {
            const voiceServicePath = path.join(voiceServiceDir, audioFilePathFromHelper.startsWith('/') ? audioFilePathFromHelper.slice(1) : audioFilePathFromHelper);
            if (fs.existsSync(voiceServicePath)) {
              audioFilePath = voiceServicePath;
            } else {
              const serverRootPath = path.join(serverRoot, audioFilePathFromHelper.startsWith('/') ? audioFilePathFromHelper.slice(1) : audioFilePathFromHelper);
              if (fs.existsSync(serverRootPath)) {
                audioFilePath = serverRootPath;
              } else {
                const cwdPath = path.join(process.cwd(), audioFilePathFromHelper.startsWith('/') ? audioFilePathFromHelper.slice(1) : audioFilePathFromHelper);
                if (fs.existsSync(cwdPath)) {
                  audioFilePath = cwdPath;
                }
              }
            }
          }
        }
        
        if (!audioFilePath || !fs.existsSync(audioFilePath)) {
        console.warn(`[RenderingService] AVATAR_PRODUCT: Audio not found for scene ${sceneNumber}`);
        continue;
      }

      // Add audio to b-roll video
      const sceneWithAudioPath = path.join(userDir, `scene_${sceneNumber}_with_audio_${projectId}_${Date.now()}.mp4`);
      await this.videoCompositor.addAudioToVideo(brollVideoPath, audioFilePath, sceneWithAudioPath);
      
      sceneVideoPaths.push(sceneWithAudioPath);
            sceneAudioPaths.push(audioFilePath);
          }

    if (sceneVideoPaths.length === 0) {
      throw new Error('No valid scene videos found for AVATAR_PRODUCT style');
    }

    await this.updateRenderingStatus(projectId, 'stitching', 70);

    // Stitch all scene videos together
    let finalVideoPath = path.join(userDir, `final_${projectId}_${Date.now()}.mp4`);
    await this.videoCompositor.concatenateVideos(sceneVideoPaths, finalVideoPath);

    // Calculate total duration
    const totalDuration = audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0);

    // Add captions if enabled (use existing sortedAudioFiles from earlier in the function)
    if (project.captionsEnabled && project.captionSettings) {
      try {
        console.log(`[RenderingService] AVATAR_PRODUCT: Adding captions to final video...`);
        const captionedVideoPath = await this.addCaptionsToFinalVideo(
          finalVideoPath,
          userDir,
          projectId,
          sortedAudioFiles,
          project.captionSettings
        );
        if (captionedVideoPath) {
          finalVideoPath = captionedVideoPath;
        }
      } catch (captionError: any) {
        console.error(`[RenderingService] AVATAR_PRODUCT: Failed to add captions: ${captionError.message}`);
        console.warn(`[RenderingService] AVATAR_PRODUCT: Proceeding without captions`);
      }
    }

    await this.finalizeAndPublishVideo(
      projectId,
      userId,
      project,
      finalVideoPath,
      userDir,
      totalDuration,
      'AVATAR_PRODUCT',
    );
  }

  /**
   * Update rendering status and progress
   */
  /**
   * Merge workspace nested `style` with legacy flat captionSettings (e.g. style page) for ASS burn-in.
   */
  private resolveCaptionStyleForBurnIn(captionSettings: any): {
    fontFamily: string;
    fontSize: number;
    fontWeight: 'normal' | 'bold';
    fontStyle: 'normal' | 'italic';
    textDecoration: 'none' | 'underline';
    textColor: string;
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
  } {
    let cs: Record<string, any> = captionSettings && typeof captionSettings === 'object' && !Array.isArray(captionSettings)
      ? (captionSettings as Record<string, any>)
      : {};
    if (typeof captionSettings === 'string') {
      try {
        const parsed = JSON.parse(captionSettings);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          cs = parsed as Record<string, any>;
        }
      } catch {
        cs = {};
      }
    }

    let nested: Record<string, unknown> = {};
    if (cs.style && typeof cs.style === 'object' && !Array.isArray(cs.style)) {
      nested = cs.style as Record<string, unknown>;
    } else if (typeof cs.style === 'string') {
      try {
        const parsed = JSON.parse(cs.style);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          nested = parsed as Record<string, unknown>;
        }
      } catch {
        nested = {};
      }
    }

    /** Prefer nested workspace `style`, fall through to legacy flat fields (same as client hydration). */
    const pickStr = (...vals: unknown[]): string | undefined => {
      for (const v of vals) {
        if (v === undefined || v === null) continue;
        const s = String(v).trim();
        if (s !== '') return s;
      }
      return undefined;
    };

    const fontFamily = pickStr(nested.fontFamily, cs.fontFamily) ?? 'Arial';
    const rawSize = nested.fontSize ?? cs.fontSize;
    const fontSize =
      typeof rawSize === 'number' && rawSize > 0 ? rawSize : 48;

    let fontWeight: 'normal' | 'bold' = 'bold';
    if (nested.fontWeight === 'normal' || nested.fontWeight === 'bold') {
      fontWeight = nested.fontWeight;
    } else if (cs.isBold === false) {
      fontWeight = 'normal';
    }

    let fontStyle: 'normal' | 'italic' = 'normal';
    if (nested.fontStyle === 'italic' || nested.fontStyle === 'normal') {
      fontStyle = nested.fontStyle;
    } else if (cs.isItalic === true) {
      fontStyle = 'italic';
    }

    let textDecoration: 'none' | 'underline' = 'none';
    if (nested.textDecoration === 'underline' || nested.textDecoration === 'none') {
      textDecoration = nested.textDecoration;
    } else if (cs.textDecoration === 'underline') {
      textDecoration = 'underline';
    }

    const textColor = pickStr(nested.textColor, cs.textColor) ?? '#FFFFFF';
    const backgroundColor =
      pickStr(nested.backgroundColor, cs.backgroundColor) ?? 'rgba(0,0,0,0.5)';
    const borderColor = pickStr(nested.borderColor, cs.borderColor) ?? '#000000';
    const borderWidth =
      typeof nested.borderWidth === 'number'
        ? nested.borderWidth
        : typeof cs.borderWidth === 'number'
          ? cs.borderWidth
          : 2;

    return {
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
      textDecoration,
      textColor,
      backgroundColor,
      borderColor,
      borderWidth,
    };
  }

  private async setCaptionRendererMetadata(
    projectId: string,
    captionRenderer: 'html' | 'ass' | 'failed',
  ): Promise<void> {
    try {
      const project = await this.databaseService.videoProject.findUnique({
        where: { id: projectId },
      });
      if (!project) return;
      const metadata = ((project.metadata as Record<string, unknown>) || {}) as Record<string, unknown>;
      await this.databaseService.videoProject.update({
        where: { id: projectId },
        data: {
          metadata: {
            ...metadata,
            captionRenderer,
            captionRendererAt: new Date().toISOString(),
          } as any,
        },
      });
    } catch (err: any) {
      console.warn(
        `[RenderingService] Could not persist captionRenderer metadata: ${err?.message || err}`,
      );
    }
  }

  /**
   * Match workspace preview: CSS fontSize is relative to a small preview container; scale to output video height.
   * Optional captionSettings.previewContainerHeight from client (workspace preview box height in px).
   */
  private computeAssFontSizeForBurnIn(captionSettings: any, videoHeight: number): number {
    const resolved = this.resolveCaptionStyleForBurnIn(captionSettings);
    const base = resolved.fontSize;
    const cs = captionSettings || {};
    const previewH =
      typeof cs.previewContainerHeight === 'number' && cs.previewContainerHeight > 0
        ? cs.previewContainerHeight
        : 480;
    const scaled = base * (videoHeight / previewH);
    return Math.round(Math.max(24, Math.min(200, scaled)));
  }

  /**
   * Word i visible until next word starts (hold previous during gaps). Last word until scene end.
   */
  private buildWordCaptionSegmentsForScene(
    wordTimestamps: any[],
    sceneOffset: number,
    sceneDuration: number,
  ): Array<{ text: string; startTime: number; endTime: number }> {
    const words = wordTimestamps
      .map((w: any) => ({
        text: (w.word ?? w.text ?? '').trim(),
        start: Number(w.start ?? w.startTime ?? 0),
        end: Number(w.end ?? w.endTime ?? w.start ?? w.startTime ?? 0),
      }))
      .filter((w) => w.text.length > 0);
    if (!words.length) return [];

    const sceneEnd = sceneOffset + Math.max(0, sceneDuration);
    const segments: Array<{ text: string; startTime: number; endTime: number }> = [];

    for (let i = 0; i < words.length; i++) {
      const startTime = sceneOffset + words[i].start;
      const endTime =
        i + 1 < words.length
          ? sceneOffset + words[i + 1].start
          : sceneDuration > 0
            ? sceneEnd
            : sceneOffset + Math.max(words[i].end, words[i].start);
      if (endTime > startTime) {
        segments.push({ text: words[i].text, startTime, endTime });
      }
    }
    return segments;
  }

  /**
   * Add captions to the final video using word timestamps from audio files
   */
  private async addCaptionsToFinalVideo(
    videoPath: string,
    userDir: string,
    projectId: string,
    sortedAudioFiles: any[],
    captionSettings: any
  ): Promise<string | null> {
    let cap: Record<string, any> =
      captionSettings && typeof captionSettings === 'object' && !Array.isArray(captionSettings)
        ? captionSettings
        : {};
    if (typeof captionSettings === 'string') {
      try {
        const parsed = JSON.parse(captionSettings);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          cap = parsed as Record<string, any>;
        }
      } catch {
        cap = {};
      }
    }

    const displayMode: 'word-by-word' | 'full-sentence' =
      cap.displayMode === 'full-sentence' ? 'full-sentence' : 'word-by-word';

    const captions: Array<{ text: string; startTime: number; endTime: number }> = [];
    let currentTime = 0;
    let filesWithWordTs = 0;

    for (const audioFile of sortedAudioFiles) {
      const dur = audioFile.duration || 0;
      const sceneText =
        audioFile.voiceover || audioFile.text || audioFile.script || '';

      if (displayMode === 'full-sentence') {
        if (sceneText && dur > 0) {
          captions.push({
            text: sceneText,
            startTime: currentTime,
            endTime: currentTime + dur,
          });
        }
        currentTime += dur;
        continue;
      }

      if (audioFile.wordTimestamps && Array.isArray(audioFile.wordTimestamps) && audioFile.wordTimestamps.length > 0) {
        filesWithWordTs += 1;
        const wordSegments = this.buildWordCaptionSegmentsForScene(
          audioFile.wordTimestamps,
          currentTime,
          dur,
        );
        captions.push(...wordSegments);
      } else if (dur > 0 && sceneText) {
        captions.push({
          text: sceneText,
          startTime: currentTime,
          endTime: currentTime + dur,
        });
      }
      currentTime += dur;
    }

    if (captions.length === 0) {
      console.warn(
        `[RenderingService] CAPTIONS SKIPPED: built 0 caption events from ${sortedAudioFiles.length} audio file(s). ` +
          `displayMode=${displayMode}, scenesWithWordTimestamps=${filesWithWordTs}. ` +
          `Ensure audioFiles include voiceover/text and duration, or wordTimestamps for word-by-word.`,
      );
      return null;
    }

    console.log(
      `[RenderingService] Adding ${captions.length} caption segment(s) to video (displayMode=${displayMode}, scenesWithWordTs=${filesWithWordTs})`,
    );

    const gp = cap.globalPosition || {};
    let posX = typeof gp.x === 'number' ? gp.x : 0.5;
    let posY = typeof gp.y === 'number' ? gp.y : 0.85;
    let widthScale = typeof gp.widthScale === 'number' ? gp.widthScale : 0.8;
    let positionScale = typeof gp.scale === 'number' ? gp.scale : 0.1;
    if (posX > 1) {
      posX = posX / 100;
    }
    if (posY > 1) {
      posY = posY / 100;
    }
    posX = Math.max(0, Math.min(1, posX));
    posY = Math.max(0, Math.min(1, posY));
    widthScale = Math.max(0.3, Math.min(0.9, widthScale));
    positionScale = Math.max(0.05, Math.min(1, positionScale));

    const resolved = this.resolveCaptionStyleForBurnIn(cap);
    let videoWidth = 1080;
    let videoHeight = 1920;
    try {
      const res = await this.videoCompositor.getVideoResolution(videoPath);
      if (res?.width) videoWidth = res.width;
      if (res?.height) videoHeight = res.height;
    } catch {
      /* keep default */
    }
    const fontSize = this.computeAssFontSizeForBurnIn(cap, videoHeight);

    const style = {
      fontFamily: resolved.fontFamily,
      fontSize,
      fontWeight: resolved.fontWeight,
      fontStyle: resolved.fontStyle,
      textDecoration: resolved.textDecoration,
      textColor: resolved.textColor,
      backgroundColor: resolved.backgroundColor,
      borderColor: resolved.borderColor,
      borderWidth: resolved.borderWidth,
      position: { x: posX, y: posY },
      widthScale,
      positionScale,
    };

    const captionedVideoPath = path.join(userDir, `final_captioned_${projectId}_${Date.now()}.mp4`);
    const useHtmlCaptionLayer = this.configService.get<string>('CAPTION_RENDERER_MODE') !== 'ass';
    const assFallbackPolicy = (
      this.configService.get<string>('CAPTION_ASS_FALLBACK') || 'allow'
    ).trim().toLowerCase();
    const useVp9Intermediate =
      this.configService.get<string>('CAPTION_USE_VP9_INTERMEDIATE') === 'true';
    const captionFps = Number(this.configService.get<string>('CAPTION_LAYER_FPS') || 12);

    let captionRenderer: 'html' | 'ass' | 'failed' = 'failed';

    const cleanupFrameDir = (dir: string) => {
      try {
        if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // no-op
      }
    };

    try {
      if (useHtmlCaptionLayer) {
        try {
          const durationSec = await this.videoCompositor.getVideoDuration(videoPath);

          if (useVp9Intermediate) {
            const captionLayerPath = path.join(
              userDir,
              `caption_layer_${projectId}_${Date.now()}.webm`,
            );
            await this.htmlCaptionLayerProvider.renderCaptionLayerAsWebm({
              captions,
              style,
              width: videoWidth,
              height: videoHeight,
              durationSec,
              outputPath: captionLayerPath,
              fps: captionFps,
            });
            await this.videoCompositor.overlayCaptionLayerOnVideo(
              videoPath,
              captionLayerPath,
              captionedVideoPath,
            );
            try {
              if (fs.existsSync(captionLayerPath)) fs.unlinkSync(captionLayerPath);
            } catch {
              // no-op
            }
          } else {
            const layerResult = await this.htmlCaptionLayerProvider.renderCaptionLayer({
              captions,
              style,
              width: videoWidth,
              height: videoHeight,
              durationSec,
              fps: captionFps,
              outputDir: userDir,
            });
            await this.videoCompositor.overlayCaptionPngSequenceOnVideo(
              videoPath,
              layerResult.frameDir,
              layerResult.fps,
              captionedVideoPath,
            );
            cleanupFrameDir(layerResult.frameDir);
          }
          captionRenderer = 'html';
        } catch (htmlError: any) {
          if (assFallbackPolicy === 'deny') {
            await this.setCaptionRendererMetadata(projectId, 'failed');
            throw new Error(
              `Caption rendering unavailable (Playwright/HTML): ${htmlError?.message || htmlError}`,
            );
          }
          console.warn(
            `[RenderingService] HTML caption layer failed, falling back to ASS burn-in: ${htmlError?.message || htmlError}`,
          );
          await this.videoCompositor.addCaptionsToVideo(
            videoPath,
            captionedVideoPath,
            captions,
            style,
          );
          captionRenderer = 'ass';
        }
      } else {
        await this.videoCompositor.addCaptionsToVideo(
          videoPath,
          captionedVideoPath,
          captions,
          style,
        );
        captionRenderer = 'ass';
      }

      if (!fs.existsSync(captionedVideoPath)) {
        await this.setCaptionRendererMetadata(projectId, 'failed');
        return null;
      }

      const sourceDuration = await this.videoCompositor.getVideoDuration(videoPath);
      const validation = await this.videoCompositor.validateVideoOutput(captionedVideoPath, {
        sourcePath: videoPath,
        expectedDurationSec: sourceDuration,
      });

      if (!validation.ok) {
        console.error(
          `[RenderingService] Caption output validation failed: ${validation.reason}. Keeping uncaptioned video.`,
        );
        try {
          fs.unlinkSync(captionedVideoPath);
        } catch {
          // no-op
        }
        await this.setCaptionRendererMetadata(projectId, 'failed');
        if (assFallbackPolicy === 'deny' && captionRenderer === 'html') {
          throw new Error(`Caption output validation failed: ${validation.reason}`);
        }
        return null;
      }

      await this.setCaptionRendererMetadata(projectId, captionRenderer);
      console.log(
        `[RenderingService] ✅ Captions added successfully (${captionRenderer}): ${captionedVideoPath}`,
      );
      return captionedVideoPath;
    } catch (err) {
      await this.setCaptionRendererMetadata(projectId, 'failed');
      throw err;
    }
  }

  private isBackgroundMusicMixEnabled(): boolean {
    return this.configService.get<string>('BACKGROUND_MUSIC_ENABLED') !== 'false';
  }

  private clampBgMusicNumber(n: unknown, fallback: number, lo: number, hi: number): number {
    const x = typeof n === 'number' && !Number.isNaN(n) ? n : fallback;
    return Math.min(hi, Math.max(lo, x));
  }

  /**
   * Download remote BGM URL to a temp file, or resolve /uploads/... path on disk.
   */
  private async resolveBackgroundMusicToLocalPath(
    publicUrl: string,
    userId: string,
    projectId: string,
  ): Promise<string | null> {
    if (!publicUrl || typeof publicUrl !== 'string') return null;
    if (publicUrl.startsWith('http://') || publicUrl.startsWith('https://')) {
      const dest = path.join(this.uploadsDir, 'videos', userId, `bgm_dl_${projectId}_${Date.now()}.mp3`);
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const resp = await axios.get(publicUrl, {
        responseType: 'arraybuffer',
        maxContentLength: 50 * 1024 * 1024,
        timeout: 120000,
      });
      fs.writeFileSync(dest, Buffer.from(resp.data));
      return dest;
    }
    if (publicUrl.startsWith('/uploads/')) {
      const rel = publicUrl.replace(/^\/uploads\//, '');
      const inVideo = path.join(this.uploadsDir, rel);
      if (fs.existsSync(inVideo)) return inVideo;
      const serverRoot = path.join(process.cwd(), '..', '..');
      const mediaMusic = path.join(serverRoot, 'microservices', 'media-management-service', 'uploads', rel);
      if (fs.existsSync(mediaMusic)) return mediaMusic;
    }
    if (publicUrl.startsWith('/')) {
      const p = path.join(process.cwd(), publicUrl.replace(/^\//, ''));
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * When project.backgroundMusic has a public URL and mixing is enabled, mux BGM under the voice track.
   */
  private async downloadMagnificMusicAtExport(
    externalId: number,
    projectId: string,
  ): Promise<{ publicUrl: string; gcsUrl?: string }> {
    const base =
      this.configService.get<string>('MEDIA_MANAGEMENT_SERVICE_URL') ||
      process.env.MEDIA_MANAGEMENT_SERVICE_URL ||
      'http://localhost:9009/api';
    const downloadUrl = `${String(base).replace(/\/$/, '')}/stock/music/${externalId}/download`;
    const response = await axios.get(downloadUrl, {
      params: { projectId },
      timeout: 180000,
      maxContentLength: 50 * 1024 * 1024,
    });
    if (!response.data?.success) {
      throw new Error(response.data?.message || response.data?.error || 'Music download failed');
    }
    const d = response.data.data || {};
    const publicUrl = d.publicUrl || d.url;
    if (!publicUrl || typeof publicUrl !== 'string') {
      throw new Error('Music download response missing publicUrl');
    }
    return { publicUrl, gcsUrl: d.gcsUrl as string | undefined };
  }

  private async applyBackgroundMusicIfEnabled(
    project: { backgroundMusic?: unknown; userId?: string },
    videoWithVoicePath: string,
    userDir: string,
    projectId: string,
  ): Promise<string> {
    if (!this.isBackgroundMusicMixEnabled()) return videoWithVoicePath;
    const bgm = project.backgroundMusic as Record<string, unknown> | null | undefined;
    if (!bgm || bgm.enabled === false) return videoWithVoicePath;

    let url = (bgm.publicUrl || bgm.gcsUrl) as string | undefined;
    const rawExt = bgm.externalId;
    const externalId =
      typeof rawExt === 'number' && !Number.isNaN(rawExt)
        ? rawExt
        : typeof rawExt === 'string'
          ? parseInt(rawExt, 10)
          : NaN;
    const source = bgm.source;

    if (!url && Number.isFinite(externalId) && externalId >= 1 && source === 'magnific') {
      console.log(`[RenderingService] BGM: downloading Magnific track ${externalId} at export time...`);
      try {
        const downloaded = await this.downloadMagnificMusicAtExport(externalId, projectId);
        url = downloaded.publicUrl;
        const merged = {
          ...bgm,
          publicUrl: downloaded.publicUrl,
          gcsUrl: downloaded.gcsUrl ?? bgm.gcsUrl,
        };
        await this.databaseService.videoProject.update({
          where: { id: projectId },
          data: { backgroundMusic: merged } as any,
        });
      } catch (dlError: any) {
        console.warn(`[RenderingService] BGM: deferred download failed: ${dlError?.message || dlError}`);
        return videoWithVoicePath;
      }
    }

    if (!url) return videoWithVoicePath;

    const userId = (project as any).userId as string;
    let localBgm: string | null = null;
    try {
      localBgm = await this.resolveBackgroundMusicToLocalPath(url, userId, projectId);
      if (!localBgm) {
        console.warn(`[RenderingService] BGM: could not resolve local file from ${url.slice(0, 120)}`);
        return videoWithVoicePath;
      }
      const out = path.join(userDir, `final_with_bgm_${projectId}_${Date.now()}.mp4`);
      const mixVol = this.clampBgMusicNumber(bgm.mixVolume, 0.05, 0, 1);
      const voiceVol = this.clampBgMusicNumber(bgm.voiceDuckTo, 1.0, 0, 1);
      const fadeInMs = this.clampBgMusicNumber(bgm.fadeInMs, 500, 0, 5000);
      const fadeOutMs = this.clampBgMusicNumber(bgm.fadeOutMs, 1500, 0, 5000);
      await this.videoCompositor.mixVoiceWithBackgroundMusic(videoWithVoicePath, localBgm, out, {
        mixVolume: mixVol,
        voiceDuckTo: voiceVol,
        fadeInSec: fadeInMs / 1000,
        fadeOutSec: fadeOutMs / 1000,
      });
      return out;
    } catch (e: any) {
      console.warn(`[RenderingService] BGM mix failed, using voice-only: ${e?.message || e}`);
      return videoWithVoicePath;
    } finally {
      try {
        if (localBgm && localBgm.includes(`bgm_dl_${projectId}`) && fs.existsSync(localBgm)) {
          fs.unlinkSync(localBgm);
        }
      } catch {
        // ignore
      }
    }
  }

  private async updateRenderingStatus(
    projectId: string,
    status: string,
    progress: number
  ): Promise<void> {
    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        renderingStatus: status as any,
        renderingProgress: progress as any,
        progressStage: this.getStageDescription(status),
      },
    });
  }

  /**
   * Get human-readable stage description
   */
  private getStageDescription(status: string): string {
    const descriptions: Record<string, string> = {
      'audio_generating': 'Generating audio files...',
      'image_generating': 'Creating images...',
      'video_generating': 'Generating B-roll videos...',
      'avatar_generating': 'Creating avatar videos...',
      'stitching_broll': 'Stitching B-roll videos...',
      'stitching_audio': 'Stitching audio files...',
      'stitching': 'Stitching everything together...',
      'overlaying': 'Overlaying avatar on video...',
      'completed': 'Video rendering completed!',
      'failed': 'Video rendering failed',
    };
    return descriptions[status] || 'Processing...';
  }

  /**
   * Get rendering status for a project
   */
  async getRenderingStatus(projectId: string, userId: string): Promise<any> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    const metadata =
      project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
        ? (project.metadata as Record<string, unknown>)
        : {};

    return {
      success: true,
      data: {
        renderingStatus: (project as any).renderingStatus,
        renderingProgress: (project as any).renderingProgress,
        progressStage: project.progressStage,
        status: project.status,
        videoUrl: project.videoUrl,
        thumbnailUrl: project.thumbnailUrl,
        errorMessage: project.errorMessage,
        metadata,
      },
    };
  }
}
