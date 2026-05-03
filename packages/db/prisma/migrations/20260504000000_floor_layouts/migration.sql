-- Sprint 3 Phase A: Floor Layouts (Stations, Printers, Terminals)
-- Locked Coffee Shop tiers (CS_1..CS_5) with auto-provisioned station/printer/terminal records.

-- ── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "CoffeeShopTier" AS ENUM ('CS_1', 'CS_2', 'CS_3', 'CS_4', 'CS_5');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StationKind" AS ENUM ('COUNTER', 'BAR', 'KITCHEN', 'HOT_BAR', 'COLD_BAR', 'PASTRY_PASS');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PrinterInterface" AS ENUM ('NETWORK', 'BLUETOOTH_RAWBT', 'USB', 'BLUETOOTH_NATIVE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Tenant: layout fields ───────────────────────────────────────────────────

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "coffeeShopTier"     "CoffeeShopTier";
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "hasCustomerDisplay" BOOLEAN NOT NULL DEFAULT false;

-- ── Printers ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "printers" (
  "id"             TEXT             NOT NULL,
  "tenantId"       TEXT             NOT NULL,
  "branchId"       TEXT,
  "name"           TEXT             NOT NULL,
  "model"          TEXT,
  "interface"      "PrinterInterface" NOT NULL DEFAULT 'BLUETOOTH_RAWBT',
  "address"        TEXT,
  "paperWidthMm"   INTEGER          NOT NULL DEFAULT 80,
  "printsReceipts" BOOLEAN          NOT NULL DEFAULT true,
  "printsOrders"   BOOLEAN          NOT NULL DEFAULT false,
  "isActive"       BOOLEAN          NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "printers_pkey"           PRIMARY KEY ("id"),
  CONSTRAINT "printers_tenantId_fkey"  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "printers_tenantId_branchId_idx" ON "printers"("tenantId","branchId");

-- ── Stations ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "stations" (
  "id"          TEXT          NOT NULL,
  "tenantId"    TEXT          NOT NULL,
  "branchId"    TEXT,
  "kind"        "StationKind" NOT NULL,
  "name"        TEXT          NOT NULL,
  "sortOrder"   INTEGER       NOT NULL DEFAULT 0,
  "hasKds"      BOOLEAN       NOT NULL DEFAULT false,
  "hasPrinter"  BOOLEAN       NOT NULL DEFAULT false,
  "printerId"   TEXT,
  "isActive"    BOOLEAN       NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "stations_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "stations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "stations_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "printers"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "stations_tenantId_branchId_idx" ON "stations"("tenantId","branchId");
CREATE INDEX IF NOT EXISTS "stations_printerId_idx"         ON "stations"("printerId");

-- ── Terminals ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "terminals" (
  "id"          TEXT          NOT NULL,
  "tenantId"    TEXT          NOT NULL,
  "branchId"    TEXT,
  "name"        TEXT          NOT NULL,
  "code"        TEXT          NOT NULL,
  "isActive"    BOOLEAN       NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "terminals_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "terminals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "terminals_tenantId_code_key"    ON "terminals"("tenantId","code");
CREATE INDEX        IF NOT EXISTS "terminals_tenantId_branchId_idx" ON "terminals"("tenantId","branchId");

-- ── Category → Station relation ─────────────────────────────────────────────

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "stationId" TEXT;
DO $$ BEGIN
  ALTER TABLE "categories" ADD CONSTRAINT "categories_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "categories_stationId_idx" ON "categories"("stationId");

-- ── Shift → Terminal relation ───────────────────────────────────────────────

ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "terminalId" TEXT;
DO $$ BEGIN
  ALTER TABLE "shifts" ADD CONSTRAINT "shifts_terminalId_fkey"
    FOREIGN KEY ("terminalId") REFERENCES "terminals"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "shifts_terminalId_closedAt_idx" ON "shifts"("terminalId","closedAt");
