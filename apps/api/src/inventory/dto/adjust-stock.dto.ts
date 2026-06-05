import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const STOCK_ADJUST_TYPES = ['INITIAL', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as const;
export type StockAdjustType = (typeof STOCK_ADJUST_TYPES)[number];

/**
 * SecAudit 2026-05 A3 — enumerated reason codes for negative adjustments.
 * BIR examination + internal audit both expect a justification on every
 * write-off. A free-text "reason" string is too easy for a colluding
 * manager to fill with "test" or "correction". Forcing a code surfaces
 * the intent in reports and lets the maker-checker queue route by
 * category.
 */
export const STOCK_ADJUST_REASON_CODES = [
  'DAMAGE',
  'THEFT',
  'EXPIRY',
  'COUNT_CORRECTION',
  'SAMPLE',
  'INTERNAL_USE',
  'PROMO_GIVEAWAY',
  'OTHER',
] as const;
export type StockAdjustReasonCode = (typeof STOCK_ADJUST_REASON_CODES)[number];

export class AdjustStockDto {
  @ApiProperty({ example: 'clxyz123...' })
  @IsString()
  productId: string;

  @ApiProperty({ example: 'clxyz456...' })
  @IsString()
  branchId: string;

  /** Positive = add stock; negative = remove stock. */
  @ApiProperty({ example: 10, description: 'Positive = add, negative = remove' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ enum: ['INITIAL', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'], example: 'STOCK_IN' })
  @IsEnum(STOCK_ADJUST_TYPES)
  type: StockAdjustType;

  /**
   * SecAudit 2026-05 A3 — enumerated reason. REQUIRED for negative
   * adjustments and STOCK_OUT (the service enforces this; we keep it
   * optional in the DTO so positive STOCK_IN doesn't always need a
   * reason — supplier-delivery is implicit). The literal string can
   * still describe specifics in `note`.
   */
  @ApiPropertyOptional({
    enum: STOCK_ADJUST_REASON_CODES,
    example: 'COUNT_CORRECTION',
    description: 'Required for STOCK_OUT and any negative quantity.',
  })
  @IsOptional()
  @IsEnum(STOCK_ADJUST_REASON_CODES)
  reasonCode?: StockAdjustReasonCode;

  /** Legacy free-text reason — kept for back-compat with existing clients. */
  @ApiPropertyOptional({ example: 'Supplier delivery' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  /**
   * SecAudit 2026-05 A3 — supervisor PIN required for negative
   * adjustments above tenant.inventoryAdjustmentPinThreshold (defaults to
   * any negative). Validated server-side against User.supervisorPinHash
   * for a user with VOID_DIRECT_ROLES.
   */
  @ApiPropertyOptional({ example: '4291' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  supervisorPin?: string;

  @ApiPropertyOptional({ example: 'DR #12345' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /**
   * Per-unit cost for this receipt. Drives Moving-Average Cost (WAC):
   *   newAvg = (oldQty × oldAvg + receivedQty × unitCost) / (oldQty + receivedQty)
   * Used only on positive-quantity STOCK_IN / INITIAL receipts. If omitted,
   * we fall back to Product.costPrice — same behaviour as before WAC.
   */
  @ApiPropertyOptional({ example: 60.00, description: 'Unit cost (₱) for this receipt — drives WAC.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  unitCost?: number;
}
