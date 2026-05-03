-- Add per-discount PWD/SC ID fields so multiple PWD/SC customers can share an order.
-- Each OrderDiscount row of type PWD or SENIOR_CITIZEN carries its own ID and
-- cardholder name (BIR audit requires the trail per qualified individual).
ALTER TABLE "order_discounts" ADD COLUMN IF NOT EXISTS "pwdScIdRef"       TEXT;
ALTER TABLE "order_discounts" ADD COLUMN IF NOT EXISTS "pwdScIdOwnerName" TEXT;
