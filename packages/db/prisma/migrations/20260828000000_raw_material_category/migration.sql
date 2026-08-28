-- What a stocked item IS: ingredient, or a supply that keeps the place running.
--
-- Nothing in the model distinguished coffee beans from bleach. Both are bought,
-- counted and run out, so both landed in the ingredient list — 17 of Cafe
-- Carolina's 283 rows were tissue, trash bags, batteries and a mixing bowl.
-- Indistinguishable from food, and therefore indistinguishable in COGS.
--
-- The column defaults to INGREDIENT rather than being nullable. A null would
-- mean "we do not know what this is", and every caller would then need to
-- decide what an unknown item does to a recipe. Defaulting says the thing that
-- is already true: every row that exists today is being treated as an
-- ingredient, so it keeps being one until someone says otherwise. Nothing
-- changes behaviour on deploy.
--
-- Deliberately NOT backfilling by name. Guessing that "Zonrox Bleach" is a
-- supply is right; guessing that "Food Keeper" is one is a coin flip, and a
-- wrong category silently removes an item from recipe costing. The 17 are
-- named in the migration notes for the owner to set, not inferred here.

CREATE TYPE "RawMaterialCategory" AS ENUM (
  'INGREDIENT',
  'KITCHEN_SUPPLY',
  'BAR_SUPPLY',
  'OFFICE_SUPPLY'
);

ALTER TABLE "raw_materials"
  ADD COLUMN IF NOT EXISTS "category" "RawMaterialCategory" NOT NULL DEFAULT 'INGREDIENT';

-- The low-stock and buy-now screens read "everything that is not an
-- ingredient" as often as they read ingredients, and both are per-tenant.
CREATE INDEX IF NOT EXISTS "raw_materials_tenant_category_idx"
  ON "raw_materials" ("tenantId", "category");
