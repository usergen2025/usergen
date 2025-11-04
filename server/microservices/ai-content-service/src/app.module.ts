import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

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
      envFilePath: ['../../.env.local', '../../.env', '.env.local', '.env'],
    }),
    // AppConfigModule, // TODO: Implement later

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.RATE_LIMIT_TTL || '60') * 1000,
        limit: parseInt(process.env.RATE_LIMIT_LIMIT || '50'),
      },
    ]),

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
