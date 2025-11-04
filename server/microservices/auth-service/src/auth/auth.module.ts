import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { JwtAuthGuard, LocalAuthGuard, GoogleAuthGuard, FacebookAuthGuard } from './guards';
import { UsersModule } from '../users/users.module';
import { DatabaseModule } from '../common/database/database.module';
import { RedisModule } from '../common/redis/redis.module';
import { MessageQueueModule } from '../common/message-queue/message-queue.module';
import { LoggerModule } from '../common/logger/logger.module';
import { HttpClientModule } from '../common/http/http-client.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN', '1h'),
        },
      }),
      inject: [ConfigService],
    }),
    DatabaseModule,
    RedisModule,
    MessageQueueModule,
    LoggerModule,
    UsersModule,
    HttpClientModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LocalStrategy,
    GoogleStrategy,
    FacebookStrategy,
    JwtAuthGuard,
    LocalAuthGuard,
    GoogleAuthGuard,
    FacebookAuthGuard,
  ],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
