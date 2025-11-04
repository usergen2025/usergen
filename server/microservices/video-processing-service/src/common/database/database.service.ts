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
    // Force reconnect to pick up any enum changes
    await this.$disconnect();
    await this.$connect();
    
    // Ensure enum values exist - add them if they don't
    try {
      // Check current enum values
      const result = await this.$queryRaw<Array<{ enum_value: string }>>`
        SELECT unnest(enum_range(NULL::"VideoCreationStep"))::text as enum_value
        ORDER BY enum_value;
      `;
      
      const enumValues = result.map((r) => r.enum_value);
      const hasBrollImages = enumValues.includes('BROLL_IMAGES');
      const hasBrollVideos = enumValues.includes('BROLL_VIDEOS');
      
      // Add BROLL_IMAGES if it doesn't exist
      if (!hasBrollImages) {
        await this.$executeRawUnsafe(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum 
              WHERE enumlabel = 'BROLL_IMAGES' 
              AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'VideoCreationStep')
            ) THEN
              ALTER TYPE "VideoCreationStep" ADD VALUE 'BROLL_IMAGES';
            END IF;
          END $$;
        `);
        console.log(`[DatabaseService] ✓ Added BROLL_IMAGES to enum`);
      }
      
      // Add BROLL_VIDEOS if it doesn't exist
      if (!hasBrollVideos) {
        await this.$executeRawUnsafe(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum 
              WHERE enumlabel = 'BROLL_VIDEOS' 
              AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'VideoCreationStep')
            ) THEN
              ALTER TYPE "VideoCreationStep" ADD VALUE 'BROLL_VIDEOS';
            END IF;
          END $$;
        `);
        console.log(`[DatabaseService] ✓ Added BROLL_VIDEOS to enum`);
      }
      
      // Reconnect to pick up enum changes if we added any
      if (!hasBrollImages || !hasBrollVideos) {
        await this.$disconnect();
        await this.$connect();
      }
      
      // Verify final enum values
      const finalResult = await this.$queryRaw<Array<{ enum_value: string }>>`
        SELECT unnest(enum_range(NULL::"VideoCreationStep"))::text as enum_value
        ORDER BY enum_value;
      `;
      const finalEnumValues = finalResult.map((r) => r.enum_value);
      console.log(`[DatabaseService] VideoCreationStep enum values: ${finalEnumValues.join(', ')}`);
    } catch (error: any) {
      console.error(`[DatabaseService] Error ensuring enum values:`, error.message);
    }
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

