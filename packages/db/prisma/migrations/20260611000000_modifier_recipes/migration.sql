-- Modifier recipes
-- Adds the recipeMultiplier column on modifier_options + a new
-- modifier_option_ingredients junction so a sale of "Latte · Grande · +1 shot"
-- can both deduct an espresso shot from inventory AND scale the base BOM
-- consumption up 25%.
--
-- Both writes plug into the existing RawMaterialInventory decrement +
-- COGS journal pipeline used by BomItem.

ALTER TABLE "modifier_options"
  ADD COLUMN "recipeMultiplier" DECIMAL(8, 4) NOT NULL DEFAULT 1.0;

CREATE TABLE "modifier_option_ingredients" (
  "id"               TEXT NOT NULL,
  "modifierOptionId" TEXT NOT NULL,
  "rawMaterialId"    TEXT NOT NULL,
  "quantity"         DECIMAL(14, 4) NOT NULL,
  "unit"             TEXT NOT NULL,
  CONSTRAINT "modifier_option_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "modifier_option_ingredients_modifierOptionId_rawMaterialId_key"
  ON "modifier_option_ingredients"("modifierOptionId", "rawMaterialId");

CREATE INDEX "modifier_option_ingredients_modifierOptionId_idx"
  ON "modifier_option_ingredients"("modifierOptionId");

CREATE INDEX "modifier_option_ingredients_rawMaterialId_idx"
  ON "modifier_option_ingredients"("rawMaterialId");

ALTER TABLE "modifier_option_ingredients"
  ADD CONSTRAINT "modifier_option_ingredients_modifierOptionId_fkey"
  FOREIGN KEY ("modifierOptionId") REFERENCES "modifier_options"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "modifier_option_ingredients"
  ADD CONSTRAINT "modifier_option_ingredients_rawMaterialId_fkey"
  FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
