-- SecAudit 2026-05 A5 — distinguish owner self-approval from third-party
-- approval in the audit log. Tenant owners are allowed to approve their
-- own JEs (final authority), but BIR examiners need to see those
-- approvals tagged cleanly when they sample the journal.
ALTER TYPE "AuditAction" ADD VALUE 'SELF_APPROVAL';
