import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
const compression = require('compression');
import { AppModule } from './app.module';
import { SwaggerAggregatorService } from './swagger-aggregator.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  // Use SWAGGER_AGGREGATOR_SERVICE_PORT to avoid conflict with SERVICE_PORT
  const port = configService.get<number>('SWAGGER_AGGREGATOR_SERVICE_PORT') || 
                configService.get<number>('SERVICE_PORT') || 
                9090;

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Allow Swagger UI to load resources
  }));
  app.use(compression());

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS configuration
  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3200');
  app.enableCors({
    origin: corsOrigins.split(','),
    credentials: true,
  });

  // Swagger Configuration - Unified API Documentation
  const enableSwagger = configService.get<boolean>('ENABLE_SWAGGER', true);

  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('UserGen.ai API Documentation')
      .setDescription(`
        Unified API documentation for all UserGen.ai microservices.
        
        ## 🔐 How to Get and Use JWT Token (Important!)
        
        **Step 1: Get Your Token**
        - Execute the **POST /api/auth/register** or **POST /api/auth/login** endpoint
        - Look at the response - you'll see a \`data\` object with \`tokens\` inside
        - Copy the \`accessToken\` value from the response
        
        **Step 2: Authorize in Swagger**
        - Click the **"Authorize"** button (green lock icon, top right)
        - In the popup, find "JWT-auth"
        - Paste your token in the "Value" field (just the token value, no "Bearer" prefix needed)
        - Click **"Authorize"** button
        - Click **"Close"**
        
        **Step 3: Test Protected Endpoints**
        - Now you can test protected endpoints from any service
        - The token will be automatically included in requests
        - You can see request body examples, response examples, and error examples for each endpoint
        
        ## 📝 Services Included (Click to expand each collection):
        - **Auth Service** (Port 9000) - Authentication & User Management
        - **AI Content Service** (Port 9001) - Script generation, Avatar creation
        - **Voice Audio Service** (Port 9002) - Voice cloning & audio processing
        - **Activity Service** (Port 9003) - User activity logging
        - **Video Processing Service** (Port 9004) - Video generation & editing
        - **Payment Wallet Service** (Port 9005) - Credits & transactions
        - **Notification Service** (Port 9006) - User notifications
        - **Workspace Service** (Port 9007) - Workspace management
        - **Analytics Service** (Port 9008) - Analytics & reporting
        - **Media Management Service** (Port 9009) - Media file management
        - **IAM Service** (Port 9010) - Identity & Access Management
        
        ## 🔧 Server Selection
        Use the "Servers" dropdown above to select:
        - **Swagger Aggregator (9090)** - Recommended default (all services accessible)
        - **Kong API Gateway (8000)** - For production routing through the gateway
        
        **Note:** Since all services are aggregated here, you don't need to change servers - all endpoints work with the default aggregator server.
        
        ## 📋 Response Examples
        All endpoints include:
        - ✅ **Request Body Examples** - See what to send
        - ✅ **Success Response Examples** - See successful responses
        - ✅ **Error Response Examples** - See error responses
        
        ## 🔒 Security
        This documentation aggregates APIs from all microservices.
        Check individual service status at /api/status
      `)
      .setVersion('1.0.0')
      .setContact(
        'UserGen.ai Support',
        'https://usergen.ai/support',
        'support@usergen.ai'
      )
      .setLicense('MIT', 'https://opensource.org/licenses/MIT')
      .addServer('http://localhost:9090', 'Swagger Aggregator (Recommended - All Services)')
      .addServer('http://localhost:8000', 'Kong API Gateway (Production Route)')
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
      .addTag('ai-content', 'AI Content Generation')
      .addTag('voice-audio', 'Voice & Audio Processing')
      .addTag('activities', 'Activity Logging')
      .addTag('video', 'Video Processing')
      .addTag('payment', 'Payment & Wallet')
      .addTag('notifications', 'Notifications')
      .addTag('workspaces', 'Workspace Management')
      .addTag('analytics', 'Analytics & Reporting')
      .addTag('media', 'Media Management')
      .addTag('iam', 'Identity & Access Management')
      .addTag('health', 'Health & Status')
      .build();

    // Get aggregated spec from service (after app is initialized)
    const swaggerAggregatorService = app.get(SwaggerAggregatorService);
    
    // Fetch aggregated specs first
    let aggregatedSpec = config;
    try {
      aggregatedSpec = await swaggerAggregatorService.getAggregatedSwagger();
    } catch (err) {
      console.warn('Failed to fetch initial Swagger specs, using base config:', err.message);
    }

    // Merge with base config
    const mergedConfig = {
      ...aggregatedSpec,
      info: {
        ...config.info,
        ...aggregatedSpec.info,
      },
      servers: aggregatedSpec.servers || config.servers,
      components: {
        ...config.components,
        ...aggregatedSpec.components,
      },
    };

    const document = SwaggerModule.createDocument(app, mergedConfig, {
      operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
    });

    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'UserGen.ai - Unified API Documentation',
      customfavIcon: '/favicon.ico',
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        docExpansion: 'list', // Shows all operations expanded under each tag
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        filter: true,
        showRequestDuration: true,
        tryItOutEnabled: true,
        displayRequestDuration: true,
        showExtensions: true,
        showCommonExtensions: true,
      },
    });
  }

  // Health check endpoint
  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'swagger-aggregator-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
    });
  });

  await app.listen(port);

  console.log(`🚀 Swagger Aggregator Service is running on port ${port}`);
  if (enableSwagger) {
    console.log(`📚 Unified Swagger documentation available at http://localhost:${port}/api/docs`);
    console.log(`📊 Service status available at http://localhost:${port}/api/status`);
  }
}

bootstrap();

