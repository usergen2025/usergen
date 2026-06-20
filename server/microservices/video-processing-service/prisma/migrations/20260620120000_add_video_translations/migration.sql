-- AlterTable
ALTER TABLE "video_projects" ADD COLUMN IF NOT EXISTS "videoTranslations" JSONB;
