-- Align DB with schema.prisma: post-submission flow, creator earnings, application review fields.
-- Previous migrations stopped at WalletSyncEvent; models CampaignPostSubmission / CreatorEarning were never migrated.

-- AlterEnum: ApplicationStatus (was APPLIED, SUBMITTED, WITHDRAWN)
ALTER TYPE "ApplicationStatus" ADD VALUE 'APPROVED';
ALTER TYPE "ApplicationStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "CampaignApplication" ADD COLUMN     "draftMediaUrl" TEXT,
ADD COLUMN     "platform" TEXT,
ADD COLUMN     "termsAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewComment" TEXT;

-- CreateEnum
CREATE TYPE "PostSubmissionStatus" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('LOCKED', 'AVAILABLE', 'REVERSED');

-- CreateTable
CREATE TABLE "CampaignPostSubmission" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "applicationId" TEXT,
    "postUrl" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" "PostSubmissionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPostSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorEarning" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "postSubmissionId" TEXT NOT NULL,
    "viewsDelta" INTEGER NOT NULL DEFAULT 0,
    "cpmRate" DECIMAL(65,30) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'LOCKED',
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockAt" TIMESTAMP(3) NOT NULL,
    "availableAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "lockReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorEarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignPostSubmission_campaignId_creatorId_idx" ON "CampaignPostSubmission"("campaignId", "creatorId");

-- CreateIndex
CREATE INDEX "CampaignPostSubmission_status_createdAt_idx" ON "CampaignPostSubmission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CreatorEarning_creatorId_status_unlockAt_idx" ON "CreatorEarning"("creatorId", "status", "unlockAt");

-- CreateIndex
CREATE INDEX "CreatorEarning_campaignId_createdAt_idx" ON "CreatorEarning"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "CampaignPostSubmission" ADD CONSTRAINT "CampaignPostSubmission_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPostSubmission" ADD CONSTRAINT "CampaignPostSubmission_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CampaignApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorEarning" ADD CONSTRAINT "CreatorEarning_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorEarning" ADD CONSTRAINT "CreatorEarning_postSubmissionId_fkey" FOREIGN KEY ("postSubmissionId") REFERENCES "CampaignPostSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
