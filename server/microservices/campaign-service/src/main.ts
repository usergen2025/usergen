import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import * as express from 'express';
const compression = require('compression');
const helmet = require('helmet');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('SERVICE_PORT', 9011);

  app.use(helmet());
  app.use(compression());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3200');
  app.enableCors({
    origin: corsOrigins.split(','),
    credentials: true,
  });

  app.setGlobalPrefix('api');

  const campaignAssetsRoot = join(process.cwd(), 'uploads', 'campaign-assets');
  app.use('/api/uploads/campaign-assets', express.static(campaignAssetsRoot));

  const swagger = new DocumentBuilder()
    .setTitle('Campaign Service API')
    .setDescription('Campaign, submissions, and review lifecycle APIs')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'JWT-auth',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, document);

  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'campaign-service',
      timestamp: new Date().toISOString(),
    });
  });

  await app.listen(port);
}

void bootstrap();
