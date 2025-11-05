#!/bin/bash

echo "🚀 Starting UserGen Dev Environment..."

# Start databases with Docker (same as local)
cd "$(dirname "$0")"
npm run env:start dev

# Wait for databases to be ready
echo "⏳ Waiting for databases to be ready..."
sleep 15

# Check database health
cd environments/dev
docker compose -f docker-compose.dev.yml ps

# Start Node.js services with PM2 (replaces concurrently from local)
cd ../..
pm2 start ecosystem.dev.config.js

echo "✅ All services started!"
pm2 list

