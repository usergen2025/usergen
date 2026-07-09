import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SsembleService } from './ssemble.service';
import { SsembleWebhookController } from './ssemble-webhook.controller';
import { DatabaseModule } from '../common/database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [SsembleWebhookController],
  providers: [SsembleService],
  exports: [SsembleService],
})
export class SsembleModule {}
