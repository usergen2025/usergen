# 🚀 Complete Backend Setup Guide

This guide will help you set up the entire backend infrastructure from scratch, including databases, services, and API endpoints.

## 📋 Prerequisites

✅ **Already Installed:**
- Node.js v22.17.0
- npm v10.9.2
- Docker v28.5.1

---

## 🔧 Step-by-Step Setup Process

### **Step 1: Navigate to Server Directory**

```bash
cd /Users/jhaaji/Downloads/Client/UserGen/server
```

### **Step 2: Setup Local Environment**

This will:
- Create `.env.local` from `.env.local.example` template
- Copy it to root `.env` for services
- Create necessary directories
- Install dependencies

```bash
npm run env:setup local
```

**Expected Output:**
```
[INFO] Setting up local environment...
[SUCCESS] Created environments/local/.env.local from template
[WARNING] Please review and update environments/local/.env.local with your actual values
[SUCCESS] Environment file copied to root as .env
[INFO] Installing root dependencies...
[INFO] Installing service dependencies...
[SUCCESS] local environment setup complete!
```

### **Step 3: Review and Update Environment Variables (Optional)**

If you have actual API keys or want to change default values:

```bash
# Open the environment file
nano environments/local/.env.local

# Or use your preferred editor
code environments/local/.env.local
```

**Key variables you might want to update:**
- `JWT_SECRET` - Change to a secure random string
- `JWT_REFRESH_SECRET` - Change to a secure random string
- API keys (OpenAI, ElevenLabs, etc.) - When you have them

For now, **default values will work** for local development.

### **Step 4: Start Database Infrastructure**

This starts PostgreSQL, Redis, MongoDB, and RabbitMQ in Docker containers:

```bash
npm run env:start local
```

**Expected Output:**
```
[INFO] Starting local services...
Creating network "usergen-network" ... done
Creating usergen-postgres ... done
Creating usergen-redis ... done
Creating usergen-mongodb ... done
Creating usergen-rabbitmq ... done
[SUCCESS] local services started!
```

**Verify services are running:**
```bash
docker ps
```

You should see 4 containers running:
- `usergen-postgres`
- `usergen-redis`
- `usergen-mongodb`
- `usergen-rabbitmq`

### **Step 5: Wait for Databases to Initialize**

Wait 15-20 seconds for PostgreSQL to fully initialize before proceeding.

```bash
# Check if PostgreSQL is ready
docker exec usergen-postgres pg_isready -U postgres

# Should return: /var/run/postgresql:5432 - accepting connections
```

### **Step 6: Setup Database Schema (Prisma Migrations)**

The databases are empty. We need to create the schema for the Auth Service:

```bash
# Navigate to auth service
cd microservices/auth-service

# Generate Prisma Client
npx prisma generate

# Run migrations to create database tables
npx prisma migrate dev --name init

# Return to server root
cd ../..
```

**Expected Output:**
```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "usergen_auth", schema "public" at "localhost:5432"

Applying migration `20241026_init`
The following migration(s) have been applied:

migrations/
  └─ 20241026_init/
    └─ migration.sql

✔ Generated Prisma Client
```

### **Step 7: Verify Database Connection**

```bash
# Test PostgreSQL
docker exec usergen-postgres psql -U postgres -d usergen_auth -c "\dt"

# Should show tables (users, social_accounts, etc.)

# Test Redis
docker exec usergen-redis redis-cli ping
# Should return: PONG

# Test MongoDB
docker exec usergen-mongodb mongosh --eval "db.adminCommand('ping')"
# Should return: { ok: 1 }
```

### **Step 8: Start Auth Service**

Open a **new terminal window** (keep the current one for logs):

```bash
cd /Users/jhaaji/Downloads/Client/UserGen/server
npm run dev:auth
```

**Expected Output:**
```
[Nest] INFO  Starting Nest application...
[Nest] INFO  Auth Service is running on port 9000
[Nest] INFO  Swagger documentation available at http://localhost:9000/api/docs
```

✅ **Service is running!** You should see the service listening on port 9000.

### **Step 9: Test API with Postman or cURL**

#### **9.1: Health Check**

```bash
curl http://localhost:9000/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "service": "auth-service",
  "timestamp": "2024-10-26T...",
  "uptime": 123.45,
  "version": "1.0.0"
}
```

#### **9.2: User Registration**

**Using cURL:**
```bash
curl -X POST http://localhost:9000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "Test123456",
    "mobile": "+1234567890"
  }'
```

**Using Postman:**
1. Method: `POST`
2. URL: `http://localhost:9000/auth/register`
3. Headers: `Content-Type: application/json`
4. Body (raw JSON):
```json
{
  "name": "Test User",
  "email": "test@example.com",
  "password": "Test123456",
  "mobile": "+1234567890"
}
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clxxxxxxx",
      "email": "test@example.com",
      "name": "Test User",
      ...
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "abc123..."
    }
  },
  "message": "User registered successfully",
  "timestamp": "2024-10-26T..."
}
```

#### **9.3: User Login**

**Using cURL:**
```bash
curl -X POST http://localhost:9000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123456"
  }'
```

**Using Postman:**
1. Method: `POST`
2. URL: `http://localhost:3000/auth/login`
3. Headers: `Content-Type: application/json`
4. Body:
```json
{
  "email": "test@example.com",
  "password": "Test123456"
}
```

#### **9.4: Get User Profile (Protected Endpoint)**

**Using cURL:**
```bash
# Replace YOUR_ACCESS_TOKEN with token from login response
curl -X GET http://localhost:9000/auth/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

**Using Postman:**
1. Method: `GET`
2. URL: `http://localhost:3000/auth/profile`
3. Headers:
   - `Authorization: Bearer YOUR_ACCESS_TOKEN`
   - `Content-Type: application/json`

---

## 📚 **Additional Resources**

### **Access Swagger Documentation**

Open in browser: **http://localhost:9000/api/docs**

You'll see:
- All available endpoints
- Request/response schemas
- Try it out functionality

### **Access RabbitMQ Management**

Open in browser: **http://localhost:15672**

- Username: `guest`
- Password: `guest`

### **View Service Logs**

```bash
# View all service logs
npm run env:logs local

# View specific service logs
docker logs usergen-postgres
docker logs usergen-redis
docker logs usergen-mongodb
docker logs usergen-rabbitmq
```

### **Check Service Status**

```bash
npm run env:status local
```

### **Stop Services**

```bash
# Stop all services
npm run env:stop local

# Stop just databases (keep service running)
docker-compose -f environments/local/docker-compose.local.yml stop postgres redis mongodb rabbitmq
```

---

## 🔍 **Troubleshooting**

### **Issue: Port Already in Use**

```bash
# Check what's using port 9000
lsof -i :9000

# Kill the process
kill -9 <PID>

# Or change port in .env file
```

### **Issue: Database Connection Failed**

```bash
# Check if databases are running
docker ps

# Check database logs
docker logs usergen-postgres

# Restart databases
npm run env:restart local
```

### **Issue: Prisma Client Not Generated**

```bash
cd microservices/auth-service
npx prisma generate
cd ../..
```

### **Issue: Migration Failed**

```bash
# Reset database (WARNING: Deletes all data)
cd microservices/auth-service
npx prisma migrate reset
npx prisma migrate dev --name init
cd ../..
```

### **Issue: Environment Variables Not Loading**

```bash
# Check if .env exists
ls -la .env

# Re-setup environment
npm run env:setup local
```

---

## ✅ **Success Checklist**

After completing all steps, verify:

- [ ] Docker containers are running (`docker ps` shows 4 containers)
- [ ] Auth service is running on port 9000
- [ ] Health endpoint returns `200 OK`
- [ ] Swagger docs accessible at `http://localhost:9000/api/docs`
- [ ] Can register a new user
- [ ] Can login and receive tokens
- [ ] Can access protected endpoints with token
- [ ] Database has tables (`docker exec usergen-postgres psql -U postgres -d usergen_auth -c "\dt"`)

---

## 🎉 **Next Steps**

Once everything is working:

1. **Start Other Services** (when ready):
   ```bash
   npm run dev:ai-content    # Port 9001
   npm run dev:voice-audio   # Port 9002
   # etc...
   ```

2. **Add Your API Keys**:
   - Update `environments/local/.env.local`
   - Add OpenAI, ElevenLabs, etc. keys when you have them

3. **Continue Development**:
   - Implement remaining services
   - Add features
   - Test endpoints

---

## 📞 **Need Help?**

If you encounter any issues:

1. Check service logs: `npm run env:logs local`
2. Check database logs: `docker logs usergen-postgres`
3. Verify environment: `cat .env | head -20`
4. Restart everything: `npm run env:restart local`

---

**Last Updated:** October 26, 2024
**Version:** 1.0.0
