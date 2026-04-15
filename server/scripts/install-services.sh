#!/usr/bin/env bash
# Install npm dependencies for each microservice that exists (skips missing dirs).
set -e
cd "$(dirname "$0")/.."

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
  echo "📦 $name"
  (cd "$path" && npm install)
  echo ""
done

echo "✅ install-services finished"
