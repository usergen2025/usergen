import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { LoggerService } from './common/logger/logger.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const logger = app.get(LoggerService);
  const port = configService.get<number>('SERVICE_PORT', 9001);

  // Security middleware
  app.use(helmet());
  app.use(compression());

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global filters
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global interceptors
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Global API prefix
  app.setGlobalPrefix('api');

  // Serve static files from uploads directory
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
  });

  // CORS configuration
  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3200');
  app.enableCors({
    origin: corsOrigins.split(',').map((origin) => origin.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('UserGen.ai AI Content Service')
    .setDescription('AI content generation API for scripts, avatars, and content')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('scripts', 'Script generation endpoints')
    .addTag('avatars', 'Avatar generation endpoints')
    .addTag('content', 'Content generation endpoints')
    .addTag('health', 'Health check endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  
  // Expose Swagger JSON endpoint (for aggregator)
  app.getHttpAdapter().get('/api/docs-json', (req, res: any) => {
    res.json(document);
  });
  
  SwaggerModule.setup('api/docs', app, document);

  // Health check endpoint
  app.getHttpAdapter().get('/health', (req, res: any) => {
    res.status(200).json({
      status: 'ok',
      service: 'ai-content-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
    });
  });

  // Global error handlers for unhandled errors (EPIPE, socket errors, etc.)
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    // Ignore EPIPE errors as they're handled by axios interceptors
    if (reason?.code === 'EPIPE' || reason?.code === 'ECONNRESET' || reason?.code === 'ECONNABORTED') {
      logger.warn(`Unhandled rejection (${reason.code}): ${reason.message}`, 'Bootstrap');
      return;
    }
    logger.error(`Unhandled Rejection: ${reason}`, reason?.stack, 'Bootstrap');
  });

  process.on('uncaughtException', (error: Error) => {
    // Ignore EPIPE errors as they're handled by axios interceptors
    if (error.message?.includes('EPIPE') || error.message?.includes('ECONNRESET') || error.message?.includes('ECONNABORTED')) {
      logger.warn(`Uncaught Exception (connection error): ${error.message}`, 'Bootstrap');
      return;
    }
    logger.error(`Uncaught Exception: ${error.message}`, error.stack, 'Bootstrap');
    // Don't exit on uncaught exceptions - let NestJS handle it
  });

  // Handle socket errors globally
  process.on('error', (error: Error) => {
    if (error.message?.includes('EPIPE') || error.message?.includes('ECONNRESET') || error.message?.includes('ECONNABORTED')) {
      logger.warn(`Process error (connection error): ${error.message}`, 'Bootstrap');
      return;
    }
    logger.error(`Process error: ${error.message}`, error.stack, 'Bootstrap');
  });

  await app.listen(port);
  
  logger.log(`AI Content Service is running on port ${port}`, 'Bootstrap');
  logger.log(`Swagger documentation available at http://localhost:${port}/api/docs`, 'Bootstrap');
}

bootstrap();
