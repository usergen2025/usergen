-- AlterTable
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "providerInvoiceId" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "providerInvoiceNumber" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "providerInvoiceUrl" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "providerInvoiceStatus" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "providerPayload" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_providerInvoiceId_key" ON "invoices"("providerInvoiceId");
