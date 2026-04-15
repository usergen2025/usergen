import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

// Core modules
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { ConfigModule as AppConfigModule } from './config/config.module';
import { DatabaseModule } from './common/database/database.module';
import { RedisModule } from './common/redis/redis.module';
import { MessageQueueModule } from './common/message-queue/message-queue.module';
import { LoggerModule } from './common/logger/logger.module';
import { SwaggerAuthGuard } from './common/guards/swagger-auth.guard';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/auth-service/.env',
        '.env',
      ],
      expandVariables: true,
    }),
    AppConfigModule,

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.RATE_LIMIT_TTL || '60') * 1000,
        limit: parseInt(process.env.RATE_LIMIT_LIMIT || '100'),
      },
    ]),

    // JWT
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
      },
    }),

    // Passport
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // Core modules
    DatabaseModule,
    RedisModule,
    MessageQueueModule,
    LoggerModule,

    // Feature modules
    AuthModule,
    UsersModule,
    AdminModule,
  ],
  providers: [SwaggerAuthGuard],
})
export class AppModule {}
