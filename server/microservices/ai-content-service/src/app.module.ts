import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

// Core modules
import { ScriptsModule } from './scripts/scripts.module';
import { AvatarsModule } from './avatars/avatars.module';
// import { ContentModule } from './content/content.module'; // TODO: Implement later
// import { IntegrationsModule } from './integrations/integrations.module'; // TODO: Implement later
// import { ConfigModule as AppConfigModule } from './config/config.module'; // TODO: Implement later
import { DatabaseModule } from './common/database/database.module';
import { LoggerModule } from './common/logger/logger.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/ai-content-service/.env',
        '.env',
      ],
    }),
    // AppConfigModule, // TODO: Implement later

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.RATE_LIMIT_TTL || '60') * 1000,
        limit: parseInt(process.env.RATE_LIMIT_LIMIT || '50'),
      },
    ]),

    // BullMQ Configuration
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),

    // Core modules
    DatabaseModule,
    LoggerModule,

    // Feature modules
    ScriptsModule,
    AvatarsModule,
    // ContentModule, // TODO: Implement later
    // IntegrationsModule, // TODO: Implement later
  ],
})
export class AppModule {}
