-- ──────────────────────────────────────────────────────────────────────────
-- 2026-05-17 — 2FA backup codes + pending-secret column
--
-- Adds two columns to `users`:
--   - twoFactorBackupCodes  TEXT[]   8 bcrypt-hashed single-use codes
--   - twoFactorPendingSecret TEXT?   un-confirmed enrollment secret
--
-- Idempotent — uses IF NOT EXISTS so prod's self-healing replay is safe.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "twoFactorBackupCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "twoFactorPendingSecret" TEXT;
