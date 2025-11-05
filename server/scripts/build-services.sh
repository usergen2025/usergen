#!/bin/bash

# Build script that only builds services with tsconfig.json
# Usage: bash scripts/build-services.sh

set -e  # Exit on error, but we'll handle skipping gracefully

cd "$(dirname "$0")/.."  # Go to server root

# Load root .env if it exists
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

echo "Building microservices (only services with tsconfig.json)..."
echo ""

# Array of all services to check
services=(
  "swagger-aggregator-service"
  "auth-service"
  "ai-content-service"
  "voice-audio-service"
  "activity-service"
  "video-processing-service"
  "payment-wallet-service"
  "notification-service"
  "workspace-service"
  "project-management-service"
  "analytics-service"
  "media-management-service"
  "iam-service"
)

success_count=0
skip_count=0
fail_count=0

for service in "${services[@]}"; do
  service_path="microservices/$service"
  
  # Check if service directory exists
  if [ ! -d "$service_path" ]; then
    echo "⚠️  Skipping $service - directory not found"
    ((skip_count++))
    continue
  fi
  
  # Check if tsconfig.json exists
  if [ ! -f "$service_path/tsconfig.json" ]; then
    echo "⚠️  Skipping $service - no tsconfig.json found (not implemented)"
    ((skip_count++))
    continue
  fi
  
  # Check if package.json exists
  if [ ! -f "$service_path/package.json" ]; then
    echo "⚠️  Skipping $service - no package.json found"
    ((skip_count++))
    continue
  fi
  
  # Try to build
  echo "📦 Building $service..."
  cd "$service_path"
  
  if npm run build 2>&1; then
    echo "✅ $service built successfully"
    ((success_count++))
  else
    echo "❌ Failed to build $service"
    ((fail_count++))
    # Continue with next service instead of exiting
  fi
  
  cd ../..
  echo ""
done

echo "=========================================="
echo "Build Summary:"
echo "  ✅ Success: $success_count"
echo "  ⚠️  Skipped: $skip_count"
echo "  ❌ Failed:  $fail_count"
echo "=========================================="

# Exit with error code if any builds failed
if [ $fail_count -gt 0 ]; then
  exit 1
fi

exit 0

