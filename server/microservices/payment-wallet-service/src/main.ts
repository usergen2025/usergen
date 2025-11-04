import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(compression());

  const corsOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3200'];
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Payment Wallet Service API')
    .setDescription('Credit management for UserGen.ai')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  
  // Expose Swagger JSON endpoint (for aggregator)
  app.getHttpAdapter().get('/api/docs-json', (req, res) => {
    res.json(document);
  });
  
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.SERVICE_PORT || 9005;
  await app.listen(port);
  console.log(`🚀 Payment Wallet Service running on port ${port}`);
}

bootstrap();
