import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class JournalLineInputDto {
  @IsString()
  accountId: string;

  /**
   * Either `debit` or `credit` (or both) must be provided.
   * Zero is allowed; null/undefined omits the field.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreateJournalDto {
  /** Document Date — ISO date string (YYYY-MM-DD) */
  @IsDateString()
  date: string;

  /**
   * Posting Date — ISO date string; determines which accounting period receives the entry.
   * Defaults to `date` if omitted.
   */
  @IsOptional()
  @IsDateString()
  postingDate?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  /** External reference: invoice #, OR #, voucher #, etc. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineInputDto)
  lines: JournalLineInputDto[];

  /** When true, save as DRAFT rather than posting immediately. */
  @IsOptional()
  @IsBoolean()
  saveDraft?: boolean;
}
