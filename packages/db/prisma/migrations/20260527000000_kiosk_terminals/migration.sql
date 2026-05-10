-- Sprint 19 — Sync kiosk-mode terminals.
-- A shared on-site tablet that staff use to clock in/out via their PIN.
-- The terminal itself authenticates with a long-lived apiKey; the cashier
-- is identified per-punch by User.kioskPin. PIN brute-force is throttled
-- with failedAttempts + lockedUntil.

CREATE TABLE IF NOT EXISTS "kiosk_terminals" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "branchId"       TEXT,
  "name"           TEXT NOT NULL,
  "apiKey"         TEXT NOT NULL,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "lastUsedAt"     TIMESTAMP(3),
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "kiosk_terminals_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "kiosk_terminals_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_terminals_apiKey_key"   ON "kiosk_terminals" ("apiKey");
CREATE        INDEX IF NOT EXISTS "kiosk_terminals_tenant_idx"  ON "kiosk_terminals" ("tenantId", "isActive");
