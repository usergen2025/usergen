import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly config: ConfigService) {
    const url = config.get<string>('DATABASE_URL');
    super({ datasources: { db: { url: url || 'postgresql://localhost:5432/usergen_notification' } } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
