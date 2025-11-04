import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';
const compression = require('compression');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('SERVICE_PORT', 9002);

  // Security - Configure helmet to allow cross-origin resources for audio files
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // Disable CSP for static files
  }));
  app.use(compression());

  // CORS
  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3200');
  app.enableCors({
    origin: corsOrigins.split(','),
    credentials: true,
  });

  // IMPORTANT: Serve static files BEFORE setting global prefix
  // This ensures static files are served at /uploads/* (not /api/uploads/*)
  // Static files bypass the global prefix when configured this way
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    setHeaders: (res, path) => {
      // Set CORS headers for audio files
      if (path.endsWith('.mp3') || path.endsWith('.wav') || path.endsWith('.m4a') || path.endsWith('.ogg')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
      }
    },
  });

  // Set global prefix AFTER static assets (so API routes are /api/*, but static files are /uploads/*)
  app.setGlobalPrefix('api');

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger - Always generate JSON for aggregator
  const config = new DocumentBuilder()
    .setTitle('Voice & Audio Service API')
    .setDescription('Voice cloning and audio processing API for UserGen.ai platform')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('voice', 'Voice cloning endpoints')
    .addTag('audio', 'Audio processing endpoints')
    .addTag('health', 'Health & Status')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Expose Swagger JSON endpoint (for aggregator)
  app.getHttpAdapter().get('/api/docs-json', (req, res: any) => {
    res.json(document);
  });

  // Health check
  app.getHttpAdapter().get('/health', (req, res: any) => {
    res.status(200).json({
      status: 'ok',
      service: 'voice-audio-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  await app.listen(port);
  console.log(`🚀 Voice & Audio Service running on port ${port}`);
  console.log(`📄 Swagger JSON available at http://localhost:${port}/api/docs-json`);
}

bootstrap();

