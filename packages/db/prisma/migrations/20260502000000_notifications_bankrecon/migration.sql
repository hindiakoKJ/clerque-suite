-- In-app notifications + Bank Reconciliation models.

-- Enums
CREATE TYPE "NotificationKind" AS ENUM ('INFO', 'WARNING', 'ERROR', 'SUCCESS');
CREATE TYPE "BankReconciliationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- Notifications
CREATE TABLE "notifications" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "userId"    TEXT,
  "kind"      "NotificationKind" NOT NULL DEFAULT 'INFO',
  "title"     TEXT NOT NULL,
  "body"      TEXT,
  "link"      TEXT,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "notifications_userId_fkey"   FOREIGN KEY ("userId")   REFERENCES "users"("id")   ON DELETE CASCADE
);
CREATE INDEX "notifications_tenantId_userId_readAt_idx"  ON "notifications" ("tenantId", "userId", "readAt");
CREATE INDEX "notifications_tenantId_createdAt_idx"      ON "notifications" ("tenantId", "createdAt");

-- Bank reconciliations (header)
CREATE TABLE "bank_reconciliations" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "accountId"     TEXT NOT NULL,
  "periodStart"   TIMESTAMP(3) NOT NULL,
  "periodEnd"     TIMESTAMP(3) NOT NULL,
  "bankBalance"   DECIMAL(14,2) NOT NULL,
  "glBalance"     DECIMAL(14,2) NOT NULL,
  "matchedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "notes"         TEXT,
  "status"        "BankReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "preparedById"  TEXT NOT NULL,
  "completedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_reconciliations_tenantId_fkey"     FOREIGN KEY ("tenantId")     REFERENCES "tenants"("id")  ON DELETE CASCADE,
  CONSTRAINT "bank_reconciliations_accountId_fkey"    FOREIGN KEY ("accountId")    REFERENCES "accounts"("id"),
  CONSTRAINT "bank_reconciliations_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "users"("id")
);
CREATE INDEX "bank_reconciliations_tenantId_accountId_periodEnd_idx"
  ON "bank_reconciliations" ("tenantId", "accountId", "periodEnd");

-- Bank reconciliation items (statement lines, JE lines, matches)
CREATE TABLE "bank_reconciliation_items" (
  "id"               TEXT NOT NULL,
  "reconciliationId" TEXT NOT NULL,
  "itemType"         TEXT NOT NULL,
  "statementDate"    TIMESTAMP(3),
  "statementDesc"    TEXT,
  "statementAmount"  DECIMAL(14,2),
  "journalLineId"    TEXT,
  "isMatched"        BOOLEAN NOT NULL DEFAULT false,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bank_reconciliation_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_reconciliation_items_reconciliationId_fkey"
    FOREIGN KEY ("reconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE CASCADE
);
CREATE INDEX "bank_reconciliation_items_reconciliationId_isMatched_idx"
  ON "bank_reconciliation_items" ("reconciliationId", "isMatched");
