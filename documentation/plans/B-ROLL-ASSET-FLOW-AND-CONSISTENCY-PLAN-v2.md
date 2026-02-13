# B-Roll Asset Flow and Consistency – Step-by-Step Implementation Plan (v2)

This plan covers: (1) script generation using both analysis text and images, (2) logo placement via reference image + prompt with a fixed reference order, (3) model selection (model-4 for product styles, Seedream model-5 for others when assets exist), (4) BytePlus Seedream API alignment and reference image order, and (5) Indian default for hindi/hinglish and US/Europe for english.

---

## Reference: BytePlus Image API (Seedream)

Example from BytePlus documentation:

```bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "seedream-4-5-251128",
    "prompt": "Replace the clothing in image 1 with the outfit from image 2.",
    "image": [
      "https://.../seedream4_imagesToimage_1.png",
      "https://.../seedream4_5_imagesToimage_2.png"
    ],
    "sequential_image_generation": "disabled",
    "size": "2K"
  }'
```

- **Order matters:** The API accepts an array of image URLs. The prompt must refer to them by position (e.g. “image 1”, “image 2”, “the last image”).
- **Convention for this app:** Use **logo last** when multiple reference images are used: `[product1, product2, ..., logo]`. So we can have multiple product images (image 1, 2, …) and the logo is always “the last reference image”. This keeps product(s) first and logo in a single, predictable position.

---

## Reference image order (product vs logo)

- **Order:** `[product image(s)..., logo]` — one or more product reference images first, then the logo as the last image.
- **Prompt wording:** Use phrases like:
  - “Image 1 (and image 2 if present) show the product; keep the product design consistent.”
  - “Use the logo from the **last** reference image. Place it naturally in the scene (e.g. on the product, packaging, or as a subtle lower-third) so the product clearly looks like it belongs to the company. Do not redraw or recreate the logo – use the exact logo from the last reference image.”
- **Implementation:** In the asset-processor (or wherever reference images are built), build the array in this order: product assets first (by scene or all products), then logo asset(s) last. Document this in code comments and in this plan.

---

## Region/language defaults (Indian vs US/Europe)

- **Hindi and Hinglish:** **Indian as default.** All B-roll and avatar descriptions should assume Indian settings: Indian people, Indian locations (markets, offices, streets, villages, cafes, metro, festivals), Indian aesthetic (lighting, colors, tone). The system prompt should state this clearly and examples should use Indian context.
- **English:** **US and Europe as default.** B-roll and avatar descriptions should assume US/European settings: Western-looking people, US/European locations (cities, offices, cafes, suburbs), and US/European aesthetic unless the user specifies otherwise.
- **Implementation:** In script generation, when building the system prompt, append a **region block** based on `language`:
  - `language === 'hindi' || language === 'hinglish'` → append **Indian context block** (Indian audience, locations, people, visuals).
  - `language === 'english'` → append **US/Europe context block** (US/European audience, locations, people, visuals).
  - Apply this to all video styles (including PRODUCT_ONLY and AVATAR_PRODUCT) so that generated `broll_image_prompt` and `broll_video_prompt` explicitly mention the right region.

---

## Step-by-step implementation plan

### Phase 1: Script and region (ai-content-service)

**1.1 Keep “both” for script (no code change if already so)**  
- Ensure script generation always uses (1) asset context from analysis (text) in the system prompt and (2) asset image URLs in the user message for vision. No either/or. Verify in [scripts.service.ts](server/microservices/ai-content-service/src/scripts/scripts.service.ts) and document.

**1.2 Region block (Indian vs US/Europe)**  
- In [scripts.service.ts](server/microservices/ai-content-service/src/scripts/scripts.service.ts):
  - Add a helper e.g. `getRegionContext(language: 'english' | 'hindi' | 'hinglish')` that returns a string:
    - For `hindi` or `hinglish`: “CRITICAL: Default region is India. All B-roll and avatar descriptions must use Indian settings: Indian people, Indian locations (markets, offices, streets, villages, cafes, metro, festivals), Indian aesthetic. Every visual_style_guide and broll_image_prompt / broll_video_prompt must explicitly mention Indian context (e.g. Indian street, Indian office) unless the user asks otherwise.”
    - For `english`: “CRITICAL: Default region is US/Europe. All B-roll and avatar descriptions must use US/European settings: Western-looking people, US/European locations (cities, offices, cafes, suburbs). Every visual_style_guide and broll_image_prompt / broll_video_prompt should reflect US/European context unless the user specifies otherwise.”
  - In `getSystemPromptForStyle`, after building the base prompt and asset context, append `getRegionContext(language)` so that every style (including PRODUCT_ONLY and AVATAR_PRODUCT) gets the correct region default.

**1.3 Indian wording in existing style prompts**  
- Audit HALF_N_HALF, ALTERNATE, AVATAR_CUTOUT, AVATAR_ONLY: they already contain Indian wording. Ensure it is consistent with the new region block (no conflict). For english, the new US/Europe block will override the default tone for those styles when language is english.

**1.4 normalizePrompts fallback**  
- In `normalizePrompts`, use a region-aware fallback when scene-specific content is missing: for `hindi`/`hinglish` use “Indian context scene”; for `english` use “US/European context scene”. This may require passing `language` into `normalizePrompts` (e.g. from script data or request). If `normalizePrompts` does not have access to language, keep “Indian context scene” as fallback and add a follow-up task to make it region-aware when language is available.

---

### Phase 2: Asset analysis usability (ai-content-service)

**2.1 Extend analysis output**  
- In [asset-analysis.service.ts](server/microservices/ai-content-service/src/assets/asset-analysis.service.ts):
  - Extend the Vision prompt and response parsing to add:
    - For **logo:** `suitableForReferenceOverlay: true` (clean logo on solid/transparent background).
    - For **product:** `canUseAsDirectBroll: boolean`, `recommendedUsage: 'reference_only' | 'direct_broll'` (e.g. reference_only when background is busy).
    - For **environment/background:** `canUseAsDirectBroll`, `suitableAsBackground` (or similar).
  - Extend the `AnalyzedAsset` type and ensure these fields are persisted in `metadata.analyzedAssets` (no schema change if metadata is JSON).

**2.2 Pass-through**  
- Ensure the video-processing-service reads these fields from `project.metadata.analyzedAssets` when building reference images and choosing models (no change to API contract if metadata is already passed through).

---

### Phase 3: BytePlus Seedream API and model config (video-processing-service)

**3.1 Model ID and request shape**  
- In [model-registry.service.ts](server/microservices/video-processing-service/src/rendering/providers/model-registry.service.ts): add or update the Seedream model so that it can use the documented model ID `seedream-4-5-251128` (multi-reference image-to-image). Either:
  - Update model-5’s `id` to `seedream-4-5-251128`, or
  - Add a new model entry (e.g. model-5b) with `seedream-4-5-251128` and use it when reference images are present. Prefer a single model-5 entry using the documented model ID if that is the recommended one for multi-reference.
- In [byteplus.provider.ts](server/microservices/video-processing-service/src/rendering/providers/byteplus.provider.ts): ensure the request body matches the API:
  - `model`: use request’s `modelId` or the Seedream model ID (e.g. `seedream-4-5-251128`).
  - `prompt`: required; will contain “image 1”, “last image”, etc., as per reference order.
  - `image`: array of URLs when multiple reference images (product(s) first, logo last).
  - `sequential_image_generation`: `"disabled"`.
  - `size`: map from aspect ratio (e.g. `2K` for 9:16). Keep existing size mapping if it already matches BytePlus expectations.

**3.2 Reference image order in code**  
- Introduce a single place that builds the reference image array for Seedream (and document it):
  - Order: **product(s) first, then logo last.**
  - In [asset-processor.service.ts](server/microservices/video-processing-service/src/common/services/asset-processor.service.ts) (or the image-generation processor), add a function e.g. `buildReferenceImagesInOrder(analyzedAssets, options?: { includeLogo: boolean })` that returns `string[]`: product image URLs first, then logo image URL(s) last. Use this whenever building `referenceImages` for Seedream so the prompt’s “image 1”, “last image” match the array.

---

### Phase 4: Image generation – default style with assets (video-processing-service)

**4.1 Pass assets and reference images into default style**  
- In [image-generation.processor.ts](server/microservices/video-processing-service/src/common/queue/processors/image-generation.processor.ts):
  - For ALTERNATE, HALF_N_HALF, AVATAR_CUTOUT, AVATAR_ONLY: when `analyzedAssets` exists, build `referenceImages` using the **ordered** helper (product(s) first, logo last). Pass `enhancedPrompt`, `analyzedAssets`, and `referenceImages` into `processDefaultStyle`.

**4.2 Use Seedream (model-5) when reference assets exist**  
- In the same processor, when style is one of ALTERNATE, HALF_N_HALF, AVATAR_CUTOUT, AVATAR_ONLY and `referenceImages.length > 0`, select **model-5** (Seedream) instead of model-1 (imagen4). Keep model-1 when there are no reference assets.
- Ensure Seedream is used with the ordered reference array and that the prompt includes:
  - “Same product as in image 1 [and image 2 if applicable]; only change camera angle, lighting, or background; do not alter product design.”
  - If logo is present: “Use the logo from the last reference image. Place it naturally in the scene so the product looks like it belongs to the company. Do not redraw the logo – use the exact logo from the last reference image.”

**4.3 PRODUCT_ONLY and AVATAR_PRODUCT unchanged**  
- Do not change model selection for PRODUCT_ONLY or AVATAR_PRODUCT; they continue to use **model-4** (nano-banana-pro) as today. If desired later, their reference order can be aligned to “product(s) first, logo last” for consistency with Seedream.

---

### Phase 5: Logo and product prompt instructions (both services)

**5.1 Asset-processor prompt enhancement**  
- In [asset-processor.service.ts](server/microservices/video-processing-service/src/common/services/asset-processor.service.ts): when building enhanced prompts for Seedream (and optionally for model-4), append:
  - Product: “Same product as in the reference image(s); only change angle, lighting, or background; do not alter product design, shape, or colors.”
  - Logo (when logo is in reference images): “Use the logo from the last reference image; place it naturally in the scene; do not generate or redraw brand text – use the exact logo from the reference.”

**5.2 Script prompt (optional)**  
- In script system prompts or asset context (ai-content-service), when logo/assets are present, add one line: “When generating broll_image_prompt and broll_video_prompt, assume the logo will be provided as a reference image (last in order); describe placement (e.g. on product, lower-third) if needed, but do not ask the image model to draw the brand name.”

---

### Phase 6: Validation and fallback

**6.1 BytePlus validation**  
- In [byteplus.provider.ts](server/microservices/video-processing-service/src/rendering/providers/byteplus.provider.ts), ensure `validateRequest` accepts multiple reference images (array of URLs) and does not reject Seedream when `referenceImages.length > 1`. Align with the documented API (array of URLs for `image`).

**6.2 FFmpeg logo overlay (fallback)**  
- If in production the model does not reliably preserve the logo from the reference image, add an optional step in the rendering pipeline to overlay the actual logo image (from `metadata.analyzedAssets`) on selected scenes using FFmpeg. Treat this as fallback; primary path remains reference image + prompt with logo last.

---

## Implementation order (summary)

1. **Phase 1:** Region block (Indian default for hindi/hinglish, US/Europe for english) and script “both” verification in ai-content-service.
2. **Phase 2:** Asset analysis usability fields in ai-content-service.
3. **Phase 3:** BytePlus model ID/request shape and reference image order helper (product(s) first, logo last) in video-processing-service.
4. **Phase 4:** Default-style path: pass reference images in order, use Seedream (model-5) when assets exist, add “same product” and “use logo from last image” in prompt.
5. **Phase 5:** Asset-processor and script prompt wording for logo and product consistency.
6. **Phase 6:** BytePlus validation and optional FFmpeg logo overlay fallback.

---

## Checklist (quick reference)

- [ ] Script: both analysis text + images; no either/or.
- [ ] Region: Indian default for hindi/hinglish; US/Europe for english; append region block to system prompt for all styles; normalizePrompts fallback region-aware if possible.
- [ ] Analysis: usability fields (e.g. suitableForReferenceOverlay, canUseAsDirectBroll, recommendedUsage) and persist in metadata.
- [ ] BytePlus: model ID (e.g. seedream-4-5-251128), request shape (image array, prompt), size/sequential_image_generation.
- [ ] Reference order: product(s) first, logo last; single helper to build ordered array; prompt refers to “image 1”, “last image”.
- [ ] Model selection: PRODUCT_ONLY and AVATAR_PRODUCT always model-4; ALTERNATE/HALF_N_HALF/AVATAR_CUTOUT/AVATAR_ONLY use model-5 when reference assets exist, else model-1.
- [ ] processDefaultStyle: receives enhancedPrompt, referenceImages (ordered), analyzedAssets; uses Seedream when referenceImages.length > 0.
- [ ] Prompts: “same product” and “use logo from last reference image” in asset-processor and scene prompts.
- [ ] Validation: Seedream accepts multiple reference images.
- [ ] Optional: FFmpeg logo overlay fallback in rendering.

This plan is ready for implementation; each phase can be done in order with minimal overlap.
