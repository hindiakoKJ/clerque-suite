import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, IsIn, MaxLength } from 'class-validator';

/**
 * Taking stock OFF the shelf for a reason that is not a sale.
 *
 * There was no way to do this at all. `adjust` resolves a productId against
 * the Product table, so it cannot address a raw material — spoiled milk,
 * a dropped bottle of syrup and a bag of beans past its date were simply
 * unrecordable. The stock stayed on the books, the recipe kept believing it
 * was there, and the POS kept offering drinks nobody could make.
 */
export const WRITE_OFF_REASONS = [
  'EXPIRY',       // past its date
  'DAMAGE',       // dropped, spilled, spoiled
  'THEFT',        // missing, believed taken
  'SAMPLE',       // given away to a customer or for training
  'INTERNAL_USE', // staff drinks, a test batch
  'OTHER',
] as const;
export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];

export class WriteOffRawMaterialDto {
  @IsString()
  @IsNotEmpty()
  branchId: string;

  /** How much is leaving, in the material's own unit. Always POSITIVE. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity: number;

  /**
   * Why it left. Required, and not a free-text field, because it decides
   * which expense account the loss lands in — spoilage is not cost of sale,
   * and a shop that cannot tell them apart cannot see waste getting worse.
   */
  @IsIn(WRITE_OFF_REASONS)
  reasonCode: WriteOffReason;

  /** What actually happened, in the person's own words. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Idempotency key. The same string can only ever remove stock once, which
   * is what stops a double-tap on a tablet writing the milk off twice.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;
}
