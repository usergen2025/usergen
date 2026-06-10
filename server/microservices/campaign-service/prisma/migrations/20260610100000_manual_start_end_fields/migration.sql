-- AlterTable
ALTER TABLE "Campaign"
ADD COLUMN "actualStartDate" TIMESTAMP(3),
ADD COLUMN "actualEndDate" TIMESTAMP(3),
ADD COLUMN "manuallyStartedBy" TEXT,
ADD COLUMN "manuallyEndedBy" TEXT;
