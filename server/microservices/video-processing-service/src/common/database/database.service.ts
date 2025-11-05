import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

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
}

