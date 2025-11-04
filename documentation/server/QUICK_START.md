# Quick Start Guide - UserGen.ai Microservices

## 🚀 Starting All Services

### Step 1: Start Docker Infrastructure (Databases, Redis, RabbitMQ)

```bash
cd /Users/jhaaji/Downloads/Client/UserGen/server

# Start Docker services
npm run docker:start

# Or manually:
cd environments/local
docker-compose -f docker-compose.local.yml up -d
```

### Step 2: Start All Microservices

```bash
cd /Users/jhaaji/Downloads/Client/UserGen/server

# Start all services at once
npm run dev
```

This will start:
- **Auth Service** (port 9000)
- **AI Content Service** (port 9001)
- **Voice Audio Service** (port 9002)
- **Activity Service** (port 9003)
- **Video Processing Service** (port 9004)
- **Payment Wallet Service** (port 9005)
- **Notification Service** (port 9006)
- **Workspace Service** (port 9007)
- **Analytics Service** (port 9008)
- **Media Management Service** (port 9009)
- **IAM Service** (port 9010)
- **Swagger Aggregator** (port 9090) ⭐ **This is your unified Swagger UI**

### Step 3: Access Swagger Documentation

Open your browser:
- **Unified Swagger UI**: http://localhost:9090/api/docs
- **Service Status**: http://localhost:9090/api/status

## 🐳 Docker Commands

### Start Docker Services
```bash
npm run docker:start
# Or: bash scripts/docker-control.sh start
```

### Stop Docker Services
```bash
npm run docker:stop
# Or: bash scripts/docker-control.sh stop
```

### Restart Docker Services
```bash
npm run docker:restart
# Or: bash scripts/docker-control.sh restart
```

### View Docker Status
```bash
npm run docker:status
# Or: bash scripts/docker-control.sh status
```

### View Docker Logs
```bash
npm run docker:logs
# Or: bash scripts/docker-control.sh logs [service-name]
# Examples:
#   npm run docker:logs           # All services
#   npm run docker:logs postgres  # PostgreSQL only
```

### Clean Docker (⚠️ Removes all data)
```bash
npm run docker:clean
# Or: bash scripts/docker-control.sh clean
```

## 📊 Check Service Status

```bash
npm run check:services
# Or: bash scripts/check-services.sh
```

This will show:
- ✅ Which services are running
- ✅ Which services have Swagger JSON available
- ✅ Swagger Aggregator status

## 🔧 Starting Individual Services

If you want to start services individually (useful for debugging):

```bash
# Terminal 1 - Auth Service
npm run dev:auth

# Terminal 2 - AI Content Service
npm run dev:ai-content

# Terminal 3 - Swagger Aggregator (start this LAST)
npm run dev:swagger

# ... etc
```

## 📝 Troubleshooting

### Services show "Service unavailable" in Swagger

1. **Check if services are running:**
   ```bash
   npm run check:services
   ```

2. **Check if services are accessible:**
   ```bash
   curl http://localhost:9000/health      # Auth Service
   curl http://localhost:9000/api/docs-json  # Swagger JSON
   ```

3. **Check Docker services:**
   ```bash
   npm run docker:status
   ```

4. **View service logs:**
   - Check the terminal where services are running
   - Check Docker logs: `npm run docker:logs`

### Port Already in Use

If you get "EADDRINUSE" errors:

```bash
# Find what's using the port
lsof -i :9000

# Kill the process (replace PID with actual process ID)
kill -9 PID
```

### Swagger Aggregator Shows Wrong Port

Make sure `.env` file has:
```bash
SWAGGER_AGGREGATOR_SERVICE_PORT=9090
```

### Database Connection Errors

1. **Start Docker infrastructure first:**
   ```bash
   npm run docker:start
   ```

2. **Wait for databases to be ready (10-15 seconds)**

3. **Then start services:**
   ```bash
   npm run dev
   ```

## ✅ Verification

Once everything is running, you should see:

1. **All services running:**
   ```bash
   npm run check:services
   ```
   Should show ✅ for all services

2. **Swagger UI accessible:**
   - Visit http://localhost:9090/api/docs
   - You should see all services as separate collections
   - Each service should have its endpoints visible

3. **Service status endpoint:**
   - Visit http://localhost:9090/api/status
   - Should show `swaggerAvailable: true` for running services

## 🎯 Quick Reference

| Service | Port | Swagger URL |
|---------|------|-------------|
| Auth Service | 9000 | http://localhost:9000/api/docs |
| AI Content Service | 9001 | http://localhost:9001/api/docs |
| Voice Audio Service | 9002 | http://localhost:9002/api/docs |
| Activity Service | 9003 | http://localhost:9003/api/docs |
| Video Processing Service | 9004 | http://localhost:9004/api/docs |
| Payment Wallet Service | 9005 | http://localhost:9005/api/docs |
| Notification Service | 9006 | http://localhost:9006/api/docs |
| Workspace Service | 9007 | http://localhost:9007/api/docs |
| Analytics Service | 9008 | http://localhost:9008/api/docs |
| Media Management Service | 9009 | http://localhost:9009/api/docs |
| IAM Service | 9010 | http://localhost:9010/api/docs |
| **Swagger Aggregator** | **9090** | **http://localhost:9090/api/docs** ⭐ |

## 📚 Next Steps

1. Start Docker infrastructure: `npm run docker:start`
2. Start all services: `npm run dev`
3. Open Swagger: http://localhost:9090/api/docs
4. Test APIs using the unified Swagger interface!

