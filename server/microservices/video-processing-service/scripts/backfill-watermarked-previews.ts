/**
 * Backfill watermarked preview videos for COMPLETED projects.
 *
 * Usage:
 *   npx ts-node scripts/backfill-watermarked-previews.ts [--dry-run] [--force] [--inline]
 *   npx ts-node scripts/backfill-watermarked-previews.ts --project-id <id> --limit 10
 *   npx ts-node scripts/backfill-watermarked-previews.ts --concurrency 2 --since 2025-01-01
 *
 * Default: enqueue BullMQ jobs when REDIS_HOST/REDIS_URL is configured; otherwise --inline.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/common/database/database.service';
import { PreviewVideoService } from '../src/preview/preview-video.service';
import { QueueManagerService } from '../src/common/queue/queue-manager.service';
import { PREVIEW_FORMAT_VERSION } from '../src/preview/preview.constants';

interface CliOptions {
  dryRun: boolean;
  force: boolean;
  inline: boolean;
  enqueue: boolean;
  projectId?: string;
  limit?: number;
  since?: Date;
  concurrency: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dryRun: false,
    force: false,
    inline: false,
    enqueue: false,
    concurrency: 2,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--inline') opts.inline = true;
    else if (arg === '--enqueue') opts.enqueue = true;
    else if (arg === '--project-id' && args[i + 1]) opts.projectId = args[++i];
    else if (arg === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i], 10);
    else if (arg === '--since' && args[i + 1]) opts.since = new Date(args[++i]);
    else if (arg === '--concurrency' && args[i + 1]) {
      opts.concurrency = Math.max(1, parseInt(args[++i], 10));
    }
  }

  const hasRedis =
    Boolean(process.env.REDIS_URL) ||
    Boolean(process.env.REDIS_HOST) ||
    Boolean(process.env.REDIS_PORT);

  if (!opts.inline && !opts.enqueue) {
    opts.enqueue = hasRedis;
    opts.inline = !hasRedis;
  } else if (opts.enqueue) {
    opts.inline = false;
  }

  return opts;
}

function shouldProcessProject(
  metadata: Record<string, unknown> | null | undefined,
  videoUrl: string,
  force: boolean,
): boolean {
  if (force) return true;
  if (!metadata?.previewVideoUrl) return true;
  const version = Number(metadata.previewFormatVersion ?? 0);
  if (version < PREVIEW_FORMAT_VERSION) return true;
  const hash = metadata.previewSourceHash as string | undefined;
  return hash !== PreviewVideoService.computeSourceHash(videoUrl);
}

function parseAudioFilesFromProject(
  raw: unknown,
): Array<{ sceneNumber?: number; duration?: number }> | undefined {
  if (!raw) return undefined;
  const arr = Array.isArray(raw) ? raw : typeof raw === 'object' ? Object.values(raw as object) : [];
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  return arr.map((item: any) => ({
    sceneNumber: item?.sceneNumber ?? item?.scene_number,
    duration: item?.duration,
  }));
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const opts = parseArgs();
  console.log('[backfill:previews] Options:', opts);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const database = app.get(DatabaseService);
  const previewService = app.get(PreviewVideoService);
  const queueManager = app.get(QueueManagerService);

  try {
    const where: Record<string, unknown> = {
      status: 'COMPLETED',
      videoUrl: { not: null },
    };
    if (opts.projectId) {
      where.id = opts.projectId;
    }
    if (opts.since) {
      where.updatedAt = { gte: opts.since };
    }

    const projects = await database.videoProject.findMany({
      where: where as any,
      orderBy: { updatedAt: 'desc' },
      take: opts.limit,
    });

    const targets = projects.filter((p) => {
      const metadata =
        p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
          ? (p.metadata as Record<string, unknown>)
          : {};
      return shouldProcessProject(metadata, p.videoUrl!, opts.force);
    });

    console.log(
      `[backfill:previews] Found ${projects.length} COMPLETED projects; ${targets.length} need processing`,
    );

    if (opts.dryRun) {
      for (const p of targets) {
        console.log(`  would process: ${p.id} user=${p.userId} videoUrl=${p.videoUrl?.slice(0, 80)}`);
      }
      return;
    }

    let ok = 0;
    let fail = 0;
    let skipped = 0;

    await runPool(targets, opts.concurrency, async (project) => {
      const metadata =
        project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
          ? ({ ...(project.metadata as Record<string, unknown>) } as Record<string, unknown>)
          : {};

      if (
        !opts.force &&
        previewService.shouldSkipRegeneration(metadata, project.videoUrl!, false)
      ) {
        skipped++;
        console.log(`[skip] ${project.id}`);
        return;
      }

      try {
        if (opts.enqueue) {
          await queueManager.addPreviewDerivativesJob({
            projectId: project.id,
            userId: project.userId,
            videoUrl: project.videoUrl!,
            forceRegenerate: opts.force,
          });
          ok++;
          console.log(`[queued] ${project.id}`);
          return;
        }

        const audioFiles = parseAudioFilesFromProject(project.audioFiles);

        const result = await previewService.buildWatermarkedPreview({
          projectId: project.id,
          userId: project.userId,
          sourceVideoUrl: project.videoUrl!,
          audioFiles,
        });

        delete metadata.previewGenerationError;
        metadata.previewVideoUrl = result.previewPublicUrl;
        metadata.previewGeneratedAt = new Date().toISOString();
        metadata.previewSourceHash = result.previewSourceHash;
        metadata.previewFormatVersion = result.previewFormatVersion;

        await database.videoProject.update({
          where: { id: project.id },
          data: {
            thumbnailUrl: result.thumbnailPublicUrl,
            metadata: metadata as object,
          },
        });

        ok++;
        console.log(`[ok] ${project.id} -> ${result.previewPublicUrl}`);
      } catch (error: unknown) {
        fail++;
        const message = error instanceof Error ? error.message : String(error);
        metadata.previewGenerationError = message;
        metadata.previewGenerationFailedAt = new Date().toISOString();
        await database.videoProject.update({
          where: { id: project.id },
          data: { metadata: metadata as object },
        });
        console.error(`[fail] ${project.id}: ${message}`);
      }
    });

    console.log(`[backfill:previews] Done. ok=${ok} fail=${fail} skipped=${skipped}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[backfill:previews] Fatal:', err);
  process.exit(1);
});
