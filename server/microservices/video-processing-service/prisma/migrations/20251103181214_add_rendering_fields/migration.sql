-- AlterTable
ALTER TABLE "video_projects" ADD COLUMN     "avatarVideos" JSONB,
ADD COLUMN     "bRollImages" JSONB,
ADD COLUMN     "bRollVideoTasks" JSONB,
ADD COLUMN     "renderingProgress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "renderingStatus" TEXT,
ADD COLUMN     "sceneVideos" JSONB;
