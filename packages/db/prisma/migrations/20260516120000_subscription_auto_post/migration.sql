-- ──────────────────────────────────────────────────────────────────────────
-- 2026-05-16 — PlatformConfig.subscriptionAutoPost toggle
--
-- When true, the customer-side APBill auto-posted by the subscription
-- billing service skips DRAFT and lands directly POSTED (JE flows to
-- DR 6280 Software Subscriptions + optional DR 1040 Input VAT / CR 2010
-- Accounts Payable). Default false — bills land in DRAFT for tenant
-- review.
--
-- Idempotent for prod's self-healing migration replay.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "platform_config"
  ADD COLUMN IF NOT EXISTS "subscriptionAutoPost" BOOLEAN NOT NULL DEFAULT false;
