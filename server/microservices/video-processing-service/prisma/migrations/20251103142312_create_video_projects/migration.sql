-- CreateEnum
CREATE TYPE "VideoType" AS ENUM ('WITH_AVATAR', 'WITHOUT_AVATAR');

-- CreateEnum
CREATE TYPE "VideoStyle" AS ENUM ('HALF_N_HALF', 'ALTERNATE', 'AVATAR_CUTOUT');

-- CreateEnum
CREATE TYPE "VoiceType" AS ENUM ('CLONED', 'SYNTHETIC', 'PRESET');

-- CreateEnum
CREATE TYPE "BRollSource" AS ENUM ('SKIP', 'AI_GENERATED', 'UPLOAD', 'STOCK');

-- CreateEnum
CREATE TYPE "VideoProjectStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VideoCreationStep" AS ENUM ('STYLE_SELECTION', 'VIDEO_TYPE', 'AVATAR_SELECTION', 'SCRIPT', 'VOICE', 'B_ROLL', 'CAPTIONS', 'RENDERING', 'COMPLETED');

-- CreateTable
CREATE TABLE "video_projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "title" TEXT,
    "description" TEXT,
    "videoType" "VideoType" NOT NULL,
    "style" "VideoStyle",
    "avatarId" TEXT,
    "avatarName" TEXT,
    "avatarUrl" TEXT,
    "script" TEXT,
    "scriptGenerated" BOOLEAN NOT NULL DEFAULT false,
    "voiceId" TEXT,
    "voiceType" "VoiceType",
    "clonedVoiceId" TEXT,
    "voiceSettings" JSONB,
    "bRollSource" "BRollSource",
    "bRollVideos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bRollPrompt" TEXT,
    "captionSettings" JSONB,
    "captionsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "VideoProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStep" "VideoCreationStep" NOT NULL DEFAULT 'STYLE_SELECTION',
    "providerJobId" TEXT,
    "providerType" TEXT,
    "videoUrl" TEXT,
    "thumbnailUrl" TEXT,
    "duration" INTEGER,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressStage" TEXT,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "creditsSpent" INTEGER NOT NULL DEFAULT 0,
    "configurationHistory" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),

    CONSTRAINT "video_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_projects_userId_idx" ON "video_projects"("userId");

-- CreateIndex
CREATE INDEX "video_projects_workspaceId_idx" ON "video_projects"("workspaceId");

-- CreateIndex
CREATE INDEX "video_projects_status_idx" ON "video_projects"("status");

-- CreateIndex
CREATE INDEX "video_projects_videoType_idx" ON "video_projects"("videoType");

-- CreateIndex
CREATE INDEX "video_projects_currentStep_idx" ON "video_projects"("currentStep");

-- CreateIndex
CREATE INDEX "video_projects_createdAt_idx" ON "video_projects"("createdAt");
