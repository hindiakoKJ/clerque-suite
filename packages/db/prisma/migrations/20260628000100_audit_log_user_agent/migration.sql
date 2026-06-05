-- SecAudit 2026-05 A4 (Medium) — capture user-agent on every AuditLog row.
--
-- Previously the AuditLog only captured ipAddress. NPC breach reports
-- (RA 10173 IRR §10.f) and BIR audit-trail forensics distinguish "owner
-- using their phone" from "leaked token replayed from a headless script"
-- via device fingerprint. Adding userAgent gives investigators that hook.

ALTER TABLE "audit_logs" ADD COLUMN "userAgent" TEXT;
