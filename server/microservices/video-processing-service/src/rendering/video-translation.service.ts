import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../common/database/database.service';
import { RenderingService } from './rendering.service';
import { HeyGenVideoProvider } from './providers/heygen-video.provider';
import { JobStatusGateway } from '../common/websocket/job-status.gateway';
import { QueueManagerService } from '../common/queue/queue-manager.service';
import {
  parseVideoTranslations,
  SceneTranslationEntry,
  upsertVideoTranslationVariant,
  VideoTranslationVariant,
} from '../video/video-translation.types';
import { PreviewVideoService } from '../preview/preview-video.service';

export interface VideoTranslationJobData {
  projectId: string;
  userId: string;
  variantId: string;
  language: string;
  authToken?: string;
  retryFailedScenesOnly?: boolean;
}

@Injectable()
export class VideoTranslationService {
  private static readonly SCENE_TRANSLATION_CONCURRENCY = 4;
  private static readonly PARALLEL_POLL_INTERVAL_MS = 8000;
  private static readonly DEFAULT_POLL_INTERVAL_MS = 5000;

  private readonly aiContentServiceUrl: string;
  private readonly jwtSecret: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly renderingService: RenderingService,
    private readonly heygenVideoProvider: HeyGenVideoProvider,
    private readonly jobStatusGateway: JobStatusGateway,
    private readonly queueManager: QueueManagerService,
    private readonly configService: ConfigService,
    private readonly previewVideoService: PreviewVideoService,
  ) {
    this.aiContentServiceUrl =
      this.configService.get<string>('AI_CONTENT_SERVICE_URL') || 'http://localhost:9002';
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'secret';
  }

  async listSupportedLanguages(): Promise<string[]> {
    return this.heygenVideoProvider.listVideoTranslationLanguages();
  }

  async getTranslations(projectId: string, userId: string): Promise<VideoTranslationVariant[]> {
    const project = await this.getProjectOrThrow(projectId, userId);
    return parseVideoTranslations((project as any).videoTranslations);
  }

  async getTranslation(projectId: string, userId: string, variantId: string): Promise<VideoTranslationVariant> {
    const variants = await this.getTranslations(projectId, userId);
    const variant = variants.find((v) => v.id === variantId);
    if (!variant) throw new NotFoundException('Translation variant not found');
    return variant;
  }

  async deleteTranslation(projectId: string, userId: string, variantId: string): Promise<void> {
    const project = await this.getProjectOrThrow(projectId, userId);
    const variants = parseVideoTranslations((project as any).videoTranslations);
    const variant = variants.find((v) => v.id === variantId);
    const next = variants.filter((v) => v.id !== variantId);
    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: { videoTranslations: next as any },
    });
    if (variant) {
      this.cleanupVariantAssets(project.userId, variantId, variant).catch(() => {});
    }
  }

  private async cleanupVariantAssets(userId: string, variantId: string, variant: VideoTranslationVariant): Promise<void> {
    const workDir = path.join(this.renderingService.getUploadsDir(), 'videos', userId, 'translations', variantId);
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    if (variant.localVideoUrl?.startsWith('/uploads/')) {
      const local = path.join(
        this.renderingService.getUploadsDir(),
        variant.localVideoUrl.replace(/^\/uploads\//, ''),
      );
      if (fs.existsSync(local)) fs.unlinkSync(local);
    }
  }

  async requestTranslation(
    projectId: string,
    userId: string,
    languages: string[],
    authToken?: string,
  ): Promise<{ variants: VideoTranslationVariant[]; jobs: { variantId: string; jobId: string; language: string }[] }> {
    if (!languages?.length) {
      throw new BadRequestException('At least one target language is required');
    }

    const project = await this.getProjectOrThrow(projectId, userId);
    if (!this.isOriginalVideoEligibleForTranslation(project)) {
      throw new BadRequestException(
        'Export your final video before translating. Avatar-only projects must complete the export step first.',
      );
    }

    await this.assertNonHumanAvatarAllowed(project, authToken);

    const supported = await this.listSupportedLanguages();
    const normalized = languages.map((l) => l.trim()).filter(Boolean);
    for (const lang of normalized) {
      if (!supported.includes(lang)) {
        throw new BadRequestException(`Unsupported translation language: ${lang}`);
      }
    }

    const existing = parseVideoTranslations((project as any).videoTranslations);
    const inFlight = existing.filter((v) =>
      ['pending', 'translating_scenes', 'stitching', 'post_processing'].includes(v.status),
    );
    if (inFlight.length > 0 && inFlight.some((v) => normalized.includes(v.language))) {
      throw new BadRequestException('Translation already in progress for one or more selected languages');
    }

    const duplicateLangs = normalized.filter((lang) =>
      existing.some((v) => v.language === lang && v.status === 'completed'),
    );
    if (duplicateLangs.length === normalized.length) {
      throw new BadRequestException('All selected languages already have completed translations');
    }

    const toCreate = normalized.filter(
      (lang) => !existing.some((v) => v.language === lang && ['completed', 'pending', 'translating_scenes', 'stitching', 'post_processing'].includes(v.status)),
    );

    const toRetry = normalized
      .map((lang) => existing.find((v) => v.language === lang && v.status === 'failed'))
      .filter(Boolean) as VideoTranslationVariant[];

    const chargeCount = toCreate.length + toRetry.length;
    if (chargeCount === 0) {
      throw new BadRequestException('No new translations or retries to process');
    }

    await this.assertTranslationAffordable(projectId, userId, chargeCount);

    let variants = [...existing];
    const jobs: { variantId: string; jobId: string; language: string }[] = [];

    for (const language of toCreate) {
      const variantId = crypto.randomUUID();
      const { snapshotId } = await this.chargeTranslationCreditsForVariant(
        projectId,
        userId,
        variantId,
        language,
      );

      const variant: VideoTranslationVariant = {
        id: variantId,
        language,
        status: 'pending',
        progress: 0,
        createdAt: new Date().toISOString(),
        sceneTranslations: [],
        creditsCharged: true,
        creditSnapshotId: snapshotId,
      };
      variants = upsertVideoTranslationVariant(variants, variant);

      const jobId = await this.queueManager.addVideoTranslationJob({
        projectId,
        userId,
        variantId,
        language,
        authToken,
      });

      variant.jobId = jobId;
      variant.status = 'translating_scenes';
      variants = upsertVideoTranslationVariant(variants, variant);
      jobs.push({ variantId, jobId, language });
    }

    for (const failed of toRetry) {
      const variantId = failed.id;
      const { snapshotId } = await this.chargeTranslationCreditsForVariant(
        projectId,
        userId,
        variantId,
        failed.language,
      );

      const jobId = await this.queueManager.addVideoTranslationJob({
        projectId,
        userId,
        variantId,
        language: failed.language,
        authToken,
        retryFailedScenesOnly: true,
      });

      const variant: VideoTranslationVariant = {
        ...failed,
        jobId,
        status: 'translating_scenes',
        progress: 0,
        error: undefined,
        creditsCharged: true,
        creditSnapshotId: snapshotId,
      };
      variants = upsertVideoTranslationVariant(variants, variant);
      jobs.push({ variantId, jobId, language: failed.language });
    }

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: { videoTranslations: variants as any },
    });

    return { variants, jobs };
  }

  async processTranslationJob(data: VideoTranslationJobData, emitJobId: string): Promise<any> {
    const { projectId, userId, variantId, language, authToken, retryFailedScenesOnly } = data;
    const project = await this.getProjectOrThrow(projectId, userId);
    let variants = parseVideoTranslations((project as any).videoTranslations);
    let variant = variants.find((v) => v.id === variantId);
    if (!variant) throw new Error(`Translation variant ${variantId} not found`);

    const notify = async (state: string, progress: number, extra: Record<string, unknown> = {}) => {
      variant = { ...variant!, progress, ...(state === 'completed' ? { status: 'completed' as const } : {}), ...(state === 'failed' ? { status: 'failed' as const } : {}) };
      await this.persistVariant(projectId, variant);
      await this.jobStatusGateway.notifyJobStatus(userId, {
        jobId: emitJobId,
        queueType: 'video-translation',
        state: state as any,
        progress,
        result: { variantId, language, ...extra },
        metadata: { variantId, language, projectId },
      }).catch(() => {});
    };

    try {
      variant = { ...variant, status: 'translating_scenes', progress: 5, error: undefined };
      await this.persistVariant(projectId, variant);
      await notify('active', 5, { phase: 'translating_scenes' });

      const style = String(project.style || '');
      const audioFiles = (project.audioFiles as any[]) || [];
      const script = typeof project.script === 'string' ? JSON.parse(project.script) : project.script;
      const scenes = script?.scenes || script?.scene_plan || [];
      const userDir = path.join(this.renderingService.getUploadsDir(), 'videos', userId);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

      const translatedVoiceovers = await this.fetchTranslatedVoiceovers(
        projectId,
        userId,
        scenes,
        audioFiles,
        language,
        authToken,
      );

      let sceneTranslations = variant.sceneTranslations || [];
      const workDir = path.join(userDir, 'translations', variantId);
      if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

      if (style === 'AVATAR_ONLY' || style === 'ANIMATED_AVATAR') {
        sceneTranslations = await this.translateSingleClipVariant(
          project,
          userId,
          variant,
          language,
          workDir,
          emitJobId,
          notify,
        );
      } else if (style === 'ALTERNATE') {
        sceneTranslations = await this.translateAlternateScenes(
          project,
          userId,
          projectId,
          variantId,
          scenes,
          audioFiles,
          language,
          workDir,
          sceneTranslations,
          retryFailedScenesOnly,
          notify,
        );
      } else if (style === 'B_ROLL_ONLY' || style === 'PRODUCT_ONLY') {
        sceneTranslations = await this.translateBrollOnlyScenes(
          project,
          userId,
          projectId,
          variantId,
          scenes,
          audioFiles,
          language,
          workDir,
          sceneTranslations,
          retryFailedScenesOnly,
          notify,
        );
      } else if (style === 'HALF_N_HALF') {
        sceneTranslations = await this.translateHalfNHalf(
          project,
          userId,
          projectId,
          variant,
          language,
          workDir,
          notify,
        );
      } else {
        throw new BadRequestException(`Video style ${style} is not yet supported for translation`);
      }

      variant = {
        ...variant,
        sceneTranslations,
        translatedVoiceovers: this.mergeTranslatedDurations(translatedVoiceovers, sceneTranslations),
        status: 'stitching',
        progress: 70,
      };
      await this.persistVariant(projectId, variant);
      await notify('active', 70, { phase: 'stitching' });

      const stitchedPath = await this.stitchTranslatedScenes(
        project,
        userId,
        variant,
        scenes,
        audioFiles,
        workDir,
        style,
      );

      variant = { ...variant, status: 'post_processing', progress: 85 };
      await this.persistVariant(projectId, variant);
      await notify('active', 85, { phase: 'post_processing' });

      const captionAudioFiles = this.buildCaptionAudioFilesForTranslation(
        audioFiles,
        translatedVoiceovers,
        sceneTranslations,
      );
      const { pathForUpload, totalDuration } = await this.renderingService.postProcessVideoPath(
        project,
        stitchedPath,
        userDir,
        projectId,
        audioFiles,
        `TRANSLATION_${style}`,
        captionAudioFiles,
      );

      const finalized = await this.renderingService.finalizeVariant(
        projectId,
        userId,
        project,
        pathForUpload,
        userDir,
        totalDuration,
        `TRANSLATION_${language}`,
      );

      let previewVideoUrl: string | undefined;
      let thumbnailUrl: string | undefined;
      try {
        const styleMeta = (project.style as string) || undefined;
        const previewResult = await this.previewVideoService.buildWatermarkedPreview({
          projectId,
          userId,
          sourceVideoUrl: finalized.localVideoUrl || finalized.publicUrl,
          audioFiles: captionAudioFiles.map((af) => ({
            sceneNumber: af.sceneNumber,
            duration: af.duration,
          })),
          projectMetadata: {
            ...(typeof project.metadata === 'object' && project.metadata ? project.metadata : {}),
            style: styleMeta,
            brandPackagingApplied: finalized.metadata?.brandPackagingApplied === true,
          },
          outputKey: `${projectId}_tr_${variant.id}`,
        });
        previewVideoUrl = previewResult.previewPublicUrl;
        thumbnailUrl = previewResult.thumbnailPublicUrl;
      } catch (previewErr: any) {
        console.warn(
          `[VideoTranslationService] Preview build failed for variant ${variant.id}: ${previewErr?.message || previewErr}`,
        );
      }

      variant = {
        ...variant,
        status: 'completed',
        progress: 100,
        videoUrl: finalized.publicUrl,
        localVideoUrl: finalized.localVideoUrl,
        previewVideoUrl,
        thumbnailUrl,
        duration: finalized.finalDuration,
        completedAt: new Date().toISOString(),
      };
      await this.persistVariant(projectId, variant);
      await notify('completed', 100, { video: variant });

      return { success: true, variant };
    } catch (error: any) {
      console.error(`[VideoTranslationService] Job failed for variant ${variantId}:`, error);
      variant = {
        ...variant!,
        status: 'failed',
        error: error?.message || String(error),
      };
      await this.persistVariant(projectId, variant);
      await notify('failed', variant.progress || 0, { error: variant.error });
      if (variant.creditsCharged && variant.creditSnapshotId) {
        await this.refundTranslationCreditsForVariant(
          projectId,
          userId,
          variantId,
          variant.creditSnapshotId,
          variant.language,
        );
        variant = { ...variant, creditsCharged: false, creditSnapshotId: undefined };
        await this.persistVariant(projectId, variant);
      }
      throw error;
    }
  }

  private async translateSingleClipVariant(
    project: any,
    userId: string,
    variant: VideoTranslationVariant,
    language: string,
    workDir: string,
    emitJobId: string,
    notify: (state: string, progress: number, extra?: Record<string, unknown>) => Promise<void>,
  ): Promise<SceneTranslationEntry[]> {
    const sourcePath = await this.resolveProjectSourceVideo(project, userId);
    const publicUrl = await this.ensurePublicVideoUrl(
      sourcePath,
      userId,
      project.id,
      variant.id,
      'translate_src.mp4',
    );

    await notify('active', 20, { phase: 'heygen_translate' });
    const translationId = await this.heygenVideoProvider.createVideoTranslation({
      videoUrl: publicUrl,
      outputLanguage: language,
      mode: 'precision',
      translateAudioOnly: false,
      disableMusicTrack: true,
      title: `Translation ${language} - ${project.id}`,
    });

    const result = await this.heygenVideoProvider.pollVideoTranslationUntilComplete(translationId);
    const localPath = path.join(workDir, `avatar_only_translated_${variant.id}.mp4`);
    await this.heygenVideoProvider.downloadVideo(result.videoUrl!, localPath);

    const duration = await this.renderingService.getVideoCompositor().getVideoDuration(localPath).catch(() => 0);

    return [{
      sceneNumber: 1,
      role: 'avatar',
      heygenTranslationId: translationId,
      translatedClipUrl: result.videoUrl,
      translatedClipLocalPath: localPath,
      duration,
      status: 'completed',
    }];
  }

  private async translateAlternateScenes(
    project: any,
    userId: string,
    projectId: string,
    variantId: string,
    scenes: any[],
    audioFiles: any[],
    language: string,
    workDir: string,
    existing: SceneTranslationEntry[],
    retryFailedOnly?: boolean,
    notify?: (state: string, progress: number, extra?: Record<string, unknown>) => Promise<void>,
  ): Promise<SceneTranslationEntry[]> {
    const avatarVideos = (project.avatarVideos as any[]) || [];
    const bRollVideos = (project.bRollVideoTasks as any[]) || [];
    const sortedScenes = [...scenes].sort(
      (a, b) => (a.scene_number || a.sceneNumber || 1) - (b.scene_number || b.sceneNumber || 1),
    );
    const results: SceneTranslationEntry[] = [...existing];
    const total = sortedScenes.length;
    let completedCount = 0;

    const scenesToProcess: Array<{ scene: any; sceneNumber: number }> = [];
    for (const scene of sortedScenes) {
      const sceneNumber = scene.scene_number || scene.sceneNumber || 1;
      const prev = results.find((r) => r.sceneNumber === sceneNumber);
      if (retryFailedOnly && prev?.status === 'completed') {
        completedCount++;
        continue;
      }
      scenesToProcess.push({ scene, sceneNumber });
    }

    const pollIntervalMs =
      scenesToProcess.length > 2
        ? VideoTranslationService.PARALLEL_POLL_INTERVAL_MS
        : VideoTranslationService.DEFAULT_POLL_INTERVAL_MS;

    const processScene = async ({ scene, sceneNumber }: { scene: any; sceneNumber: number }) => {
      const role = this.renderingService.getAlternateSceneRolePublic(scene, sceneNumber);
      try {
        const entry = await this.translateOneAlternateScene({
          project,
          userId,
          projectId,
          variantId,
          sceneNumber,
          role,
          language,
          workDir,
          avatarVideos,
          bRollVideos,
          audioFiles,
          pollIntervalMs,
        });

        const idx = results.findIndex((r) => r.sceneNumber === sceneNumber);
        if (idx >= 0) results[idx] = entry;
        else results.push(entry);

        completedCount++;
        if (notify) {
          await notify('active', 10 + Math.round((completedCount / total) * 55), {
            phase: 'translating_scenes',
            sceneNumber,
            completedScenes: completedCount,
            totalScenes: total,
          });
        }
        return entry;
      } catch (err: any) {
        const failedEntry: SceneTranslationEntry = {
          sceneNumber,
          role: role === 'avatar' ? 'avatar' : 'broll',
          status: 'failed',
          error: err?.message || String(err),
        };
        const idx = results.findIndex((r) => r.sceneNumber === sceneNumber);
        if (idx >= 0) results[idx] = failedEntry;
        else results.push(failedEntry);
        throw err;
      }
    };

    await this.runWithConcurrency(
      scenesToProcess,
      VideoTranslationService.SCENE_TRANSLATION_CONCURRENCY,
      processScene,
    );

    return results;
  }

  private async translateOneAlternateScene(params: {
    project: any;
    userId: string;
    projectId: string;
    variantId: string;
    sceneNumber: number;
    role: string;
    language: string;
    workDir: string;
    avatarVideos: any[];
    bRollVideos: any[];
    audioFiles: any[];
    pollIntervalMs: number;
  }): Promise<SceneTranslationEntry> {
    const {
      project,
      userId,
      projectId,
      variantId,
      sceneNumber,
      role,
      language,
      workDir,
      avatarVideos,
      bRollVideos,
      audioFiles,
      pollIntervalMs,
    } = params;

    let sourcePath: string | null = null;
    if (role === 'avatar') {
      const entry = avatarVideos.find((v: any) => v.sceneNumber === sceneNumber);
      sourcePath = this.renderingService.resolveLocalVideoPath(entry?.localPath, entry?.localUrl);
      if (!sourcePath) throw new Error(`Missing avatar video for scene ${sceneNumber}`);
    } else {
      sourcePath = await this.buildBrollSceneClip(project, userId, sceneNumber, bRollVideos, audioFiles, workDir);
    }

    const langSlug = language.replace(/\W+/g, '_');
    const publicUrl = await this.ensurePublicVideoUrl(
      sourcePath,
      userId,
      projectId,
      variantId,
      `scene_${sceneNumber}_${langSlug}.mp4`,
    );

    console.log(
      `[VideoTranslationService] HeyGen translate scene ${sceneNumber} project=${projectId} variant=${variantId} role=${role} source=${sourcePath}`,
    );

    const translationId = await this.heygenVideoProvider.createVideoTranslation({
      videoUrl: publicUrl,
      outputLanguage: language,
      mode: role === 'avatar' ? 'precision' : 'speed',
      translateAudioOnly: role === 'b-roll',
      disableMusicTrack: true,
      title: `Scene ${sceneNumber} ${language} - ${projectId}`,
      speakerNum: 1,
    });

    const polled = await this.heygenVideoProvider.pollVideoTranslationUntilComplete(
      translationId,
      120,
      pollIntervalMs,
    );
    const localPath = path.join(workDir, `scene_${sceneNumber}_translated.mp4`);
    await this.heygenVideoProvider.downloadVideo(polled.videoUrl!, localPath);

    let finalPath = localPath;
    if (role === 'b-roll') {
      const translatedDur = await this.renderingService.getVideoCompositor().getVideoDuration(localPath).catch(() => 0);
      finalPath = await this.refitVideoToTargetDuration(localPath, workDir, sceneNumber, translatedDur);
    }

    const duration = await this.renderingService.getVideoCompositor().getVideoDuration(finalPath).catch(() => 0);
    return {
      sceneNumber,
      role: role === 'avatar' ? 'avatar' : 'broll',
      heygenTranslationId: translationId,
      translatedClipUrl: polled.videoUrl,
      translatedClipLocalPath: finalPath,
      duration,
      status: 'completed',
    };
  }

  private async runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    if (!items.length) return [];
    const results: R[] = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) break;
        results[index] = await fn(items[index]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private async translateBrollOnlyScenes(
    project: any,
    userId: string,
    projectId: string,
    variantId: string,
    scenes: any[],
    audioFiles: any[],
    language: string,
    workDir: string,
    existing: SceneTranslationEntry[],
    retryFailedOnly?: boolean,
    notify?: (state: string, progress: number, extra?: Record<string, unknown>) => Promise<void>,
  ): Promise<SceneTranslationEntry[]> {
    return this.translateAlternateScenes(
      project,
      userId,
      projectId,
      variantId,
      scenes.length ? scenes : audioFiles.map((af, i) => ({ scene_number: af.sceneNumber || i + 1 })),
      audioFiles,
      language,
      workDir,
      existing,
      retryFailedOnly,
      notify,
    ).then(async (entries) =>
      entries.map((e) => ({ ...e, role: 'broll' as const })),
    );
  }

  private async translateHalfNHalf(
    project: any,
    userId: string,
    projectId: string,
    variant: VideoTranslationVariant,
    language: string,
    workDir: string,
    notify?: (state: string, progress: number, extra?: Record<string, unknown>) => Promise<void>,
  ): Promise<SceneTranslationEntry[]> {
    const variantId = variant.id;
    const meta = (project.metadata as Record<string, unknown>) || {};
    const avatarCache = meta.avatarVideoCache as Record<string, { localPath?: string }> | undefined;
    const avatarPath =
      avatarCache && Object.values(avatarCache)[0]?.localPath
        ? Object.values(avatarCache)[0]!.localPath!
        : null;

    if (!avatarPath || !fs.existsSync(avatarPath)) {
      throw new Error('HALF_N_HALF avatar source video not found for translation');
    }

    const pollIntervalMs = VideoTranslationService.PARALLEL_POLL_INTERVAL_MS;

    await notify?.('active', 20, { phase: 'translate_parallel' });

    const translateAvatar = async (): Promise<string> => {
      const avatarPublic = await this.ensurePublicVideoUrl(
        avatarPath,
        userId,
        projectId,
        variantId,
        'half_avatar.mp4',
      );
      const avatarTranslationId = await this.heygenVideoProvider.createVideoTranslation({
        videoUrl: avatarPublic,
        outputLanguage: language,
        mode: 'precision',
        translateAudioOnly: false,
        disableMusicTrack: true,
        title: `HALF_N_HALF avatar ${language} - ${projectId}`,
      });
      const avatarResult = await this.heygenVideoProvider.pollVideoTranslationUntilComplete(
        avatarTranslationId,
        120,
        pollIntervalMs,
      );
      const translatedAvatarPath = path.join(workDir, 'half_avatar_translated.mp4');
      await this.heygenVideoProvider.downloadVideo(avatarResult.videoUrl!, translatedAvatarPath);
      return translatedAvatarPath;
    };

    const translateBroll = async (): Promise<string> => {
      const brollStitched = path.join(workDir, 'half_broll_stitched.mp4');
      const bRollVideos = (project.bRollVideoTasks as any[]) || [];
      const brollPaths = bRollVideos
        .sort((a, b) => a.sceneNumber - b.sceneNumber)
        .map((v) => this.renderingService.resolveLocalVideoPath(v.localPath, v.localUrl))
        .filter(Boolean) as string[];
      if (!brollPaths.length) throw new Error('Missing b-roll videos for HALF_N_HALF translation');
      await this.renderingService.concatenateSceneClips(brollPaths, brollStitched);

      const brollPublic = await this.ensurePublicVideoUrl(
        brollStitched,
        userId,
        projectId,
        variantId,
        'half_broll.mp4',
      );
      const brollTranslationId = await this.heygenVideoProvider.createVideoTranslation({
        videoUrl: brollPublic,
        outputLanguage: language,
        mode: 'speed',
        translateAudioOnly: true,
        disableMusicTrack: true,
        title: `HALF_N_HALF broll ${language} - ${projectId}`,
      });
      const brollResult = await this.heygenVideoProvider.pollVideoTranslationUntilComplete(
        brollTranslationId,
        120,
        pollIntervalMs,
      );
      const translatedBrollPath = path.join(workDir, 'half_broll_translated.mp4');
      await this.heygenVideoProvider.downloadVideo(brollResult.videoUrl!, translatedBrollPath);
      return translatedBrollPath;
    };

    const [translatedAvatarPath, translatedBrollPath] = await Promise.all([
      translateAvatar(),
      translateBroll(),
    ]);

    await notify?.('active', 55, { phase: 'composite_half' });

    const compositedPath = path.join(workDir, `half_composited_${variantId}.mp4`);
    await this.renderingService.getVideoCompositor().compositeHalfAndHalf(
      translatedBrollPath,
      translatedAvatarPath,
      compositedPath,
      1080,
      1920,
    );

    return [
      {
        sceneNumber: 1,
        role: 'avatar',
        translatedClipLocalPath: compositedPath,
        status: 'completed',
      },
    ];
  }

  private async stitchTranslatedScenes(
    project: any,
    userId: string,
    variant: VideoTranslationVariant,
    scenes: any[],
    audioFiles: any[],
    workDir: string,
    style: string,
  ): Promise<string> {
    const sceneTranslations = variant.sceneTranslations || [];
    if (style === 'AVATAR_ONLY' || style === 'ANIMATED_AVATAR') {
      const clip = sceneTranslations[0]?.translatedClipLocalPath;
      if (!clip || !fs.existsSync(clip)) throw new Error('Translated avatar clip missing');
      return clip;
    }

    if (style === 'HALF_N_HALF') {
      const clip = sceneTranslations[0]?.translatedClipLocalPath;
      if (!clip || !fs.existsSync(clip)) throw new Error('Translated HALF_N_HALF clip missing');
      return clip;
    }

    const sortedScenes = [...scenes].sort(
      (a, b) => (a.scene_number || a.sceneNumber || 1) - (b.scene_number || b.sceneNumber || 1),
    );
    const compositor = this.renderingService.getVideoCompositor();
    const userDir = path.join(this.renderingService.getUploadsDir(), 'videos', userId);
    const scenePaths: string[] = [];

    for (const scene of sortedScenes) {
      const sceneNumber = scene.scene_number || scene.sceneNumber || 1;
      const entry = sceneTranslations.find((s) => s.sceneNumber === sceneNumber);
      if (!entry?.translatedClipLocalPath || !fs.existsSync(entry.translatedClipLocalPath)) {
        throw new Error(`Missing translated clip for scene ${sceneNumber}`);
      }
      let clipPath = entry.translatedClipLocalPath;
      const res = await compositor.getVideoResolution(clipPath);
      if (res && (res.width !== 1080 || res.height !== 1920)) {
        const scaled = path.join(userDir, `trans_scaled_${sceneNumber}_${variant.id}.mp4`);
        await compositor.scaleVideoToDimensions(clipPath, scaled, 1080, 1920);
        if (fs.existsSync(scaled)) clipPath = scaled;
      }
      scenePaths.push(path.resolve(clipPath));
    }

    const outputPath = path.join(workDir, `stitched_${variant.id}.mp4`);
    await this.renderingService.concatenateTranslatedSceneClips(scenePaths, outputPath);
    return outputPath;
  }

  private async buildBrollSceneClip(
    project: any,
    userId: string,
    sceneNumber: number,
    bRollVideos: any[],
    audioFiles: any[],
    workDir: string,
  ): Promise<string> {
    const videoEntry = bRollVideos.find((v) => v.sceneNumber === sceneNumber);
    if (!videoEntry) throw new Error(`Missing b-roll video for scene ${sceneNumber}`);

    let videoPath = this.renderingService.resolveLocalVideoPath(videoEntry.localPath, videoEntry.localUrl);
    if (!videoPath) throw new Error(`B-roll file not found for scene ${sceneNumber}`);

    const audioFile = audioFiles.find((af) => af.sceneNumber === sceneNumber);
    if (!audioFile) throw new Error(`Missing audio for scene ${sceneNumber}`);

    const audioPath = this.resolveAudioPath(audioFile);
    if (!audioPath) throw new Error(`Audio file not found for scene ${sceneNumber}`);

    const compositor = this.renderingService.getVideoCompositor();
    const res = await compositor.getVideoResolution(videoPath);
    if (res && (res.width !== 1080 || res.height !== 1920)) {
      const scaled = path.join(workDir, `broll_src_scaled_${sceneNumber}.mp4`);
      await compositor.scaleVideoToDimensions(videoPath, scaled, 1080, 1920);
      if (fs.existsSync(scaled)) videoPath = scaled;
    }

    const withAudio = path.join(workDir, `broll_src_${sceneNumber}.mp4`);
    await compositor.addAudioToVideo(videoPath, audioPath, withAudio);
    return withAudio;
  }

  private async refitVideoToTargetDuration(
    videoPath: string,
    workDir: string,
    sceneNumber: number,
    targetDur: number,
  ): Promise<string> {
    const compositor = this.renderingService.getVideoCompositor();
    const out = path.join(workDir, `refit_${sceneNumber}.mp4`);
    const refitted = await compositor.refitVideoToTargetDuration(videoPath, out, targetDur);
    return refitted === videoPath ? videoPath : refitted;
  }

  private resolveAudioPath(audioFile: any): string | null {
    const p = this.renderingService.getAudioFilePathPublic(audioFile);
    if (!p) return null;
    if (path.isAbsolute(p) && fs.existsSync(p)) return p;
    const serverRoot = path.join(process.cwd(), '..', '..');
    const voiceServiceDir = path.join(serverRoot, 'microservices', 'voice-audio-service');
    const rel = p.startsWith('/') ? p.slice(1) : p;
    for (const base of [voiceServiceDir, serverRoot, process.cwd()]) {
      const full = path.join(base, rel);
      if (fs.existsSync(full)) return full;
    }
    return null;
  }

  private async resolveProjectSourceVideo(project: any, userId: string): Promise<string> {
    const localFromUrl = project.videoUrl?.startsWith('/uploads')
      ? path.join(this.renderingService.getUploadsDir(), project.videoUrl.replace(/^\/uploads\//, ''))
      : null;
    if (localFromUrl && fs.existsSync(localFromUrl)) return localFromUrl;

    if (project.videoUrl?.startsWith('http')) {
      const tmp = path.join(this.renderingService.getUploadsDir(), 'videos', userId, `dl_${project.id}.mp4`);
      await this.heygenVideoProvider.downloadVideo(project.videoUrl, tmp);
      return tmp;
    }

    throw new Error('Cannot resolve source video for translation');
  }

  private async ensurePublicVideoUrl(
    localPath: string,
    userId: string,
    projectId: string,
    variantId: string,
    filename: string,
  ): Promise<string> {
    const gcsFolder = `videos/${userId}/translation-sources/${projectId}/${variantId}`;
    const result = await this.renderingService.getPublicUrlService().uploadFromPath(
      localPath,
      gcsFolder,
      filename,
      'video/mp4',
    );
    const url = result.gcsUrl || result.publicUrl;
    if (!url || url.includes('localhost')) {
      throw new Error('Could not publish video for HeyGen translation — configure GCS public URLs');
    }
    console.log(
      `[VideoTranslationService] Published translation source project=${projectId} variant=${variantId} file=${filename}`,
    );
    return url;
  }

  private buildCaptionAudioFiles(originalAudio: any[], translated: Array<{ sceneNumber: number; voiceover: string; duration?: number }>) {
    return originalAudio.map((af) => {
      const tr = translated.find((t) => t.sceneNumber === af.sceneNumber);
      if (!tr) return af;
      return {
        ...af,
        voiceover: tr.voiceover,
        text: tr.voiceover,
        duration: tr.duration ?? af.duration,
      };
    });
  }

  private buildCaptionAudioFilesForTranslation(
    originalAudio: any[],
    translated: Array<{ sceneNumber: number; voiceover: string; duration?: number }>,
    sceneTranslations: SceneTranslationEntry[],
  ) {
    return originalAudio.map((af) => {
      const tr = translated.find((t) => t.sceneNumber === af.sceneNumber);
      const scene = sceneTranslations.find((s) => s.sceneNumber === af.sceneNumber);
      if (!tr && !scene) return af;
      return {
        ...af,
        voiceover: tr?.voiceover ?? af.voiceover,
        text: tr?.voiceover ?? af.text,
        duration: scene?.duration ?? tr?.duration ?? af.duration,
        wordTimestamps: undefined,
      };
    });
  }

  private mergeTranslatedDurations(
    translated: Array<{ sceneNumber: number; voiceover: string; duration?: number }>,
    sceneTranslations: SceneTranslationEntry[],
  ): Array<{ sceneNumber: number; voiceover: string; duration?: number }> {
    return translated.map((t) => {
      const scene = sceneTranslations.find((s) => s.sceneNumber === t.sceneNumber);
      return scene?.duration ? { ...t, duration: scene.duration } : t;
    });
  }

  private async fetchTranslatedVoiceovers(
    projectId: string,
    userId: string,
    scenes: any[],
    audioFiles: any[],
    targetLanguage: string,
    authToken?: string,
  ): Promise<Array<{ sceneNumber: number; voiceover: string; duration?: number }>> {
    const payloadScenes = (scenes.length ? scenes : audioFiles).map((s: any, i: number) => {
      const sceneNumber = s.scene_number || s.sceneNumber || audioFiles[i]?.sceneNumber || i + 1;
      const af = audioFiles.find((a) => a.sceneNumber === sceneNumber);
      const voiceover =
        s.voiceover ||
        s.narration ||
        af?.voiceover ||
        af?.text ||
        '';
      return { sceneNumber, voiceover };
    }).filter((s) => s.voiceover);

    if (!payloadScenes.length) return [];

    const token =
      authToken?.replace(/^Bearer\s+/i, '') ??
      jwt.sign({ sub: userId, userId, id: userId, type: 'service' }, this.jwtSecret, { expiresIn: '1h' });

    const res = await axios.post<{ success: boolean; data: { scenes: Array<{ sceneNumber: number; voiceover: string }> } }>(
      `${this.aiContentServiceUrl}/api/scripts/translate-voiceovers`,
      { scenes: payloadScenes, targetLanguage },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 120000 },
    );

    if (!res.data?.success || !res.data?.data?.scenes) {
      throw new Error('Failed to translate voiceover text for captions');
    }

    return res.data.data.scenes.map((s) => ({
      sceneNumber: s.sceneNumber,
      voiceover: s.voiceover,
      duration: audioFiles.find((af) => af.sceneNumber === s.sceneNumber)?.duration,
    }));
  }

  private async persistVariant(projectId: string, variant: VideoTranslationVariant): Promise<void> {
    const maxRetries = 8;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const project = await this.databaseService.videoProject.findFirst({ where: { id: projectId } });
      if (!project) return;

      const expectedUpdatedAt = project.updatedAt;
      const merged = upsertVideoTranslationVariant(
        parseVideoTranslations((project as any).videoTranslations),
        variant,
      );

      const result = await this.databaseService.videoProject.updateMany({
        where: { id: projectId, updatedAt: expectedUpdatedAt },
        data: { videoTranslations: merged as any },
      });

      if (result.count === 1) return;

      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }

    const project = await this.databaseService.videoProject.findFirst({ where: { id: projectId } });
    if (!project) return;
    const merged = upsertVideoTranslationVariant(
      parseVideoTranslations((project as any).videoTranslations),
      variant,
    );
    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: { videoTranslations: merged as any },
    });
  }

  private async getProjectOrThrow(projectId: string, userId: string) {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) throw new NotFoundException('Video project not found');
    return project;
  }

  private isOriginalVideoEligibleForTranslation(project: any): boolean {
    if (!project.videoUrl) return false;
    const style = String(project.style || '');
    const meta =
      project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
        ? (project.metadata as Record<string, unknown>)
        : {};
    const isSingleClip = style === 'AVATAR_ONLY' || style === 'ANIMATED_AVATAR';
    if (isSingleClip) {
      return project.status === 'COMPLETED' && Boolean(meta.finalExportedAt);
    }
    return project.status === 'COMPLETED';
  }

  private async assertNonHumanAvatarAllowed(project: any, authToken?: string): Promise<void> {
    if (!project.avatarId) return;
    const stylesWithAvatar = ['ALTERNATE', 'AVATAR_ONLY', 'HALF_N_HALF', 'AVATAR_CUTOUT', 'AVATAR_PRODUCT', 'ANIMATED_AVATAR'];
    if (!stylesWithAvatar.includes(String(project.style))) return;

    try {
      const token =
        authToken?.replace(/^Bearer\s+/i, '') ??
        jwt.sign({ sub: project.userId, userId: project.userId, type: 'service' }, this.jwtSecret, { expiresIn: '1h' });
      const res = await axios.get(`${this.aiContentServiceUrl}/api/avatars/${project.avatarId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });
      const meta = res.data?.data?.generationMetadata || res.data?.generationMetadata;
      const classification = meta?.avatarIntentClassification;
      if (classification?.type && !['human', 'character'].includes(classification.type)) {
        throw new BadRequestException(
          'Video translation with lip-sync is not supported for non-human avatars. Use a human or character avatar.',
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      console.warn('[VideoTranslationService] Could not verify avatar intent classification:', err?.message);
    }
  }

  private paymentServiceBase(): string {
    return (this.configService.get<string>('PAYMENT_SERVICE_URL') || 'http://localhost:9005').replace(/\/api\/?$/, '');
  }

  private async assertTranslationAffordable(projectId: string, userId: string, languageCount: number): Promise<void> {
    try {
      const costRes = await axios.get(
        `${this.paymentServiceBase()}/api/pricing/VIDEO_TRANSLATION/cost`,
        { timeout: 10000 },
      );
      const perLang = costRes.data?.data?.creditCost ?? 50;
      const required = perLang * languageCount;
      const balanceRes = await axios.get(
        `${this.paymentServiceBase()}/api/transactions/balance?userId=${encodeURIComponent(userId)}`,
        { timeout: 10000 },
      );
      const balance = balanceRes.data?.data?.credits ?? 0;
      if (balance < required) {
        throw new HttpException(
          { code: 'INSUFFICIENT_CREDITS', message: `Need ${required} credits for ${languageCount} translation(s)`, requiredCredits: required, currentBalance: balance },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      console.warn('[VideoTranslationService] Affordability check skipped:', err?.message);
    }
  }

  private async chargeTranslationCreditsForVariant(
    projectId: string,
    userId: string,
    variantId: string,
    language: string,
  ): Promise<{ snapshotId: string }> {
    const res = await axios.post(
      `${this.paymentServiceBase()}/api/credits/record-and-deduct`,
      {
        projectId,
        userId,
        operationType: 'VIDEO_TRANSLATION',
        operationName: `Video translation (${language})`,
        metadata: { variantId, language, projectId },
      },
      { timeout: 15000 },
    );
    const snapshot = res.data?.data;
    if (!res.data?.success || !snapshot?.id) {
      const msg =
        res.data?.message ||
        res.data?.error ||
        'Failed to deduct credits for video translation';
      throw new HttpException(
        { code: 'CREDIT_DEDUCTION_FAILED', message: msg },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return { snapshotId: snapshot.id as string };
  }

  private async refundTranslationCreditsForVariant(
    projectId: string,
    userId: string,
    variantId: string,
    creditSnapshotId: string,
    language: string,
  ): Promise<void> {
    try {
      const costRes = await axios.get(
        `${this.paymentServiceBase()}/api/pricing/VIDEO_TRANSLATION/cost`,
        { timeout: 10000 },
      );
      const amount = costRes.data?.data?.creditCost ?? 50;
      await axios.post(
        `${this.paymentServiceBase()}/api/transactions/add`,
        {
          userId,
          amount,
          type: 'REFUNDED',
          description: `Video translation (${language}) failed — credit refund`,
          resourceId: projectId,
          metadata: {
            projectId,
            variantId,
            creditSnapshotId,
            operationType: 'VIDEO_TRANSLATION',
          },
        },
        { timeout: 15000 },
      );
    } catch (err: any) {
      console.warn('[VideoTranslationService] refundTranslationCreditsForVariant:', err?.message);
    }
  }
}
