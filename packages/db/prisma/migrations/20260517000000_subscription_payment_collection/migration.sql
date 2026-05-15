-- Sprint 24 — Manual subscription payment collection (pre-PayMongo)
-- ─────────────────────────────────────────────────────────────────
-- Customer-side: PendingPayment captures each unpaid subscription cycle
-- (new signup or monthly renewal). Customer submits proof of payment
-- (transaction ID + receipt screenshot) via the /pay/<refCode> page.
--
-- Owner-side: /admin/payments-pending lists pending payments. Owner verifies
-- the deposit in their personal Maya / BDO / Maribank account, issues a
-- paper BIR Official Receipt from the accredited booklet, enters the OR
-- number — system records it as an OfficialReceipt and links it.
--
-- ─── Enums ────────────────────────────────────────────────────────

CREATE TYPE "PendingPaymentStatus" AS ENUM (
  'AWAITING_PROOF',
  'PROOF_SUBMITTED',
  'CONFIRMED',
  'REJECTED',
  'EXPIRED'
);

CREATE TYPE "PendingPaymentReason" AS ENUM (
  'NEW_SIGNUP',
  'MONTHLY_RENEWAL',
  'PLAN_UPGRADE'
);

-- ─── PlatformConfig additions ─────────────────────────────────────

ALTER TABLE "platform_config" ADD COLUMN "paymentMethodsJson" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "platform_config" ADD COLUMN "lastOrNumber" TEXT;
ALTER TABLE "platform_config" ADD COLUMN "orNumberPadding" INTEGER NOT NULL DEFAULT 6;

-- ─── PendingPayment ───────────────────────────────────────────────

CREATE TABLE "pending_payments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "planCode" TEXT NOT NULL,
  "amountPhpCents" INTEGER NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "reason" "PendingPaymentReason" NOT NULL,
  "referenceCode" TEXT NOT NULL,
  "status" "PendingPaymentStatus" NOT NULL DEFAULT 'AWAITING_PROOF',
  "submittedAt" TIMESTAMP(3),
  "submittedProofUrl" TEXT,
  "submittedRefId" TEXT,
  "submittedNotes" TEXT,
  "submittedMethod" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmedById" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedById" TEXT,
  "rejectionReason" TEXT,
  "officialReceiptId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pending_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pending_payments_referenceCode_key" UNIQUE ("referenceCode"),
  CONSTRAINT "pending_payments_officialReceiptId_key" UNIQUE ("officialReceiptId"),
  CONSTRAINT "pending_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "pending_payments_status_expiresAt_idx" ON "pending_payments"("status", "expiresAt");
CREATE INDEX "pending_payments_tenantId_status_idx" ON "pending_payments"("tenantId", "status");

-- ─── OfficialReceipt ──────────────────────────────────────────────

CREATE TABLE "official_receipts" (
  "id" TEXT NOT NULL,
  "orNumber" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "issuedById" TEXT NOT NULL,
  "payerTenantId" TEXT,
  "payerName" TEXT NOT NULL,
  "payerTin" TEXT,
  "payerAddress" TEXT,
  "amountPhpCents" INTEGER NOT NULL,
  "taxStatus" TEXT NOT NULL,
  "vatAmountPhpCents" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT NOT NULL,
  "scannedCopyUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "official_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "official_receipts_orNumber_key" UNIQUE ("orNumber"),
  CONSTRAINT "official_receipts_payerTenantId_fkey" FOREIGN KEY ("payerTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL
);

CREATE INDEX "official_receipts_orNumber_idx" ON "official_receipts"("orNumber");
CREATE INDEX "official_receipts_issuedAt_idx" ON "official_receipts"("issuedAt");
CREATE INDEX "official_receipts_payerTenantId_idx" ON "official_receipts"("payerTenantId");

-- ─── FK from PendingPayment to OfficialReceipt ────────────────────

ALTER TABLE "pending_payments"
  ADD CONSTRAINT "pending_payments_officialReceiptId_fkey"
  FOREIGN KEY ("officialReceiptId") REFERENCES "official_receipts"("id") ON DELETE SET NULL;
