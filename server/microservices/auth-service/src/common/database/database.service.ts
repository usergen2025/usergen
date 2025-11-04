import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class DatabaseService extends PrismaClient {
  constructor(private configService: ConfigService) {
    const databaseUrl = 
      configService.get('DATABASE_URL_AUTH') || 
      configService.get('DATABASE_URL') ||
      process.env.DATABASE_URL_AUTH ||
      process.env.DATABASE_URL ||
      'postgresql://postgres:password@localhost:5432/usergen_auth';
    
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
    await this.$connect();
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
