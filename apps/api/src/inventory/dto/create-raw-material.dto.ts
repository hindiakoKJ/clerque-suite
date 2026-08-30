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
}
