import {
  IsArray, IsBase64, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsPositive,
  IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RAW_MATERIAL_CATEGORIES, RawMaterialCategoryValue } from '../../inventory/dto/create-raw-material.dto';
import { EXPENSE_CATEGORIES, ExpenseCategory } from '../receipt-parser';

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ReceiptMediaType = (typeof MEDIA_TYPES)[number];

/** A photo, nothing else. What it says comes back as a suggestion to correct. */
export class ParseReceiptDto {
  @IsString()
  @IsBase64()
  imageBase64!: string;

  @IsOptional()
  @IsIn(MEDIA_TYPES)
  mediaType?: ReceiptMediaType;
}

/**
 * An ingredient the shop does not have yet, created on the way in.
 *
 * Deliberately minimal: name, the unit it will be counted in, and what it is.
 * Cost comes from the receipt line itself, so it is never asked for twice.
 */
export class ReceiptNewMaterialDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(20)
  unit!: string;

  @IsOptional()
  @IsIn(RAW_MATERIAL_CATEGORIES)
  category?: RawMaterialCategoryValue;
}

/** One printed line that goes ON THE SHELF -- an ingredient or a stocked supply. */
export class ReceiptStockLineDto {
  /** An existing ingredient. Exactly one of this or `create` must be given. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  rawMaterialId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReceiptNewMaterialDto)
  create?: ReceiptNewMaterialDto;

  /** How many CONTAINERS (or kilos, or litres) the receipt shows. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  packsBought!: number;

  /** What one of those holds, in the ingredient's own unit. 1000 for a kilo of a gram-counted item. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  packSize!: number;

  /**
   * Price of ONE container, as printed. Positive: a zero here is a price that
   * was not read, and a zero that reaches the shelf dilutes the weighted
   * average of everything it touches. A genuinely free item goes in by hand
   * through Stock on hand, which already accepts no cost.
   */
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  packCost!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandNote?: string;

  /** "The price really did change" -- passes the order-of-magnitude guard on receive. */
  @IsOptional()
  @IsBoolean()
  acceptCostChange?: boolean;
}

/** One printed line that is NOT stock: a delivery fee, a service, a repair. */
export class ReceiptExpenseLineDto {
  @IsString()
  @MaxLength(200)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;
}

export class ConfirmReceiptDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendor?: string;

  /** The date printed on the receipt (YYYY-MM-DD). Stock and expenses post on this day. */
  @IsOptional()
  @IsDateString()
  receiptDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;

  /** Where the money came from. CREDIT is deliberately not offered: that needs a vendor bill. */
  @IsIn(['CASH', 'OWNER_FUNDED'])
  paymentMethod!: 'CASH' | 'OWNER_FUNDED';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptStockLineDto)
  lines!: ReceiptStockLineDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptExpenseLineDto)
  expenses?: ReceiptExpenseLineDto[];

  /** The photo, kept with the request as its supporting document. */
  @IsOptional()
  @IsString()
  @IsBase64()
  imageBase64?: string;

  @IsOptional()
  @IsIn(MEDIA_TYPES)
  mediaType?: ReceiptMediaType;

  /**
   * A key the client makes once per receipt and resends on retry. A second
   * confirm carrying the same key returns the first result instead of posting
   * the delivery again -- the same rule receive already applies per line,
   * lifted to the whole receipt.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  idempotencyKey?: string;
}
