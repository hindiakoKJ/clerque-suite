-- Sprint 5: Kitchen Display System (KDS) — per-item prep status state machine.

DO $$ BEGIN
  CREATE TYPE "PrepStatus" AS ENUM ('PENDING', 'READY', 'SERVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "prepStatus" "PrepStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "readyAt"    TIMESTAMP(3);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "servedAt"   TIMESTAMP(3);
