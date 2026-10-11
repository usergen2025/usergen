-- Run against the video-processing Postgres DB (not bash).
-- Example:
--   set -a && source microservices/video-processing-service/.env && set +a
--   psql "$DATABASE_URL" -f server/scripts/audit-gcs-coverage.sql
-- Or if DATABASE_URL uses a different var:
--   psql "$DATABASE_URL_VIDEO" -f server/scripts/audit-gcs-coverage.sql

-- Finals that are local-only (will break playback if VM uploads are wiped)
SELECT id, status, "videoUrl"
FROM video_projects
WHERE "videoUrl" IS NOT NULL
  AND "videoUrl" NOT LIKE 'https://storage.googleapis.com/%';

-- Audio missing gcsUrl (re-export may break after wipe unless STORAGE_PRIORITY=gcs can fetch publicUrl)
SELECT id,
  (SELECT count(*) FROM jsonb_array_elements(COALESCE("audioFiles", '[]'::jsonb)) e
   WHERE coalesce(e->>'gcsUrl','') = '') AS audio_missing_gcs
FROM video_projects
WHERE "audioFiles" IS NOT NULL;

-- B-roll tasks missing gcsUrl
SELECT id,
  (SELECT count(*) FROM jsonb_array_elements(COALESCE("bRollVideoTasks", '[]'::jsonb)) e
   WHERE coalesce(e->>'gcsUrl','') = '') AS broll_missing_gcs
FROM video_projects
WHERE "bRollVideoTasks" IS NOT NULL;

-- Avatar clips missing gcsUrl (often local-only before this change)
SELECT id,
  (SELECT count(*) FROM jsonb_array_elements(COALESCE("avatarVideos", '[]'::jsonb)) e
   WHERE coalesce(e->>'gcsUrl','') = '') AS avatar_missing_gcs
FROM video_projects
WHERE "avatarVideos" IS NOT NULL;
