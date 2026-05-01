import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface ServiceConfig {
  name: string;
  url: string;
  swaggerPath?: string;
  enabled?: boolean;
}

@Injectable()
export class SwaggerAggregatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SwaggerAggregatorService.name);
  private readonly httpClient: AxiosInstance;
  private services: ServiceConfig[] = [];
  private cachedSpecs: Map<string, any> = new Map();
  private lastFetchTime: number = 0;
  private readonly CACHE_TTL = 30000; // 30 seconds (reduced from 1 minute for faster updates)
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(private configService: ConfigService) {
    this.httpClient = axios.create({
      timeout: 5000,
    });
    this.initializeServices();
  }

  async onModuleInit() {
    // Initial fetch
    await this.fetchAllSwaggerSpecs();
    this.lastFetchTime = Date.now();

    // Set up periodic refresh every 30 seconds to pick up services as they come online
    this.refreshInterval = setInterval(async () => {
      this.logger.debug('Periodic refresh: Fetching Swagger specs from all services...');
      await this.fetchAllSwaggerSpecs();
      this.lastFetchTime = Date.now();
    }, this.CACHE_TTL);

    this.logger.log(`Swagger spec refresh interval set to ${this.CACHE_TTL / 1000} seconds`);
  }

  onModuleDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  private initializeServices() {
    const baseUrl = (serviceName: string, port: string) => 
      this.configService.get<string>(`${serviceName}_SERVICE_URL`, `http://localhost:${port}`);

    this.services = [
      { name: 'auth-service', url: baseUrl('AUTH', '9000'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'ai-content-service', url: baseUrl('AI_CONTENT', '9001'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'voice-audio-service', url: baseUrl('VOICE_AUDIO', '9002'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'activity-service', url: baseUrl('ACTIVITY', '9003'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'video-processing-service', url: baseUrl('VIDEO_PROCESSING', '9004'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'payment-wallet-service', url: baseUrl('PAYMENT_WALLET', '9005'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'notification-service', url: baseUrl('NOTIFICATION', '9006'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'workspace-service', url: baseUrl('WORKSPACE', '9007'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'analytics-service', url: baseUrl('ANALYTICS', '9008'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'media-management-service', url: baseUrl('MEDIA_MANAGEMENT', '9009'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'iam-service', url: baseUrl('IAM', '9010'), swaggerPath: '/api/docs-json', enabled: true },
      { name: 'campaign-service', url: baseUrl('CAMPAIGN', '9011'), swaggerPath: '/api/docs-json', enabled: true },
    ];
  }

  async getAggregatedSwagger(): Promise<any> {
    const now = Date.now();
    
    // Use cache if available and not expired
    if (this.cachedSpecs.size > 0 && (now - this.lastFetchTime) < this.CACHE_TTL) {
      this.logger.debug('Returning cached Swagger specs');
      return this.buildAggregatedSpec();
    }

    // Fetch specs from all services
    await this.fetchAllSwaggerSpecs();
    this.lastFetchTime = now;

    return this.buildAggregatedSpec();
  }

  private async fetchAllSwaggerSpecs(): Promise<void> {
    this.logger.log('Fetching Swagger specs from all services...');

    const fetchPromises = this.services
      .filter(service => service.enabled)
      .map(service => this.fetchSwaggerSpec(service));

    await Promise.allSettled(fetchPromises);
  }

  private async fetchSwaggerSpec(service: ServiceConfig): Promise<void> {
    try {
      const swaggerPath = service.swaggerPath || '/api/docs-json';
      const url = `${service.url}${swaggerPath}`;
      
      this.logger.debug(`Fetching Swagger from ${url}`);
      
      const response = await this.httpClient.get(url);
      const spec = response.data;

      // Normalize the spec - ensure paths are correct
      const normalizedSpec = {
        ...spec,
        info: {
          ...spec.info,
          title: spec.info?.title || `${service.name} API`,
          description: spec.info?.description || `API for ${service.name}`,
        },
        servers: spec.servers || [{ url: service.url, description: `${service.name} Server` }],
      };
      
      // If paths don't have /api prefix, ensure they're added
      // Swagger might generate paths without global prefix even when setGlobalPrefix is used
      if (normalizedSpec.paths) {
        const normalizedPaths: any = {};
        for (const [path, pathItem] of Object.entries(normalizedSpec.paths)) {
          // Normalize path to include /api if missing
          const normalizedPath = path.startsWith('/api') 
            ? path 
            : path.startsWith('/')
            ? `/api${path}`
            : `/api/${path}`;
          normalizedPaths[normalizedPath] = pathItem;
        }
        normalizedSpec.paths = normalizedPaths;
      }
      
      this.cachedSpecs.set(service.name, normalizedSpec);

      this.logger.log(`✅ Successfully fetched Swagger from ${service.name}`);
    } catch (error: any) {
      // Improved error logging to show actual error details
      const errorMessage = error.response 
        ? `HTTP ${error.response.status}: ${error.response.statusText} - ${error.response.data?.message || ''}`
        : error.code 
        ? `Connection Error (${error.code}): ${error.message}`
        : error.message || 'Unknown error';
      
      this.logger.warn(`⚠️  Failed to fetch Swagger from ${service.name} (${service.url}): ${errorMessage}`);
      
      // Log connection errors separately for debugging
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        this.logger.debug(`   → Service may not be running or not accessible at ${service.url}`);
      }
      
      // Keep old spec in cache if available
      if (!this.cachedSpecs.has(service.name)) {
        this.cachedSpecs.set(service.name, this.createEmptySpec(service));
      }
    }
  }

  private createEmptySpec(service: ServiceConfig): any {
    return {
      openapi: '3.0.0',
      info: {
        title: `${service.name} API`,
        description: `API for ${service.name} (Service unavailable)`,
        version: '1.0.0',
      },
      servers: [{ url: service.url, description: `${service.name} Server` }],
      paths: {},
      tags: [],
    };
  }

  private buildAggregatedSpec(): any {
    const aggregatedSpec: any = {
      openapi: '3.0.0',
      info: {
        title: 'UserGen.ai API Documentation',
        description: 'Unified API documentation for all UserGen.ai microservices',
        version: '1.0.0',
        contact: {
          name: 'UserGen.ai Support',
          url: 'https://usergen.ai/support',
          email: 'support@usergen.ai',
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
        },
      },
      servers: [
        { url: 'http://localhost:9090', description: 'Swagger Aggregator (Recommended - All Services)' },
        { url: 'http://localhost:8000', description: 'Kong API Gateway (Production Route)' },
      ],
      paths: {},
      components: {
        securitySchemes: {
          'JWT-auth': {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Enter JWT token',
          },
        },
      },
      tags: [],
    };

    // Process each service and keep endpoints grouped by service
    for (const [serviceName, spec] of this.cachedSpecs.entries()) {
      const serviceDisplayName = serviceName.replace('-service', '').replace(/-/g, ' ').split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      
      // Create main service tag (this becomes the collection)
      const serviceTag = {
        name: serviceDisplayName,
        description: spec.info?.description || `All endpoints for ${serviceDisplayName}`,
        'x-service-name': serviceName,
      };
      
      // Only add tag if not already exists
      if (!aggregatedSpec.tags.find((t: any) => t.name === serviceDisplayName)) {
        aggregatedSpec.tags.push(serviceTag);
      }

      // Merge paths - paths are already normalized in fetchSwaggerSpec
      // Just ensure they're properly tagged with the service name
      if (spec.paths) {
        for (const [path, methods] of Object.entries(spec.paths)) {
          // Paths should already be normalized with /api prefix from fetchSwaggerSpec
          // But double-check in case normalization was missed
          const normalizedPath = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : '/' + path}`;
          
          if (methods && typeof methods === 'object') {
            // Update each operation to use the service tag
            const updatedMethods: any = {};
            for (const [method, operation] of Object.entries(methods)) {
              if (operation && typeof operation === 'object') {
                const op = operation as any;
                // Ensure operation uses the service tag (this groups endpoints under collections)
                if (!op.tags || op.tags.length === 0) {
                  op.tags = [serviceDisplayName];
                } else {
                  // Make service tag the primary tag if not already
                  if (!op.tags.includes(serviceDisplayName)) {
                    op.tags = [serviceDisplayName, ...op.tags];
                  } else if (op.tags[0] !== serviceDisplayName) {
                    // Reorder to put service tag first
                    op.tags = [serviceDisplayName, ...op.tags.filter((t: string) => t !== serviceDisplayName)];
                  }
                }
                updatedMethods[method] = op;
              } else {
                updatedMethods[method] = operation;
              }
            }
            aggregatedSpec.paths[normalizedPath] = updatedMethods;
          } else {
            aggregatedSpec.paths[normalizedPath] = methods;
          }
        }
      }

      // Merge components (schemas, security schemes, etc.)
      if (spec.components) {
        if (!aggregatedSpec.components) {
          aggregatedSpec.components = {};
        }

        // Merge schemas
        if (spec.components.schemas) {
          if (!aggregatedSpec.components.schemas) {
            aggregatedSpec.components.schemas = {};
          }
          Object.assign(aggregatedSpec.components.schemas, spec.components.schemas);
        }

        // Merge security schemes
        if (spec.components.securitySchemes) {
          Object.assign(aggregatedSpec.components.securitySchemes || {}, spec.components.securitySchemes);
        }
      }
    }

    // Add service status tag at the end
    aggregatedSpec.tags.push({
      name: 'Services Status',
      description: 'Check status of all microservices',
    });

    this.logger.log(`✅ Built aggregated Swagger spec with ${Object.keys(aggregatedSpec.paths).length} paths from ${this.cachedSpecs.size} services`);

    return aggregatedSpec;
  }

  async getServiceStatus(): Promise<any> {
    const status = {
      services: [] as any[],
      timestamp: new Date().toISOString(),
    };

    for (const service of this.services) {
      const spec = this.cachedSpecs.get(service.name);
      status.services.push({
        name: service.name,
        url: service.url,
        enabled: service.enabled,
        swaggerAvailable: !!spec && spec.paths && Object.keys(spec.paths).length > 0,
        pathCount: spec?.paths ? Object.keys(spec.paths).length : 0,
      });
    }

    return status;
  }
}

