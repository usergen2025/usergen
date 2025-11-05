import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MediaController } from './media/media.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/media-management-service/.env',
        '.env',
      ],
    }),
  ],
  controllers: [MediaController],
  providers: [],
})
export class AppModule {}

