import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

// Core modules
import { ConfigModule as AppConfigModule } from './config/config.module';
import { DatabaseModule } from './common/database/database.module';
import { RedisModule } from './common/redis/redis.module';
import { MessageQueueModule } from './common/message-queue/message-queue.module';
import { LoggerModule } from './common/logger/logger.module';

// Feature modules
import { WorkspacesModule } from './workspaces/workspaces.module';
import { MembersModule } from './members/members.module';
import { InvitationsModule } from './invitations/invitations.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/workspace-service/.env',
        '.env',
      ],
    }),
    AppConfigModule,

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.RATE_LIMIT_TTL || '60') * 1000,
        limit: parseInt(process.env.RATE_LIMIT_LIMIT || '100'),
      },
    ]),

    // Core modules
    DatabaseModule,
    RedisModule,
    MessageQueueModule,
    LoggerModule,

    // Feature modules
    WorkspacesModule,
    MembersModule,
    InvitationsModule,
  ],
})
export class AppModule {}


