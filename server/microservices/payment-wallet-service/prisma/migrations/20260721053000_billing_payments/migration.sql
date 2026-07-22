-- CreateEnum
CREATE TYPE "BillingAudience" AS ENUM ('CREATOR', 'BRAND');
CREATE TYPE "FeeType" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "ProductType" AS ENUM ('CREDIT_TOPUP', 'SUBSCRIPTION', 'ADDON');
CREATE TYPE "PurchaseSource" AS ENUM ('PACKAGE', 'CUSTOM', 'ADMIN_LINK');
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PAID', 'FULFILLED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'STRIPE', 'MANUAL');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "billing_settings" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "creditRateBps" INTEGER NOT NULL DEFAULT 10000,
    "creatorFeeBps" INTEGER NOT NULL DEFAULT 500,
    "brandFeeBps" INTEGER NOT NULL DEFAULT 1000,
    "feeType" "FeeType" NOT NULL DEFAULT 'PERCENT',
    "minTopUpPaise" INTEGER NOT NULL DEFAULT 10000,
    "maxTopUpPaise" INTEGER NOT NULL DEFAULT 100000000,
    "gstEnabled" BOOLEAN NOT NULL DEFAULT true,
    "gstRateBps" INTEGER NOT NULL DEFAULT 1800,
    "platformGstin" TEXT,
    "platformLegalName" TEXT,
    "platformAddress" TEXT,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'UG',
    "invoiceNextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_billing_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feeBps" INTEGER,
    "feeType" "FeeType",
    "feeFixedPaise" INTEGER,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_billing_overrides_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_packages" (
    "id" TEXT NOT NULL,
    "audience" "BillingAudience" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "creditsToGrant" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "badge" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "credit_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "claimToken" TEXT,
    "audience" "BillingAudience" NOT NULL,
    "productType" "ProductType" NOT NULL DEFAULT 'CREDIT_TOPUP',
    "source" "PurchaseSource" NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "packageId" TEXT,
    "baseAmountPaise" INTEGER NOT NULL,
    "feeAmountPaise" INTEGER NOT NULL,
    "feeBpsApplied" INTEGER NOT NULL,
    "feeTypeApplied" "FeeType" NOT NULL,
    "discountAmountPaise" INTEGER NOT NULL DEFAULT 0,
    "gstAmountPaise" INTEGER NOT NULL DEFAULT 0,
    "gstRateBpsApplied" INTEGER NOT NULL DEFAULT 0,
    "totalChargePaise" INTEGER NOT NULL,
    "creditsToGrant" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "creditRateBps" INTEGER NOT NULL DEFAULT 10000,
    "quoteSnapshot" JSONB NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "expiresAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_link_records" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "providerLinkId" TEXT NOT NULL,
    "shortUrl" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerName" TEXT,
    "expireBy" TIMESTAMP(3),
    "createdByAdminId" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_link_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "userId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "baseAmountPaise" INTEGER NOT NULL,
    "feeAmountPaise" INTEGER NOT NULL,
    "discountAmountPaise" INTEGER NOT NULL DEFAULT 0,
    "gstAmountPaise" INTEGER NOT NULL,
    "gstRateBps" INTEGER NOT NULL,
    "totalChargePaise" INTEGER NOT NULL,
    "creditsGranted" INTEGER NOT NULL,
    "platformGstin" TEXT,
    "buyerGstin" TEXT,
    "platformLegalName" TEXT,
    "lineItems" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refund_records" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerRefundId" TEXT,
    "providerPaymentId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "creditsToClawBack" INTEGER NOT NULL,
    "creditsClawedBack" INTEGER NOT NULL DEFAULT 0,
    "shortfallCredits" INTEGER NOT NULL DEFAULT 0,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "adminUserId" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discount_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "audience" "BillingAudience",
    "maxRedemptions" INTEGER,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discount_redemptions" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payout_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "providerContactId" TEXT,
    "providerFundAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);

-- Indexes & uniques
CREATE UNIQUE INDEX "user_billing_overrides_userId_key" ON "user_billing_overrides"("userId");
CREATE INDEX "user_billing_overrides_userId_idx" ON "user_billing_overrides"("userId");
CREATE INDEX "credit_packages_audience_isActive_idx" ON "credit_packages"("audience", "isActive");
CREATE INDEX "credit_packages_sortOrder_idx" ON "credit_packages"("sortOrder");
CREATE UNIQUE INDEX "purchase_orders_claimToken_key" ON "purchase_orders"("claimToken");
CREATE INDEX "purchase_orders_userId_idx" ON "purchase_orders"("userId");
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");
CREATE INDEX "purchase_orders_createdAt_idx" ON "purchase_orders"("createdAt");
CREATE INDEX "purchase_orders_packageId_idx" ON "purchase_orders"("packageId");
CREATE UNIQUE INDEX "payment_attempts_providerPaymentId_key" ON "payment_attempts"("providerPaymentId");
CREATE INDEX "payment_attempts_purchaseOrderId_idx" ON "payment_attempts"("purchaseOrderId");
CREATE INDEX "payment_attempts_providerOrderId_idx" ON "payment_attempts"("providerOrderId");
CREATE INDEX "payment_attempts_status_idx" ON "payment_attempts"("status");
CREATE UNIQUE INDEX "payment_link_records_providerLinkId_key" ON "payment_link_records"("providerLinkId");
CREATE UNIQUE INDEX "payment_link_records_referenceId_key" ON "payment_link_records"("referenceId");
CREATE INDEX "payment_link_records_purchaseOrderId_idx" ON "payment_link_records"("purchaseOrderId");
CREATE INDEX "payment_link_records_createdByAdminId_idx" ON "payment_link_records"("createdByAdminId");
CREATE UNIQUE INDEX "webhook_events_provider_providerEventId_key" ON "webhook_events"("provider", "providerEventId");
CREATE INDEX "webhook_events_eventType_idx" ON "webhook_events"("eventType");
CREATE INDEX "webhook_events_createdAt_idx" ON "webhook_events"("createdAt");
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");
CREATE INDEX "invoices_purchaseOrderId_idx" ON "invoices"("purchaseOrderId");
CREATE INDEX "invoices_userId_idx" ON "invoices"("userId");
CREATE INDEX "invoices_issuedAt_idx" ON "invoices"("issuedAt");
CREATE UNIQUE INDEX "refund_records_providerRefundId_key" ON "refund_records"("providerRefundId");
CREATE INDEX "refund_records_purchaseOrderId_idx" ON "refund_records"("purchaseOrderId");
CREATE INDEX "refund_records_status_idx" ON "refund_records"("status");
CREATE INDEX "refund_records_adminUserId_idx" ON "refund_records"("adminUserId");
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");
CREATE INDEX "discount_codes_isActive_idx" ON "discount_codes"("isActive");
CREATE INDEX "discount_redemptions_discountCodeId_idx" ON "discount_redemptions"("discountCodeId");
CREATE INDEX "discount_redemptions_userId_idx" ON "discount_redemptions"("userId");
CREATE UNIQUE INDEX "payout_accounts_userId_key" ON "payout_accounts"("userId");
CREATE INDEX "payout_accounts_userId_idx" ON "payout_accounts"("userId");

-- ForeignKeys
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "credit_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_link_records" ADD CONSTRAINT "payment_link_records_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
