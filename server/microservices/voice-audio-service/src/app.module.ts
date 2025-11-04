import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VoiceController } from './voice/voice.controller';
import { VoiceService } from './voice/voice.service';
import { ElevenLabsProvider } from './voice/providers/elevenlabs.provider';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env.local', '../../.env', '.env.local', '.env'],
    }),
  ],
  controllers: [VoiceController],
  providers: [VoiceService, ElevenLabsProvider],
  exports: [VoiceService],
})
export class AppModule {}

