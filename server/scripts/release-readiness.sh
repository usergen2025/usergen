#!/usr/bin/env bash
# VM release-readiness preflight for backend stack.
set -euo pipefail

cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok_count=0
warn_count=0
fail_count=0

ok() {
  echo -e "${GREEN}✅ $1${NC}"
  ok_count=$((ok_count + 1))
}

warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
  warn_count=$((warn_count + 1))
}

fail() {
  echo -e "${RED}❌ $1${NC}"
  fail_count=$((fail_count + 1))
}

info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

check_cmd() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    ok "Command available: $name"
  else
    fail "Missing command: $name"
  fi
}

check_file() {
  local path="$1"
  if [ -f "$path" ]; then
    ok "Found file: $path"
  else
    fail "Missing file: $path"
  fi
}

check_dir() {
  local path="$1"
  if [ -d "$path" ]; then
    ok "Found directory: $path"
  else
    fail "Missing directory: $path"
  fi
}

check_service_env() {
  local service="$1"
  local base="microservices/$service"
  if [ ! -d "$base" ]; then
    warn "Service missing in repo (skipped): $service"
    return
  fi
  if [ -f "$base/.env" ]; then
    ok "$service has .env"
  elif [ -f "$base/env.example" ]; then
    warn "$service missing .env (env.example exists)"
  else
    warn "$service has no .env or env.example"
  fi
}

echo "=========================================="
echo "🚦 UserGen Server Release Readiness Check"
echo "=========================================="
echo ""

info "Checking required tooling..."
for cmd in bash node npm npx docker; do
  check_cmd "$cmd"
done
echo ""

info "Checking root-level expected files..."
check_file ".env"
check_file "package.json"
check_file "scripts/install-services.sh"
check_file "scripts/migrate-and-deploy.sh"
check_file "scripts/build-services.sh"
echo ""

info "Checking expected service directories..."
services=(
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
)
for s in "${services[@]}"; do
  check_dir "microservices/$s"
done
echo ""

info "Checking service env readiness..."
for s in "${services[@]}"; do
  check_service_env "$s"
done
echo ""

info "Checking npm scripts exposed for VM pipeline..."
for script_name in "deploy:vm" "migrate:all" "generate:all" "build:all"; do
  if node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['$script_name'] ? 0 : 1)"; then
    ok "$script_name script present"
  else
    fail "$script_name script missing"
  fi
done
echo ""

echo "=========================================="
echo "Readiness Summary:"
echo "  ✅ Pass: $ok_count"
echo "  ⚠️  Warn: $warn_count"
echo "  ❌ Fail: $fail_count"
echo "=========================================="

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi

exit 0
