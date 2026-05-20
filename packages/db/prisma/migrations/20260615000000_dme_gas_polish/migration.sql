-- DME + Gas polish
-- Adds:
--   • Tenant.fdaLicenseNumber  — DME tenants print their LTO on the receipt
--   • FuelPump.doeCeilingPricePhp — manual DOE ceiling per pump; Counter
--     warns when the linked Product.price exceeds it

ALTER TABLE "tenants"     ADD COLUMN "fdaLicenseNumber"   TEXT;
ALTER TABLE "fuel_pumps"  ADD COLUMN "doeCeilingPricePhp" DECIMAL(8, 2);
