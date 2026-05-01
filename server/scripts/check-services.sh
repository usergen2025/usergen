#!/bin/bash
# Service Status Checker Script
# Checks if all microservices are running and their Swagger JSON endpoints are accessible

echo "🔍 Checking Service Status..."
echo ""

services=(
  "auth-service:9000"
  "ai-content-service:9001"
  "voice-audio-service:9002"
  "activity-service:9003"
  "video-processing-service:9004"
  "payment-wallet-service:9005"
  "notification-service:9006"
  "workspace-service:9007"
  "analytics-service:9008"
  "media-management-service:9009"
  "iam-service:9010"
  "campaign-service:9011"
  "swagger-aggregator:9090"
)

running_count=0
swagger_available_count=0

for service_port in "${services[@]}"; do
  IFS=':' read -r service port <<< "$service_port"
  
  # Check if port is listening
  if lsof -i :$port > /dev/null 2>&1; then
    running_count=$((running_count + 1))
    
    # Check if health endpoint responds
    health_response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$port/health 2>/dev/null)
    
    if [ "$health_response" = "200" ]; then
      echo "✅ $service (port $port) - Running & Healthy"
    else
      echo "⚠️  $service (port $port) - Running but health check returned $health_response"
    fi
    
    # Check Swagger JSON if not aggregator
    if [ "$service" != "swagger-aggregator" ]; then
      swagger_response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$port/api/docs-json 2>/dev/null)
      if [ "$swagger_response" = "200" ]; then
        echo "   └─ Swagger JSON: ✅ Available"
        swagger_available_count=$((swagger_available_count + 1))
      else
        echo "   └─ Swagger JSON: ❌ Not available (HTTP $swagger_response)"
      fi
    fi
  else
    echo "❌ $service (port $port) - Not running"
  fi
done

echo ""
echo "📊 Summary:"
echo "   Running services: $running_count/${#services[@]}"
echo "   Services with Swagger: $swagger_available_count/12"

if [ "$running_count" -lt "${#services[@]}" ]; then
  echo ""
  echo "💡 To start all services, run:"
  echo "   cd /Users/jhaaji/Downloads/Client/UserGen/server"
  echo "   npm run dev"
fi

echo ""
echo "📊 Swagger Aggregator Status:"
if curl -s http://localhost:9090/api/status > /dev/null 2>&1; then
  curl -s http://localhost:9090/api/status | jq '.' 2>/dev/null || curl -s http://localhost:9090/api/status
else
  echo "   ❌ Swagger Aggregator not accessible at http://localhost:9090"
fi

