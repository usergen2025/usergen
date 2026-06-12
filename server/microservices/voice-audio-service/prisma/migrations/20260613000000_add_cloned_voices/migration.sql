-- CreateTable
CREATE TABLE "ClonedVoice" (
    "id" TEXT NOT NULL,
    "elevenlabsId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClonedVoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClonedVoice_elevenlabsId_key" ON "ClonedVoice"("elevenlabsId");

-- CreateIndex
CREATE INDEX "ClonedVoice_userId_idx" ON "ClonedVoice"("userId");

-- CreateIndex
CREATE INDEX "ClonedVoice_elevenlabsId_idx" ON "ClonedVoice"("elevenlabsId");
