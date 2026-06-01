# Brand pipeline — local testing guide

## Prerequisites (already verified on your machine)

| Check | Command |
|-------|---------|
| Redis | `redis-cli ping` → `PONG` |
| Postgres | Docker / local on `5432` |
| ADC (GCS upload) | `gcloud auth application-default login` |
| Services | `9001` ai-content, `9004` video-processing, `3200` client |

## Start stack

From repo root:

```bash
# Terminal 1 — backend (if not already running)
cd server && npm run dev

# Terminal 2 — client (restart after .env.local changes)
cd client && npm run dev
```

Create local env from the template (both are gitignored):

```bash
cd client && cp .env.example .env && cp .env.example .env.local
```

Minimum required vars:

- `NEXT_PUBLIC_API_URL=http://localhost:9000/api` — auth profile/login (do **not** leave default port 8000)
- `NEXT_PUBLIC_VIDEO_SERVICE_URL=http://localhost:9004/api`
- `NEXT_PUBLIC_WS_URL=http://localhost:9004`

## Test project (repaired)

- **Project ID:** `cmpvbq271000110qtwwp8jm1y`
- **Workspace:** http://localhost:3200/create-video/workspace?projectId=cmpvbq271000110qtwwp8jm1y

Check pipeline status:

```bash
bash server/scripts/brand-pipeline-status.sh cmpvbq271000110qtwwp8jm1y
```

Expect before re-export:

- `brandPackaging.status` = `ready`
- `logoBrand` with `hasEndCardPlate: true`
- `brandPackagingApplied` = `false` or missing (until you re-export)

## Re-export (required for branded final)

The existing final MP4 was rendered **before** brand assets were ready. To see corner logo + 1s brand end card:

1. Open workspace for the project.
2. Go back to **Videos** (or trigger **Export** again) so `startRendering` runs Phase C with `logoBrand` + `endCardPlate`.

Or call the API with your user JWT:

```bash
curl -X POST "http://localhost:9004/api/video-projects/cmpvbq271000110qtwwp8jm1y/start-rendering" \
  -H "Authorization: Bearer YOUR_JWT"
```

After render completes, verify:

```bash
bash server/scripts/brand-pipeline-status.sh cmpvbq271000110qtwwp8jm1y
# brandPackagingApplied should be true
ls server/microservices/video-processing-service/uploads/videos/*/final_branded_cmpvbq*
```

## Download verification

Download strategies (`GET .../download-url`):

| Strategy | When | Client behavior |
|----------|------|-----------------|
| `proxy_stream` | Local `final_*.mp4` on disk | Authenticated `fetch` → `/api/video/:id/download` with Bearer JWT |
| `signed_gcs` | VM/service account can sign | Open HTTPS URL in new tab |
| `public_gcs` | ADC cannot sign; object is public | Open GCS `videoUrl` in new tab (no JWT) |

**Never** open `/api/video/:id/download` in a new tab without logging in — returns `401 User ID is required`.

### Automated checks

```bash
PROJECT_ID=cmpvbq271000110qtwwp8jm1y
JWT="PASTE_FROM_BROWSER_localStorage_authToken"

# download-url OK
curl -s -H "Authorization: Bearer $JWT" \
  "http://localhost:3200/api/video/$PROJECT_ID/download-url"

# no auth → 401
curl -s "http://localhost:3200/api/video/$PROJECT_ID/download"

# full file (~25MB)
curl -s -H "Authorization: Bearer $JWT" \
  "http://localhost:3200/api/video/$PROJECT_ID/download" \
  -o /tmp/verify-final.mp4 -w "HTTP %{http_code} size=%{size_download}\n"
file /tmp/verify-final.mp4
```

### UI checks

1. Workspace → **Download** → `.mp4` saves; no JSON error tab.
2. DevTools: download request has `Authorization: Bearer …`, `content-type: video/mp4`.
3. Logged out → toast “Please log in to download”.

## Auth / AI Chat verification

| Step | Expected |
|------|----------|
| Open `/create-video/ai-chat?projectId=...` while logged in | No “Network error: No response from server” |
| Network tab `profile` | Hits `localhost:9000` (or your `NEXT_PUBLIC_API_URL`), status 200 |

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9000/api/auth/profile
# 401 without token is OK (port reachable)
```

## Repair legacy projects (stringified assets)

```bash
curl -X POST "http://localhost:9004/api/video-projects/PROJECT_ID/repair-brand-metadata" \
  -H "Authorization: Bearer YOUR_JWT"
```

Then wait for `brandPackaging.status=ready` and re-export.

## Preview vs final

| Output | What you see |
|--------|----------------|
| **Workspace player** | Watermarked preview + 1s **UserGen** outro |
| **Download** | Clean final with **your logo** corner + brand 1s end card |

## Faster local packaging (optional)

In `video-processing-service/.env`, uncomment:

```
BRAND_END_CARD_BYTEPLUS_ENABLED=false
```

Restart `npm run dev` in `server/`. End cards use solid/gradient only (~seconds vs ~45s BytePlus).

## New projects

AI Chat now sends `metadata.assets` as an **array** (not JSON string). Logo → analysis → `logoBrand` → brand-packaging should run automatically.
