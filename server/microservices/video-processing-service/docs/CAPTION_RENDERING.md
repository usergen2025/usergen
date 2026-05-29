# Caption rendering — diagnosis playbook

Use this when final burned-in captions differ from the workspace preview, the video is blank, or glyphs show as hollow squares (tofu).

## Pipeline overview

| Step | Component | Output |
|------|-----------|--------|
| Preview | `DraggableResizableCaption` (client) | CSS overlay in workspace |
| Burn-in (default) | `HtmlCaptionLayerProvider` + PNG overlay | Playwright → PNG frames → FFmpeg overlay |
| Fallback | `generateAssSubtitles` + libass | ASS file + FFmpeg `ass` filter |
| Legacy VP9 | `overlayCaptionLayerOnVideo` | Only if `CAPTION_USE_VP9_INTERMEDIATE=true` |

Default env: `CAPTION_RENDERER_MODE=html_css`, PNG direct overlay (no VP9 WebM).

## Log grep patterns

Search `video-processing-service` logs for a single test render with captions enabled:

| Log line | Meaning |
|----------|---------|
| `HTML caption layer failed, falling back to ASS` | Playwright/deps failure → expect ASS artifacts on VM |
| `CAPTION_ASS_FALLBACK=deny` / `Caption rendering unavailable` | HTML failed and fallback disabled |
| `Captions rendered in legacy ASS mode` | ASS fallback used; styling may not match preview |
| `ASS style computed: font=Arial (requested=Inter)` | No bundled fonts in `assets/fonts` |
| `caption_layer_*.webm` | VP9 intermediate path (should not appear unless `CAPTION_USE_VP9_INTERMEDIATE=true`) |
| `overlayCaptionPngSequenceOnVideo` | Expected happy path |
| `Generated ASS subtitle file` | ASS-only or fallback path |
| `Captions added successfully` | Output file exists (run validation checks too) |
| `Caption output validation failed` | Bad overlay rejected; uncaptioned video kept |
| `captionRenderer: html` / `ass` / `failed` | Stored on project `metadata` after render |

## Environment-specific symptoms

| Environment | Symptom | Likely cause |
|-------------|---------|--------------|
| **Local Mac** | Full black/blank final video | VP9 WebM alpha overlay (if VP9 enabled); or validation should now reject |
| **VM Linux** | Hollow squares / tofu | Playwright missing deps → ASS fallback without Inter fonts |
| **Both** | Font/padding/position mismatch | ASS path, or HTML before Phase 3 fixes |

## Manual checks

1. **Intermediate files** (under `uploads/videos/{userId}/`):
   - `caption_frames_*` — PNG sequence (should exist briefly during render)
   - `caption_layer_*.webm` — only if VP9 intermediate enabled
   - `final_captioned_*.mp4` — final output
2. Play `final_captioned_*.mp4` — entire frame black vs only caption area wrong?
3. Compare DB `captionSettings.style` and `previewContainerHeight` to workspace preset.

## Playwright health (local + VM)

```bash
cd server/microservices/video-processing-service
npx playwright install chromium
# Linux VM only:
sudo npx playwright install-deps chromium
```

On service startup, look for:

- `[CaptionPlaywright] Chromium launch OK` — HTML path available
- `[CaptionPlaywright] Chromium launch FAILED` — install deps; on prod set `CAPTION_ASS_FALLBACK=deny` after HTML is stable

Quick manual test:

```bash
node -e "import('playwright').then(p=>p.chromium.launch().then(b=>b.close()).then(()=>console.log('OK')))"
```

## Env reference

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAPTION_RENDERER_MODE` | `html_css` | `html_css` or `ass` |
| `CAPTION_LAYER_FPS` | `12` | PNG frame rate for HTML layer |
| `CAPTION_FONTS_DIR` | `./assets/fonts` if present | libass fonts for ASS fallback |
| `CAPTION_ASS_FALLBACK` | `allow` | `deny` = fail render if HTML captions fail |
| `CAPTION_USE_VP9_INTERMEDIATE` | `false` | Legacy VP9 WebM (not recommended) |

## Test matrix (Phase 6)

| # | Environment | Preset | Assert |
|---|-------------|--------|--------|
| 1 | Local | Dark | No blank video; readable captions |
| 2 | Local | Light | Black on white box |
| 3 | Local | Transparent | White text + shadow |
| 4 | VM | Dark | Logs: PNG overlay, no ASS fallback |
| 5 | VM | Word-by-word | Timing OK |
| 6 | Both | Captions OFF | Same as pre-caption video |
| 7 | Local | Drag to corner | Position matches preview |
