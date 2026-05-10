-- Sprint 19 — Customizable receipt template fields on Tenant.
-- Owner edits these from Settings → Receipt template.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "receiptHeaderNote" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptFooterNote" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptLogoUrl"    TEXT;
