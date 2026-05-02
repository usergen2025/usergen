#!/usr/bin/env bash
# Install npm dependencies for each microservice that exists (skips missing dirs).
set -e
cd "$(dirname "$0")/.."

for cmd in node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ Missing required command: $cmd"
    exit 1
  fi
done

SERVICES=(
  "swagger-aggregator-service"
  "auth-service"
  "ai-content-service"
  "voice-audio-service"
  "media-management-service"
  "video-processing-service"
  "payment-wallet-service"
  "iam-service"
  "notification-service"
  "analytics-service"
  "activity-service"
  "workspace-service"
  "campaign-service"
  "project-management-service"
)

echo "Installing microservice dependencies..."
echo ""

for name in "${SERVICES[@]}"; do
  path="microservices/$name"
  if [ ! -d "$path" ]; then
    echo "⚠️  Skip (not in repo): $name"
    continue
  fi
  if [ ! -f "$path/package.json" ]; then
    echo "⚠️  Skip (no package.json): $name"
    continue
  fi
  if [ ! -f "$path/.env" ] && [ -f "$path/env.example" ]; then
    echo "⚠️  $name has no .env (env.example exists)."
  fi
  echo "📦 $name"
  if [ -f "$path/package-lock.json" ]; then
    (cd "$path" && npm ci --no-audit --no-fund)
  else
    (cd "$path" && npm install --no-audit --no-fund)
  fi
  if [ -f "$path/prisma/schema.prisma" ]; then
    echo "   🔧 prisma generate ($name)"
    if ! (cd "$path" && npx prisma generate); then
      echo "⚠️  prisma generate failed for $name — fix DATABASE_URL or run: npm run deploy:all"
    fi
  fi
  echo ""
done

echo "✅ install-services finished"
