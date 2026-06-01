# Logo brand packaging (analysis + preprocessing)

## Three-phase flow

| Phase | When | What |
|-------|------|------|
| **A** | Logo attach → asset analysis | `LogoPreprocessingService` writes `metadata.logoBrand` with dual-path `StorageRef`s |
| **B** | Parallel with audio/B-roll (AI Chat → Workspace) | `brand-packaging` Bull queue validates PNGs, builds end-card plate, sets `metadata.brandPackaging.status=ready` |
| **C** | Final render | Fast FFmpeg stitch only (local paths + pre-built plate) |

## metadata.logoBrand (StorageRef schema)

| Field | Purpose |
|-------|---------|
| `sourceLogo` | Original uploaded logo (`StorageRef`) |
| `cornerOverlay` | Trimmed alpha PNG for top-right bug |
| `endCardLogo` | Larger mark for outro center |
| `endCardPlate` | Pre-built 9:16 plate (Phase B, on video-processing) |
| `cornerOverlayPngUrl` | Legacy alias → `cornerOverlay.publicUrl` |
| `endCardLogoPngUrl` | Legacy alias → `endCardLogo.publicUrl` |
| `dominantColors` | Hex colors for gradient end card |
| `overlayPolicy.showCornerBug` | Always `true` when user uploaded a logo; BytePlus corner variant in Phase B if AI marks mark unsuitable |
| `cornerNeedsBytePlusVariant` | Phase A flag → Phase B runs compact corner mark generation |
| `overlayPolicy.showEndCard` | Append 1s brand outro |
| `overlayPolicy.endCardMode` | `solid`, `gradient`, or `byteplus` |

## metadata.brandPackaging

| Field | Values |
|-------|--------|
| `status` | `pending` \| `processing` \| `ready` \| `failed` \| `skipped` |
| `jobId` | Bull job id e.g. `brand-packaging-{projectId}` |
| `cornerReady` | Corner PNG validated |
| `endCardPlateReady` | End-card plate built and stored |

## DB verification

```bash
docker exec usergen-postgres psql -U postgres -d usergen_video_processing -c "
SELECT id,
       metadata->'brandPackaging'->>'status' AS brand_status,
       metadata->'logoBrand'->'cornerOverlay'->>'localPath' AS corner_local,
       metadata->'logoBrand'->'endCardPlate'->>'localPath' AS plate_local,
       metadata->'brandPackagingApplied' AS applied
FROM video_projects WHERE id = 'PROJECT_ID';"
```

## File checks

```bash
ls server/microservices/ai-content-service/uploads/logos/PROJECT_ID/
ls server/microservices/video-processing-service/uploads/logos/PROJECT_ID/
```

## Logo types

| Input | Preprocessing |
|-------|----------------|
| Transparent PNG | trim → corner/endcard PNGs |
| Solid black/white | rembg if no alpha |
| Busy photo background | rembg + `endCardMode: byteplus` when vision says so |
| Wide wordmark | `cornerNeedsBytePlusVariant: true`, corner still shown after Phase B BytePlus variant |
| SVG | rasterize at 300dpi → trim |

## Dependencies

- `sharp` (image ops)
- `scripts/remove_image_background.py` + Python `rembg` (optional)

## Downstream

- **Script:** `metadata.logoBrand.brandName` preferred in `ScriptsService`.
- **Phase B:** `POST /api/video-projects/:id/brand-packaging/start` (triggered from AI Chat audio start + asset analysis).
- **Repair:** `POST /api/video-projects/:id/repair-brand-metadata` — parse legacy stringified `metadata.assets`, re-queue analysis + brand-packaging.
- **Render:** `BrandVideoPostProcessorService` uses local paths only at finalize (BytePlus only in Phase B for plates/corner variant).
- **Preview:** Workspace plays watermarked preview + 1s UserGen outro (not brand plate). Final download has corner + brand end card.
- **Client:** `metadata.assets` must be a JSON **array** (never `JSON.stringify`).

## Shared helper

`parseMetadataAssets()` in `server/shared/brand/parse-metadata-assets.ts` — used by video-processing gates and repair.
