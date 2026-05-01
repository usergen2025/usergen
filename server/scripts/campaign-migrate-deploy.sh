#!/usr/bin/env bash
# Apply Prisma migrations for campaign-service only (usergen_campaigns DB).
# Usage: from server repo root — bash scripts/campaign-migrate-deploy.sh
# Requires: DATABASE_URL in microservices/campaign-service/.env or exported in the environment.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVC="$ROOT/microservices/campaign-service"

if [[ ! -d "$SVC" ]]; then
  echo "campaign-service not found at $SVC" >&2
  exit 1
fi

cd "$SVC"

if [[ -z "${DATABASE_URL:-}" ]] && [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a
  source .env
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. Add it to microservices/campaign-service/.env or export it." >&2
  exit 1
fi

echo "Running prisma migrate deploy in campaign-service..."
npx prisma migrate deploy
echo "Running prisma generate..."
npx prisma generate
echo "Done. Restart campaign-service (e.g. pm2 restart campaign-service)."
