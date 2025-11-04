# Environment Management

This directory contains environment-specific configurations for UserGen.ai microservices.

## 📁 Directory Structure

```
environments/
├── local/                    # Local development environment
│   ├── env.local            # Environment variables
│   ├── docker-compose.local.yml
│   └── config.local.json    # Service configuration
├── dev/                     # Development environment
│   ├── env.dev              # Environment variables
│   ├── docker-compose.dev.yml
│   └── config.dev.json      # Service configuration
└── prod/                    # Production environment
    ├── env.prod             # Environment variables
    ├── docker-compose.prod.yml
    └── config.prod.json     # Service configuration
```

## 🚀 Quick Start

### Local Development
```bash
# Setup local environment
npm run env:setup local

# Start services
npm run env:start local

# View logs
npm run env:logs local
```

### Development Environment
```bash
# Setup dev environment
npm run env:setup dev

# Start services
npm run env:start dev

# Check status
npm run env:status dev
```

### Production Environment
```bash
# Setup production environment
npm run env:setup prod

# Start services
npm run env:start prod

# Monitor services
npm run env:status prod
```

## 🔧 Environment Variables

### Service-Specific Variables
Each environment file contains variables prefixed with service names:

- `DATABASE_URL_AUTH` - Authentication service database
- `DATABASE_URL_AI_CONTENT` - AI content service database
- `DATABASE_URL_VOICE_AUDIO` - Voice & audio service database
- `DATABASE_URL_MEDIA_MANAGEMENT` - Media management service database
- `DATABASE_URL_VIDEO_PROCESSING` - Video processing service database
- `DATABASE_URL_PAYMENT_WALLET` - Payment & wallet service database
- `DATABASE_URL_NOTIFICATION` - Notification service database
- `DATABASE_URL_PROJECT_MANAGEMENT` - Project management service database
- `DATABASE_URL_ANALYTICS` - Analytics service database

### Shared Variables
- `REDIS_URL` - Redis cache URL
- `MONGODB_URL` - MongoDB metadata URL
- `RABBITMQ_URL` - Message queue URL
- `JWT_SECRET` - JWT signing secret
- `OPENAI_API_KEY` - OpenAI API key
- `ELEVENLABS_API_KEY` - ElevenLabs API key
- `STRIPE_SECRET_KEY` - Stripe payment key

## 📊 Configuration Files

### config.{env}.json
Contains service-specific configurations:
- Service ports and health checks
- Database connections
- Resource limits
- Monitoring settings
- Storage configuration

### docker-compose.{env}.yml
Contains Docker Compose configurations:
- Service definitions
- Network configurations
- Volume mappings
- Resource constraints
- Health checks

## 🔒 Security Notes

### Local Environment
- Uses development API keys
- No sensitive data
- Safe for local testing

### Development Environment
- Uses separate development API keys
- Cloud storage for shared access
- Basic monitoring enabled

### Production Environment
- Uses environment variables for secrets
- Production API keys
- Full monitoring and security
- SSL/TLS enabled

## 🛠️ Management Commands

All environment management is handled through npm scripts:

```bash
# Environment setup
npm run env:setup <environment>

# Service management
npm run env:start <environment>
npm run env:stop <environment>
npm run env:restart <environment>

# Monitoring
npm run env:logs <environment>
npm run env:status <environment>

# Database
npm run env:migrate <environment>

# Cleanup
npm run env:clean <environment>
```

## 📝 Adding New Services

When adding a new service:

1. **Add environment variables** to all environment files:
   ```bash
   # Add to env.local, env.dev, env.prod
   NEW_SERVICE_PORT=3009
   DATABASE_URL_NEW_SERVICE=postgresql://...
   ```

2. **Update configuration files** (config.{env}.json):
   ```json
   {
     "services": {
       "new-service": {
         "port": 3009,
         "healthCheck": "/health",
         "database": "usergen_new_service"
       }
     }
   }
   ```

3. **Update Docker Compose files** (docker-compose.{env}.yml):
   ```yaml
   new-service:
     build:
       context: ./microservices/new-service
       dockerfile: Dockerfile
     environment:
       - SERVICE_PORT=3009
       - DATABASE_URL=${DATABASE_URL_NEW_SERVICE}
   ```

4. **Update environment manager script** if needed

## 🔍 Troubleshooting

### Common Issues

1. **Environment file not found**
   ```bash
   # Ensure you're in the server directory
   cd /path/to/UserGen/server
   
   # Check if environment files exist
   ls environments/local/
   ```

2. **Services not starting**
   ```bash
   # Check Docker status
   docker ps
   
   # Check service logs
   npm run env:logs local
   ```

3. **Database connection issues**
   ```bash
   # Check database status
   npm run env:status local
   
   # Restart databases
   npm run env:restart local
   ```

4. **Port conflicts**
   ```bash
   # Check port usage
   lsof -i :3000
   
   # Stop conflicting services
   npm run env:stop local
   ```

## 📚 Additional Resources

- [Main Setup Guide](../documentation/SETUP.md)
- [Docker Documentation](https://docs.docker.com/)
- [Environment Variables Best Practices](https://12factor.net/config)
