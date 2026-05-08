-- ──────────────────────────────────────────────────────────────────────────
-- 2026-05-12 — POS → Ledger completeness sweep
--
-- Adds two AccountingEventType values so cash flow events that previously
-- escaped the GL now have a typed event row:
--
--   PAID_OUT       — mid-shift cash-out (cashier paid for supplies/transport
--                    from the till). DR Expense / CR Cash on Hand at posting.
--   CASH_VARIANCE  — declared cash != expected cash at shift close. DR/CR
--                    cash + variance income / expense.
--
-- Idempotent: ADD VALUE IF NOT EXISTS makes re-running safe across multi-replica
-- deploys and any environment that may have applied via prisma db push first.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TYPE "AccountingEventType" ADD VALUE IF NOT EXISTS 'PAID_OUT';
ALTER TYPE "AccountingEventType" ADD VALUE IF NOT EXISTS 'CASH_VARIANCE';
