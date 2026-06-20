import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private configService: ConfigService) {
    const databaseUrl = 
      configService.get('DATABASE_URL_VIDEO_PROCESSING') ||
      configService.get('DATABASE_URL_VIDEO') || 
      configService.get('DATABASE_URL') ||
      process.env.DATABASE_URL_VIDEO_PROCESSING ||
      process.env.DATABASE_URL_VIDEO ||
      process.env.DATABASE_URL ||
      'postgresql://postgres:password@localhost:5432/usergen_video';
    
    super({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      log: ['query', 'info', 'warn', 'error'],
    });
  }

  async onModuleInit() {
    // Connect to database
    await this.$connect();
    // Note: Enum values are managed via Prisma migrations, not at runtime
    // Migration 20251104005419_add_broll_steps handles BROLL_IMAGES and BROLL_VIDEOS
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Run `fn` inside a transaction that holds a row-level lock on the given
   * video project. This serializes concurrent read-modify-write operations on
   * the project's JSON columns (e.g. avatarVideos, bRollVideoTasks, metadata)
   * so that parallel BullMQ workers cannot clobber each other's updates
   * (lost-update race). The lock is released when the transaction commits.
   *
   * IMPORTANT: keep `fn` short — do NOT perform external/network calls inside
   * it, or the row lock will be held for the duration of those calls.
   */
  async withProjectLock<T>(
    projectId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // Acquire a row-level lock; concurrent transactions targeting the same
      // project block here until this transaction commits.
      await tx.$queryRaw`SELECT id FROM "video_projects" WHERE id = ${projectId} FOR UPDATE`;
      return fn(tx);
    });
  }
}

