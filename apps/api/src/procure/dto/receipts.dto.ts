import {
  ArrayMaxSize,
  IsArray,
  IsBase64,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SOURCE_KINDS, type SourceKind } from '@repo/shared-types';
import { SanityConfirmationDto } from '../../common/sanity/sanity.types';
import { RAW_MATERIAL_CATEGORIES, RawMaterialCategoryValue } from '../../inventory/dto/create-raw-material.dto';
import { EXPENSE_CATEGORIES, ExpenseCategory, DOCUMENT_KINDS, DocumentKind } from '../receipt-parser';

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ReceiptMediaType = (typeof MEDIA_TYPES)[number];

/** A photo, nothing else. What it says comes back as a suggestion to correct. */
/** One image, or one strip of a long one. */
export class ReceiptImageDto {
  @IsString()
  @IsBase64()
  base64!: string;

  @IsOptional()
  @IsIn(MEDIA_TYPES)
  mediaType?: ReceiptMediaType;
}

export class ParseReceiptDto {
  /**
   * A whole receipt in one frame. Still accepted, and still what a short
   * supermarket slip sends.
   */
  @IsOptional()
  @IsString()
  @IsBase64()
  imageBase64?: string;

  @IsOptional()
  @IsIn(MEDIA_TYPES)
  mediaType?: ReceiptMediaType;

  /**
   * A long receipt, cut into overlapping strips top to bottom.
   *
   * A metre of thermal paper squeezed into one frame is unreadable by
   * anything — the text ends up a few pixels tall. The phone cuts it into
   * strips at full width instead, and they are read together as one receipt.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ReceiptImageDto)
  images?: ReceiptImageDto[];

  /**
   * The request this receipt belongs to. Its own ingredients are matched
   * first, so a reading that could be either of two sugars lands on the one
   * the kitchen asked for.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  purchaseRequestId?: string;

  /** What the photo is of: a till receipt (default), an online order page, or a supplier's delivery slip. */
  @IsOptional()
  @IsIn(DOCUMENT_KINDS)
  documentKind?: DocumentKind;

  /**
   * Read this one receipt with the OTHER provider.
   *
   * The point of keeping both alive is being able to put the same photo
   * through each and compare what comes back, and that is worth nothing if
   * it needs an environment change and a redeploy. Owner-only: it chooses
   * who gets billed for the read, and the two do not cost the same.
   */
  @IsOptional()
  @IsIn(['gemini', 'anthropic'])
  provider?: 'gemini' | 'anthropic';
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

  /**
   * Write the receipt ONTO this request -- the list the kitchen sent --
   * instead of making a second request beside it. The request's own lines
   * get their packs, size and price; a printed line that is not on the list
   * becomes a new line with the next control number.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  purchaseRequestId?: string;

  /**
   * Record only: write the lines and file the photo, post nothing. For an
   * order screenshot on the day it was placed, or a delivery slip before
   * the owner has looked. Default true. Ignored without purchaseRequestId.
   */
  @IsOptional()
  @IsBoolean()
  postNow?: boolean;

  /**
   * With postNow:false onto a request: the goods were paid for on order
   * day, from paymentMethod. The money leaves now into 1063 and the arrival
   * costs nothing more. The expense lines (shipping, a platform fee) post
   * now too, from the same pocket.
   */
  @IsOptional()
  @IsBoolean()
  paidAhead?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendor?: string;

  /**
   * What kind of place the vendor is: the palengke, a grocery, online, a
   * supplier. Written on every line with the vendor as the store, for the
   * where-bought report. Left out, the lines carry the vendor name only.
   */
  @IsOptional()
  @IsIn(SOURCE_KINDS)
  sourceKind?: SourceKind;

  /** The date printed on the receipt (YYYY-MM-DD). Stock and expenses post on this day. */
  @IsOptional()
  @IsDateString()
  receiptDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;

  /**
   * Where the money came from: the till, the owner's pocket, or the shop's
   * bank or GCash. CREDIT is deliberately not offered: that needs a vendor bill.
   */
  @IsIn(['CASH', 'OWNER_FUNDED', 'BANK'])
  paymentMethod!: 'CASH' | 'OWNER_FUNDED' | 'BANK';

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

  /** "Yes, this price is right" — the answers to a SANITY_CONFIRM_REQUIRED refusal. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SanityConfirmationDto)
  sanityConfirmations?: SanityConfirmationDto[];
}
