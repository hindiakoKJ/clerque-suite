import {
  IsIn, IsNumber, Min, IsString, IsOptional, MaxLength, IsDateString,
} from 'class-validator';

/**
 * "Simple Entry" — plain-language operational bookkeeping for the SIMPLE tier
 * (Solo Books). Each type maps to a fixed, balanced 2-line journal entry that
 * is posted to the real books via JournalService. The user never sees debits
 * or credits.
 */
export const SIMPLE_ENTRY_TYPES = [
  'EXPENSE',            // money out for an operating cost
  'OTHER_INCOME',       // money in that is NOT a POS sale
  'OWNER_CONTRIBUTION', // owner puts money into the business
  'OWNER_DRAWING',      // owner takes money out for personal use
  'DEPOSIT_TO_BANK',    // move till cash to the bank
  'WITHDRAW_TO_CASH',   // move bank money to the till
  /*
    Goods paid for before they are here -- a Shopee order, a deposit to a
    supplier. The money leaves the pocket now and waits in 1063 Advance
    Deposits (a clearing account, like a GR/IR) until the goods arrive and
    take it onto the shelf; a refund brings it back to the pocket; a parcel
    that never comes is written off.
  */
  'PAID_AHEAD',           // Dr 1063 / Cr pocket
  'PAID_AHEAD_REFUND',    // Dr pocket / Cr 1063
  'PAID_AHEAD_WRITE_OFF', // Dr 6140 / Cr 1063
] as const;
export type SimpleEntryType = (typeof SIMPLE_ENTRY_TYPES)[number];

export const EXPENSE_CATEGORIES = [
  'RENT', 'UTILITIES', 'SUPPLIES', 'REPAIRS', 'TRANSPORT', 'FREIGHT', 'OTHER',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export class CreateSimpleEntryDto {
  @IsIn(SIMPLE_ENTRY_TYPES)
  type!: SimpleEntryType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  /** Document date (YYYY-MM-DD). */
  @IsDateString()
  date!: string;

  /** Funding account for non-transfer types. Ignored for deposit/withdraw. */
  @IsOptional()
  @IsIn(['CASH', 'BANK'])
  source?: 'CASH' | 'BANK';

  /** Expense category — only used when type === 'EXPENSE'. Defaults to OTHER. */
  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
