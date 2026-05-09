-- Sprint 19 — Pre-destructive backup snapshots for tenant data wipes.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "tenant_data_snapshots" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "reason"       TEXT NOT NULL,
  "takenById"    TEXT,
  "takenByEmail" TEXT,
  "rowCount"     INTEGER NOT NULL DEFAULT 0,
  "payload"      JSONB NOT NULL DEFAULT '{}'::jsonb,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_data_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tenant_data_snapshots_tenantId_createdAt_idx"
  ON "tenant_data_snapshots" ("tenantId", "createdAt");
