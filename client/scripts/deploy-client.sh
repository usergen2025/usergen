#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

for cmd in node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ Missing required command: $cmd"
    exit 1
  fi
done

echo "Installing client dependencies..."
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

echo "Building Next.js client..."
npm run build

echo "Client deploy bundle ready."
echo "Start with: npm run start"
