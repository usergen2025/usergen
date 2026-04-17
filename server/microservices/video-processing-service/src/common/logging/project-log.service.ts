import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { PublicUrlService } from '../storage/public-url.service';
import { DatabaseService } from '../database/database.service';


export type ProjectLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface ProjectLogContext {
  projectId?: string;
  op?: string;
  scene?: number;
  jobId?: string;
}

interface SyncStateFile {
  global: number;
  projects: Record<string, number>;
}

@Injectable()
export class ProjectLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectLogService.name);
  private readonly logDir: string;
  private readonly syncIntervalMs: number;
  private readonly gcsPrefix: string;
  private readonly logMaxBytes: number;
  private readonly serviceLabel: string;
  private syncStatePath: string;
  private syncState: SyncStateFile = { global: 0, projects: {} };
  private timer: NodeJS.Timeout | null = null;
  private readonly pendingWrites = new Map<string, Promise<void>>();

  constructor(
    private readonly config: ConfigService,
    private readonly publicUrl: PublicUrlService,
    private readonly database: DatabaseService,
  ) {
    this.logDir = this.config.get<string>('LOG_DIR') || path.join(process.cwd(), 'logs');
    this.syncIntervalMs = parseInt(this.config.get<string>('LOG_GCS_SYNC_INTERVAL_MS') || '300000', 10);
    this.gcsPrefix = this.config.get<string>('LOG_GCS_PREFIX') || 'project-logs';
    this.logMaxBytes = parseInt(this.config.get<string>('LOG_MAX_FILE_BYTES') || `${8 * 1024 * 1024}`, 10);
    this.serviceLabel = this.config.get<string>('SERVICE_NAME') || 'video-processing';
    this.syncStatePath = path.join(this.logDir, '.log-sync-state.json');
  }

  async onModuleInit() {
    await fs.mkdir(path.join(this.logDir, 'global'), { recursive: true });
    await fs.mkdir(path.join(this.logDir, 'projects'), { recursive: true });
    await this.loadSyncState();
    if (this.syncIntervalMs > 0 && this.publicUrl.isGcsAvailable()) {
      this.timer = setInterval(() => {
        this.runScheduledSync().catch((e) =>
          this.logger.warn(`Scheduled GCS log sync failed: ${e?.message || e}`),
        );
      }, this.syncIntervalMs);
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async loadSyncState() {
    try {
      const raw = await fs.readFile(this.syncStatePath, 'utf8');
      const parsed = JSON.parse(raw) as SyncStateFile;
      if (typeof parsed.global === 'number' && parsed.projects && typeof parsed.projects === 'object') {
        this.syncState = {
          global: parsed.global,
          projects: { ...parsed.projects },
        };
      }
    } catch {
      this.syncState = { global: 0, projects: {} };
    }
  }

  private async saveSyncState() {
    await fs.writeFile(
      this.syncStatePath,
      JSON.stringify(this.syncState, null, 0),
      'utf8',
    );
  }

  private chain(key: string, work: () => Promise<void>): Promise<void> {
    const prev = this.pendingWrites.get(key) ?? Promise.resolve();
    const next = prev.then(work).catch(() => {});
    this.pendingWrites.set(key, next);
    return next;
  }

  private redact(message: string): string {
    return message
      .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk_[A-Za-z0-9_]+\b/g, 'sk_[REDACTED]')
      .replace(/x-api-key\s*[:=]\s*\S+/gi, 'x-api-key:[REDACTED]')
      .replace(/FAL_KEY\s*=\s*\S+/gi, 'FAL_KEY=[REDACTED]');
  }

  private formatLine(level: ProjectLogLevel, message: string, ctx?: ProjectLogContext): string {
    const ts = new Date().toISOString();
    const parts: string[] = [`${ts} [${level}] [${this.serviceLabel}]`];
    if (ctx?.projectId) parts.push(`[project=${ctx.projectId}]`);
    if (ctx?.op) parts.push(`[op=${ctx.op}]`);
    if (ctx?.scene != null) parts.push(`[scene=${ctx.scene}]`);
    if (ctx?.jobId) parts.push(`[job=${ctx.jobId}]`);
    parts.push(this.redact(message));
    return `${parts.join(' ')}\n`;
  }

  async logGlobal(level: ProjectLogLevel, message: string, ctx?: Omit<ProjectLogContext, 'projectId'>): Promise<void> {
    const line = this.formatLine(level, message, ctx as ProjectLogContext);
    const filePath = path.join(this.logDir, 'global', 'app.log');
    await this.chain('__global__', async () => {
      await fs.appendFile(filePath, line, 'utf8');
      await this.maybeRotate(path.join(this.logDir, 'global'), 'app.log', 'global');
    });
  }

  async logProject(
    projectId: string,
    level: ProjectLogLevel,
    message: string,
    ctx?: Omit<ProjectLogContext, 'projectId'>,
  ): Promise<void> {
    const line = this.formatLine(level, message, { ...ctx, projectId });
    const relName = `${projectId}.log`;
    const filePath = path.join(this.logDir, 'projects', relName);
    await this.chain(projectId, async () => {
      await fs.appendFile(filePath, line, 'utf8');
      await this.maybeRotate(path.join(this.logDir, 'projects'), relName, projectId);
    });
  }

  private async maybeRotate(dir: string, filename: string, syncKey: string) {
    const full = path.join(dir, filename);
    try {
      const st = await fs.stat(full);
      if (st.size < this.logMaxBytes) return;
      const rotated = `${filename}.${Date.now()}.bak`;
      await fs.rename(full, path.join(dir, rotated));
      if (syncKey === 'global') {
        this.syncState.global = 0;
      } else {
        delete this.syncState.projects[syncKey];
      }
      await this.saveSyncState();
    } catch {
      /* noop */
    }
  }

  private async runScheduledSync() {
    if (!this.publicUrl.isGcsAvailable()) return;
    const projectsDir = path.join(this.logDir, 'projects');
    let entries: string[] = [];
    try {
      entries = await fs.readdir(projectsDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (!name.endsWith('.log')) continue;
      const projectId = name.replace(/\.log$/, '');
      await this.syncFileToGcs('project', projectId).catch((e) =>
        this.logger.debug(`Project log GCS sync ${projectId}: ${e?.message || e}`),
      );
    }
    await this.syncFileToGcs('global', 'global').catch((e) =>
      this.logger.debug(`Global log GCS sync: ${e?.message || e}`),
    );
  }

  async flushProjectToGcs(projectId: string): Promise<void> {
    await this.syncFileToGcs('project', projectId);
  }

  private async syncFileToGcs(kind: 'project' | 'global', key: string) {
    if (!this.publicUrl.isGcsAvailable()) return;

    const relativePath =
      kind === 'global' ? path.join('global', 'app.log') : path.join('projects', `${key}.log`);
    const full = path.join(this.logDir, relativePath);
    if (!fsSync.existsSync(full)) return;

    const fileBuf = await fs.readFile(full);
    const start =
      kind === 'global' ? this.syncState.global : this.syncState.projects[key] ?? 0;
    if (start >= fileBuf.length) return;

    const slice = fileBuf.subarray(start);
    if (slice.length === 0) return;

    const partName = `${kind === 'global' ? 'global' : key}-${Date.now()}-part.log`;
    const subPath =
      kind === 'global'
        ? `${this.gcsPrefix}/global`
        : `${this.gcsPrefix}/projects/${key}`;
    const result = await this.publicUrl.uploadFromBuffer(slice, subPath, partName, 'text/plain; charset=utf-8');
    const gcsUrl = result.gcsUrl || result.publicUrl;

    if (kind === 'global') {
      this.syncState.global = fileBuf.length;
    } else {
      this.syncState.projects[key] = fileBuf.length;
      const metaRow = await this.database.videoProject.findUnique({
        where: { id: key },
        select: { metadata: true },
      });
      const base =
        metaRow?.metadata && typeof metaRow.metadata === 'object' && !Array.isArray(metaRow.metadata)
          ? { ...(metaRow.metadata as Record<string, unknown>) }
          : {};
      const prevParts = Array.isArray(base.projectLogGcsParts) ? (base.projectLogGcsParts as string[]) : [];
      await this.database.videoProject.update({
        where: { id: key },
        data: {
          metadata: {
            ...base,
            projectLogLastGcsSyncAt: new Date().toISOString(),
            projectLogGcsUrl: gcsUrl,
            projectLogGcsParts: [...prevParts.slice(-19), gcsUrl],
          } as any,
        },
      });
    }

    await this.saveSyncState();
  }

  async readProjectLogs(projectId: string): Promise<{
    source: 'local' | 'gcs';
    body: string;
    lastGcsSyncedAt: string | null;
    gcsUrl: string | null;
    hint?: string;
  }> {
    const full = path.join(this.logDir, 'projects', `${projectId}.log`);
    const metaRow = await this.database.videoProject.findUnique({
      where: { id: projectId },
      select: { metadata: true },
    });
    const m = metaRow?.metadata as Record<string, unknown> | null | undefined;
    const lastGcsSyncedAt = (m?.projectLogLastGcsSyncAt as string) ?? null;
    const gcsUrlMeta = (m?.projectLogGcsUrl as string) ?? null;

    if (fsSync.existsSync(full)) {
      const body = await fs.readFile(full, 'utf8');
      return {
        source: 'local',
        body,
        lastGcsSyncedAt,
        gcsUrl: gcsUrlMeta,
        hint:
          'Logs may lag GCS by up to LOG_GCS_SYNC_INTERVAL_MS. Elasticsearch/Kibana may be added later; these files remain the source of truth.',
      };
    }

    if (gcsUrlMeta) {
      try {
        const res = await fetch(gcsUrlMeta);
        if (res.ok) {
          const body = await res.text();
          return {
            source: 'gcs',
            body,
            lastGcsSyncedAt,
            gcsUrl: gcsUrlMeta,
            hint: 'Showing last GCS snapshot (no local project log on this node).',
          };
        }
      } catch {
        /* fall through */
      }
    }

    return {
      source: 'local',
      body: '',
      lastGcsSyncedAt,
      gcsUrl: gcsUrlMeta,
      hint: 'No local log file yet for this project.',
    };
  }
}
