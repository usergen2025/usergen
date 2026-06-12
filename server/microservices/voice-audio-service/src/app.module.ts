import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VoiceController } from './voice/voice.controller';
import { VoiceService } from './voice/voice.service';
import { ElevenLabsProvider } from './voice/providers/elevenlabs.provider';
import { PublicUrlService } from './common/storage/public-url.service';
import { DatabaseModule } from './common/database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/voice-audio-service/.env',
        '.env',
      ],
    }),
    DatabaseModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService, ElevenLabsProvider, PublicUrlService],
  exports: [VoiceService, PublicUrlService],
})
export class AppModule {}
