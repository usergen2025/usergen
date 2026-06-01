# Brand video post-processing

## Three-phase flow

1. **Phase A (ai-content):** Logo preprocessing writes `metadata.logoBrand` with `StorageRef` dual paths.
2. **Phase B (video-processing):** `brand-packaging` queue pre-builds end-card plate during audio/B-roll generation.
3. **Phase C (render):** `RenderingService.finalizeAndPublishVideo` awaits `brandPackaging.status=ready`, then fast-stitches.

## Phase C steps (fast stitch)

1. **Readiness gate** — poll `metadata.brandPackaging` up to `BRAND_PACKAGING_TIMEOUT_MS`; one emergency plate build on timeout.
2. **Corner logo overlay** (if `overlayPolicy.showCornerBug` and `BRAND_LOGO_OVERLAY_ENABLED`)
   - Resolve `cornerOverlay` `StorageRef` to local path → FFmpeg overlay (no HTTP download).
3. **1s brand end card** (if `overlayPolicy.showEndCard` and `BRAND_END_CARD_ENABLED`)
   - Use pre-built `endCardPlate.localPath` → `buildBrandOutroMp4` → `appendOutro`.

Sets `metadata.brandPackagingApplied: true` when end card is appended.

## Emergency fallback

`BrandLogoResolverService` runs only when `brandPackaging.status === 'failed'` and logo assets exist.

## Preview

`PreviewVideoService` skips a second outro when `brandPackagingApplied` is true.

## API

- `POST /api/video-projects/:projectId/brand-packaging/start`
- `GET /api/video-projects/:projectId/brand-packaging/status`

WebSocket `queueType: brand-packaging` emits `{ cornerReady, endCardPlateReady }`.

## DB verification

```bash
docker exec usergen-postgres psql -U postgres -d usergen_video_processing -c "
SELECT id,
       metadata->'brandPackaging'->>'status' AS brand_status,
       metadata->'logoBrand'->'cornerOverlay'->>'localPath' AS corner_local,
       metadata->'logoBrand'->'endCardPlate'->>'localPath' AS plate_local
FROM video_projects WHERE id = 'PROJECT_ID';"
```

## Environment

See `env.example`: `BRAND_*`, `BRAND_PACKAGING_*`, `AI_CONTENT_UPLOADS_DIR`, `AI_CONTENT_SERVICE_URL`.
