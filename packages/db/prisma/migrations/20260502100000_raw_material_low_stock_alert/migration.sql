-- Add low-stock alert threshold to raw materials
-- Nullable so existing rows are unaffected; same unit as the ingredient itself.
ALTER TABLE "raw_materials" ADD COLUMN IF NOT EXISTS "lowStockAlert" DECIMAL(12,4);
