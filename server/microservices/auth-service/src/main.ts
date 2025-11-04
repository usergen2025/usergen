import { NestFactory } from '@nestjs/core';
import { ValidationPipe, ExecutionContext } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
const compression = require('compression');
import { AppModule } from './app.module';
import { LoggerService } from './common/logger/logger.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { SwaggerAuthGuard } from './common/guards/swagger-auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('SERVICE_PORT', 9000);

  // CORS configuration - MUST be before other middleware
  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3200');
  const allowedOrigins = corsOrigins.split(',').map(origin => origin.trim());

  // Enable CORS - Express CORS will automatically set Access-Control-Allow-Origin
  // to the request origin if it matches the allowedOrigins array
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Request-ID'],
    exposedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Security middleware
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  }));
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

  // Enhanced Swagger Configuration with Security
  // Swagger UI is disabled at individual service level - Use unified Swagger at port 9090
  // But we always generate the JSON spec for the aggregator
  const nodeEnv = configService.get<string>('NODE_ENV', 'local');
  const enableSwagger = configService.get<boolean>('ENABLE_SWAGGER', false); // Disabled - use aggregated Swagger
  const useBasicAuth = configService.get<boolean>('SWAGGER_USE_BASIC_AUTH', true);

  // Always generate Swagger document for aggregator (even if UI is disabled)
  const config = new DocumentBuilder()
    .setTitle('UserGen.ai Auth Service API')
    .setDescription('Authentication and user management API for UserGen.ai platform')
    .setVersion('1.0.0')
    .setContact(
      'UserGen.ai Support',
      'https://usergen.ai/support',
      'support@usergen.ai'
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer('http://localhost:9000', 'Local Development')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('auth', 'Authentication & Authorization')
    .addTag('users', 'User Management')
    .addTag('health', 'Health & Status')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Expose Swagger JSON endpoint (always available for aggregator)
  app.getHttpAdapter().get('/api/docs-json', (req, res) => {
    res.json(document);
  });

  // Only setup Swagger UI if explicitly enabled
  if (enableSwagger) {
    // Secure Swagger Setup based on environment
    if (nodeEnv === 'production' || useBasicAuth) {
      // Production or when basic auth is enabled: Require authentication
      const swaggerAuthGuard = app.get(SwaggerAuthGuard);
      
      // Apply middleware before Swagger setup
      app.use('/api/docs*', (req, res, next) => {
        const context = {
          switchToHttp: () => ({
            getRequest: () => req,
            getResponse: () => res,
          }),
        } as ExecutionContext;
        
        const isAuthorized = swaggerAuthGuard.canActivate(context);
        if (isAuthorized) {
          next();
        }
        // If not authorized, guard already sent 401 response
      });
    }

    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'UserGen.ai API Documentation',
      customfavIcon: '/favicon.ico',
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        docExpansion: 'none',
        filter: true,
        showRequestDuration: true,
        tryItOutEnabled: true,
      },
    });
  }

  // Health check endpoint
  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
    });
  });

  await app.listen(port);
  
  const logger = app.get(LoggerService);
  logger.log(`Auth Service is running on port ${port}`, 'Bootstrap');
  logger.log(`Swagger JSON available at http://localhost:${port}/api/docs-json for aggregator`, 'Bootstrap');
  
  if (enableSwagger) {
    logger.log(`Swagger documentation available at http://localhost:${port}/api/docs`, 'Bootstrap');
    if (useBasicAuth) {
      logger.log(`Swagger is protected with Basic Auth (${configService.get<string>('SWAGGER_USER', 'admin')})`, 'Bootstrap');
    }
  } else {
    logger.log(`Swagger UI disabled - Use unified Swagger at http://localhost:9090/api/docs`, 'Bootstrap');
  }
}

bootstrap();
