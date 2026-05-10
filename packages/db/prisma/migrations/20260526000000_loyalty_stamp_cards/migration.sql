-- Sprint 19 — Loyalty stamp cards (digital + printable).

DO $$ BEGIN
  CREATE TYPE "StampAccrualBasis" AS ENUM ('PER_ORDER', 'PER_AMOUNT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StampEventKind" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'ADJUST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "stamp_card_templates" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "rewardLabel"      TEXT NOT NULL,
  "requiredStamps"   INTEGER NOT NULL,
  "accrualBasis"     "StampAccrualBasis" NOT NULL DEFAULT 'PER_ORDER',
  "accrualThreshold" DECIMAL(10, 2),
  "minOrderTotal"    DECIMAL(10, 2),
  "expiryDays"       INTEGER,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stamp_card_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "stamp_card_templates_tenantId_isActive_idx"
  ON "stamp_card_templates" ("tenantId", "isActive");
DO $$ BEGIN
  ALTER TABLE "stamp_card_templates"
    ADD CONSTRAINT "stamp_card_templates_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "customer_stamp_cards" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "customerId"     TEXT NOT NULL,
  "templateId"     TEXT NOT NULL,
  "stamps"         INTEGER NOT NULL DEFAULT 0,
  "lifetimeStamps" INTEGER NOT NULL DEFAULT 0,
  "redemptionCount" INTEGER NOT NULL DEFAULT 0,
  "publicToken"    TEXT NOT NULL,
  "lastEarnedAt"   TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_stamp_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_stamp_cards_publicToken_key"
  ON "customer_stamp_cards" ("publicToken");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_stamp_cards_customerId_templateId_key"
  ON "customer_stamp_cards" ("customerId", "templateId");
CREATE INDEX IF NOT EXISTS "customer_stamp_cards_tenantId_customerId_idx"
  ON "customer_stamp_cards" ("tenantId", "customerId");
DO $$ BEGIN
  ALTER TABLE "customer_stamp_cards"
    ADD CONSTRAINT "customer_stamp_cards_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "customer_stamp_cards"
    ADD CONSTRAINT "customer_stamp_cards_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "customer_stamp_cards"
    ADD CONSTRAINT "customer_stamp_cards_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "stamp_card_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "stamp_card_events" (
  "id"          TEXT NOT NULL,
  "cardId"      TEXT NOT NULL,
  "kind"        "StampEventKind" NOT NULL,
  "delta"       INTEGER NOT NULL,
  "stampsAfter" INTEGER NOT NULL,
  "orderId"     TEXT,
  "note"        TEXT,
  "performedBy" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stamp_card_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "stamp_card_events_cardId_createdAt_idx"
  ON "stamp_card_events" ("cardId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "stamp_card_events"
    ADD CONSTRAINT "stamp_card_events_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "customer_stamp_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
