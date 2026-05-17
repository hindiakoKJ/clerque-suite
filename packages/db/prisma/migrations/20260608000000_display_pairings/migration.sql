-- Sprint 25 — Display pairing for customer-facing + KDS screens

CREATE TYPE "DisplayDeviceRole" AS ENUM (
  'CUSTOMER_DISPLAY',
  'KDS_KITCHEN',
  'KDS_BAR',
  'KDS_COLD_BAR',
  'KDS_HOT_BAR',
  'KDS_PASTRY_PASS',
  'KDS_GENERIC'
);

CREATE TABLE "display_pairings" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "stationId"   TEXT,
  "role"        "DisplayDeviceRole" NOT NULL,
  "label"       TEXT,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "redeemedAt"  TIMESTAMP(3),
  "deviceToken" TEXT,
  "lastSeenAt"  TIMESTAMP(3),
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "display_pairings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "display_pairings_tenantId_code_key" UNIQUE ("tenantId", "code"),
  CONSTRAINT "display_pairings_deviceToken_key" UNIQUE ("deviceToken"),
  CONSTRAINT "display_pairings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "display_pairings_tenantId_role_redeemedAt_idx"
  ON "display_pairings"("tenantId", "role", "redeemedAt");
CREATE INDEX "display_pairings_deviceToken_idx"
  ON "display_pairings"("deviceToken");
