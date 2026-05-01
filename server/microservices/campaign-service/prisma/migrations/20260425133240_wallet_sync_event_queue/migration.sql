-- CreateEnum
CREATE TYPE "WalletSyncStatus" AS ENUM ('RETRY_PENDING', 'FAILED', 'SYNCED');

-- CreateTable
CREATE TABLE "WalletSyncEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "WalletSyncStatus" NOT NULL DEFAULT 'RETRY_PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletSyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletSyncEvent_status_createdAt_idx" ON "WalletSyncEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WalletSyncEvent_eventType_idx" ON "WalletSyncEvent"("eventType");
