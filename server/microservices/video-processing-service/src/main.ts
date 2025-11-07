import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { join } from 'path';
const compression = require('compression');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('SERVICE_PORT', 9004);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // Disable CSP for static files
  }));
  app.use(compression());

  // CORS configuration with complete options for preflight handling
  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3200');
  const allowedOrigins = corsOrigins.split(',').map((o: string) => o.trim());
  
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Request-ID'],
    exposedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Serve static files from uploads directory (BEFORE setting global prefix)
  // This way static files are served at /uploads/* (not /api/uploads/*)
  const uploadsDir = configService.get<string>('UPLOADS_DIR') || join(process.cwd(), 'uploads');
  app.useStaticAssets(uploadsDir, {
    prefix: '/uploads',
    setHeaders: (res, path) => {
      // Set CORS headers for images
      if (path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.png') || path.endsWith('.gif') || path.endsWith('.webp')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
      }
    },
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Video Processing Service API')
    .setDescription('Video generation and processing API for UserGen.ai platform')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('video', 'Video processing endpoints')
    .addTag('health', 'Health & Status')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  app.getHttpAdapter().get('/api/docs-json', (req: any, res: any) => res.json(document));

  app.getHttpAdapter().get('/health', (req: any, res: any) => {
    res.status(200).json({ status: 'ok', service: 'video-processing-service', timestamp: new Date().toISOString(), uptime: process.uptime() });
  });

  await app.listen(port);
  console.log(`🚀 Video Processing Service running on port ${port}`);
  console.log(`📄 Swagger JSON available at http://localhost:${port}/api/docs-json`);
}

bootstrap();

