-- Phase 8-10: Documents, OR Sequences, Expense Claims
-- Uses IF NOT EXISTS throughout so this is safe to run against a DB
-- that was previously synced with prisma db push.

-- CreateEnum (safe no-op if already exists)
DO $$ BEGIN
  CREATE TYPE "ExpenseClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: password reset token fields
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "passwordResetToken"       TEXT,
  ADD COLUMN IF NOT EXISTS "passwordResetTokenExpiry" TIMESTAMP(3);

-- CreateTable: documents (polymorphic attachments)
CREATE TABLE IF NOT EXISTS "documents" (
    "id"           TEXT         NOT NULL,
    "tenantId"     TEXT         NOT NULL,
    "entityType"   TEXT         NOT NULL,
    "entityId"     TEXT         NOT NULL,
    "filename"     TEXT         NOT NULL,
    "mimeType"     TEXT         NOT NULL,
    "sizeBytes"    INTEGER      NOT NULL,
    "storagePath"  TEXT         NOT NULL,
    "label"        TEXT,
    "uploadedById" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: or_sequences (BIR Official Receipt counter per tenant)
CREATE TABLE IF NOT EXISTS "or_sequences" (
    "id"         TEXT         NOT NULL,
    "tenantId"   TEXT         NOT NULL,
    "prefix"     TEXT         NOT NULL DEFAULT 'OR',
    "lastNumber" INTEGER      NOT NULL DEFAULT 0,
    "padLength"  INTEGER      NOT NULL DEFAULT 8,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "or_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable: expense_claims
CREATE TABLE IF NOT EXISTS "expense_claims" (
    "id"            TEXT                 NOT NULL,
    "tenantId"      TEXT                 NOT NULL,
    "branchId"      TEXT,
    "claimNumber"   TEXT                 NOT NULL,
    "submittedById" TEXT                 NOT NULL,
    "title"         TEXT                 NOT NULL,
    "description"   TEXT,
    "totalAmount"   DECIMAL(14,2)        NOT NULL,
    "status"        "ExpenseClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt"   TIMESTAMP(3),
    "reviewedById"  TEXT,
    "reviewedAt"    TIMESTAMP(3),
    "reviewNotes"   TEXT,
    "paidAt"        TIMESTAMP(3),
    "paymentRef"    TEXT,
    "createdAt"     TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable: expense_claim_items
CREATE TABLE IF NOT EXISTS "expense_claim_items" (
    "id"          TEXT          NOT NULL,
    "claimId"     TEXT          NOT NULL,
    "category"    TEXT          NOT NULL,
    "description" TEXT          NOT NULL,
    "amount"      DECIMAL(14,2) NOT NULL,
    "receiptDate" TIMESTAMP(3)  NOT NULL,
    "receiptRef"  TEXT,
    "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_claim_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: expense_claim_sequences (per-tenant EC-YEAR-NNNNN counter)
CREATE TABLE IF NOT EXISTS "expense_claim_sequences" (
    "id"         TEXT         NOT NULL,
    "tenantId"   TEXT         NOT NULL,
    "lastNumber" INTEGER      NOT NULL DEFAULT 0,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claim_sequences_pkey" PRIMARY KEY ("id")
);

-- Indexes (IF NOT EXISTS so safe on existing schema)
CREATE INDEX  IF NOT EXISTS "documents_tenantId_entityType_entityId_idx" ON "documents"("tenantId", "entityType", "entityId");
CREATE INDEX  IF NOT EXISTS "documents_tenantId_createdAt_idx"           ON "documents"("tenantId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "or_sequences_tenantId_key"            ON "or_sequences"("tenantId");

CREATE INDEX  IF NOT EXISTS "expense_claims_tenantId_status_idx"         ON "expense_claims"("tenantId", "status");
CREATE INDEX  IF NOT EXISTS "expense_claims_tenantId_submittedById_idx"  ON "expense_claims"("tenantId", "submittedById");
CREATE UNIQUE INDEX IF NOT EXISTS "expense_claims_tenantId_claimNumber_key" ON "expense_claims"("tenantId", "claimNumber");

CREATE INDEX  IF NOT EXISTS "expense_claim_items_claimId_idx"            ON "expense_claim_items"("claimId");

CREATE UNIQUE INDEX IF NOT EXISTS "expense_claim_sequences_tenantId_key" ON "expense_claim_sequences"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "users_passwordResetToken_key"         ON "users"("passwordResetToken");

-- Foreign keys (safe — PostgreSQL ignores ADD CONSTRAINT if already named)
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "or_sequences" ADD CONSTRAINT "or_sequences_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "expense_claim_items" ADD CONSTRAINT "expense_claim_items_claimId_fkey"
    FOREIGN KEY ("claimId") REFERENCES "expense_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "expense_claim_sequences" ADD CONSTRAINT "expense_claim_sequences_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
