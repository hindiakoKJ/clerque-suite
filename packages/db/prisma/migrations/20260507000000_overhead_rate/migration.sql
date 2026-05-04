-- Sprint 6: Manufacturing overhead rate per unit produced.
-- Only meaningful for businessType = MANUFACTURING; null elsewhere.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "overheadRatePerUnit" DECIMAL(10,4);
