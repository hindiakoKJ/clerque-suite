-- Sprint 19 — Wash+Dry combo: separate washer + dryer machine slots.
--
-- Most Filipino laundromats run separate washers and dryers, not all-in-one
-- COMBO units. Forcing combo packages to pick a non-existent COMBO machine
-- effectively hid the entire fleet from the dropdown. The new dryerMachineId
-- column lets a WASH_DRY_COMBO line reference a washer for the wash phase
-- AND a dryer for the dry phase, so the existing fleet works for combo
-- packages without inventing fictional machines.
--
-- Behaviour:
--   - Non-combo lines (WASH / DRY / DRY_CLEAN / IRON / FOLD): dryerMachineId
--     is always NULL. machineId carries the single machine when applicable.
--   - WASH_DRY_COMBO lines: machineId = washer slot, dryerMachineId = dryer
--     slot. Either may also be a COMBO machine (same machine in both slots
--     is rejected at the service layer).

ALTER TABLE "laundry_order_lines"
  ADD COLUMN IF NOT EXISTS "dryerMachineId" TEXT;

ALTER TABLE "laundry_order_lines"
  ADD CONSTRAINT "laundry_order_lines_dryerMachineId_fkey"
    FOREIGN KEY ("dryerMachineId") REFERENCES "laundry_machines"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "laundry_order_lines_dryerMachineId_idx"
  ON "laundry_order_lines" ("dryerMachineId");
