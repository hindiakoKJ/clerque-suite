-- Sprint 19 — Per-tenant policy: allow staff to clock in/out from their
-- own Sync account, or restrict to the shared kiosk tablet only.
--
-- Default false: kiosk-only is the safer starting point. The shop owner
-- explicitly opts staff in to self-service clocking.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "allowSelfClockIn" BOOLEAN NOT NULL DEFAULT false;
