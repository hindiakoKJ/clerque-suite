-- Magnet Books / simple-mode slice (2026-08-17). Additive, backfill-free:
-- every existing tenant keeps FULL ledger + PH/PHP/Asia-Manila.

-- CreateEnum
CREATE TYPE "LedgerMode" AS ENUM ('FULL', 'SIMPLE');

-- AlterTable
ALTER TABLE "tenants"
  ADD COLUMN "ledgerMode" "LedgerMode" NOT NULL DEFAULT 'FULL',
  ADD COLUMN "country"    TEXT         NOT NULL DEFAULT 'PH',
  ADD COLUMN "currency"   TEXT         NOT NULL DEFAULT 'PHP',
  ADD COLUMN "timezone"   TEXT         NOT NULL DEFAULT 'Asia/Manila';
