import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
const compression = require('compression');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('SERVICE_PORT', 9008);

  app.use(helmet());
  app.use(compression());

  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3200');
  app.enableCors({ origin: corsOrigins.split(','), credentials: true });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Analytics Service API')
    .setDescription('Analytics and reporting API for UserGen.ai platform')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('analytics', 'Analytics endpoints')
    .addTag('reports', 'Reporting endpoints')
    .addTag('health', 'Health & Status')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  app.getHttpAdapter().get('/api/docs-json', (req, res) => res.json(document));

  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'analytics-service', timestamp: new Date().toISOString(), uptime: process.uptime() });
  });

  await app.listen(port);
  console.log(`🚀 Analytics Service running on port ${port}`);
  console.log(`📄 Swagger JSON available at http://localhost:${port}/api/docs-json`);
}

bootstrap();

