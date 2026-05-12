-- Sprint 21 — D5-06: Idempotency-Key replay protection for financial mutations.
-- Stores user-supplied keys + cached responses for 24h so a double-clicked
-- payment/order POST returns the original response instead of double-posting.

CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseBody" TEXT NOT NULL,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_keys_tenantId_key_endpoint_key"
    ON "idempotency_keys"("tenantId", "key", "endpoint");

CREATE INDEX "idempotency_keys_tenantId_expiresAt_idx"
    ON "idempotency_keys"("tenantId", "expiresAt");

ALTER TABLE "idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
