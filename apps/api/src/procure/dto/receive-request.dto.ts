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
import { EXPENSE_CATEGORIES, ExpenseCategory } from '../../simple-entries/dto/simple-entry.dto';

/**
 * Where the money for a delivery came from.
 *
 *   CASH          the till drawer            -> Cr 1010 Cash on Hand
 *   OWNER_FUNDED  the owner's own pocket     -> Cr 3010 Owner's Capital
 *   BANK          the shop's bank or GCash   -> Cr 1020 Cash in Bank
 *
 * CREDIT is deliberately not here: that needs a supplier and a bill, and the
 * request path has neither yet.
 */
export const PROCURE_POCKETS = ['CASH', 'OWNER_FUNDED', 'BANK'] as const;
export type ProcurePocket = (typeof PROCURE_POCKETS)[number];

/** What to do about packs that were bought but did not arrive. */
export const SHORT_OUTCOMES = ['STILL_COMING', 'REFUNDED', 'LOST', 'NOT_COMING'] as const;
export type ShortOutcome = (typeof SHORT_OUTCOMES)[number];

/** One line to post now, with how much of it actually arrived. */
export class ReceiveLineDto {
  @IsString()
  @MaxLength(40)
  lineId!: string;

  /**
   * How many packs are in the box, when fewer than were bought. Omit when
   * everything came. Zero means none of it did.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  packsArrived?: number;
}

export class CloseShortDto {
  @IsString()
  @MaxLength(40)
  lineId!: string;

  @IsIn(SHORT_OUTCOMES)
  outcome!: ShortOutcome;
}

/** A charge that came with the goods but is not stock: shipping, a platform fee, parking. */
export class ReceiveChargeDto {
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

export class ReceiveRequestDto {
  @IsOptional()
  @IsIn(PROCURE_POCKETS)
  paymentMethod?: ProcurePocket;

  /** "The price really did change" -- passes the order-of-magnitude guard. */
  @IsOptional()
  @IsBoolean()
  acceptCostChange?: boolean;

  /** The day the goods came (YYYY-MM-DD). Stock and the books post on this day. Defaults to today. */
  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  /** One line for a person: the stall, the receipt number, "no receipt". */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  /** Only these lines. Omit to post every line that has packs recorded. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines?: ReceiveLineDto[];

  /** For a line that came short: what happens to the rest. Default: still coming. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CloseShortDto)
  closeShort?: CloseShortDto[];

  /**
   * Close the request after this post. Anything not posted goes back on the
   * branch's open shopping list, because it still has to be bought.
   */
  @IsOptional()
  @IsBoolean()
  closeRest?: boolean;

  /** Charges that came with the goods. Posted once, with the lines. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReceiveChargeDto)
  charges?: ReceiveChargeDto[];
}

export class BoughtLineInputDto {
  @IsString()
  @MaxLength(40)
  lineId!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  packsBought!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  packSize!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  packCost!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandNote?: string;
}

export class RecordBoughtDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BoughtLineInputDto)
  lines!: BoughtLineInputDto[];

  /** The stall, the seller, the order number -- one line, for a person. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  /** The day it was bought or ordered (YYYY-MM-DD), when that is not today. */
  @IsOptional()
  @IsDateString()
  boughtAt?: string;

  /** Ordered online or from a supplier: paid or promised, not here yet. */
  @IsOptional()
  @IsBoolean()
  onTheWay?: boolean;
}

/** "Remaining: 1 bottle" -- what is left on the shelf, in the ingredient's own unit. */
export class RecordCountDto {
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  countedQty!: number;
}

export const PHOTO_LABELS = ['Receipt', 'Order', 'Delivery receipt', 'Sales invoice'] as const;
export type PhotoLabel = (typeof PHOTO_LABELS)[number];
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** A photo of the paper, filed against the request by whoever is holding it. */
export class AttachPhotoDto {
  @IsString()
  @IsBase64()
  imageBase64!: string;

  @IsOptional()
  @IsIn(MEDIA_TYPES)
  mediaType?: (typeof MEDIA_TYPES)[number];

  @IsOptional()
  @IsIn(PHOTO_LABELS)
  label?: PhotoLabel;
}
