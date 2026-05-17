-- CreateEnum
CREATE TYPE "CampaignPayoutModel" AS ENUM ('CPM', 'POOL');

-- CreateEnum
CREATE TYPE "FinalizationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable: Campaign — add prize-pool fields and finalization tracking.
ALTER TABLE "Campaign"
  ADD COLUMN     "payoutModel" "CampaignPayoutModel" NOT NULL DEFAULT 'POOL',
  ADD COLUMN     "prizePoolJson" JSONB,
  ADD COLUMN     "tieBreaker" TEXT NOT NULL DEFAULT 'EARLIER_VERIFIED_POST',
  ADD COLUMN     "minViewsToQualify" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN     "gracePeriodHours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN     "previewN" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN     "finalizedAt" TIMESTAMP(3),
  ADD COLUMN     "finalizationStatus" "FinalizationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN     "finalizationError" TEXT,
  ADD COLUMN     "finalizationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN     "exceptionRefundAmountPaise" BIGINT;

-- Make payoutRate optional now that POOL campaigns may not set it.
ALTER TABLE "Campaign" ALTER COLUMN "payoutRate" DROP NOT NULL;

-- Existing campaigns retain CPM model and have a payoutRate set; mark them.
UPDATE "Campaign" SET "payoutModel" = 'CPM' WHERE "payoutRate" IS NOT NULL AND "createdAt" < NOW();

-- New indexes for finalization scans.
CREATE INDEX "Campaign_finalizationStatus_status_idx" ON "Campaign"("finalizationStatus", "status");
CREATE INDEX "Campaign_payoutModel_status_idx" ON "Campaign"("payoutModel", "status");

-- AlterTable: CampaignPostSubmission — current-views snapshot and disqualification fields.
ALTER TABLE "CampaignPostSubmission"
  ADD COLUMN "currentViews" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastViewsUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "disqualifiedAt" TIMESTAMP(3),
  ADD COLUMN "disqualifiedReason" TEXT;

-- Backfill currentViews from CreatorEarning.metadata->>'currentViews' if present.
UPDATE "CampaignPostSubmission" ps
SET "currentViews" = COALESCE((
  SELECT MAX(COALESCE(NULLIF(ce."metadata"->>'currentViews', '')::INT, 0))
  FROM "CreatorEarning" ce
  WHERE ce."postSubmissionId" = ps."id"
), 0);

CREATE INDEX "CampaignPostSubmission_campaignId_currentViews_idx" ON "CampaignPostSubmission"("campaignId", "currentViews");

-- CreateTable: CampaignPostViewUpdate.
CREATE TABLE "CampaignPostViewUpdate" (
  "id" TEXT NOT NULL,
  "postSubmissionId" TEXT NOT NULL,
  "previousViews" INTEGER NOT NULL,
  "newViews" INTEGER NOT NULL,
  "recordedBy" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  CONSTRAINT "CampaignPostViewUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CampaignPostViewUpdate_postSubmissionId_recordedAt_idx" ON "CampaignPostViewUpdate"("postSubmissionId", "recordedAt");

ALTER TABLE "CampaignPostViewUpdate"
  ADD CONSTRAINT "CampaignPostViewUpdate_postSubmissionId_fkey"
  FOREIGN KEY ("postSubmissionId") REFERENCES "CampaignPostSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: CampaignLeaderboardSnapshot.
CREATE TABLE "CampaignLeaderboardSnapshot" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "postSubmissionId" TEXT,
  "hadVerifiedPost" BOOLEAN NOT NULL,
  "rank" INTEGER,
  "views" INTEGER NOT NULL DEFAULT 0,
  "percentageBps" INTEGER NOT NULL DEFAULT 0,
  "payoutAmountPaise" BIGINT NOT NULL DEFAULT 0,
  "droppedReason" TEXT,
  "finalizationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignLeaderboardSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CampaignLeaderboardSnapshot_campaignId_rank_idx" ON "CampaignLeaderboardSnapshot"("campaignId", "rank");
CREATE INDEX "CampaignLeaderboardSnapshot_campaignId_creatorId_idx" ON "CampaignLeaderboardSnapshot"("campaignId", "creatorId");

ALTER TABLE "CampaignLeaderboardSnapshot"
  ADD CONSTRAINT "CampaignLeaderboardSnapshot_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: CreatorEarning — relax FK to support pool grants without a post submission link.
ALTER TABLE "CreatorEarning" ALTER COLUMN "cpmRate" DROP NOT NULL;
ALTER TABLE "CreatorEarning" ALTER COLUMN "postSubmissionId" DROP NOT NULL;
ALTER TABLE "CreatorEarning" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'CPM';

-- Drop and recreate FK to allow nullable + ON DELETE SET NULL.
ALTER TABLE "CreatorEarning" DROP CONSTRAINT IF EXISTS "CreatorEarning_postSubmissionId_fkey";
ALTER TABLE "CreatorEarning"
  ADD CONSTRAINT "CreatorEarning_postSubmissionId_fkey"
  FOREIGN KEY ("postSubmissionId") REFERENCES "CampaignPostSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
