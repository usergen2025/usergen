# Quick Start Guide

## Start Services

```bash
cd server
docker-compose up
```

## Install & Migrate

```bash
# Auth Service
cd microservices/auth-service
npm install && npx prisma migrate dev

# Workspace Service
cd ../workspace-service
npm install && npx prisma migrate dev

# Payment Wallet Service
cd ../payment-wallet-service
npm install && npx prisma migrate dev

# Activity Service
cd ../activity-service
npm install && npx prisma migrate dev
```

## Service Ports

- Frontend (Next.js): 3200
- Auth Service: 9000
- AI Content Service: 9001
- Activity Service: 9003
- Payment Wallet Service: 9005
- Workspace Service: 9007
- IAM Service: 9010
- API Gateway (Kong): 8000

## Test

```bash
# Health check
curl http://localhost:9000/health

# Register user
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@test.com","password":"Pass123!"}'
```

## Documentation

- `WORKSPACES.md` - Workspace management
- `CREDITS.md` - Credit system
- `SETUP.md` - Detailed setup guide
- `server/MULTI_TENANT.md` - Architecture details


