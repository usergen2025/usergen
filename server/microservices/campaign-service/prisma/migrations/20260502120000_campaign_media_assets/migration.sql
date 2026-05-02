-- CreateEnum
CREATE TYPE "CampaignMediaSourceType" AS ENUM ('PROJECT_LIBRARY', 'UPLOAD', 'EXTERNAL_URL');

-- CreateEnum
CREATE TYPE "CampaignMediaStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "CampaignMediaAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "campaignId" TEXT,
    "sourceType" "CampaignMediaSourceType" NOT NULL,
    "projectId" TEXT,
    "originalSourceUrl" TEXT,
    "originalLocalPath" TEXT,
    "originalGcsUrl" TEXT,
    "watermarkedLocalPath" TEXT,
    "watermarkedGcsUrl" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "status" "CampaignMediaStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignMediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignMediaAsset_ownerId_createdAt_idx" ON "CampaignMediaAsset"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignMediaAsset_campaignId_idx" ON "CampaignMediaAsset"("campaignId");

-- AddForeignKey
ALTER TABLE "CampaignMediaAsset" ADD CONSTRAINT "CampaignMediaAsset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "CampaignApplication" ADD COLUMN "draftMediaAssetId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CampaignApplication_draftMediaAssetId_key" ON "CampaignApplication"("draftMediaAssetId");

-- AddForeignKey
ALTER TABLE "CampaignApplication" ADD CONSTRAINT "CampaignApplication_draftMediaAssetId_fkey" FOREIGN KEY ("draftMediaAssetId") REFERENCES "CampaignMediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
