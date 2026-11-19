import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsDefined, IsIn, IsOptional, IsString, Matches, MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ReceiptExpenseLineDto, ReceiptImageDto, ReceiptStockLineDto,
} from '../procure/dto/receipts.dto';
import { SanityConfirmationDto } from '../common/sanity/sanity.types';
import { DOCUMENT_KINDS, type DocumentKind } from '../procure/receipt-parser';

/**
 * The bodies of the two receipt routes under /service (contract: "Paid
 * receipts by Telegram"). The lines are the Clerque app's own receipt line
 * shapes, validated by the same classes; the rest is what AIBA adds.
 */

/** POST /service/procure/receipts/read */
export class ServiceReceiptReadDto {
  /** One photo, or a long receipt in strips from top to bottom. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ReceiptImageDto)
  images!: ReceiptImageDto[];

  @IsOptional()
  @IsIn(DOCUMENT_KINDS)
  documentKind?: DocumentKind;
}

/** POST /service/procure/receipts/post */
export class ServiceReceiptPostDto {
  /**
   * AIBA's own reference, and the idempotency key: the same reference again
   * answers with the first post. Written as the receipt's replay key
   * ([RCPT:...]), so at most 80 characters, and no brackets.
   */
  @Matches(/^[A-Za-z0-9._:/-]{1,80}$/, { message: 'reference is required: 1 to 80 letters, digits or . _ : / -' })
  reference!: string;

  @IsIn(['auto', 'confirmed'])
  mode!: 'auto' | 'confirmed';

  /** The total as printed, e.g. "3482.50" (a number is accepted too). */
  @IsDefined()
  total!: string | number;

  /** The Telegram sender, as AIBA knows them. */
  @IsString()
  @MaxLength(80)
  sentBy!: string;

  /** Mode confirmed only: the person who tapped Post in Telegram. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  confirmedBy?: string;

  /** Kept with the receipt as its photo (the first one, then the other strips). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ReceiptImageDto)
  images?: ReceiptImageDto[];

  // ── the Clerque app's confirm fields ──────────────────────────────────────

  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendor?: string;

  @IsOptional()
  @IsDateString()
  receiptDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;

  /** Where the money came from. Left out, the owner's pocket. */
  @IsOptional()
  @IsIn(['CASH', 'OWNER_FUNDED', 'BANK'])
  paymentMethod?: 'CASH' | 'OWNER_FUNDED' | 'BANK';

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiptStockLineDto)
  lines!: ReceiptStockLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiptExpenseLineDto)
  expenses?: ReceiptExpenseLineDto[];

  /** Mode confirmed only: the person's answers to a SANITY refusal. Ignored in mode auto. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SanityConfirmationDto)
  sanityConfirmations?: SanityConfirmationDto[];
}
