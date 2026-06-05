-- Security Audit 2026-05 — Critical A1 + High A2 remediations.

-- ─── A1 (Critical): JournalEntry.entryNumber unique per tenant ─────────
--
-- The journal.service.ts comment claimed this constraint existed — it did
-- not. NumberingService races could silently double-issue JE numbers.
-- This breaks BIR's gapless-numbering requirement (NIRC §237 + RR 16-2018).
--
-- Order.orderNumber already has this same constraint at journal_entries:1548;
-- this brings JournalEntry into parity.
--
-- Before applying the unique index, surface any existing duplicates so an
-- engineer can decide whether to renumber. The DO block fails fast if any
-- duplicates exist — surfacing the problem rather than silently failing
-- the migration with an opaque "duplicate key" error.
DO $$
DECLARE
  dup_count INTEGER;
  sample_dups TEXT;
BEGIN
  SELECT COUNT(*), STRING_AGG(DISTINCT tenant_id || ':' || entry_number, ', ' ORDER BY tenant_id || ':' || entry_number) FILTER (WHERE rn > 1)
  INTO dup_count, sample_dups
  FROM (
    SELECT
      "tenantId" AS tenant_id,
      "entryNumber" AS entry_number,
      ROW_NUMBER() OVER (PARTITION BY "tenantId", "entryNumber" ORDER BY "createdAt") AS rn
    FROM journal_entries
  ) ranked
  WHERE rn > 1;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'A1 backfill blocked: % duplicate (tenantId, entryNumber) pairs exist. Sample: %. Renumber the duplicates manually in a separate migration before applying this constraint.', dup_count, sample_dups;
  END IF;
END $$;

CREATE UNIQUE INDEX "journal_entries_tenantId_entryNumber_key"
  ON "journal_entries" ("tenantId", "entryNumber");


-- ─── A2 (High): audit_logs INSERT-only at the DB layer ─────────────────
--
-- AuditService exposes only log() / findAll() — no update or delete
-- methods, and grep across the repo confirms no auditLog.delete|update
-- calls anywhere in application code. The "INSERT-only" claim in the
-- service header is enforced ONLY by convention. Any compromised DB role,
-- direct psql session, Prisma Studio, or rogue migration could rewrite
-- history.
--
-- This trigger raises an exception on UPDATE or DELETE attempts against
-- audit_logs. It is the DB-layer enforcement that closes the gap.
--
-- Same protection applied to login_logs and console_logs which carry
-- comparable forensic value.
--
-- To intentionally archive audit rows (the audit-archive scheduler), use
-- a SECURITY DEFINER function or temporarily disable the trigger with
-- ALTER TABLE ... DISABLE TRIGGER — that is intentionally a friction step
-- that requires DB admin privilege.

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'SecAudit A2: % on % is forbidden — table is INSERT-only at the DB layer. If you genuinely need to archive rows, use the audit-archive scheduler or temporarily disable this trigger as a DB admin.',
    TG_OP, TG_TABLE_NAME;
END;
$$;

DO $$
BEGIN
  -- audit_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
    DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
    CREATE TRIGGER audit_logs_no_update
      BEFORE UPDATE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
    CREATE TRIGGER audit_logs_no_delete
      BEFORE DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
  END IF;

  -- login_logs (if present)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'login_logs') THEN
    DROP TRIGGER IF EXISTS login_logs_no_update ON login_logs;
    DROP TRIGGER IF EXISTS login_logs_no_delete ON login_logs;
    CREATE TRIGGER login_logs_no_update
      BEFORE UPDATE ON login_logs
      FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
    CREATE TRIGGER login_logs_no_delete
      BEFORE DELETE ON login_logs
      FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
  END IF;

  -- console_logs (if present)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'console_logs') THEN
    DROP TRIGGER IF EXISTS console_logs_no_update ON console_logs;
    DROP TRIGGER IF EXISTS console_logs_no_delete ON console_logs;
    CREATE TRIGGER console_logs_no_update
      BEFORE UPDATE ON console_logs
      FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
    CREATE TRIGGER console_logs_no_delete
      BEFORE DELETE ON console_logs
      FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
  END IF;
END $$;

-- Note: onDelete:Cascade from Tenant still wipes audit rows when a tenant
-- is hard-deleted. That is a Critical second issue (R2 / A2 follow-up):
-- changing the FK to Restrict requires a careful audit of admin.service.ts
-- tenant-delete paths and is intentionally NOT bundled here. Track as
-- a separate migration when the tenant lifecycle work lands.
