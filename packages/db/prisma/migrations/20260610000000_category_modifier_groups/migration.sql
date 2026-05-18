-- Category-level modifier groups
-- Adds optional categoryId to modifier_groups so a group can auto-apply to
-- every product in a category, without per-product ProductModifierGroup rows.
-- ON DELETE SET NULL preserves modifier groups if their category is removed.

ALTER TABLE "modifier_groups" ADD COLUMN "categoryId" TEXT;

ALTER TABLE "modifier_groups"
  ADD CONSTRAINT "modifier_groups_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "modifier_groups_tenantId_categoryId_idx"
  ON "modifier_groups"("tenantId", "categoryId");
