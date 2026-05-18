-- Campaign scrape cooldown
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "manualScrapeCooldownSec" INTEGER NOT NULL DEFAULT 21600;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "lastManualScrapeAt" TIMESTAMP(3);

-- Post submission scrape metadata
ALTER TABLE "CampaignPostSubmission" ADD COLUMN IF NOT EXISTS "ownerUsername" TEXT;
ALTER TABLE "CampaignPostSubmission" ADD COLUMN IF NOT EXISTS "postCreatedAt" TIMESTAMP(3);
ALTER TABLE "CampaignPostSubmission" ADD COLUMN IF NOT EXISTS "postPlatformId" TEXT;
ALTER TABLE "CampaignPostSubmission" ADD COLUMN IF NOT EXISTS "caption" TEXT;
ALTER TABLE "CampaignPostSubmission" ADD COLUMN IF NOT EXISTS "hashtags" JSONB;
ALTER TABLE "CampaignPostSubmission" ADD COLUMN IF NOT EXISTS "likesCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CampaignPostSubmission" ADD COLUMN IF NOT EXISTS "commentsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CampaignPostSubmission" ADD COLUMN IF NOT EXISTS "prelimCheckedAt" TIMESTAMP(3);
ALTER TABLE "CampaignPostSubmission" ADD COLUMN IF NOT EXISTS "prelimCheckPassed" BOOLEAN;
ALTER TABLE "CampaignPostSubmission" ADD COLUMN IF NOT EXISTS "lastScrapeRunId" TEXT;

CREATE TABLE IF NOT EXISTS "CampaignPostScrapeRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "triggeredById" TEXT,
    "status" TEXT NOT NULL,
    "apifyRunId" TEXT,
    "postsRequested" INTEGER NOT NULL DEFAULT 0,
    "postsScraped" INTEGER NOT NULL DEFAULT 0,
    "postsFailed" INTEGER NOT NULL DEFAULT 0,
    "postsDisqualified" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    CONSTRAINT "CampaignPostScrapeRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CampaignPostScrapeResult" (
    "id" TEXT NOT NULL,
    "scrapeRunId" TEXT NOT NULL,
    "postSubmissionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "apifyShortcode" TEXT,
    "apifyPostId" TEXT,
    "videoPlayCount" INTEGER,
    "videoViewCount" INTEGER,
    "likesCount" INTEGER,
    "commentsCount" INTEGER,
    "postTimestamp" TIMESTAMP(3),
    "ownerUsername" TEXT,
    "productType" TEXT,
    "rawJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignPostScrapeResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CampaignPostScrapeRun_campaignId_startedAt_idx" ON "CampaignPostScrapeRun"("campaignId", "startedAt");
CREATE INDEX IF NOT EXISTS "CampaignPostScrapeRun_status_startedAt_idx" ON "CampaignPostScrapeRun"("status", "startedAt");
CREATE INDEX IF NOT EXISTS "CampaignPostScrapeResult_scrapeRunId_idx" ON "CampaignPostScrapeResult"("scrapeRunId");
CREATE INDEX IF NOT EXISTS "CampaignPostScrapeResult_postSubmissionId_createdAt_idx" ON "CampaignPostScrapeResult"("postSubmissionId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "CampaignPostScrapeRun" ADD CONSTRAINT "CampaignPostScrapeRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CampaignPostScrapeResult" ADD CONSTRAINT "CampaignPostScrapeResult_scrapeRunId_fkey" FOREIGN KEY ("scrapeRunId") REFERENCES "CampaignPostScrapeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CampaignPostScrapeResult" ADD CONSTRAINT "CampaignPostScrapeResult_postSubmissionId_fkey" FOREIGN KEY ("postSubmissionId") REFERENCES "CampaignPostSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
