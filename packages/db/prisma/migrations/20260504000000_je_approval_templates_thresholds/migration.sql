-- JE approval workflow + recurring JE templates + tenant tunable thresholds.

-- 1. JE approval enum addition
ALTER TYPE "JournalEntryStatus" ADD VALUE 'PENDING_APPROVAL';

-- 2. JE approval columns
ALTER TABLE "journal_entries"
  ADD COLUMN "approvedById"    TEXT,
  ADD COLUMN "approvedAt"      TIMESTAMP(3),
  ADD COLUMN "rejectionReason" TEXT;

-- 3. Tenant — JE approval threshold + metrics threshold overrides
ALTER TABLE "tenants"
  ADD COLUMN "jeApprovalThreshold" DECIMAL(14,2) NOT NULL DEFAULT 50000,
  ADD COLUMN "metricsThresholds"   JSONB;

-- 4. Recurring/template JEs
CREATE TYPE "JournalTemplateFrequency" AS ENUM (
  'MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'
);

CREATE TABLE "journal_templates" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "lines"       JSONB NOT NULL,
  "frequency"   "JournalTemplateFrequency" NOT NULL DEFAULT 'MANUAL',
  "nextRunAt"   TIMESTAMP(3),
  "lastRunAt"   TIMESTAMP(3),
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "journal_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "journal_templates_tenantId_isActive_nextRunAt_idx"
  ON "journal_templates" ("tenantId", "isActive", "nextRunAt");
