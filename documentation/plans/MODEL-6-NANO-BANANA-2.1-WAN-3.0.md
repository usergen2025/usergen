# Plan: New Models — Nano Banana 2.1 (image) + Wan 3.0 Standard & Prime (video)

**Status:** Approved — ready for implementation  
**Branch note:** Prior export/caption/BGM fixes already pushed on `revamp/landing` (`9529198`).

---

## Goal

Add new models and make them the **default everywhere** non-HeyGen generation runs:

| Slot | Provider model | fal endpoint(s) | Default? |
|------|----------------|-----------------|----------|
| `model-6` (image) | Google Nano Banana 2.1 | `google/nano-banana-2.1` (T2I), `google/nano-banana-2.1/edit` (I2I / multi-ref) | **Yes — new default for all image gen** |
| `video-model-3` | Alibaba Wan 3.0 (Standard) | `alibaba/wan-3.0/text-to-video`, `alibaba/wan-3.0/image-to-video` | **Yes — new default for video gen** |
| `video-model-4` | Alibaba Wan 3.0 Prime | `alibaba/wan-3.0-prime/text-to-video`, `alibaba/wan-3.0-prime/image-to-video` | No (selectable) |

**Key principles:**
- All image gen across the entire app (including ai-content-service avatar product stills) → Nano Banana 2.1
- Video: both Wan Standard and Prime are added; Standard is default; user can switch to any model without breakage
- HeyGen avatar **video** generation untouched
- Existing models 1–5 (image) and video 1–2 remain selectable; app must work with any selected model

---

## Current state

- **Images:** 5 registry slots (`model-1`…`model-5`). Defaults: `model-5` (BytePlus Seedream) for T2I; `model-4` (`fal-ai/nano-banana-pro`) for product/reference flows.
- **Videos:** 2 registry slots (`video-model-1` BytePlus Seedance, `video-model-2` FAL Veo 3.1). Next slots: `video-model-3`, `video-model-4`.
- Routing: `ModelRegistryService` → `FalProvider` / `FalVideoProvider` / `BytePlusProvider`, with hardcoded defaults scattered across client and server.

---

## fal capability matrix (verified)

### Nano Banana 2.1 — covers all image scenarios

| Scenario | Endpoint | Key inputs | Notes |
|----------|----------|------------|-------|
| Text → image | `google/nano-banana-2.1` | `prompt`, `aspect_ratio`, `resolution` (`1K`/`2K`/`4K`), `num_images` 1–4, `thinking_level` | Replaces Seedream T2I |
| Image → image / edit | `google/nano-banana-2.1/edit` | `prompt` + `image_urls[]` (up to 14) | Replaces nano-banana-pro `/edit` |
| Multi-image → image | same `/edit` | up to **14** reference URLs | Product + avatar + extras |
| Resolutions / ratios | both | `9:16`, `1:1`, `4:3`, etc., up to 4K | Compatible with vertical pipeline |

### Wan 3.0 — covers all video scenarios

| Scenario | Standard endpoint | Prime endpoint | Key inputs |
|----------|-------------------|----------------|------------|
| Text → video | `alibaba/wan-3.0/text-to-video` | `alibaba/wan-3.0-prime/text-to-video` | `prompt`, `duration` 2–30 (integer), `resolution`, `aspect_ratio`, `audio` |
| Image → video (primary) | `alibaba/wan-3.0/image-to-video` | `alibaba/wan-3.0-prime/image-to-video` | **`start_image_url`**, optional `end_image_url`, `prompt`, `duration`, `resolution`, `audio` |
| Multi-reference → video | `alibaba/wan-3.0/reference-to-video` | `alibaba/wan-3.0-prime/reference-to-video` | `reference_image_urls` (≤10), `reference_video_urls`, `reference_audio_urls` |

---

## Compatibility gaps (must fix)

### 1. Image `FalProvider` — assumes `fal-ai/…` namespace + old nano-banana names

- URL builder strips `fal-ai/` and re-prefixes `/fal-ai/…`. `google/nano-banana-2.1` → wrong prefix
- `extractBaseModelName('google/nano-banana-2.1')` → `google` (breaks `/edit` suffix + status polling)
- `/edit` suffix allowlist only includes `nano-banana` / `nano-banana-pro`

**Fix:** Namespace-aware URL builder — submit to `/google/nano-banana-2.1` or `/google/nano-banana-2.1/edit`; poll status/result with full model path. Add `nano-banana-2.1` to the edit-capable model list.

### 2. Video `FalVideoProvider` — hardcoded to single Veo model

- `modelPath = 'veo3.1/image-to-video'` — always `/fal-ai/${modelPath}`
- Payload: `image_url` (Wan uses `start_image_url`), `duration: '4s'|'6s'|'8s'` (Wan uses integer 2–30), `generate_audio` (Wan uses `audio`)

**Fix:** Accept model path from request. Build a model-specific payload adapter:

| Field | Veo 3.1 | Wan 3.0 / Prime |
|-------|---------|-----------------|
| Image input | `image_url` | `start_image_url` |
| Duration | enum `'4s'`/`'6s'`/`'8s'` | integer seconds 2–30 |
| Audio toggle | `generate_audio` | `audio` |
| URL prefix | `/fal-ai/` | `/alibaba/` (no prefix) |
| Status polling | `fal-ai/{base}/requests/…` | `alibaba/{base}/requests/…` |

### 3. Factory platform detection

`VideoProviderFactory.getProviderForModel` only treats `fal-ai/` as FAL. Must also recognize `alibaba/…` → FAL platform. Best approach: always resolve through registry (platform field) first, prefix-sniffing as fallback.

### 4. Hardcoded defaults across app

All non-HeyGen defaults change to `model-6` / `video-model-3`:

**Server:**
- `model-registry.service.ts` — `getDefaultModel()`, `getDefaultModelForStyle()`, `getDefaultVideoModel()`
- `video.controller.ts` — generate/regenerate fallback model ids
- `image-generation.processor.ts` — product/ref overrides (`model-4` → `model-6`)
- `video-generation.processor.ts` — default `video-model-1` → `video-model-3`
- `rendering.service.ts` — BGM mix volume defaults already fixed (keep)
- `ai-content-service/avatars.service.ts` — avatar product still (`fal-ai/nano-banana-pro` → `google/nano-banana-2.1`)
- `ai-content-service/fal-image.provider.ts` — same namespace fix as main FalProvider

**Client:**
- `ModelSelector.tsx` — add fallback entries for model-6, video-model-3, video-model-4
- `workspace/page.tsx` — default model ids for regen/generate
- `broll-images/page.tsx` — `selectedModels` default
- `broll-videos/page.tsx` — `selectedModels` default
- `ai-chat/page.tsx` — model selection logic

---

## Implementation phases

### Phase A — Registry additions

1. **`model-6`** in `model-registry.service.ts`:
   ```
   id: 'google/nano-banana-2.1'
   platform: 'FAL'
   capabilities: aspect ratios (auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16, 4:1, 1:4, 8:1, 1:8)
   resolutions: ['1K', '2K', '4K']
   async: true, numImages: 4
   ```

2. **`video-model-3`** (Wan 3.0 Standard):
   ```
   id: 'alibaba/wan-3.0/image-to-video'
   platform: 'FAL'
   supportedAspectRatios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']
   supportedResolutions: ['480p', '720p', '1080p']
   minDuration: 2, maxDuration: 30
   defaultConfig.textToVideoEndpoint: 'alibaba/wan-3.0/text-to-video'
   defaultConfig.audio: false  (VO/BGM authoritative)
   ```

3. **`video-model-4`** (Wan 3.0 Prime):
   ```
   id: 'alibaba/wan-3.0-prime/image-to-video'
   platform: 'FAL'
   (same capabilities as Standard)
   defaultConfig.textToVideoEndpoint: 'alibaba/wan-3.0-prime/text-to-video'
   defaultConfig.audio: false
   ```

4. Update `getDefaultModel()` → `model-6`, `getDefaultModelForStyle()` → `model-6` for all styles, `getDefaultVideoModel()` → `video-model-3`

5. Update API response `default` fields in `getImageGenerationModels` / `getVideoGenerationModels`

### Phase B — Provider plumbing

1. **FalProvider (images):**
   - Detect model namespace: `google/…` vs `fal-ai/…` vs bare name
   - Build URL without hardcoded `fal-ai/` prefix for non-fal-ai namespaces
   - Add `nano-banana-2.1` to edit-capable models (→ `/edit` suffix when `referenceImages` present)
   - Fix `extractBaseModelName` for namespaced models (use full path for status polling)
   - Keep all existing nano-banana / nano-banana-pro / reve / imagen4 behavior intact

2. **FalVideoProvider (videos):**
   - Accept `modelPath` from caller (from registry lookup) instead of hardcoded Veo
   - Build model-specific payload adapter map:
     - Veo: `{ imageKey: 'image_url', durationFormat: 'enum', audioKey: 'generate_audio', urlPrefix: 'fal-ai/' }`
     - Wan/WanPrime: `{ imageKey: 'start_image_url', durationFormat: 'integer', audioKey: 'audio', urlPrefix: '' }`
   - Fix `checkRequestStatus` / `fetchRequestResult` to use full model path (not just first segment)
   - Duration for Wan: `Math.ceil(sceneVoDuration)` clamped 2–30
   - `audio: false` by default for Wan (our FFmpeg VO+BGM pipeline is authoritative)

3. **VideoProviderFactory:**
   - Add `alibaba/` and `google/` prefix detection as FAL fallback
   - Primary path: resolve via registry (platform field) — already works for `video-model-3`/`video-model-4`

### Phase C — Default switchover

Replace every hardcoded default. **Non-exhaustive checklist:**

| File | Old default | New default |
|------|-------------|-------------|
| `model-registry.service.ts` | `model-5` / `model-4` | `model-6` |
| `video.controller.ts` | `video-model-1` / `model-5` / `model-4` | `video-model-3` / `model-6` |
| `image-generation.processor.ts` | `model-4` / `model-5` | `model-6` |
| `video-generation.processor.ts` | `video-model-1` | `video-model-3` |
| `workspace/page.tsx` | `model-4`/`model-5`/`video-model-1` | `model-6`/`video-model-3` |
| `broll-images/page.tsx` | `model-5` | `model-6` |
| `broll-videos/page.tsx` | `video-model-1` | `video-model-3` |
| `ai-chat/page.tsx` | `model-4`/`model-5` | `model-6` |
| `ModelSelector.tsx` fallbacks | 5 image + 2 video | 6 image + 4 video |

### Phase D — ai-content-service

- `avatars.service.ts`: switch `fal-ai/nano-banana-pro` → `google/nano-banana-2.1` for avatar product stills
- `fal-image.provider.ts`: apply same namespace-aware URL fixes as main FalProvider
- Avatar **video** (HeyGen) — no change

### Phase E — End-to-end testing

Full E2E browser test covering both the new model changes AND the prior export fixes:

1. **Image generation:**
   - T2I with Model 6 (Nano Banana 2.1) — verify image returned
   - Switch to Model 5 in selector → regenerate → verify still works
   - Switch back to Model 6 → regenerate → verify
   - Product style with reference images → verify `/edit` endpoint used

2. **Video generation:**
   - I2V with Video Model 3 (Wan 3.0 Standard) — verify video returned
   - Switch to Video Model 4 (Prime) → regenerate → verify
   - Switch to Video Model 1 (Seedance) → regenerate → verify no breakage
   - Switch back to Video Model 3 → verify

3. **Prior fixes regression (from `9529198`):**
   - **Regenerate button:** Visible beside Edit on workspace, broll-images, broll-videos; click triggers regen
   - **Captions:** Export with captions enabled → verify burned-in text in output
   - **BGM/Music:** Export with music → verify audible background music in output
   - **Avatar Export:** Avatar-only project → Export → verify post-process runs (not stuck on toast)
   - **SceneEditModal:** Open Edit → verify Current media thumbnail is visible (not blank)
   - **Avatar thumbnails:** Avatar-only scene cards show avatar preview (not "No image")

4. **Model switching resilience:**
   - Mid-project switch from Model 6 to Model 3 (image) → regenerate scene → no crash
   - Mid-project switch video model → regenerate → no crash
   - Full export after model switches → verify captions + BGM still applied

---

## Risks / mitigations

| Risk | Mitigation |
|------|------------|
| `google/…` and `alibaba/…` namespaces break fal URL building | Namespace-aware builder with explicit tests per model family |
| Wan `start_image_url` vs Veo `image_url` confusion | Payload adapter map keyed by model family; factory resolves before payload build |
| Wan native audio fights our VO/BGM | `audio: false` in registry defaults; explicit in payload builder |
| Old model-4/model-5 overrides silently kept | Grep + replace all defaults; processor override logic updated |
| Cost: Wan 30s/1080p expensive | Duration clamped to scene VO length (`Math.ceil`); max 30s |
| Prime vs Standard confusion | Separate registry entries with clear display names ("Wan 3.0" vs "Wan 3.0 Prime") |

---

## File touch list

**Server — video-processing-service:**
- `src/rendering/providers/model-registry.service.ts`
- `src/rendering/providers/fal/fal.provider.ts`
- `src/rendering/providers/fal/fal-video.provider.ts`
- `src/rendering/providers/video-provider-factory.service.ts`
- `src/common/queue/processors/image-generation.processor.ts`
- `src/common/queue/processors/video-generation.processor.ts`
- `src/video/video.controller.ts`

**Server — ai-content-service:**
- `src/avatars/avatars.service.ts`
- `src/avatars/providers/fal-image.provider.ts`

**Client:**
- `components/create-video/ModelSelector.tsx`
- `app/create-video/workspace/page.tsx`
- `app/create-video/broll-images/page.tsx`
- `app/create-video/broll-videos/page.tsx`
- `app/create-video/ai-chat/page.tsx`

---

## Acceptance criteria

- [ ] `model-6` registered with `google/nano-banana-2.1`; T2I and I2I/edit work
- [ ] `video-model-3` (Wan Standard) and `video-model-4` (Wan Prime) registered; I2V works for both
- [ ] Default image model is `model-6` everywhere (including ai-content-service)
- [ ] Default video model is `video-model-3` everywhere
- [ ] Models 1–5 (image) and video 1–2 still selectable and functional
- [ ] Switching between any model mid-project does not break the app
- [ ] HeyGen avatar video generation paths unchanged
- [ ] Export still applies captions + BGM on top of any model's clips
- [ ] Regenerate button present and working on workspace, broll-images, broll-videos
- [ ] SceneEditModal shows correct absolute media thumbnail
- [ ] Avatar-only scene cards show avatar preview thumbnail
- [ ] Full E2E test passes covering all of the above
