# UserGen.ai - Microservices Architecture Setup Guide

## 📋 Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture Overview](#architecture-overview)
3. [Technology Stack](#technology-stack)
4. [Prerequisites](#prerequisites)
5. [Development Environment Setup](#development-environment-setup)
6. [Database Setup](#database-setup)
7. [Microservices Setup](#microservices-setup)
8. [API Gateway Configuration](#api-gateway-configuration)
9. [Message Queue Setup](#message-queue-setup)
10. [Monitoring & Logging](#monitoring--logging)
11. [Deployment Strategy](#deployment-strategy)
12. [Environment Variables](#environment-variables)
13. [Development Workflow](#development-workflow)
14. [Testing Strategy](#testing-strategy)
15. [Troubleshooting](#troubleshooting)

## 🎯 Project Overview

UserGen.ai is an AI-powered video creation platform that enables users to:
- Create videos with AI avatars
- Generate scripts using AI chat
- Clone voices for narration
- Add B-roll content (AI-generated or uploaded)
- Customize captions and styling
- Export and share videos
- Monetize through avatar usage

## 📊 Implementation Status

### ✅ Completed Services
1. **Authentication Service** - Complete with JWT, social login, OTP verification
2. **AI Content Service** - Basic structure with placeholder integrations
3. **Shared Utilities** - Complete type definitions, helpers, middleware
4. **Docker Configuration** - Local development environment setup
5. **API Gateway** - Kong configuration for service routing

### 🚧 In Progress
- Voice & Audio Service (placeholder structure)
- Media Management Service (placeholder structure)
- Video Processing Service (placeholder structure)
- Payment & Wallet Service (placeholder structure)
- Notification Service (placeholder structure)
- Project Management Service (placeholder structure)
- Analytics Service (placeholder structure)

### 🔄 Next Steps
1. Complete remaining microservices implementation
2. Add 3rd party API integrations (OpenAI, ElevenLabs, etc.)
3. Implement real-time features with WebSockets
4. Add comprehensive testing suite
5. Set up CI/CD pipeline
6. Deploy to cloud infrastructure

## 🏗️ Architecture Overview

### Microservices Architecture
The application follows a microservices architecture with the following core services:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Gateway   │────│  Load Balancer │────│   Frontend      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │
    ┌────▼────┐
    │Services │
    └─────────┘
         │
┌────────▼────────┐
│ Message Queue   │
│ (RabbitMQ)      │
└─────────────────┘
         │
┌────────▼────────┐
│   Databases     │
│ PostgreSQL      │
│ Redis           │
│ MongoDB         │
└─────────────────┘
```

### Service Breakdown
1. **Authentication Service** - User management, JWT tokens, social login
2. **AI Content Service** - Script generation, avatar creation, video synthesis
3. **Voice & Audio Service** - Voice cloning, TTS, audio processing
4. **Media Management Service** - File uploads, storage, CDN
5. **Video Processing Service** - Video rendering, editing, export
6. **Payment & Wallet Service** - Credits, transactions, monetization
7. **Notification Service** - Real-time updates, email, push notifications
8. **Project Management Service** - Project lifecycle, drafts, completed videos
9. **Analytics Service** - Usage tracking, performance metrics

## 🛠️ Technology Stack

### Backend
- **Language**: Node.js with TypeScript
- **Framework**: NestJS
- **Database**: PostgreSQL (primary), Redis (cache), MongoDB (metadata)
- **Message Queue**: RabbitMQ
- **API Gateway**: Kong
- **Authentication**: JWT with Passport.js
- **File Storage**: AWS S3 or Google Cloud Storage
- **CDN**: CloudFlare or AWS CloudFront

### AI Integrations
- **Script Generation**: OpenAI GPT-4
- **Voice Cloning**: ElevenLabs
- **Avatar Generation**: DALL-E 3 / Midjourney
- **Video Generation**: Runway ML / Pika Labs
- **Background Music**: Stock music APIs

### DevOps & Monitoring
- **Containerization**: Docker
- **Orchestration**: Kubernetes
- **Monitoring**: Prometheus + Grafana
- **Logging**: ELK Stack (Elasticsearch, Logstash, Kibana)
- **Tracing**: Jaeger
- **CI/CD**: GitHub Actions

## 📋 Prerequisites

### System Requirements
- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **Docker**: v20.x or higher
- **Docker Compose**: v2.x or higher
- **PostgreSQL**: v14.x or higher
- **Redis**: v7.x or higher
- **MongoDB**: v6.x or higher
- **RabbitMQ**: v3.x or higher

### Development Tools
- **IDE**: VS Code with TypeScript support
- **API Testing**: Postman or Insomnia
- **Database Client**: pgAdmin, Redis Commander, MongoDB Compass
- **Version Control**: Git

### Cloud Services (Production)
- **Cloud Provider**: AWS, Google Cloud, or Azure
- **Container Registry**: Docker Hub, AWS ECR, or Google GCR
- **Kubernetes**: EKS, GKE, or AKS
- **Monitoring**: CloudWatch, Stackdriver, or Azure Monitor

## 🌍 **Environment Management**

### **Environment Directory Structure**
The project uses a centralized environment management system:

```
server/
├── environments/
│   ├── local/
│   │   ├── env.local              # Local environment variables
│   │   ├── docker-compose.local.yml
│   │   └── config.local.json      # Local configuration
│   ├── dev/
│   │   ├── env.dev                # Development environment variables
│   │   ├── docker-compose.dev.yml
│   │   └── config.dev.json        # Development configuration
│   └── prod/
│       ├── env.prod               # Production environment variables
│       ├── docker-compose.prod.yml
│       └── config.prod.json       # Production configuration
├── scripts/
│   └── env-manager.sh             # Environment management script
└── microservices/
    └── ...                        # Individual services
```

### **Environment Management Commands**
```bash
# Setup environment
npm run env:setup local
npm run env:setup dev
npm run env:setup prod

# Start services
npm run env:start local
npm run env:start dev
npm run env:start prod

# Stop services
npm run env:stop local
npm run env:stop dev
npm run env:stop prod

# View logs
npm run env:logs local
npm run env:logs dev
npm run env:logs prod

# Check status
npm run env:status local
npm run env:status dev
npm run env:status prod

# Run migrations
npm run env:migrate local
npm run env:migrate dev
npm run env:migrate prod

# Clean environment
npm run env:clean local
npm run env:clean dev
npm run env:clean prod
```

### **Environment-Specific Features**

#### **Local Environment**
- ✅ **Local file storage** (no cloud dependencies)
- ✅ **Development API keys** (safe for local testing)
- ✅ **Debug logging** enabled
- ✅ **Hot reload** for development
- ✅ **No monitoring** (to reduce complexity)

#### **Development Environment**
- ✅ **Cloud storage** (S3/GCS for shared access)
- ✅ **Development API keys** (separate from production)
- ✅ **Basic monitoring** (Prometheus + Grafana)
- ✅ **Multiple replicas** for testing
- ✅ **Resource limits** configured

#### **Production Environment**
- ✅ **Production cloud storage** (S3/GCS)
- ✅ **Production API keys** (secure secrets)
- ✅ **Full monitoring** (Prometheus + Grafana + ELK + Jaeger)
- ✅ **High availability** (multiple replicas)
- ✅ **Resource optimization** for performance
- ✅ **Health checks** and auto-restart
- ✅ **SSL/TLS** enabled
- ✅ **Rate limiting** configured

## 🚀 **Quick Start Guide**

### **Local Development Setup**
```bash
# 1. Clone and navigate to server directory
git clone <repository-url>
cd UserGen/server

# 2. Setup local environment
npm run env:setup local

# 3. Start all services
npm run env:start local

# 4. Run database migrations
npm run env:migrate local

# 5. Start development servers
npm run dev

# 6. Access services
# - API Gateway: http://localhost:8000
# - Auth Service: http://localhost:3000
# - AI Content Service: http://localhost:3001
# - Swagger Docs: http://localhost:3000/api/docs
# - RabbitMQ Management: http://localhost:15672 (guest/guest)
```

### **Development Environment Setup**
```bash
# 1. Setup development environment
npm run env:setup dev

# 2. Start development services
npm run env:start dev

# 3. Run migrations
npm run env:migrate dev

# 4. Check service status
npm run env:status dev
```

### **Production Deployment**
```bash
# 1. Setup production environment
npm run env:setup prod

# 2. Start production services
npm run env:start prod

# 3. Run migrations
npm run env:migrate prod

# 4. Monitor services
npm run env:status prod
npm run env:logs prod
```

## 🗄️ Database Setup

### PostgreSQL Configuration
```sql
-- Create databases
CREATE DATABASE usergen_auth;
CREATE DATABASE usergen_projects;
CREATE DATABASE usergen_analytics;

-- Create users
CREATE USER usergen_auth_user WITH PASSWORD 'secure_password';
CREATE USER usergen_projects_user WITH PASSWORD 'secure_password';
CREATE USER usergen_analytics_user WITH PASSWORD 'secure_password';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE usergen_auth TO usergen_auth_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_projects TO usergen_projects_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_analytics TO usergen_analytics_user;
```

### Redis Configuration
```redis
# Redis configuration for caching and sessions
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

### MongoDB Configuration
```javascript
// MongoDB configuration for metadata storage
{
  "storage": {
    "dbPath": "/data/db",
    "journal": {
      "enabled": true
    }
  },
  "net": {
    "port": 27017,
    "bindIp": "0.0.0.0"
  }
}
```

## 🔧 Microservices Setup

### Service Structure
```
microservices/
├── auth-service/
│   ├── src/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── guards/
│   │   └── strategies/
│   ├── test/
│   ├── package.json
│   └── Dockerfile
├── ai-content-service/
│   ├── src/
│   │   ├── scripts/
│   │   ├── avatars/
│   │   ├── content/
│   │   └── integrations/
│   ├── test/
│   ├── package.json
│   └── Dockerfile
└── ... (other services)
```

### Service Dependencies
Each service should have its own:
- `package.json` with specific dependencies
- `Dockerfile` for containerization
- Environment configuration
- Database connections
- Health check endpoints
- API documentation

## 🌐 API Gateway Configuration

### Kong Configuration
```yaml
# kong.yml
_format_version: "3.0"

services:
  - name: auth-service
    url: http://auth-service:3000
    routes:
      - name: auth-routes
        paths:
          - /api/auth
          - /api/users

  - name: ai-content-service
    url: http://ai-content-service:3001
    routes:
      - name: ai-content-routes
        paths:
          - /api/ai
          - /api/content

plugins:
  - name: cors
    config:
      origins:
        - http://localhost:3000
        - https://usergen.ai
  - name: rate-limiting
    config:
      minute: 100
      hour: 1000
```

## 📨 Message Queue Setup

### RabbitMQ Configuration
```yaml
# rabbitmq.conf
default_user = usergen
default_pass = secure_password
default_vhost = usergen

management.tcp.port = 15672
management.tcp.ip = 0.0.0.0

# Enable plugins
management_plugin = true
rabbitmq_management_plugin = true
```

### Queue Definitions
```typescript
// Queue names and configurations
export const QUEUES = {
  VIDEO_PROCESSING: 'video.processing',
  AI_GENERATION: 'ai.generation',
  EMAIL_NOTIFICATIONS: 'email.notifications',
  PAYMENT_PROCESSING: 'payment.processing',
  ANALYTICS_EVENTS: 'analytics.events'
} as const;
```

## 📊 Monitoring & Logging

### Prometheus Configuration
```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'usergen-services'
    static_configs:
      - targets: 
        - 'auth-service:3000'
        - 'ai-content-service:3001'
        - 'voice-audio-service:3002'
        - 'media-management-service:3003'
        - 'video-processing-service:3004'
        - 'payment-wallet-service:3005'
        - 'notification-service:3006'
        - 'project-management-service:3007'
        - 'analytics-service:3008'
```

### Grafana Dashboards
- Service health monitoring
- API response times
- Database performance
- Queue processing metrics
- User activity analytics

### ELK Stack Configuration
```yaml
# docker-compose.monitoring.yml
version: '3.8'
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.8.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - "9200:9200"

  logstash:
    image: docker.elastic.co/logstash/logstash:8.8.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    ports:
      - "5044:5044"

  kibana:
    image: docker.elastic.co/kibana/kibana:8.8.0
    ports:
      - "5601:5601"
```

## 🚀 Deployment Strategy

### Docker Configuration
```dockerfile
# Example Dockerfile for a service
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
```

### Kubernetes Configuration
```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: auth-service
  template:
    metadata:
      labels:
        app: auth-service
    spec:
      containers:
      - name: auth-service
        image: usergen/auth-service:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: usergen-secrets
              key: database-url
```

## 🔐 Environment Variables

### Required Environment Variables
```bash
# Database URLs
DATABASE_URL=postgresql://user:password@localhost:5432/usergen_auth
REDIS_URL=redis://localhost:6379
MONGODB_URL=mongodb://localhost:27017/usergen_metadata

# Message Queue
RABBITMQ_URL=amqps://user:password@localhost:5672

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=1h
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_REFRESH_EXPIRES_IN=7d

# AI Service API Keys
OPENAI_API_KEY=sk-your-openai-key
ELEVENLABS_API_KEY=your-elevenlabs-key
RUNWAY_API_KEY=your-runway-key

# File Storage
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_S3_BUCKET=usergen-media
AWS_REGION=us-east-1

# Payment Processing
STRIPE_SECRET_KEY=sk_test_your-stripe-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret

# Email Service
SENDGRID_API_KEY=SG.your-sendgrid-key
FROM_EMAIL=noreply@usergen.ai

# Monitoring
PROMETHEUS_ENDPOINT=http://prometheus:9090
JAEGER_ENDPOINT=http://jaeger:14268/api/traces
```

## 🔄 Development Workflow

### Git Workflow
```bash
# Feature development
git checkout -b feature/auth-service-setup
git add .
git commit -m "feat: implement authentication service"
git push origin feature/auth-service-setup

# Create pull request
# After review and approval, merge to main
```

### Code Standards
- **TypeScript**: Strict mode enabled
- **ESLint**: Airbnb configuration
- **Prettier**: Code formatting
- **Husky**: Pre-commit hooks
- **Conventional Commits**: Commit message format

### Testing Strategy
```bash
# Unit tests
npm run test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Coverage report
npm run test:coverage
```

## 🧪 Testing Strategy

### Test Types
1. **Unit Tests**: Individual service functions
2. **Integration Tests**: Service-to-service communication
3. **E2E Tests**: Complete user workflows
4. **Load Tests**: Performance under stress
5. **Security Tests**: Vulnerability scanning

### Test Environment
```bash
# Start test databases
docker-compose -f docker-compose.test.yml up -d

# Run tests
npm run test:all

# Cleanup
docker-compose -f docker-compose.test.yml down
```

## 🔧 Troubleshooting

### Common Issues

#### Database Connection Issues
```bash
# Check database status
docker ps | grep postgres
docker logs usergen-postgres

# Test connection
psql -h localhost -U usergen_auth_user -d usergen_auth
```

#### Service Communication Issues
```bash
# Check service health
curl http://localhost:3000/health
curl http://localhost:3001/health

# Check API Gateway
curl http://localhost:8000/api/auth/health
```

#### Queue Processing Issues
```bash
# Check RabbitMQ management
open http://localhost:15672

# Check queue status
rabbitmqctl list_queues
rabbitmqctl list_consumers
```

### Performance Optimization
- **Database Indexing**: Ensure proper indexes on frequently queried fields
- **Caching Strategy**: Implement Redis caching for expensive operations
- **Connection Pooling**: Configure database connection pools
- **Load Balancing**: Distribute traffic across service instances

### Security Checklist
- [ ] Environment variables secured
- [ ] Database credentials encrypted
- [ ] API endpoints authenticated
- [ ] File uploads validated
- [ ] Rate limiting implemented
- [ ] CORS properly configured
- [ ] HTTPS enforced in production

## 📞 Support & Resources

### Documentation Links
- [NestJS Documentation](https://docs.nestjs.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/documentation)
- [RabbitMQ Documentation](https://www.rabbitmq.com/documentation.html)
- [Docker Documentation](https://docs.docker.com/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)

### Team Contacts
- **Backend Lead**: [Contact Information]
- **DevOps Engineer**: [Contact Information]
- **Database Administrator**: [Contact Information]
- **Security Engineer**: [Contact Information]

---

**Last Updated**: [Current Date]
**Version**: 1.0.0
**Maintained By**: Development Team
