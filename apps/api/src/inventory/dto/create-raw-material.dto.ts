import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, MaxLength, IsIn } from 'class-validator';

/** Mirrors the RawMaterialCategory enum in the Prisma schema. */
export const RAW_MATERIAL_CATEGORIES = [
  'INGREDIENT', 'KITCHEN_SUPPLY', 'BAR_SUPPLY', 'OFFICE_SUPPLY',
] as const;
export type RawMaterialCategoryValue = (typeof RAW_MATERIAL_CATEGORIES)[number];

export class CreateRawMaterialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  /** Unit of measure label: g, ml, kg, pc, oz, tsp, tbsp, cup, etc. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit: string;

  /**
   * What this item IS: something that goes into a recipe, or a supply that
   * keeps the place running.
   *
   * The column has existed since migration 20260828000000 but nothing could
   * SET it — no DTO field, no service handling, no UI — so every row in every
   * tenant sat on the INGREDIENT default, bleach and coffee beans alike. A
   * classification nobody can apply is not a classification.
   *
   * Omitted means unchanged (or INGREDIENT on create), which keeps existing
   * behaviour exactly as it was.
   */
  @IsOptional()
  @IsIn(RAW_MATERIAL_CATEGORIES)
  category?: RawMaterialCategoryValue;

  /** Cost per unit (in ₱). Used for WAC COGS calculation. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costPrice?: number;

  /** Stock level below which the ingredient is flagged as low (same unit as ingredient). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  lowStockAlert?: number | null;

  /**
   * The unit RECIPES use, when it differs from the unit the shop BUYS in.
   *
   * Rice is bought by the sack and portioned by the gram. Everything
   * downstream speaks one unit per ingredient, so the two have to be
   * reconciled once, here, while the person still remembers which was which —
   * `unit` above is only a label and nothing converts it later.
   *
   * Omitted, or the same as `unit`, means there is nothing to reconcile, which
   * is every drink ingredient and every item created before this existed.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  recipeUnit?: string;

  /**
   * How many `recipeUnit` are in one `unit`, when no conversion exists.
   *
   * kg → g is arithmetic. "1 bottle → ml" is not: only the person holding the
   * bottle knows it is 750. Required for a countable container, and refused
   * when the units already convert, because giving both means one of them is
   * being ignored.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  packSize?: number | null;
}
