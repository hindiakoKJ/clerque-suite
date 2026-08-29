-- Sub-recipes: a prepared ingredient that has its own recipe.
--
-- White Sugar Syrup is made from 1000 g White Sugar + 500 ml Water. Until now
-- nothing recorded that, so selling a latte consumed syrup while the sugar sat
-- untouched forever -- it could never fall, never reach a reorder alert, and
-- never appear on a buy list. The shop runs out of sugar with the system
-- insisting it holds eight kilos.
--
-- Additive only. BomItem is read across 15 services and 21 query sites; giving
-- it a nullable parent would put all of them in the blast radius of a change
-- none of them care about. This mirrors what the schema already does three
-- times over -- BomItem, VariantBomItem, ModifierOptionIngredient are parallel
-- tables with one shape and different parents.

-- How much ONE batch yields, in the material's own unit. NULL on ordinary
-- ingredients. This is what makes the cost checkable: the value of the inputs
-- must equal batchYield x costPrice, or a batch invents or destroys value.
ALTER TABLE "raw_materials" ADD COLUMN "batchYield" DECIMAL(12,4);

CREATE TABLE "sub_recipe_items" (
    "id"                  TEXT NOT NULL,
    "parentRawMaterialId" TEXT NOT NULL,
    "rawMaterialId"       TEXT NOT NULL,
    "quantity"            DECIMAL(12,4) NOT NULL,

    CONSTRAINT "sub_recipe_items_pkey" PRIMARY KEY ("id")
);

-- One line per component. A second entry for the same ingredient would be an
-- edit, not an addition, and silently double the batch.
CREATE UNIQUE INDEX "sub_recipe_items_parentRawMaterialId_rawMaterialId_key"
    ON "sub_recipe_items"("parentRawMaterialId", "rawMaterialId");
CREATE INDEX "sub_recipe_items_parentRawMaterialId_idx" ON "sub_recipe_items"("parentRawMaterialId");
CREATE INDEX "sub_recipe_items_rawMaterialId_idx"       ON "sub_recipe_items"("rawMaterialId");

-- Deleting the sub-recipe removes its recipe with it.
ALTER TABLE "sub_recipe_items" ADD CONSTRAINT "sub_recipe_items_parentRawMaterialId_fkey"
    FOREIGN KEY ("parentRawMaterialId") REFERENCES "raw_materials"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- But an ingredient still used by some sub-recipe cannot be deleted out from
-- under it -- same rule BomItem already applies for products.
ALTER TABLE "sub_recipe_items" ADD CONSTRAINT "sub_recipe_items_rawMaterialId_fkey"
    FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- A sub-recipe cannot contain itself. Deeper cycles (A needs B needs A) are
-- caught in the service, where the whole tree is walked; this covers the
-- one-step case cheaply and permanently.
ALTER TABLE "sub_recipe_items" ADD CONSTRAINT "sub_recipe_items_no_self_reference"
    CHECK ("parentRawMaterialId" <> "rawMaterialId");
