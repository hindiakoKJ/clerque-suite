-- Cash Paid-Out / Cash Drop on POS shifts.
-- Lets cashiers log legitimate cash leaving the till during a shift so
-- the close-shift cash variance reconciles correctly.

-- 1. New enum
CREATE TYPE "CashOutType" AS ENUM ('PAID_OUT', 'CASH_DROP');

-- 2. shift_cash_outs table
CREATE TABLE "shift_cash_outs" (
    "id"              TEXT           NOT NULL,
    "tenantId"        TEXT           NOT NULL,
    "branchId"        TEXT           NOT NULL,
    "shiftId"         TEXT           NOT NULL,
    "type"            "CashOutType"  NOT NULL,
    "amount"          DECIMAL(12,2)  NOT NULL,
    "reason"          TEXT           NOT NULL,
    "category"        TEXT,
    "receiptPhotoUrl" TEXT,
    "createdById"     TEXT           NOT NULL,
    "approvedById"    TEXT,
    "aiAssisted"      BOOLEAN        NOT NULL DEFAULT false,
    "createdAt"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_cash_outs_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes
CREATE INDEX "shift_cash_outs_tenantId_shiftId_idx"
    ON "shift_cash_outs"("tenantId", "shiftId");

CREATE INDEX "shift_cash_outs_branchId_createdAt_idx"
    ON "shift_cash_outs"("branchId", "createdAt");

-- 4. FK to shifts (cascade so closing/deleting a shift cleans up its cash-outs)
ALTER TABLE "shift_cash_outs"
    ADD CONSTRAINT "shift_cash_outs_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "shifts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
