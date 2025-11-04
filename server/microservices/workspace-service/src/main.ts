import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security
  app.use(helmet());
  app.use(compression());

  // CORS
  const corsOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3200'];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Workspace Service API')
    .setDescription('Workspace management for UserGen.ai')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  
  // Expose Swagger JSON endpoint (for aggregator)
  app.getHttpAdapter().get('/api/docs-json', (req, res) => {
    res.json(document);
  });
  
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.SERVICE_PORT || 9007;
  await app.listen(port);
  console.log(`🚀 Workspace Service running on port ${port}`);
}

bootstrap();


