-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('EARNED', 'SPENT', 'PURCHASED', 'REFUNDED', 'TRANSFER');

-- CreateEnum
CREATE TYPE "ContextType" AS ENUM ('INDIVIDUAL', 'TEAM');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('USER', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('SCRIPT_GENERATION', 'SCENE_REGENERATION', 'AUDIO_GENERATION', 'IMAGE_GENERATION', 'VIDEO_GENERATION', 'AVATAR_VIDEO', 'STOCK_FOOTAGE', 'FINAL_RENDER', 'WATERMARK_REMOVAL');

-- CreateTable
CREATE TABLE "user_credits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_credits" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "contextType" "ContextType" NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "actorUserId" TEXT,
    "activityName" TEXT,
    "resourceId" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "change" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_pricing" (
    "id" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "creditCost" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "operation_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_history" (
    "id" TEXT NOT NULL,
    "operationPricingId" TEXT NOT NULL,
    "previousCost" INTEGER NOT NULL,
    "newCost" INTEGER NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_cost_snapshots" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sceneNumber" INTEGER,
    "operationType" TEXT NOT NULL,
    "operationName" TEXT NOT NULL,
    "creditCost" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_cost_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_credits_userId_key" ON "user_credits"("userId");

-- CreateIndex
CREATE INDEX "user_credits_userId_idx" ON "user_credits"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_credits_workspaceId_key" ON "workspace_credits"("workspaceId");

-- CreateIndex
CREATE INDEX "workspace_credits_workspaceId_idx" ON "workspace_credits"("workspaceId");

-- CreateIndex
CREATE INDEX "transactions_userId_idx" ON "transactions"("userId");

-- CreateIndex
CREATE INDEX "transactions_workspaceId_idx" ON "transactions"("workspaceId");

-- CreateIndex
CREATE INDEX "transactions_actorUserId_idx" ON "transactions"("actorUserId");

-- CreateIndex
CREATE INDEX "transactions_contextType_idx" ON "transactions"("contextType");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- CreateIndex
CREATE INDEX "credit_ledger_entityType_entityId_idx" ON "credit_ledger"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "credit_ledger_transactionId_idx" ON "credit_ledger"("transactionId");

-- CreateIndex
CREATE INDEX "credit_ledger_createdAt_idx" ON "credit_ledger"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "operation_pricing_operationType_key" ON "operation_pricing"("operationType");

-- CreateIndex
CREATE INDEX "operation_pricing_operationType_idx" ON "operation_pricing"("operationType");

-- CreateIndex
CREATE INDEX "operation_pricing_isActive_idx" ON "operation_pricing"("isActive");

-- CreateIndex
CREATE INDEX "pricing_history_operationPricingId_idx" ON "pricing_history"("operationPricingId");

-- CreateIndex
CREATE INDEX "pricing_history_createdAt_idx" ON "pricing_history"("createdAt");

-- CreateIndex
CREATE INDEX "generation_cost_snapshots_projectId_idx" ON "generation_cost_snapshots"("projectId");

-- CreateIndex
CREATE INDEX "generation_cost_snapshots_userId_idx" ON "generation_cost_snapshots"("userId");

-- CreateIndex
CREATE INDEX "generation_cost_snapshots_operationType_idx" ON "generation_cost_snapshots"("operationType");

-- CreateIndex
CREATE INDEX "generation_cost_snapshots_createdAt_idx" ON "generation_cost_snapshots"("createdAt");

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_history" ADD CONSTRAINT "pricing_history_operationPricingId_fkey" FOREIGN KEY ("operationPricingId") REFERENCES "operation_pricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
