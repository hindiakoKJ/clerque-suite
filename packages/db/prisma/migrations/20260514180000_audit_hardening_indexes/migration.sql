-- ──────────────────────────────────────────────────────────────────────────
-- 2026-05-14 — Sprint 13 audit hardening: missing hot-path indexes
--
-- Two indexes added to back queries that ran every login / token refresh:
--
--   user_sessions(userId, status)
--     auth.service.ts findMany({ where: { userId, status: 'ACTIVE' } })
--     ran on every refresh; previously only [userId] indexed, so all
--     historical sessions for a user were scanned + bcrypt-compared.
--
--   login_logs(userId, createdAt)
--     auth.service.ts lockout check counts recent failures for a user;
--     previously only [tenantId, createdAt] indexed, so the per-user
--     count did a non-indexed scan over the table.
--
-- Both are CREATE INDEX IF NOT EXISTS for idempotent re-deploy.
-- ──────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "user_sessions_userId_status_idx"
  ON "user_sessions" ("userId", "status");

CREATE INDEX IF NOT EXISTS "login_logs_userId_createdAt_idx"
  ON "login_logs" ("userId", "createdAt");
