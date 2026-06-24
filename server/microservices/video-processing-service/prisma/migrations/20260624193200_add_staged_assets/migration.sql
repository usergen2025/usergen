-- CreateEnum
CREATE TYPE "StagedAssetStatus" AS ENUM ('STAGING', 'COMMITTED', 'ORPHANED', 'PURGED');

-- CreateTable
CREATE TABLE "staged_assets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientAssetId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "localPath" TEXT,
    "gcsPath" TEXT,
    "mimeType" TEXT,
    "assetType" TEXT NOT NULL DEFAULT 'image',
    "status" "StagedAssetStatus" NOT NULL DEFAULT 'STAGING',
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staged_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staged_assets_userId_projectId_status_idx" ON "staged_assets"("userId", "projectId", "status");

-- CreateIndex
CREATE INDEX "staged_assets_projectId_clientAssetId_idx" ON "staged_assets"("projectId", "clientAssetId");
