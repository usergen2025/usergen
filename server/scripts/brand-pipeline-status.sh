#!/usr/bin/env bash
# Quick brand pipeline status for a video project.
# Usage: ./scripts/brand-pipeline-status.sh [projectId]

set -euo pipefail
PROJECT_ID="${1:-cmpvbq271000110qtwwp8jm1y}"
VP_DIR="$(cd "$(dirname "$0")/../microservices/video-processing-service" && pwd)"

cd "$VP_DIR"
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const proj = await prisma.videoProject.findUnique({ where: { id: process.argv[1] } });
  if (!proj) { console.error('Project not found'); process.exit(1); }
  const m = proj.metadata || {};
  const lb = m.logoBrand;
  console.log('Project:', proj.id);
  console.log('Status:', proj.status);
  console.log('assets:', Array.isArray(m.assets) ? 'array(' + m.assets.length + ')' : typeof m.assets);
  console.log('assetAnalysis:', m.assetAnalysis?.status);
  console.log('brandPackaging:', JSON.stringify(m.brandPackaging));
  console.log('logoBrand:', lb ? {
    showCornerBug: lb.overlayPolicy?.showCornerBug,
    cornerNeedsBytePlusVariant: lb.cornerNeedsBytePlusVariant,
    hasCornerOverlay: !!lb.cornerOverlay,
    hasEndCardPlate: !!lb.endCardPlate,
  } : null);
  console.log('brandPackagingApplied:', m.brandPackagingApplied);
  console.log('videoUrl:', (proj.videoUrl || '').slice(0, 80));
  await prisma.\$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
" "$PROJECT_ID"
