-- Sprint 19 — Laundry wash cycles + auto-complete timer.
-- Idempotent: safe to re-run.

-- ─── New table: laundry_wash_cycles ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "laundry_wash_cycles" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "kind"            "LaundryMachineKind" NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "autoComplete"    BOOLEAN NOT NULL DEFAULT false,
  "surcharge"       DECIMAL(10, 2),
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "laundry_wash_cycles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "laundry_wash_cycles_tenantId_kind_isActive_idx"
  ON "laundry_wash_cycles" ("tenantId", "kind", "isActive");

DO $$ BEGIN
  ALTER TABLE "laundry_wash_cycles"
    ADD CONSTRAINT "laundry_wash_cycles_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Extend laundry_order_lines with cycle tracking columns ────────────────
ALTER TABLE "laundry_order_lines"
  ADD COLUMN IF NOT EXISTS "cycleId"           TEXT,
  ADD COLUMN IF NOT EXISTS "cycleEndsAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cycleAutoComplete" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "laundry_order_lines"
    ADD CONSTRAINT "laundry_order_lines_cycleId_fkey"
    FOREIGN KEY ("cycleId") REFERENCES "laundry_wash_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "laundry_order_lines_cron_scan_idx"
  ON "laundry_order_lines" ("cycleEndsAt", "machineStatus", "cycleAutoComplete");
