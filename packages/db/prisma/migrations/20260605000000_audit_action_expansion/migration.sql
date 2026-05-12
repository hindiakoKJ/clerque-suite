-- Audit D3-07 + D10-D — expand AuditAction enum
--
-- New values cover sensitive mutations that previously captured the actor
-- only on per-row columns (postedBy, createdBy) without an immutable
-- AuditLog row. One ALTER per value because Postgres < 12 disallows
-- multi-value ADD VALUE; one-at-a-time is also the only form that can
-- run inside an implicit transaction-per-statement migration.

ALTER TYPE "AuditAction" ADD VALUE 'JOURNAL_POSTED';
ALTER TYPE "AuditAction" ADD VALUE 'JOURNAL_REVERSED';
ALTER TYPE "AuditAction" ADD VALUE 'YEAR_END_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE 'PERIOD_REOPENED';
ALTER TYPE "AuditAction" ADD VALUE 'AP_BILL_POSTED';
ALTER TYPE "AuditAction" ADD VALUE 'AP_BILL_VOIDED';
ALTER TYPE "AuditAction" ADD VALUE 'AR_INVOICE_POSTED';
ALTER TYPE "AuditAction" ADD VALUE 'AR_INVOICE_VOIDED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYSLIP_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE 'SALARY_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'USER_DEPROVISIONED';
ALTER TYPE "AuditAction" ADD VALUE 'DATA_EXPORTED';
ALTER TYPE "AuditAction" ADD VALUE 'BULK_EXPORT_FLAGGED';
