import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AvatarsController } from './avatars.controller';
import { AvatarsService } from './avatars.service';
import { HeyGenProvider } from './providers/heygen.provider';
import { DatabaseModule } from '../common/database/database.module';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [ConfigModule, DatabaseModule, LoggerModule],
  controllers: [AvatarsController],
  providers: [AvatarsService, HeyGenProvider],
  exports: [AvatarsService],
})
export class AvatarsModule {}

