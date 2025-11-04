-- CreateEnum
CREATE TYPE "AvatarSource" AS ENUM ('LIBRARY', 'UPLOAD', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "AvatarCategory" AS ENUM ('PROFESSIONAL', 'CASUAL', 'MODERN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('UPLOAD_IMAGE', 'CREATE_GROUP', 'TRAIN', 'GENERATE_LOOKS', 'ADD_MOTION');

-- CreateTable
CREATE TABLE "avatars" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" "AvatarSource" NOT NULL DEFAULT 'UPLOAD',
    "provider" TEXT,
    "providerAvatarId" TEXT,
    "providerGroupId" TEXT,
    "thumbnailUrl" TEXT,
    "avatarUrl" TEXT,
    "originalImageUrl" TEXT,
    "imageKey" TEXT,
    "category" "AvatarCategory",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "generationStatus" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "generationError" TEXT,
    "creditsSpent" INTEGER NOT NULL DEFAULT 0,
    "generationMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatar_generation_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "avatarId" TEXT,
    "provider" TEXT NOT NULL,
    "providerJobId" TEXT,
    "jobType" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "imageUrl" TEXT,
    "imageKey" TEXT,
    "groupId" TEXT,
    "avatarIdResult" TEXT,
    "metadata" JSONB,
    "resultData" JSONB,
    "errorMessage" TEXT,
    "creditsSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "avatar_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_avatars" (
    "id" TEXT NOT NULL,
    "provider" TEXT,
    "providerAvatarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "AvatarCategory" NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_avatars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avatars_userId_idx" ON "avatars"("userId");

-- CreateIndex
CREATE INDEX "avatars_source_idx" ON "avatars"("source");

-- CreateIndex
CREATE INDEX "avatars_provider_idx" ON "avatars"("provider");

-- CreateIndex
CREATE INDEX "avatars_isPublic_idx" ON "avatars"("isPublic");

-- CreateIndex
CREATE INDEX "avatars_category_idx" ON "avatars"("category");

-- CreateIndex
CREATE INDEX "avatars_generationStatus_idx" ON "avatars"("generationStatus");

-- CreateIndex
CREATE INDEX "avatar_generation_jobs_userId_idx" ON "avatar_generation_jobs"("userId");

-- CreateIndex
CREATE INDEX "avatar_generation_jobs_provider_idx" ON "avatar_generation_jobs"("provider");

-- CreateIndex
CREATE INDEX "avatar_generation_jobs_status_idx" ON "avatar_generation_jobs"("status");

-- CreateIndex
CREATE INDEX "avatar_generation_jobs_jobType_idx" ON "avatar_generation_jobs"("jobType");

-- CreateIndex
CREATE INDEX "public_avatars_category_idx" ON "public_avatars"("category");

-- CreateIndex
CREATE INDEX "public_avatars_isActive_idx" ON "public_avatars"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "public_avatars_provider_providerAvatarId_key" ON "public_avatars"("provider", "providerAvatarId");

-- AddForeignKey
ALTER TABLE "avatar_generation_jobs" ADD CONSTRAINT "avatar_generation_jobs_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "avatars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
